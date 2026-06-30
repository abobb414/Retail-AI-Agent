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

type AiTextResponse = {
  response?: string;
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
};

class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

const EMBEDDING_MODEL = "@cf/baai/bge-m3";
const LLM_MODEL = "@cf/meta/llama-3.1-8b-instruct-fp8";
const EMBEDDING_DIMENSIONS = 1024;
const INGEST_BATCH_SIZE = 8;
const VECTOR_TOP_K = 20;
const LLM_CONTEXT_LIMIT = 5;
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
  const queryVector = await generateSingleEmbedding(env, payload.message);
  const vectorMatches = await env.VECTOR_INDEX.query(queryVector, {
    topK: VECTOR_TOP_K,
    returnValues: false,
    returnMetadata: "none",
  });

  const matches = vectorMatches.matches ?? [];

  if (matches.length === 0) {
    return jsonResponse(buildNoMatchResponse(), 200);
  }

  const products = selectProductsForMessage(
    payload.message,
    await fetchProductsByVectorMatches(env, matches),
  ).slice(0, LLM_CONTEXT_LIMIT);

  if (products.length === 0) {
    return jsonResponse(buildNoMatchResponse(), 200);
  }

  const llmResponse = await summarizeRecommendation(env, payload.message, products);
  return jsonResponse(sanitizeChatResponse(llmResponse, products), 200);
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
    brand: typeof product.brand === "string" ? product.brand : "Adidas",
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
    brand: item.brand?.trim() || "Adidas",
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

function rowToProductContext(row: ProductRow, score: number): ProductContext {
  return {
    id: row.id,
    vector_id: row.vector_id || row.id,
    name: row.name,
    brand: row.brand || "Adidas",
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

function extractCnyBudget(message: string): number | null {
  const normalized = message.replace(/[,，]/g, "");
  const patterns = [
    /预算\s*(?:在|是|大概|约|为)?\s*(\d+(?:\.\d+)?)\s*(?:元|块|rmb|cny)?\s*(?:以内|以下|内)?/i,
    /(\d+(?:\.\d+)?)\s*(?:元|块|rmb|cny)?\s*(?:以内|以下|内)/i,
    /不超过\s*(\d+(?:\.\d+)?)\s*(?:元|块|rmb|cny)?/i,
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

async function summarizeRecommendation(
  env: Env,
  message: string,
  products: ProductContext[],
): Promise<ChatResponse> {
  const response = (await env.AI.run(LLM_MODEL, {
    messages: [
      {
        role: "system",
        content: [
          "你是一个专业的阿迪达斯金牌智能导购。",
          "请根据 D1 中检索出来的真实商品列表 Context，结合用户的实际提问意图，从中精选出一个最符合需求的商品。",
          "必须严格保持真实数据的 id、image 和 url 的一致性，绝对不允许凭空胡编乱造、杜绝大模型幻觉。",
          "只返回纯 JSON 对象，不要包含任何 ```json 这样的 markdown 包裹外壳，也不要有多余的废话前缀。",
        ].join("\n"),
      },
      {
        role: "user",
        content: buildRecommendationPrompt(message, products),
      },
    ],
    max_tokens: 900,
    temperature: 0.2,
    response_format: { type: "json_object" },
  })) as AiTextResponse;

  return parseLlmJson(response.response ?? "");
}

function buildRecommendationPrompt(message: string, products: ProductContext[]): string {
  return [
    `用户提问: ${message}`,
    "",
    "Context 商品列表，所有推荐字段必须从这里选择，不允许新增商品:",
    JSON.stringify(products, null, 2),
    "",
    "请输出如下 JSON Schema:",
    JSON.stringify(
      {
        chat_reply: "导购对用户说的一句热情开场白...",
        recommended_product: {
          id: "商品的真实ID",
          name: "商品名称",
          brand: "Adidas",
          price_display: "CNY 299",
          image: "从数据库捞出来的真实图片URL",
          url: "从数据库捞出来的真实官网URL",
          why_buy: "一句话提炼：为什么优先看它？结合用户需求给出最痛点的理由。",
          ideal_for: ["适合人群标签1", "适合人群标签2"],
          avoid_for: ["避坑/建议先不买的人群标签1", "标签2"],
          next_step_tip: "下一步怎么选的引导文案...",
        },
      },
      null,
      2,
    ),
  ].join("\n");
}

function parseLlmJson(rawText: string): ChatResponse {
  const cleaned = stripMarkdownJson(rawText.trim());

  try {
    return JSON.parse(cleaned) as ChatResponse;
  } catch {
    const firstBrace = cleaned.indexOf("{");
    const lastBrace = cleaned.lastIndexOf("}");

    if (firstBrace >= 0 && lastBrace > firstBrace) {
      return JSON.parse(cleaned.slice(firstBrace, lastBrace + 1)) as ChatResponse;
    }

    throw new Error("LLM did not return valid JSON.");
  }
}

function stripMarkdownJson(value: string): string {
  return value
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

function sanitizeChatResponse(response: ChatResponse, products: ProductContext[]): ChatResponse {
  const product = response.recommended_product;

  if (!product) {
    return buildNoMatchResponse(response.chat_reply);
  }

  const source = products.find((item) => item.id === product.id) ?? products[0];

  return {
    chat_reply:
      typeof response.chat_reply === "string" && response.chat_reply.trim()
        ? response.chat_reply.trim()
        : "我帮你从真实商品库里挑了一款更贴近需求的单品。",
    recommended_product: {
      id: source.id,
      name: source.name,
      brand: source.brand || "Adidas",
      price_display: source.price_display,
      image: source.image,
      url: source.url,
      why_buy:
        typeof product.why_buy === "string" && product.why_buy.trim()
          ? product.why_buy.trim()
          : "它和你的需求匹配度最高，适合作为优先对比款。",
      ideal_for: preferNonEmptyStringArray(product.ideal_for, source.ideal_for),
      avoid_for: preferNonEmptyStringArray(product.avoid_for, source.avoid_for),
      next_step_tip:
        typeof product.next_step_tip === "string" && product.next_step_tip.trim()
          ? product.next_step_tip.trim()
          : "建议点进官网查看尺码、库存和更多实拍细节后再决定。",
    },
  };
}

function buildNoMatchResponse(chatReply?: string): ChatResponse {
  return {
    chat_reply:
      chatReply ||
      "我暂时没有在真实商品库里找到足够匹配的单品。你可以换个说法，比如告诉我预算、使用场景或想要的品类。",
    recommended_product: null,
  };
}

function normalizeStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : [];
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
