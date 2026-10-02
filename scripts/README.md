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

## Regression tests

All of these are offline (no API keys, no dev server needed):

```bash
# 图片 URL 的型号词元抽取：防「型号冲突误判」把好图全丢掉
node --experimental-strip-types scripts/test-image-model-tokens.mjs

# 品牌标兜底的域名候选：防第三方站 favicon（smzdm / 京东 / 知乎）冒充品牌官方标
node --experimental-strip-types scripts/test-brand-logo.mjs

# 定品线路（主 + 备用）：顺序、超时、label 去重、质检跟随哪条线路
node --experimental-strip-types scripts/test-llm-lines.mjs
```

> `test-brand-logo.mjs` 与 `test-llm-lines.mjs` 会注册一个 `data:` URL 的 resolve 钩子，
> 用来给源码里**无扩展名**的相对导入补 `.ts` 后缀 —— 裸 Node 的 ESM 解析器不认这种写法
> （`ERR_MODULE_NOT_FOUND`），而 Nuxt/Vite 认。所以它们不能像另一个测试那样直接照抄导入方式。

## Visual & end-to-end probes

These hit a running dev server (default `http://127.0.0.1:3100`):

```bash
# 冷门/长尾产品端到端：定品 + 选图 + 官网按钮 + 耗时
node scripts/test-cold-products.mjs 3100
node scripts/test-cold-products.mjs 3100 --only=手冲壶

# 视觉能力探测（中转站上的模型到底能不能看图）
node scripts/probe-vision.mjs <baseUrl> <apiKey> <model>
node scripts/probe-vision-sweep.mjs <baseUrl> <apiKey> <model1> <model2> ...
```

## System test

对**运行中**的实例做全链路场景验证：静态服务、SSE 协议合法性、追问流程、
定品流程与卡片字段、多轮上下文、空输入处理。

```bash
# 完整套件（含真实大模型定品，约 1~2 分钟）
node scripts/system-test.mjs http://127.0.0.1:3100

# 快速冒烟（不调大模型：S1 静态 / S2 协议 / S6 空输入）
node scripts/system-test.mjs http://127.0.0.1:3100 --smoke

# 兜底模式：对故障注入实例断言 engine=catalog
# ⚠️ 必须把**备用大模型线路也一起摘掉**，否则请求会被它接住，永远落不到 Worker。
#    2026-10-02 起存在第二条 LLM 线路（LLM_FALLBACK_*），所以「让大模型不可用」
#    这件事现在要两条一起断：主线路 + 备用线路都不通，才是真正的 catalog 路径。
#    先起一个两条 LLM 线路都不可达的实例：
#   LLM_BASE_URL=http://127.0.0.1:9/v1 LLM_FALLBACK_API_KEY= HOST=127.0.0.1 PORT=3101 nuxt dev
node scripts/system-test.mjs http://127.0.0.1:3101 --fallback
```

退出码 0 = 全部通过；失败项会逐条列出。S4/S7 之外的场景不依赖具体模型，
换模型、换供应商后可直接复跑。

> 顺带一提：三层可用性现在是「主线路 LLM → 备用线路 LLM（换出口）→ Worker 商品库（换数据源）」。
> 只有**三层同时**不可用才返回 503，错误文案里会把三条路各自的原因都列出来。
