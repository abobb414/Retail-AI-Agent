/**
 * D1 schema:
 *
 * CREATE TABLE IF NOT EXISTS products (
 *     id TEXT PRIMARY KEY,
 *     vector_id TEXT UNIQUE,
 *     name TEXT NOT NULL,
 *     brand TEXT,
 *     price REAL,
 *     price_display TEXT,
 *     url TEXT,
 *     description TEXT,
 *     image TEXT,
 *     ideal_for TEXT,
 *     avoid_for TEXT,
 *     department TEXT,
 *     product_type TEXT,
 *     subcategory TEXT,
 *     gender TEXT,
 *     size_options TEXT,
 *     attributes TEXT
 * );
 *
 * If you already created the smaller table from the first import version, add:
 *
 * ALTER TABLE products ADD COLUMN vector_id TEXT;
 * ALTER TABLE products ADD COLUMN brand TEXT;
 * ALTER TABLE products ADD COLUMN price_display TEXT;
 * ALTER TABLE products ADD COLUMN image TEXT;
 * ALTER TABLE products ADD COLUMN ideal_for TEXT;
 * ALTER TABLE products ADD COLUMN avoid_for TEXT;
 * CREATE UNIQUE INDEX IF NOT EXISTS products_vector_id_idx ON products(vector_id);
 */

export interface Env {
  DB: D1Database;
  VECTOR_INDEX: VectorizeIndex;
  AI: Ai;
}

import {
  DEPARTMENT_LABELS,
  brandMatches,
  detectRequestProfile,
  getProductTypeLabel,
  getSearchTerms,
  normalizeText,
  type Department,
  type Gender,
  type RequestProfile,
} from "./catalogTaxonomy.ts";

type RawProduct = {
  id: string;
  name: string;
  brand?: string;
  price_range?: string;
  source_url?: string;
  image?: string;
  feature?: string;
  keywords?: string[];
  ideal_for?: string[];
  avoid_for?: string[];
  department?: Department;
  product_type?: string;
  subcategory?: string;
  gender?: Gender | null;
  size_options?: string[];
  attributes?: Record<string, unknown>;
  price_cny?: number | null;
  price_display?: string;
};

type CleanProduct = {
  id: string;
  vectorId: string;
  name: string;
  brand: string;
  price: number;
  priceDisplay: string;
  url: string;
  description: string;
  image: string;
  idealFor: string[];
  avoidFor: string[];
  department: Department;
  productType: string;
  subcategory: string;
  gender: Gender | null;
  sizeOptions: string[];
  attributes: Record<string, unknown>;
  embeddingText: string;
};

type ProductRow = {
  id: string;
  vector_id: string | null;
  name: string;
  brand: string | null;
  price: number | null;
  price_display: string | null;
  url: string | null;
  description: string | null;
  image: string | null;
  ideal_for: string | null;
  avoid_for: string | null;
  department: Department | null;
  product_type: string | null;
  subcategory: string | null;
  gender: Gender | null;
  size_options: string | null;
  attributes: string | null;
};

type ProductContext = {
  id: string;
  vector_id: string;
  name: string;
  brand: string;
  price: number;
  price_display: string;
  url: string;
  description: string;
  image: string;
  ideal_for: string[];
  avoid_for: string[];
  department: Department;
  product_type: string;
  subcategory: string;
  gender: Gender | null;
  size_options: string[];
  attributes: Record<string, unknown>;
  vector_score: number;
};

type ChatPayload = {
  message: string;
};

type AiEmbeddingResponse = {
  data?: number[][] | number[];
  shape?: number[];
};

type RecommendedProduct = {
  id: string;
  name: string;
  brand: string;
  category: string;
  department: string;
  product_type: string;
  gender: Gender | null;
  attributes: Record<string, unknown>;
  price_display: string;
  image: string;
  url: string;
  why_buy: string;
  ideal_for: string[];
  avoid_for: string[];
  next_step_tip: string;
};

type ChatResponse = {
  chat_reply: string;
  recommended_product: RecommendedProduct | null;
  stage?: "clarify_slots" | "rag_recommendation" | "no_vector_match";
};

class HttpError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const EMBEDDING_MODEL = "@cf/baai/bge-m3";
const EMBEDDING_DIMENSIONS = 1024;
const INGEST_BATCH_SIZE = 8;
const VECTOR_TOP_K = 20;
const LEXICAL_TOP_K = 120;
const textEncoder = new TextEncoder();

const jsonHeaders = {
  "content-type": "application/json; charset=utf-8",
};

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: corsHeaders(),
      });
    }

    const url = new URL(request.url);

    try {
      if (url.pathname === "/api/chat") {
        return await handleChat(request, env);
      }

      return await handleIngest(request, env);
    } catch (error) {
      console.error(
        JSON.stringify({
          message: "Worker request failed",
          path: url.pathname,
          error: error instanceof Error ? error.message : String(error),
        }),
      );

      return jsonResponse(
        {
          ok: false,
          error: error instanceof Error ? error.message : "Unknown worker error.",
        },
        error instanceof HttpError ? error.status : 500,
      );
    }
  },
};

async function handleChat(request: Request, env: Env): Promise<Response> {
  if (request.method !== "POST") {
    return jsonResponse(
      { ok: false, error: "Method Not Allowed. Please use POST." },
      405,
      { Allow: "POST, OPTIONS" },
    );
  }

  const payload = validateChatPayload(await parseJsonBody(request));
  const clarificationReply = getClarificationReply(payload.message);

  if (clarificationReply) {
    return jsonResponse(
      {
        chat_reply: clarificationReply,
        recommended_product: null,
        stage: "clarify_slots",
      },
      200,
    );
  }

  const products = await retrieveProductsForMessage(env, payload.message);

  if (products.length === 0) {
    return jsonResponse(buildNoMatchResponse(payload.message), 200);
  }

  return jsonResponse(buildRecommendationResponse(payload.message, products[0]), 200);
}

