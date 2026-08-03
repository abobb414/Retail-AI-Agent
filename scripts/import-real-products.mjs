#!/usr/bin/env node

import { mkdtemp, readFile, unlink, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { join, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { tmpdir } from "node:os";
import { promisify } from "node:util";

const workerUrl = process.env.WORKER_URL;
const productsFile = resolve(
  process.env.PRODUCTS_FILE ?? "frontend/server/data/realProducts.json",
);
const facetsFile = resolve(
  process.env.FACETS_FILE ?? "frontend/server/data/productFacets.json",
);
const batchSize = readPositiveInteger("BATCH_SIZE", 8);
const concurrency = readPositiveInteger("CONCURRENCY", 1);
const retryAttempts = readPositiveInteger("RETRY_ATTEMPTS", 3);
const retryDelayMs = readPositiveInteger("RETRY_DELAY_MS", 1_500);
const startIndex = readNonNegativeInteger("START_INDEX", 0);
const limit = process.env.LIMIT ? readPositiveInteger("LIMIT", 0) : undefined;
const postClient = process.env.POST_CLIENT ?? "curl";
const workerResolveIp = process.env.WORKER_RESOLVE_IP;
const execFileAsync = promisify(execFile);

if (!workerUrl) {
  console.error("Missing WORKER_URL. Example:");
  console.error(
    "  WORKER_URL=https://your-worker.your-subdomain.workers.dev node scripts/import-real-products.mjs",
  );
  process.exit(1);
}

const products = await loadProducts(productsFile);
const facetsById = await loadProductFacets(facetsFile);
const productsWithFacets = products.map((product) => {
  const facets = facetsById.get(product.id);
  return facets ? { ...product, ...facets } : product;
});
const missingFacetIds = productsWithFacets
  .filter((product) => !facetsById.has(product.id))
  .map((product) => product.id);

if (missingFacetIds.length > 0 && process.env.REQUIRE_FACETS !== "false") {
  throw new Error(
    `Missing structured facets for ${missingFacetIds.length} products in ${facetsFile}. Set REQUIRE_FACETS=false only for a deliberate legacy import.`,
  );
}

const selectedProducts = productsWithFacets.slice(
  startIndex,
  limit ? startIndex + limit : undefined,
);
const batches = chunk(selectedProducts, batchSize);

console.log(
  `Importing ${selectedProducts.length} products from ${productsFile} with facets from ${facetsFile} to ${workerUrl}`,
);
console.log(
  `Batch size: ${batchSize}, concurrency: ${concurrency}, retry attempts: ${retryAttempts}, client: ${postClient}`,
);

let imported = 0;
let failed = 0;
let nextBatchIndex = 0;

await Promise.all(
  Array.from({ length: concurrency }, async (_, workerIndex) => {
    while (nextBatchIndex < batches.length) {
      const batchIndex = nextBatchIndex;
      nextBatchIndex += 1;

      const batch = batches[batchIndex];
      const absoluteStart = startIndex + batchIndex * batchSize;

      try {
        const response = await postBatch(batch, batchIndex, absoluteStart);
        imported += batch.length;
        console.log(
          `[worker ${workerIndex + 1}] batch ${batchIndex + 1}/${batches.length} ok: ${batch.length} products, response=${JSON.stringify(response)}`,
        );
      } catch (error) {
        failed += batch.length;
        console.error(
          `[worker ${workerIndex + 1}] batch ${batchIndex + 1}/${batches.length} failed at source index ${absoluteStart}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }),
);

console.log(`Done. Imported: ${imported}. Failed: ${failed}.`);
process.exit(failed > 0 ? 1 : 0);

async function loadProducts(filePath) {
  const raw = await readFile(filePath, "utf8");
  const parsed = JSON.parse(raw);

  if (Array.isArray(parsed)) {
    return parsed;
  }

  if (parsed && typeof parsed === "object" && Array.isArray(parsed.products)) {
    return parsed.products;
  }

  throw new Error("Product file must be a JSON array or an object with a products array.");
}

async function loadProductFacets(filePath) {
  const raw = await readFile(filePath, "utf8");
  const parsed = JSON.parse(raw);
  const products = Array.isArray(parsed) ? parsed : parsed?.products;

  if (!Array.isArray(products)) {
    throw new Error("Facet file must be a JSON array or an object with a products array.");
  }

  const facetsById = new Map();
  for (const product of products) {
    if (product && typeof product.id === "string") facetsById.set(product.id, product);
  }
  return facetsById;
}

async function postBatch(batch, batchIndex, absoluteStart) {
  let lastError;

  for (let attempt = 1; attempt <= retryAttempts; attempt += 1) {
    try {
      return await postJson(batch, batchIndex, absoluteStart);
    } catch (error) {
      lastError = error;

      if (attempt < retryAttempts) {
        const delay = retryDelayMs * attempt;
        console.warn(
          `Retrying batch ${batchIndex + 1} after attempt ${attempt}/${retryAttempts}: ${error instanceof Error ? error.message : String(error)}`,
        );
        await sleep(delay);
      }
    }
  }

  throw lastError;
}

async function postJson(batch, batchIndex, absoluteStart) {
  if (postClient === "fetch") {
    const response = await fetch(workerUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify(batch),
    });

    const responseText = await response.text();
    const responseBody = parseMaybeJson(responseText);

    if (!response.ok) {
      throw new Error(
        `HTTP ${response.status} for batch ${batchIndex + 1}, source index ${absoluteStart}: ${responseText}`,
      );
    }

    return responseBody;
  }

  const tempDir = await mkdtemp(join(tmpdir(), "retail-import-"));
  const tempFile = join(tempDir, `batch-${batchIndex + 1}.json`);
  const curlArgs = [
    "-sS",
    "--max-time",
    "120",
    "-X",
    "POST",
    workerUrl,
    "-H",
    "content-type: application/json",
    "-w",
    "\n%{http_code}",
    "--data-binary",
    `@${tempFile}`,
  ];

  if (workerResolveIp) {
    const host = new URL(workerUrl).hostname;
    curlArgs.unshift("--resolve", `${host}:443:${workerResolveIp}`);
  }

  await writeFile(tempFile, JSON.stringify(batch), "utf8");

  let stdout = "";

  try {
    ({ stdout } = await execFileAsync(
      "curl",
      curlArgs,
      {
        maxBuffer: 1024 * 1024 * 10,
      },
    ));
  } finally {
    await unlink(tempFile).catch(() => {});
  }

  const splitAt = stdout.lastIndexOf("\n");
  const responseText = splitAt >= 0 ? stdout.slice(0, splitAt) : stdout;
  const status = splitAt >= 0 ? Number(stdout.slice(splitAt + 1)) : 0;

  if (status < 200 || status >= 300) {
    throw new Error(
      `HTTP ${status} for batch ${batchIndex + 1}, source index ${absoluteStart}: ${responseText}`,
    );
  }

  return parseMaybeJson(responseText);
}

function chunk(items, size) {
  const chunks = [];

  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }

  return chunks;
}

function parseMaybeJson(value) {
  if (!value) {
    return null;
  }

  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function readPositiveInteger(name, fallback) {
  const rawValue = process.env[name];

  if (!rawValue) {
    return fallback;
  }

  const value = Number(rawValue);

  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer.`);
  }

  return value;
}

function readNonNegativeInteger(name, fallback) {
  const rawValue = process.env[name];

  if (!rawValue) {
    return fallback;
  }

  const value = Number(rawValue);

  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative integer.`);
  }

  return value;
}
