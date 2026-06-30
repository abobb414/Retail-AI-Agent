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
 *     avoid_for TEXT
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

type AudiencePreference = "male" | "female" | "child" | "pet" | null;

class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

const EMBEDDING_MODEL = "@cf/baai/bge-m3";
const EMBEDDING_DIMENSIONS = 1024;
const INGEST_BATCH_SIZE = 8;
const VECTOR_TOP_K = 20;
const LEXICAL_TOP_K = 30;
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
    return jsonResponse(buildNoMatchResponse(), 200);
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
  };
}

function cleanProduct(item: RawProduct): CleanProduct {
  const description = item.feature?.trim() ?? "";
  const keywords = item.keywords ?? [];
  const priceDisplay = item.price_range?.trim() ?? "";

  return {
    id: item.id,
    vectorId: createVectorId(item.id),
    name: item.name.trim(),
    brand: item.brand?.trim() || inferBrand(item),
    price: parsePrice(priceDisplay),
    priceDisplay,
    url: item.source_url?.trim() ?? "",
    description,
    image: item.image?.trim() ?? "",
    idealFor: item.ideal_for ?? [],
    avoidFor: item.avoid_for ?? [],
    embeddingText: `商品名称: ${item.name.trim()}。核心特征: ${description}。标签: ${keywords.join(", ")}`,
  };
}