async function handleIngest(request: Request, env: Env): Promise<Response> {
  if (request.method !== "POST") {
    return jsonResponse(
      { ok: false, error: "Method Not Allowed. Please use POST." },
      405,
      { Allow: "POST, OPTIONS" },
    );
  }

  const payload = await parseJsonBody(request);
  const products = parseProductsPayload(payload);

  if (products.length === 0) {
    throw new HttpError(400, "Request body must contain at least one product.");
  }

  const cleanedProducts = products.map(cleanProduct);
  const result = {
    ok: true,
    received: products.length,
    insertedD1: 0,
    upsertedVectorize: 0,
    batches: 0,
  };

  for (let offset = 0; offset < cleanedProducts.length; offset += INGEST_BATCH_SIZE) {
    const batch = cleanedProducts.slice(offset, offset + INGEST_BATCH_SIZE);
    const vectors = await generateProductVectors(env, batch);

    await writeProductsToD1(env, batch);
    await env.VECTOR_INDEX.upsert(vectors);

    result.insertedD1 += batch.length;
    result.upsertedVectorize += vectors.length;
    result.batches += 1;
  }

  return jsonResponse(result, 200);
}

async function parseJsonBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new HttpError(400, "Invalid JSON body.");
  }
}

function validateChatPayload(payload: unknown): ChatPayload {
  if (!payload || typeof payload !== "object") {
    throw new HttpError(400, "Request body must be an object.");
  }

  const message = (payload as Partial<ChatPayload>).message;

  if (typeof message !== "string" || message.trim().length === 0) {
    throw new HttpError(400, 'Request body must include a non-empty "message" string.');
  }

  return {
    message: message.trim(),
  };
}

function parseProductsPayload(payload: unknown): RawProduct[] {
  if (Array.isArray(payload)) {
    return payload.map(validateRawProduct);
  }

  if (
    payload &&
    typeof payload === "object" &&
    "products" in payload &&
    Array.isArray((payload as { products: unknown }).products)
  ) {
    return (payload as { products: unknown[] }).products.map(validateRawProduct);
  }

  throw new HttpError(400, "Invalid request body. Expected a product JSON array.");
}

function validateRawProduct(item: unknown, index: number): RawProduct {
  if (!item || typeof item !== "object") {
    throw new HttpError(400, `Invalid product at index ${index}: item must be an object.`);
  }

  const product = item as Partial<RawProduct>;

  if (!product.id || typeof product.id !== "string") {
    throw new HttpError(400, `Invalid product at index ${index}: id must be a string.`);
  }

  if (!product.name || typeof product.name !== "string") {
    throw new HttpError(400, `Invalid product at index ${index}: name must be a string.`);
  }

  if (product.keywords !== undefined && !Array.isArray(product.keywords)) {
    throw new HttpError(400, `Invalid product at index ${index}: keywords must be an array.`);
  }

  return {
    id: product.id,
    name: product.name,
    brand: typeof product.brand === "string" ? product.brand : "",
    price_range: typeof product.price_range === "string" ? product.price_range : "",
    source_url: typeof product.source_url === "string" ? product.source_url : "",
    image: typeof product.image === "string" ? product.image : "",
    feature: typeof product.feature === "string" ? product.feature : "",
    keywords: normalizeStringArray(product.keywords),
    ideal_for: normalizeStringArray(product.ideal_for),
    avoid_for: normalizeStringArray(product.avoid_for),
    department: isDepartment(product.department) ? product.department : "other",
    product_type: typeof product.product_type === "string" ? product.product_type : "other",
    subcategory: typeof product.subcategory === "string" ? product.subcategory : "",
    gender: isGender(product.gender) ? product.gender : null,
    size_options: normalizeStringArray(product.size_options),
    attributes: isRecord(product.attributes) ? product.attributes : {},
    price_cny: typeof product.price_cny === "number" && Number.isFinite(product.price_cny)
      ? product.price_cny
      : product.price_cny === null
        ? null
        : undefined,
    price_display: typeof product.price_display === "string" ? product.price_display : "",
  };
}

function cleanProduct(item: RawProduct): CleanProduct {
  const description = item.feature?.trim() ?? "";
  const keywords = item.keywords ?? [];
  const price = item.price_cny === null ? 0 : item.price_cny ?? parsePriceFromProduct(item);
  const priceDisplay = item.price_display?.trim() || (price > 0 ? `CNY ${price}` : item.price_cny === null ? "价格以官网为准" : item.price_range?.trim() ?? "价格以官网为准");
  const department = isDepartment(item.department) ? item.department : "other";
  const productType = item.product_type?.trim() || "other";
  const subcategory = item.subcategory?.trim() || "";
  const gender = isGender(item.gender) ? item.gender : null;
  const sizeOptions = item.size_options ?? [];
  const attributes = item.attributes ?? {};

  return {
    id: item.id,
    vectorId: createVectorId(item.id),
    name: item.name.trim(),
    brand: item.brand?.trim() || inferBrand(item),
    price,
    priceDisplay,
    url: item.source_url?.trim() ?? "",
    description,
    image: item.image?.trim() ?? "",
    idealFor: item.ideal_for ?? [],
    avoidFor: item.avoid_for ?? [],
    department,
    productType,
    subcategory,
    gender,
    sizeOptions,
    attributes,
    embeddingText: [
      `商品名称: ${item.name.trim()}`,
      `一级分类: ${DEPARTMENT_LABELS[department]}`,
      `商品类型: ${productType}`,
      subcategory ? `细分类目: ${subcategory}` : "",
      gender ? `性别: ${gender}` : "",
      sizeOptions.length ? `可选尺寸: ${sizeOptions.join(", ")}` : "",
      Object.keys(attributes).length ? `规格属性: ${JSON.stringify(attributes)}` : "",
      `核心特征: ${description}`,
      `标签: ${keywords.join(", ")}`,
    ].filter(Boolean).join("。"),
  };
}

