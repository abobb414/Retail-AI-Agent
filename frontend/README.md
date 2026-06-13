# Retail AI Agent Frontend

![Retail AI Agent preview](./public/preview.png)

本地目录已关联到 Vercel 项目 `abobb/frontend`，线上地址：

- Frontend: https://frontend-bol609619914-4581-abobb.vercel.app
- API: same-origin Nuxt server route `/api/chat`

## Run Locally

```bash
npm install
npm run build
npm run start:local
```

打开 http://127.0.0.1:3000

## Notes

- `.vercel/` 已由 `vercel link` 和 `vercel pull` 生成，并被 `.gitignore` 忽略。
- 本地 `/api/chat` 现在直接调用 DeepSeek Chat Completions API，并把 DeepSeek 的流式响应转换成前端需要的 SSE 事件。
- 产品图片走本地 `/api/image` 同源代理，减少浏览器直连海外品牌 CDN 导致的加载失败。
- DeepSeek key 放在本地 `.env`，该文件已被 `.gitignore` 忽略，不要提交。