function parsePrice(priceRange?: string): number {
  if (!priceRange) {
    return 0;
  }

  const match = priceRange.replace(/,/g, "").match(/(\d+(?:\.\d+)?)/);
  return match ? Number(match[1]) : 0;
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
         id, vector_id, name, brand, price, price_display, url, description, image, ideal_for, avoid_for
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
         avoid_for = excluded.avoid_for`,
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
  const query = `SELECT id, vector_id, name, brand, price, price_display, url, description, image, ideal_for, avoid_for
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
  const audienceFilteredProducts = filterProductsByAudience(message, products);
  const kindFilteredProducts = filterProductsByRequestedKind(message, audienceFilteredProducts);
  const budgetFilteredProducts = selectProductsForMessage(message, kindFilteredProducts);

  return extractCnyBudget(message) ? budgetFilteredProducts : kindFilteredProducts;
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

  const searchableColumns = ["id", "name", "brand", "description", "ideal_for", "avoid_for"];
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
    `SELECT id, vector_id, name, brand, price, price_display, url, description, image, ideal_for, avoid_for
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
    vector_score: score,
  };
}

function selectProductsForMessage(message: string, products: ProductContext[]): ProductContext[] {
  const budget = extractCnyBudget(message);

  if (!budget) {
    return products;
  }

  return products.filter((product) => product.price > 0 && product.price <= budget);
}

function filterProductsByAudience(message: string, products: ProductContext[]): ProductContext[] {
  const audience = detectAudiencePreference(normalizeIntentText(message));

  if (!audience) {
    return products.filter((product) => !productLooksPetOnly(product));
  }

  return products.filter((product) => productMatchesAudience(product, audience));
}

function filterProductsByRequestedKind(message: string, products: ProductContext[]): ProductContext[] {
  const kinds = detectRequestedProductKinds(normalizeIntentText(message));

  if (kinds.length === 0) {
    return products;
  }

  return products.filter((product) => kinds.some((kind) => productMatchesKind(product, kind)));
}

function detectRequestedProductKind(text: string): "tee" | "shoe" | "pants" | "outerwear" | "bag" | null {
  return detectRequestedProductKinds(text)[0] ?? null;
}

function detectRequestedProductKinds(text: string): Array<"tee" | "shoe" | "pants" | "outerwear" | "bag"> {
  const kinds: Array<"tee" | "shoe" | "pants" | "outerwear" | "bag"> = [];

  if (/跑鞋|运动鞋|篮球鞋|足球鞋|板鞋|德训鞋|鞋子|鞋|靴|凉鞋/.test(text)) {
    kinds.push("shoe");
  }

  if (/半袖|短袖|t恤|tee|圆领|polo衫|上衣/.test(text)) {
    kinds.push("tee");
  }

  if (/运动裤|短裤|长裤|裤子|裤/.test(text)) {
    kinds.push("pants");
  }

  if (/外套|夹克|冲锋衣|卫衣|风衣|羽绒服/.test(text)) {
    kinds.push("outerwear");
  }

  if (/背包|斜挎包|单肩包|托特包|包包|包/.test(text)) {
    kinds.push("bag");
  }

  return kinds;
}

function productMatchesKind(product: ProductContext, kind: NonNullable<ReturnType<typeof detectRequestedProductKind>>): boolean {
  const text = normalizeIntentText(`${product.name} ${product.description} ${product.brand}`);

  switch (kind) {
    case "tee":
      return /半袖|短袖|t恤|tee|圆领|polo衫|上衣/.test(text) && !/鞋|靴|裤|裙|帽|包|手套/.test(text);
    case "shoe":
      return /跑鞋|运动鞋|篮球鞋|足球鞋|板鞋|德训鞋|鞋|靴|凉鞋/.test(text);
    case "pants":
      return /运动裤|短裤|长裤|裤/.test(text) && !/鞋|包|帽|手套/.test(text);
    case "outerwear":
      return /外套|夹克|冲锋衣|卫衣|风衣|羽绒服/.test(text);
    case "bag":
      return /背包|斜挎包|单肩包|托特包|包/.test(text) && !/鞋|裤/.test(text);
  }
}

function detectAudiencePreference(text: string): AudiencePreference {
  if (/宠物|猫|狗/.test(text)) {
    return "pet";
  }

  if (/儿童|孩子|小孩|宝宝|婴儿|幼儿|童装|男童|女童/.test(text)) {
    return "child";
  }

  if (/女士|女生|女子|女款|女性|女装|women|womens|woman/.test(text)) {
    return "female";
  }

  if (/男士|男生|男子|男款|男性|男装|(^|[^a-z])(?:men|mens|man)([^a-z]|$)/.test(text)) {
    return "male";
  }

  return null;
}

function productMatchesAudience(product: ProductContext, audience: NonNullable<AudiencePreference>): boolean {
  const text = getProductAudienceText(product);

  switch (audience) {
    case "male":
      return !productLooksChildOnly(text) && !productLooksPetOnly(product) && !productLooksFemaleOnly(text);
    case "female":
      return !productLooksChildOnly(text) && !productLooksPetOnly(product) && !productLooksMaleOnly(text);
    case "child":
      return productLooksChildOnly(text);
    case "pet":
      return productLooksPetOnly(product);
  }
}

function getProductAudienceText(product: ProductContext): string {
  return normalizeIntentText(
    `${product.name} ${product.description} ${product.brand} ${product.ideal_for.join(" ")} ${product.avoid_for.join(" ")}`,
  );
}

function productLooksChildOnly(text: string): boolean {
  return /儿童|孩子|宝宝|婴儿|幼儿|童装|男童|女童|110cm|120cm|130cm|140cm|150cm|160cm/.test(text);
}

function productLooksPetOnly(product: ProductContext): boolean {
  return /宠物|猫|狗/.test(getProductAudienceText(product));
}

function productLooksFemaleOnly(text: string): boolean {
  if (/男士\/女士|女士\/男士|男女|男\/女|中性|unisex/.test(text)) {
    return false;
  }

  return /女士|女生|女子|女款|女性|女装|连衣裙|半身裙|裙装|文胸|胸衣|bra|women|womens|woman/.test(text);
}

function productLooksMaleOnly(text: string): boolean {
  if (/男士\/女士|女士\/男士|男女|男\/女|中性|unisex/.test(text)) {
    return false;
  }

  return /男士|男生|男子|男款|男性|男装|(^|[^a-z])(?:men|mens|man)([^a-z]|$)/.test(text);
}

function extractCnyBudget(message: string): number | null {
  const normalized = message.replace(/[,，]/g, "");
  const patterns = [
    /预算\s*(?:在|是|大概|约|为|控制在)?\s*(\d+(?:\.\d+)?)\s*(?:元|块|rmb|cny)?\s*(?:左右|上下|附近|以内|以下|内)?/i,
    /(?:价位|价格|预算|控制在|不超过|别超过)\D{0,8}(\d+(?:\.\d+)?)\s*(?:元|块|rmb|cny)?/i,
    /(\d+(?:\.\d+)?)\s*(?:元|块|rmb|cny)\s*(?:左右|上下|附近|以内|以下|内)?/i,
    /(\d+(?:\.\d+)?)\s*(?:左右|上下|以内|以下|内)/i,
  ];

  for (const pattern of patterns) {
    const match = normalized.match(pattern);
    const value = match ? Number(match[1]) : 0;

    if (Number.isFinite(value) && value > 0) {
      return value;
    }
  }

  return null;
}

function buildLexicalSearchTerms(message: string): string[] {
  const normalized = normalizeIntentText(message);
  const terms = new Set<string>();
  const knownTerms = [
    "半袖",
    "短袖",
    "t恤",
    "tee",
    "圆领",
    "polo",
    "上衣",
    "跑鞋",
    "运动鞋",
    "篮球鞋",
    "足球鞋",
    "板鞋",
    "德训鞋",
    "鞋",
    "运动裤",
    "短裤",
    "长裤",
    "裤",
    "外套",
    "夹克",
    "卫衣",
    "背包",
    "包",
    "通勤",
    "跑步",
    "户外",
    "健身",
    "训练",
    "篮球",
    "足球",
    "日常",
    "休闲",
    "透气",
    "速干",
    "轻便",
    "防水",
    "保暖",
    "adidas",
    "阿迪达斯",
    "nike",
    "耐克",
    "uniqlo",
    "优衣库",
    "muji",
    "无印良品",
    "ikea",
    "宜家",
    "男士",
    "男生",
    "男子",
    "男款",
    "女士",
    "女生",
    "女子",
    "女款",
    "儿童",
    "童装",
  ];

  for (const term of knownTerms) {
    if (normalized.includes(term)) {
      terms.add(term);
    }
  }

  for (const kind of detectRequestedProductKinds(normalized)) {
    for (const term of productKindSearchTerms(kind)) {
      terms.add(term);
    }
  }

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

function productKindSearchTerms(kind: NonNullable<ReturnType<typeof detectRequestedProductKind>>): string[] {
  switch (kind) {
    case "tee":
      return ["半袖", "短袖", "t恤", "tee", "圆领", "polo", "上衣"];
    case "shoe":
      return ["鞋", "跑鞋", "运动鞋", "篮球鞋", "足球鞋", "板鞋"];
    case "pants":
      return ["裤", "运动裤", "短裤", "长裤"];
    case "outerwear":
      return ["外套", "夹克", "卫衣", "冲锋衣"];
    case "bag":
      return ["包", "背包", "斜挎包", "单肩包"];
  }
}

function isGenericSearchChunk(value: string): boolean {
  return /^(推荐|想买|想找|想看|看看|有没有|买|选|需要|预算|男生|女生|男士|女士|中性|以内|以下|左右|上下)$/.test(value);
}

function rankProductsForMessage(message: string, products: ProductContext[]): ProductContext[] {
  const budget = extractCnyBudget(message);
  const kinds = detectRequestedProductKinds(normalizeIntentText(message));
  const terms = buildLexicalSearchTerms(message);

  return [...products].sort((left, right) => {
    const rightScore = scoreProductForMessage(right, message, terms, kinds, budget);
    const leftScore = scoreProductForMessage(left, message, terms, kinds, budget);

    if (rightScore !== leftScore) {
      return rightScore - leftScore;
    }

    if (budget) {
      return Math.abs((left.price || budget) - budget) - Math.abs((right.price || budget) - budget);
    }

    return left.name.localeCompare(right.name, "zh-Hans-CN");
  });
}

function scoreProductForMessage(
  product: ProductContext,
  message: string,
  terms: string[],
  kinds: Array<"tee" | "shoe" | "pants" | "outerwear" | "bag">,
  budget: number | null,
): number {
  const productText = normalizeIntentText(
    `${product.id} ${product.name} ${product.brand} ${product.description} ${product.ideal_for.join(" ")} ${product.avoid_for.join(" ")}`,
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

  if (kinds.some((kind) => productMatchesKind(product, kind))) {
    score += 35;
  }

  if (budget && product.price > 0) {
    score += product.price <= budget ? 18 : -80;
  }

  const audience = detectAudiencePreference(normalizeIntentText(message));

  if (audience && productMatchesAudience(product, audience)) {
    score += 24;
  }

  const scene = getSceneLabel(message);

  if (scene && productText.includes(normalizeIntentText(scene))) {
    score += 8;
  }

  return score;
}

function getClarificationReply(message: string): string | null {
  const text = normalizeIntentText(message);
  const category = detectRequestCategory(text);
  const hasBudget = extractCnyBudget(message) !== null || /预算|便宜|贵|高端|入门|性价比/.test(text);
  const hasGenderOrRecipient = /男|女|中性|儿童|孩子|宝宝|老人|宠物|送人|自用|自己/.test(text);
  const hasScene = /通勤|上班|办公室|跑步|健身|训练|篮球|足球|户外|旅行|出差|上学|夏天|冬天|春秋|卧室|客厅|厨房|书房|餐厅|小户型|宿舍|日常|居家|运动|工作|睡觉|收纳/.test(text);
  const hasStyleOrSize = /舒服|舒适|透气|轻便|防水|保暖|宽松|修身|简约|正式|休闲|耐用|好看|质感|尺码|尺寸|码|平米|面积|容量/.test(text);

  if (!category && /推荐|想买|想找|想看|看看|有没有|买|选|需要|预算/.test(text)) {
    return "可以的，我先不急着推单品。你想看哪一类商品？顺便告诉我预算和使用场景，我再从真实商品库里挑。";
  }

  if (category === "wearable") {
    const missing = [
      !hasGenderOrRecipient ? "男士、女士、中性或尺码" : "",
      !hasBudget ? "预算" : "",
      !hasScene && !hasStyleOrSize ? "穿着场景" : "",
    ].filter(Boolean);

    if (missing.length > 0) {
      return `还差一点关键信息：${missing.join("、")}。补一句就行，比如“男士 300 元，户外跑步”。`;
    }
  }

  if (category === "home") {
    const missing = [
      !hasScene ? "放在哪个空间或主要解决什么问题" : "",
      !hasBudget ? "预算大概多少" : "",
    ].filter(Boolean);

    if (missing.length > 0) {
      return `还差一点关键信息：${missing.join("，")}。补一句后我再给你推具体款。`;
    }
  }

  if (category === "appliance") {
    const missing = [
      !hasScene && !hasStyleOrSize ? "使用场景、面积、容量或安装条件" : "",
      !hasBudget ? "预算范围" : "",
    ].filter(Boolean);

    if (missing.length > 0) {
      return `这类商品先别盲推，还差：${missing.join("，")}。补一句后我再帮你缩到具体选择。`;
    }
  }

  if (category === "living_context") {
    return "这个场景可以做，但我先确认方向：你更想看灯光、收纳、床品、小家具，还是运动穿搭？再给我一个预算，我就能更像顾问一样帮你挑。";
  }

  return null;
}

function normalizeIntentText(message: string): string {
  return message.toLowerCase().replace(/\s+/g, "");
}

function detectRequestCategory(text: string): "wearable" | "home" | "appliance" | "living_context" | null {
  if (/鞋|跑鞋|运动鞋|篮球鞋|足球鞋|板鞋|凉鞋|靴|半袖|t恤|tee|上衣|裤|短裤|运动裤|外套|夹克|卫衣|衬衫|polo|裙|内衣|袜|帽|包/.test(text)) {
    return "wearable";
  }

  if (/椅|桌|床(?!头)|柜|沙发|架|收纳|灯|照明|台灯|地毯|床品|枕|被|家具/.test(text)) {
    return "home";
  }

  if (/空调|冰箱|洗衣机|洗碗机|烤箱|微波炉|咖啡机|吸尘器|扫地|电视|音箱|耳机|手机|电脑|电器|家电/.test(text)) {
    return "appliance";
  }

  if (/卧室|客厅|厨房|书房|小户型|宿舍|通勤|运动|舒服|舒适|氛围|生活/.test(text)) {
    return "living_context";
  }

  return null;
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
  return {
    chat_reply: buildDeterministicChatReply(source),
    recommended_product: {
      id: source.id,
      name: source.name,
      brand: source.brand || "精选品牌",
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

function buildDeterministicChatReply(product: ProductContext): string {
  return `这款 ${product.name} 更贴近你刚才补充的条件，可以先作为第一候选看。`;
}

function buildDeterministicWhyBuy(message: string, product: ProductContext): string {
  const kind = detectRequestedProductKind(normalizeIntentText(message));
  const budget = extractCnyBudget(message);
  const scene = getSceneLabel(message);
  const kindLabel = kind ? productKindLabel(kind) : "这个品类";
  const budgetText = budget ? `价格没有超过 ${budget} 元预算` : "价格和需求比较匹配";
  const sceneText = scene ? `，也贴合${scene}` : "";

  return `它是${kindLabel}，${budgetText}${sceneText}，比只按关键词硬推更稳。`;
}

function buildDeterministicNextStep(product: ProductContext): string {
  return product.url
    ? "下一步先看官网尺码、库存和实拍细节，再决定是否下单。"
    : "下一步先确认尺码、库存和实拍细节，再决定是否下单。";
}

function productKindLabel(kind: NonNullable<ReturnType<typeof detectRequestedProductKind>>): string {
  switch (kind) {
    case "tee":
      return "短袖上衣";
    case "shoe":
      return "鞋类单品";
    case "pants":
      return "裤装";
    case "outerwear":
      return "外套";
    case "bag":
      return "包袋";
  }
}

function getSceneLabel(message: string): string {
  const text = normalizeIntentText(message);

  if (/户外.*跑|跑步|越野/.test(text)) {
    return "户外跑步";
  }

  if (/通勤|上班|办公室/.test(text)) {
    return "通勤";
  }

  if (/健身|训练|运动/.test(text)) {
    return "运动训练";
  }

  if (/日常|休闲/.test(text)) {
    return "日常穿着";
  }

  return "";
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

function buildNoMatchResponse(chatReply?: string): ChatResponse {
  return {
    chat_reply:
      chatReply ||
      "我暂时没有在真实商品库里找到足够匹配的单品。你可以换个说法，比如告诉我预算、使用场景或想要的品类。",
    recommended_product: null,
    stage: "no_vector_match",
  };
}

function normalizeStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : [];
}

function inferBrand(item: Pick<RawProduct, "id" | "name" | "source_url">): string {
  const text = `${item.id} ${item.name} ${item.source_url ?? ""}`.toLowerCase();
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
    return "CNY 0";
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
