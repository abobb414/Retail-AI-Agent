import { isBlockedHost } from '../utils/netGuard'

const MAX_REDIRECTS = 3

function getImageRequestHeaders(parsedUrl: URL) {
  const hostname = parsedUrl.hostname.toLowerCase()
  const headers: Record<string, string> = {
    Accept: 'image/avif,image/webp,image/*,*/*',
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
  }

  if (hostname.endsWith('haier.com')) {
    headers.Referer = 'https://www.haier.com/'
  } else if (hostname.endsWith('gree.com')) {
    headers.Referer = 'https://www.gree.com/'
  } else if (hostname.endsWith('quanyou.com.cn') || hostname.endsWith('aliyuncs.com')) {
    headers.Referer = 'https://www.quanyou.com.cn/'
  } else if (hostname.endsWith('tcl.com')) {
    headers.Referer = 'https://www.tcl.com/'
  }

  return headers
}

function assertFetchableUrl(url: URL) {
  if (!['http:', 'https:'].includes(url.protocol) || isBlockedHost(url.hostname)) {
    throw createError({ statusCode: 400, statusMessage: 'Image url is not allowed' })
  }
}

/** 手工跟随重定向：每一跳都重新过 SSRF 检查，否则公网地址 302 到内网就绕过去了。 */
async function fetchImage(initialUrl: URL) {
  let currentUrl = initialUrl

  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    let response: Response
    try {
      response = await fetch(currentUrl, {
        headers: getImageRequestHeaders(currentUrl),
        redirect: 'manual',
      })
    } catch {
      throw createError({ statusCode: 502, statusMessage: 'Unable to fetch image' })
    }

    const location = response.headers.get('location')
    if (response.status < 300 || response.status >= 400 || !location) {
      return response
    }

    await response.body?.cancel()
    currentUrl = new URL(location, currentUrl)
    assertFetchableUrl(currentUrl)
  }

  throw createError({ statusCode: 502, statusMessage: 'Too many redirects' })
}

export default defineEventHandler(async (event) => {
  const rawUrl = getQuery(event).url
  const imageUrl = Array.isArray(rawUrl) ? rawUrl[0] : rawUrl

  if (!imageUrl) {
    throw createError({ statusCode: 400, statusMessage: 'Missing image url' })
  }

  let parsedUrl: URL
  try {
    parsedUrl = new URL(imageUrl)
  } catch {
    throw createError({ statusCode: 400, statusMessage: 'Invalid image url' })
  }
  assertFetchableUrl(parsedUrl)

  const response = await fetchImage(parsedUrl)

  if (!response.ok || !response.body) {
    throw createError({ statusCode: response.status || 502, statusMessage: 'Unable to fetch image' })
  }

  // 这个接口是公开代理：只放行图片。否则 /api/image?url=<攻击者页面> 会在我们的域名下输出 text/html。
  const upstreamType = (response.headers.get('content-type') || '').toLowerCase()
  if (upstreamType && !upstreamType.startsWith('image/') && !upstreamType.startsWith('application/octet-stream')) {
    throw createError({ statusCode: 415, statusMessage: 'Upstream is not an image' })
  }

  setHeader(event, 'Content-Type', upstreamType || 'image/jpeg')
  setHeader(event, 'X-Content-Type-Options', 'nosniff')
  // 上面放行的是 `image/*`，其中 `image/svg+xml` 是**唯一能内嵌 `<script>` 的图片类型**。
  // `<img src>` 引用它时浏览器不执行脚本，但**直接导航到本接口**时它会当文档加载，
  // 脚本就在 retail.abobb.com 这个源下跑起来（缓存 7 天会放大影响）。
  // `sandbox` 让该文档进沙箱（禁脚本 / 禁同源 / 禁表单）。CSP 只作用于 document，
  // 不影响 `<img>` 引用，所以对正常展示零副作用。
  // （要更严就把 svg 从白名单里剔除，代价是「品牌标是 svg + 外链失败」的回退会没图。）
  setHeader(event, 'Content-Security-Policy', 'sandbox')
  setHeader(event, 'Cache-Control', 'public, max-age=86400, s-maxage=604800, stale-while-revalidate=604800')

  return response.body
})