function parsePrice(priceRange?: string): number {
  if (!priceRange) {
    return 0;
  }

  const match = priceRange.replace(/,/g, "").match(/(\d+(?:\.\d+)?)/);
  return match ? Number(match[1]) : 0;
}

function parsePriceFromProduct(item: RawProduct): number {
  const explicitPrice = [...[item.name, ...(item.keywords ?? []), item.price_range ?? ""].join(" ").matchAll(/(\d{2,6}(?:\.\d+)?)\s*(?:元|块)(?:起)?/g)]
    .map((match) => Number(match[1]))
    .filter((value) => Number.isFinite(value));

  if (explicitPrice.length) return Math.min(...explicitPrice);
  return parsePrice(item.price_range);
}

async function generateSingleEmbedding(env: Env, text: string): Promise<number[]> {
  const response = (await env.AI.run(EMBEDDING_MODEL, { text: [text] })) as AiEmbeddingResponse;
  const [embedding] = normalizeEmbeddingResponse(response, 1);

  if (embedding.length !== EMBEDDING_DIMENSIONS) {
    throw new Error(
      `Query embedding dimension mismatch. Expected ${EMBEDDING_DIMENSIONS}, got ${embedding.length}.`,
    );
  }

  return embedding;
}

async function generateProductVectors(
  env: Env,
  products: CleanProduct[],
): Promise<VectorizeVector[]> {
  const response = (await env.AI.run(EMBEDDING_MODEL, {
    text: products.map((product) => product.embeddingText),
  })) as AiEmbeddingResponse;

  const embeddings = normalizeEmbeddingResponse(response, products.length);

  return products.map((product, index) => {
    const values = embeddings[index];

    if (values.length !== EMBEDDING_DIMENSIONS) {
      throw new Error(
        `Embedding dimension mismatch for product ${product.id}. Expected ${EMBEDDING_DIMENSIONS}, got ${values.length}.`,
      );
    }

    return {
      id: product.vectorId,
      values,
    };
  });
}

function normalizeEmbeddingResponse(
  response: AiEmbeddingResponse,
  expectedCount: number,
): number[][] {
  if (!Array.isArray(response.data)) {
    throw new Error("Workers AI embedding response is missing data.");
  }

  const data = response.data;
  const embeddings = Array.isArray(data[0]) ? (data as number[][]) : [data as number[]];

  if (embeddings.length !== expectedCount) {
    throw new Error(
      `Embedding count mismatch. Expected ${expectedCount}, got ${embeddings.length}.`,
    );
  }

  for (const [index, embedding] of embeddings.entries()) {
    if (!embedding.every((value) => typeof value === "number" && Number.isFinite(value))) {
      throw new Error(`Invalid embedding values at batch index ${index}.`);
    }
  }

  return embeddings;
}

async function writeProductsToD1(env: Env, products: CleanProduct[]): Promise<void> {
  const statements = products.map((product) =>
    env.DB.prepare(
      `INSERT INTO products (
         id, vector_id, name, brand, price, price_display, url, description, image, ideal_for, avoid_for,
         department, product_type, subcategory, gender, size_options, attributes
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         vector_id = excluded.vector_id,
         name = excluded.name,
         brand = excluded.brand,
         price = excluded.price,
         price_display = excluded.price_display,
         url = excluded.url,
         description = excluded.description,
         image = excluded.image,
         ideal_for = excluded.ideal_for,
         avoid_for = excluded.avoid_for,
         department = excluded.department,
         product_type = excluded.product_type,
         subcategory = excluded.subcategory,
         gender = excluded.gender,
         size_options = excluded.size_options,
         attributes = excluded.attributes`,
    ).bind(
      product.id,
      product.vectorId,
      product.name,
      product.brand,
      product.price,
      product.priceDisplay,
      product.url,
      product.description,
      product.image,
      JSON.stringify(product.idealFor),
      JSON.stringify(product.avoidFor),
      product.department,
      product.productType,
      product.subcategory,
      product.gender,
      JSON.stringify(product.sizeOptions),
      JSON.stringify(product.attributes),
    ),
  );

  await env.DB.batch(statements);
}

async function fetchProductsByVectorMatches(
  env: Env,
  matches: VectorizeMatch[],
): Promise<ProductContext[]> {
  const ids = matches.map((match) => match.id).filter((id) => id.length > 0);

  if (ids.length === 0) {
    return [];
  }

  const placeholders = ids.map(() => "?").join(", ");
  const query = `SELECT id, vector_id, name, brand, price, price_display, url, description, image, ideal_for, avoid_for,
                        department, product_type, subcategory, gender, size_options, attributes
                 FROM products
                 WHERE vector_id IN (${placeholders}) OR id IN (${placeholders})`;
  const result = await env.DB.prepare(query).bind(...ids, ...ids).all<ProductRow>();

  const rowsByVectorId = new Map(
    (result.results ?? []).map((row) => [row.vector_id || row.id, row]),
  );
  const scoreById = new Map(matches.map((match) => [match.id, match.score]));

  return ids
    .map((id) => {
      const row = rowsByVectorId.get(id);

      if (!row) {
        return null;
      }

      return rowToProductContext(row, scoreById.get(id) ?? 0);
    })
    .filter((product): product is ProductContext => product !== null);
}

