# Product Import Scripts

## Import `realProducts.json`

```bash
WORKER_URL=https://your-worker.your-subdomain.workers.dev \
node scripts/import-real-products.mjs
```

The script reads `frontend/server/data/realProducts.json`, merges structured
facets from `frontend/server/data/productFacets.json` by product ID, splits the
products into batches, and POSTs each batch to the Worker.

Optional environment variables:

- `PRODUCTS_FILE`: product JSON path. Default: `frontend/server/data/realProducts.json`
- `FACETS_FILE`: normalized facet JSON path. Default: `frontend/server/data/productFacets.json`
- `REQUIRE_FACETS`: fail when a product has no facet record. Default: `true`
- `BATCH_SIZE`: products per POST request. Default: `8`
- `CONCURRENCY`: parallel POST workers. Default: `1`
- `RETRY_ATTEMPTS`: attempts per failed batch. Default: `3`
- `RETRY_DELAY_MS`: base retry delay in milliseconds. Default: `1500`
- `START_INDEX`: source product index to resume from. Default: `0`
- `LIMIT`: import only this many products. Useful for smoke tests.

Smoke test with one product:

```bash
WORKER_URL=https://your-worker.your-subdomain.workers.dev \
LIMIT=1 \
node scripts/import-real-products.mjs
```

Catalog intent regression test:

```bash
node --experimental-strip-types scripts/test-catalog-intent.mjs
```