async function retrieveProductsForMessage(env: Env, message: string): Promise<ProductContext[]> {
  const lexicalProducts = await safeProductSearch("Lexical product search failed", () =>
    fetchProductsByLexicalSearch(env, message),
  );
  const lexicalCandidates = rankProductsForMessage(message, selectCandidateProducts(message, lexicalProducts));

  if (lexicalCandidates.length > 0) {
    return lexicalCandidates;
  }

  const semanticProducts = await safeProductSearch("Semantic product search failed", () =>
    fetchProductsBySemanticSearch(env, message),
  );
  const mergedProducts = mergeProducts(lexicalProducts, semanticProducts);

  return rankProductsForMessage(message, selectCandidateProducts(message, mergedProducts));
}

async function safeProductSearch(
  logMessage: string,
  search: () => Promise<ProductContext[]>,
): Promise<ProductContext[]> {
  try {
    return await search();
  } catch (error) {
    console.error(
      JSON.stringify({
        message: logMessage,
        error: error instanceof Error ? error.message : String(error),
      }),
    );

    return [];
  }
}

function selectCandidateProducts(message: string, products: ProductContext[]): ProductContext[] {
  const profile = detectRequestProfile(message);
  return products.filter((product) => productMatchesRequest(product, profile));
}

async function fetchProductsBySemanticSearch(env: Env, message: string): Promise<ProductContext[]> {
  const queryVector = await generateSingleEmbedding(env, message);
  const vectorMatches = await env.VECTOR_INDEX.query(queryVector, {
    topK: VECTOR_TOP_K,
    returnValues: false,
    returnMetadata: "none",
  });

  const matches = vectorMatches.matches ?? [];

  if (matches.length === 0) {
    return [];
  }

  return fetchProductsByVectorMatches(env, matches);
}

async function fetchProductsByLexicalSearch(env: Env, message: string): Promise<ProductContext[]> {
  const terms = buildLexicalSearchTerms(message).slice(0, 10);

  if (terms.length === 0) {
    return [];
  }

  const searchableColumns = [
    "id",
    "name",
    "brand",
    "description",
    "ideal_for",
    "avoid_for",
    "department",
    "product_type",
    "subcategory",
    "gender",
    "size_options",
    "attributes",
  ];
  const whereClauses: string[] = [];
  const bindings: string[] = [];

  for (const term of terms) {
    const likeTerm = `%${term}%`;

    for (const column of searchableColumns) {
      whereClauses.push(`LOWER(COALESCE(${column}, '')) LIKE ?`);
      bindings.push(likeTerm);
    }
  }

  const result = await env.DB.prepare(
    `SELECT id, vector_id, name, brand, price, price_display, url, description, image, ideal_for, avoid_for,
            department, product_type, subcategory, gender, size_options, attributes
     FROM products
     WHERE ${whereClauses.join(" OR ")}
     LIMIT ${LEXICAL_TOP_K}`,
  )
    .bind(...bindings)
    .all<ProductRow>();

  return (result.results ?? []).map((row) => rowToProductContext(row, 0));
}

function mergeProducts(primary: ProductContext[], secondary: ProductContext[]): ProductContext[] {
  const productsById = new Map<string, ProductContext>();

  for (const product of [...primary, ...secondary]) {
    const existingProduct = productsById.get(product.id);

    if (!existingProduct || product.vector_score > existingProduct.vector_score) {
      productsById.set(product.id, product);
    }
  }

  return [...productsById.values()];
}

function rowToProductContext(row: ProductRow, score: number): ProductContext {
  return {
    id: row.id,
    vector_id: row.vector_id || row.id,
    name: row.name,
    brand: row.brand || inferBrand(row),
    price: typeof row.price === "number" ? row.price : 0,
    price_display: row.price_display || formatPrice(row.price),
    url: row.url || "",
    description: row.description || "",
    image: row.image || "",
    ideal_for: parseJsonStringArray(row.ideal_for),
    avoid_for: parseJsonStringArray(row.avoid_for),
    department: isDepartment(row.department) ? row.department : "other",
    product_type: row.product_type || "other",
    subcategory: row.subcategory || "",
    gender: isGender(row.gender) ? row.gender : null,
    size_options: parseJsonStringArray(row.size_options),
    attributes: parseJsonRecord(row.attributes),
    vector_score: score,
  };
}

function productMatchesRequest(product: ProductContext, profile: RequestProfile): boolean {
  if (profile.department && product.department !== profile.department) return false;
  if (profile.productType && product.product_type !== profile.productType) return false;

  if (profile.brand && !brandMatches(product.brand, profile.brand)) return false;

  if (profile.gender && product.department === "apparel") {
    if (product.gender !== profile.gender && product.gender !== "unisex") return false;
  }

  if (profile.budget !== null && (product.price <= 0 || product.price > profile.budget)) return false;

  if (profile.size && product.department === "apparel") {
    if (!product.size_options.length || !product.size_options.some((size) => normalizeText(size) === normalizeText(profile.size!))) return false;
  }

  if (profile.screenSizeInch !== null) {
    const value = numericAttribute(product.attributes, "screen_size_inch");
    if (value === null || value !== profile.screenSizeInch) return false;
  }

  if (profile.storageGb !== null) {
    const value = numericAttribute(product.attributes, "storage_gb");
    if (value === null || value < profile.storageGb) return false;
  }

  return true;
}

function numericAttribute(attributes: Record<string, unknown>, key: string) {
  const value = attributes[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function buildLexicalSearchTerms(message: string): string[] {
  const terms = new Set<string>();
  const profile = detectRequestProfile(message);

  if (profile.department) terms.add(profile.department);
  if (profile.productType) terms.add(profile.productType);
  for (const term of getSearchTerms(profile)) terms.add(term);

  for (const code of message.toLowerCase().match(/[a-z0-9][a-z0-9_-]{2,}/g) ?? []) {
    if (!/^\d+$/.test(code)) {
      terms.add(code);
    }
  }

  for (const chunk of message.toLowerCase().split(/[，,。.!！?？；;\s]+/)) {
    const cleaned = chunk.replace(/\d+(?:\.\d+)?(?:元|块|rmb|cny)?/gi, "").trim();

    if (cleaned.length >= 2 && cleaned.length <= 24 && !isGenericSearchChunk(cleaned)) {
      terms.add(cleaned);
    }
  }

  return [...terms];
}

function isGenericSearchChunk(value: string): boolean {
  return /^(推荐|想买|想找|想看|看看|有没有|买|选|需要|预算|男生|女生|男士|女士|中性|以内|以下|左右|上下)$/.test(value);
}

function rankProductsForMessage(message: string, products: ProductContext[]): ProductContext[] {
  const profile = detectRequestProfile(message);
  const terms = buildLexicalSearchTerms(message);

  return [...products].sort((left, right) => {
    const rightScore = scoreProductForMessage(right, message, terms, profile);
    const leftScore = scoreProductForMessage(left, message, terms, profile);

    if (rightScore !== leftScore) {
      return rightScore - leftScore;
    }

    if (profile.budget !== null) {
      return Math.abs((left.price || profile.budget) - profile.budget) - Math.abs((right.price || profile.budget) - profile.budget);
    }

    return left.name.localeCompare(right.name, "zh-Hans-CN");
  });
}

function scoreProductForMessage(
  product: ProductContext,
  message: string,
  terms: string[],
  profile: RequestProfile,
): number {
  const productText = normalizeIntentText(
    `${product.id} ${product.name} ${product.brand} ${product.department} ${product.product_type} ${product.subcategory} ${product.gender ?? ""} ${JSON.stringify(product.attributes)} ${product.description}`,
  );
  let score = product.vector_score * 80;

  for (const term of terms) {
    const normalizedTerm = normalizeIntentText(term);

    if (!normalizedTerm) {
      continue;
    }

    if (normalizeIntentText(product.name).includes(normalizedTerm)) {
      score += 14;
    } else if (productText.includes(normalizedTerm)) {
      score += 5;
    }
  }

  if (productText.includes(normalizeIntentText(message))) {
    score += 20;
  }

  if (profile.department === product.department) score += 40;
  if (profile.productType === product.product_type) score += 80;
  if (profile.brand && brandMatches(product.brand, profile.brand)) score += 35;
  if (profile.gender && product.gender === profile.gender) score += 24;
  if (profile.budget !== null && product.price > 0) score += product.price <= profile.budget ? 18 : -80;

  return score;
}

export function getClarificationReply(message: string): string | null {
  const profile = detectRequestProfile(message);
  const text = normalizeIntentText(message);

  if (!profile.department && (isRecommendationRequest(text) || profile.brand)) {
    return "你想买哪类商品？比如手机、服饰、家具或家居用品。预算大概多少？";
  }

  if (!profile.department) return null;

  const missing: string[] = [];
  if (!profile.productType && !(profile.department === "apparel" && hasBroadApparelRequest(message))) {
    missing.push(getDepartmentTypePrompt(profile.department));
  }

  switch (profile.department) {
    case "apparel":
      if (!profile.gender && !profile.size) missing.push("穿着对象或尺码");
      if (profile.budget === null) missing.push("预算");
      break;
    case "digital":
      if (!profile.brand && ["phone", "tablet", "computer", "monitor"].includes(profile.productType ?? "")) {
        missing.push("品牌或具体型号");
      }
      if (profile.budget === null) missing.push("预算");
      break;
    case "appliance":
      if (profile.budget === null) missing.push("预算");
      if (requiresApplianceDetails(profile.productType) && !hasApplianceRequirement(message)) {
        missing.push("容量、面积或安装条件");
      }
      if (profile.productType === "kitchen_appliance" && !hasKitchenApplianceRequirement(message)) {
        missing.push("使用方式");
      }
      if (profile.productType === "cleaning_appliance" && !hasCleaningApplianceRequirement(message)) {
        missing.push("使用场景");
      }
      break;
    case "furniture":
      if (profile.budget === null) missing.push("预算");
      if (profile.productType && !hasFurnitureRequirement(message)) missing.push("摆放空间或尺寸");
      break;
    case "home_goods":
      if (profile.budget === null) missing.push("预算");
      if (!hasHomeGoodsRequirement(message)) missing.push("具体用途或尺寸");
      break;
    case "personal_care":
      if (profile.budget === null) missing.push("预算");
      if (!hasPersonalCareRequirement(message)) missing.push("使用需求或肤质");
      break;
    case "food":
      if (profile.budget === null) missing.push("预算");
      if (!hasFoodRequirement(message)) missing.push("口味或数量");
      break;
    case "baby":
      if (profile.budget === null) missing.push("预算");
      if (!hasBabyRequirement(message)) missing.push("适用年龄或对象");
      break;
    case "pet":
      if (profile.budget === null) missing.push("预算");
      if (!hasPetRequirement(message)) missing.push("宠物种类或年龄");
      break;
    case "lighting":
      if (profile.budget === null) missing.push("预算");
      if (!hasLightingRequirement(message)) missing.push("摆放位置或照明需求");
      break;
    case "toys":
      if (profile.budget === null) missing.push("预算");
      if (!hasToyRequirement(message)) missing.push("适用年龄或玩法");
      break;
    case "fitness":
      if (profile.budget === null) missing.push("预算");
      if (!hasFurnitureRequirement(message)) missing.push("摆放空间或器材类型");
      break;
    case "stationery":
      if (profile.budget === null) missing.push("预算");
      break;
    default:
      if (profile.budget === null) missing.push("预算");
  }

  if (!missing.length) return null;

  return buildNaturalClarification(profile, message, missing);
}

function isRecommendationRequest(text: string) {
  return /推荐|想买|想找|想看|有没有|买|选|需要|预算|商品|产品|查一下|看看/.test(text);
}

function hasBroadApparelRequest(message: string) {
  return /运动服|运动服饰|运动装|户外服|户外服饰|健身服|瑜伽服|训练服|穿搭/.test(normalizeIntentText(message));
}

function getDepartmentTypePrompt(department: Department): string {
  const prompts: Record<Department, string> = {
    apparel: "上衣、裤装、鞋、外套或配件",
    digital: "手机、平板、电脑、显示器、耳机或配件",
    appliance: "空调、冰箱、洗衣机、厨房电器或清洁电器",
    furniture: "沙发、床、桌、椅或收纳柜",
    home_goods: "餐厨、床品、家居装饰或收纳用品",
    personal_care: "护肤、洗护或护手产品",
    food: "零食、茶、咖啡或饮品",
    pet: "主粮、零食或日用品",
    baby: "衣物、寝具或日用品",
    stationery: "书写、收纳或办公用品",
    lighting: "台灯、落地灯或其他灯具",
    toys: "积木、轨道或其他儿童玩具",
    fitness: "动感单车、跑步机或其他器材",
    other: "具体商品类型",
  };
  return prompts[department];
}

function requiresApplianceDetails(productType: string | null) {
  return ["air_conditioner", "refrigerator", "washer", "dishwasher"].includes(productType ?? "");
}

function buildNaturalClarification(profile: RequestProfile, message: string, missing: string[]) {
  const needs = new Set(missing);
  const budget = needs.has("预算") ? "预算大概多少" : "";
  const joinBudget = (question: string) => budget ? `${question}？${budget}？` : `${question}？`;

  switch (profile.department) {
    case "apparel":
      if (!profile.productType && needs.has(getDepartmentTypePrompt("apparel"))) {
        return joinBudget("你想找上衣、裤装、鞋、外套还是配件");
      }
      if (!profile.gender && !profile.size) {
        return joinBudget("准备给男士、女士还是中性款");
      }
      return budget ? `${budget}？` : "你平时穿什么尺码？";

    case "digital":
      if (!profile.productType) {
        return joinBudget("你想买手机、平板、电脑、耳机还是其他数码产品");
      }
      if (["phone", "tablet", "computer", "monitor"].includes(profile.productType) && !profile.brand) {
        return joinBudget("你想看哪个品牌或具体型号");
      }
      return budget ? `${budget}？` : "你对屏幕尺寸、内存或存储有要求吗？";

    case "appliance":
      if (profile.productType === "air_conditioner" && needs.has("容量、面积或安装条件")) {
        return joinBudget("房间大概多大、安装位置有什么限制");
      }
      if (profile.productType === "refrigerator" && needs.has("容量、面积或安装条件")) {
        return joinBudget("需要多大容量，摆放位置的宽度或深度有限制吗");
      }
      if (["washer", "dishwasher"].includes(profile.productType ?? "") && needs.has("容量、面积或安装条件")) {
        return joinBudget("需要多大容量，准备独立摆放还是嵌入安装");
      }
      if (!profile.productType) return joinBudget("你想看空调、冰箱、洗衣机还是其他电器");
      if (profile.productType === "kitchen_appliance" && needs.has("使用方式")) {
        return joinBudget("平时主要用它做什么");
      }
      if (profile.productType === "cleaning_appliance" && needs.has("使用场景")) {
        return joinBudget("主要清洁地板、地毯还是宠物毛发");
      }
      return budget ? `${budget}？` : "你更在意哪些功能？";

    case "furniture":
      if (!profile.productType) return joinBudget("你想找沙发、床、桌、椅还是收纳柜");
      if (needs.has("摆放空间或尺寸")) return joinBudget("准备放在哪个空间，尺寸大概多大");
      return budget ? `${budget}？` : "你准备把它放在哪个空间？";

    case "home_goods":
      if (!profile.productType) return joinBudget("你想看餐厨、床品、装饰还是收纳用品");
      if (needs.has("具体用途或尺寸")) return joinBudget("主要准备怎么用，尺寸有要求吗");
      return budget ? `${budget}？` : "主要准备怎么用？";

    case "personal_care":
      if (!profile.productType) return joinBudget("你想看护肤、洗护还是护手产品");
      if (needs.has("使用需求或肤质")) return joinBudget("你主要想解决什么问题，肤质有什么特点");
      return budget ? `${budget}？` : "你主要想改善哪方面？";

    case "food":
      if (!profile.productType) return joinBudget("你想看零食、茶、咖啡还是饮品");
      if (needs.has("口味或数量")) return joinBudget("想要什么口味或类型，需要多少");
      return budget ? `${budget}？` : "想要什么口味或类型？";

    case "pet":
      if (needs.has("宠物种类或年龄")) return joinBudget("家里养的是猫还是狗，年龄或体型怎样");
      return budget ? `${budget}？` : "家里养的是什么宠物？";

    case "baby":
      if (needs.has("适用年龄或对象")) return joinBudget("宝宝多大了，准备给谁用");
      return budget ? `${budget}？` : "准备给多大的宝宝用？";

    case "stationery":
      if (!profile.productType) return joinBudget("主要是书写、收纳还是办公使用");
      return budget ? `${budget}？` : "主要准备怎么用？";

    case "lighting":
      if (needs.has("摆放位置或照明需求")) return joinBudget("准备放在哪儿，主要是阅读照明还是氛围灯");
      return budget ? `${budget}？` : "准备放在哪个位置？";

    case "toys":
      if (needs.has("适用年龄或玩法")) return joinBudget("给多大的孩子玩，更想要哪种玩法");
      return budget ? `${budget}？` : "给多大的孩子玩？";

    case "fitness":
      if (!profile.productType) return joinBudget("想练什么，准备在家里还是健身房使用");
      if (needs.has("摆放空间或器材类型")) return joinBudget("想练什么，家里能留出多大空间");
      return budget ? `${budget}？` : "主要想练什么？";

    default:
      return budget ? `${budget}？` : "你想找哪类具体商品？";
  }
}

function hasApplianceRequirement(message: string) {
  return /面积|平米|㎡|容量|升|安装|预留|嵌入|台式|独立式|匹|能效|制冷|制热|除湿|厨房|客厅|卧室/.test(normalizeIntentText(message));
}

function hasKitchenApplianceRequirement(message: string) {
  return /浓缩|美式|拿铁|胶囊|全自动|半自动|烘焙|烤箱|面包|料理|微波|加热/.test(normalizeIntentText(message));
}

function hasCleaningApplianceRequirement(message: string) {
  return /地板|地毯|毛发|宠物|除螨|家具|车内|床垫/.test(normalizeIntentText(message));
}

function hasFurnitureRequirement(message: string) {
  return /卧室|书房|客厅|餐厅|玄关|厨房|办公室|办公|小户型|租房|儿童房|阳台|尺寸|宽|高|深|cm|厘米|平米|㎡|风格|材质/.test(normalizeIntentText(message));
}

function hasHomeGoodsRequirement(message: string) {
  return /厨房|餐桌|卧室|床|收纳|装饰|香薰|用途|尺寸|宽|高|深|cm|厘米|套|个|件/.test(normalizeIntentText(message));
}

function hasPersonalCareRequirement(message: string) {
  return /肤质|敏感|干燥|保湿|清洁|香味|护手|洗发|沐浴|护肤|使用|需求/.test(normalizeIntentText(message));
}

function hasFoodRequirement(message: string) {
  return /口味|甜|咸|辣|无糖|咖啡因|数量|几包|几盒|送人|早餐|零食|饮料/.test(normalizeIntentText(message));
}

function hasBabyRequirement(message: string) {
  return /年龄|月龄|岁|男童|女童|宝宝|婴儿|儿童|对象|尺码/.test(normalizeIntentText(message));
}

function hasPetRequirement(message: string) {
  return /猫|狗|幼年|成年|年龄|体重|口味|对象/.test(normalizeIntentText(message));
}

function hasLightingRequirement(message: string) {
  return /卧室|书房|客厅|床头|办公|阅读|氛围|亮度|色温|摆放|位置/.test(normalizeIntentText(message));
}

function hasToyRequirement(message: string) {
  return /年龄|岁|儿童|孩子|宝宝|积木|轨道|玩法|送礼/.test(normalizeIntentText(message));
}

function normalizeIntentText(message: string): string {
  return message.toLowerCase().replace(/\s+/g, "");
}

function createVectorId(productId: string): string {
  if (textEncoder.encode(productId).length <= 64) {
    return productId;
  }

  return `pid_${hashUtf8ToBase36(productId)}_${productId.length}`;
}

function hashUtf8ToBase36(value: string): string {
  let hash = 0xcbf29ce484222325n;

  for (const byte of textEncoder.encode(value)) {
    hash ^= BigInt(byte);
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }

  return hash.toString(36);
}

function buildRecommendationResponse(message: string, source: ProductContext): ChatResponse {
  const category = inferDisplayCategory(source);
  return {
    chat_reply: buildDeterministicChatReply(source),
    recommended_product: {
      id: source.id,
      name: source.name,
      brand: source.brand || "精选品牌",
      category,
      department: DEPARTMENT_LABELS[source.department],
      product_type: source.product_type,
      gender: source.gender,
      attributes: source.attributes,
      price_display: source.price_display,
      image: source.image,
      url: source.url,
      why_buy: buildDeterministicWhyBuy(message, source),
      ideal_for: source.ideal_for,
      avoid_for: source.avoid_for,
      next_step_tip: buildDeterministicNextStep(source),
    },
    stage: "rag_recommendation",
  };
}

function inferDisplayCategory(product: ProductContext): string {
  const typeLabels: Record<string, string> = {
    home_textile: "床品家纺",
    home_decor: "家居装饰",
    home_organization: "家居收纳",
    tableware: "餐厨用品",
    lamp: "灯具",
    toy: "儿童玩具",
    apparel_accessory: "服饰配件",
    digital_accessory: "数码配件",
    personal_care: "个护用品",
    hand_care: "手部护理",
  };
  return `${DEPARTMENT_LABELS[product.department]} · ${typeLabels[product.product_type] ?? getProductTypeLabel(product.product_type)}`;
}

function buildDeterministicChatReply(product: ProductContext): string {
  return `这款 ${product.name} 更贴近你刚才补充的条件，可以先作为第一候选看。`;
}

function buildDeterministicWhyBuy(message: string, product: ProductContext): string {
  const profile = detectRequestProfile(message);
  const facts = [`属于${DEPARTMENT_LABELS[product.department]}`];
  if (product.brand) facts.push(`品牌是${product.brand}`);
  if (product.price_display) facts.push(`价格为${product.price_display}`);
  if (profile.budget !== null) facts.push(`符合不超过${profile.budget}元的预算`);
  if (product.gender) facts.push(`适用对象为${product.gender === "unisex" ? "男女通用" : product.gender === "child" ? "儿童" : product.gender === "male" ? "男性" : "女性"}`);
  const attributeText = Object.entries(product.attributes).slice(0, 2).map(([key, value]) => `${key}为${String(value)}`);
  facts.push(...attributeText);
  return `${facts.join("，")}，可以作为当前条件下的真实商品候选。`;
}

function buildDeterministicNextStep(product: ProductContext): string {
  if (product.url) return "下一步查看官网的规格、库存和售后信息，再决定是否下单。";
  return "下一步先确认商品规格、库存和售后信息，再决定是否下单。";
}

function isUsableConsultantText(value: unknown): value is string {
  if (typeof value !== "string") {
    return false;
  }

  const text = cleanConsultantText(value);
  return text.length >= 8 && !/(?:或者|以及|和|或|、|，|,|：|:|；|;)$/.test(text);
}

function cleanConsultantText(value: string): string {
  return value
    .replace(/您/g, "你")
    .replace(/^(您好|你好|嗨|哈喽)[，,。!！\s]*/g, "")
    .replace(/亲爱的用户[，,。!！\s]*/g, "")
    .replace(/欢迎来到[^，,。!！]*[，,。!！\s]*/g, "")
    .replace(/(?:我|我们)?为您推荐(?:以下)?(?:的)?商品(?:是)?[：:，,。!！\s]*/g, "")
    .replace(/(?:我|我们)?推荐(?:的)?(?:商品)?(?:是)?[：:，,。!！\s]*/g, "")
    .replace(/(?:可以)?直接购买[，,。!！\s]*/g, "")
    .trim();
}

export function buildNoMatchResponse(message?: string): ChatResponse {
  const profile = message ? detectRequestProfile(message) : null;
  const constraints = profile
    ? [
        profile.brand,
        profile.productType ? getProductTypeLabel(profile.productType) : profile.department ? DEPARTMENT_LABELS[profile.department] : null,
        profile.gender ? profile.gender === "male" ? "男士" : profile.gender === "female" ? "女士" : profile.gender === "child" ? "儿童" : "中性款" : null,
        profile.size ? `尺码${profile.size}` : null,
        profile.budget !== null ? `预算${profile.budget}元以内` : null,
        profile.screenSizeInch !== null ? `${profile.screenSizeInch}寸` : null,
        profile.storageGb !== null ? `${profile.storageGb}GB` : null,
      ].filter(Boolean).join("、")
    : "";

  return {
    chat_reply: constraints
      ? `我查了下商品库，暂时没有找到符合${constraints}的商品。你可以换个品牌、型号或预算，我再帮你看看。`
      : "我查了下商品库，暂时没有找到符合这次需求的商品。你可以补充其他要求，我再帮你看看。",
    recommended_product: null,
    stage: "no_vector_match",
  };
}

function normalizeStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : [];
}

function isDepartment(value: unknown): value is Department {
  return typeof value === "string" && value in DEPARTMENT_LABELS;
}

function isGender(value: unknown): value is Gender {
  return value === "male" || value === "female" || value === "child" || value === "unisex";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parseJsonRecord(value: string | null): Record<string, unknown> {
  if (!value) return {};

  try {
    const parsed = JSON.parse(value);
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function inferBrand(item: { id: string; name: string; source_url?: string; url?: string }): string {
  const text = `${item.id} ${item.name} ${item.source_url ?? item.url ?? ""}`.toLowerCase();
  const brandRules: Array<[RegExp, string]> = [
    [/adidas|阿迪达斯/, "Adidas"],
    [/nike|耐克/, "Nike"],
    [/uniqlo|优衣库/, "Uniqlo"],
    [/muji|无印良品/, "MUJI"],
    [/ikea|宜家/, "IKEA"],
    [/xiaomi|mi\.com|小米/, "Xiaomi"],
    [/samsung|三星/, "Samsung"],
    [/sony|索尼/, "Sony"],
    [/apple|苹果/, "Apple"],
  ];

  for (const [pattern, brand] of brandRules) {
    if (pattern.test(text)) {
      return brand;
    }
  }

  return "精选品牌";
}

function parseJsonStringArray(value: string | null): string[] {
  if (!value) {
    return [];
  }

  try {
    return normalizeStringArray(JSON.parse(value));
  } catch {
    return [];
  }
}

function preferNonEmptyStringArray(primary: unknown, fallback: string[]): string[] {
  const normalized = normalizeStringArray(primary);
  return normalized.length > 0 ? normalized : fallback;
}

function formatPrice(price: number | null): string {
  if (typeof price !== "number" || !Number.isFinite(price) || price <= 0) {
    return "价格以官网为准";
  }

  return `CNY ${price}`;
}

function jsonResponse(
  body: unknown,
  status = 200,
  headers: HeadersInit = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...jsonHeaders,
      ...corsHeaders(),
      ...headers,
    },
  });
}

function corsHeaders(): HeadersInit {
  return {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "POST, OPTIONS",
    "access-control-allow-headers": "content-type",
  };
}
