import { isBlockedHost } from './netGuard'

const MAX_REDIRECTS = 3

/**
 * 代理内部的可预期失败（参数非法、SSRF 拦截、上游不通……）。
 *
 * 不用 h3 的 createError：那条错误链路在线上会被平台接管，回一个 Vercel 自带的 HTML 错误页，
 * 没有我们的 nosniff / CSP 头。这里改为在 handleImageRequest 的出口统一转成自己的 Response。
 */
class ImageProxyError extends Error {
  constructor(readonly status: number, message: string) {
    super(message)
  }
}

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
    throw new ImageProxyError(400, 'Image url is not allowed')
  }
}

/**
 * 手工跟随重定向：每一跳都重新过 SSRF 检查，否则公网地址 302 到内网就绕过去了。
 *
 * 上游是否支持 HEAD 参差不齐，遇到 405/501 时退回 GET（取到响应头即丢弃正文）。
 */
async function fetchImage(initialUrl: URL, method: 'GET' | 'HEAD') {
  let currentUrl = initialUrl

  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    let response: Response
    try {
      response = await fetch(currentUrl, {
        method,
        headers: getImageRequestHeaders(currentUrl),
        redirect: 'manual',
      })

      if (method === 'HEAD' && (response.status === 405 || response.status === 501)) {
        await response.body?.cancel()
        response = await fetch(currentUrl, {
          headers: getImageRequestHeaders(currentUrl),
          redirect: 'manual',
        })
      }
    } catch {
      throw new ImageProxyError(502, 'Unable to fetch image')
    }

    const location = response.headers.get('location')
    if (response.status < 300 || response.status >= 400 || !location) {
      return response
    }

    await response.body?.cancel()
    currentUrl = new URL(location, currentUrl)
    assertFetchableUrl(currentUrl)
  }

  throw new ImageProxyError(502, 'Too many redirects')
}

/**
 * 502 / 504 在这条域名链路上**到不了客户端**：会被 Cloudflare 换成它自己的纯文本页
 * `error code: 502` / `error code: 504`（16 字节、无 nosniff、无我们的 JSON，连 `x-vercel-id`
 * 都没有）。实测方式：同一上游 httpbin 只换状态码，对比「直连 Vercel 部署地址」与
 * 「走 retail.abobb.com」——
 *
 *   上游 500 → 两边都是我们的 JSON（透传 ✅）
 *   上游 502 → 直连是我们的 JSON，走域名变成 `error code: 502`（被替换 ❌）
 *   上游 503 → 两边都是我们的 JSON（透传 ✅）
 *   上游 504 → 直连是我们的 JSON，走域名变成 `error code: 504`（被替换 ❌）
 *
 * 也就是说：**替换只看状态码，跟正文/头部无关**，所以光把错误改成自己的 Response 还不够。
 * 出口统一把 502 / 504 折算成 503 —— 语义仍是「服务端暂时无法完成这次取图」，
 * 但能活着到达客户端，也就带得上我们的 JSON 与安全头。
 */
function clientStatus(status: number) {
  return status === 502 || status === 504 ? 503 : status
}

/** 错误响应：自带 nosniff / CSP sandbox，不缓存；HEAD 不输出正文。 */
function errorResponse(status: number, message: string, method: 'GET' | 'HEAD') {
  return new Response(method === 'HEAD' ? null : JSON.stringify({ error: message }), {
    status: clientStatus(status),
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': 'sandbox',
      'Cache-Control': 'no-store',
    },
  })
}

async function proxyImage(event: H3Event, method: 'GET' | 'HEAD') {
  const rawUrl = getQuery(event).url
  const imageUrl = Array.isArray(rawUrl) ? rawUrl[0] : rawUrl

  if (!imageUrl) {
    throw new ImageProxyError(400, 'Missing image url')
  }

  let parsedUrl: URL
  try {
    parsedUrl = new URL(imageUrl)
  } catch {
    throw new ImageProxyError(400, 'Invalid image url')
  }
  assertFetchableUrl(parsedUrl)

  const response = await fetchImage(parsedUrl, method)

  if (!response.ok || (method === 'GET' && !response.body)) {
    // 上游 3xx 落到这里时不能把 3xx 原样回给浏览器，统一折算成 502。
    throw new ImageProxyError(response.status >= 400 ? response.status : 502, 'Unable to fetch image')
  }

  // 这个接口是公开代理：只放行图片。否则 /api/image?url=<攻击者页面> 会在我们的域名下输出 text/html。
  const upstreamType = (response.headers.get('content-type') || '').toLowerCase()
  if (upstreamType && !upstreamType.startsWith('image/') && !upstreamType.startsWith('application/octet-stream')) {
    throw new ImageProxyError(415, 'Upstream is not an image')
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

  if (method === 'HEAD') {
    await response.body?.cancel()
    // ⚠️ 这里**不能 `return null`**：h3 v1.15 的 handleHandlerResponse 把 null 交给
    // sendNoContent()，而它的实现是「状态码为 200 时仍回落 204」
    // （`if (!code && res.statusCode !== 200) code = res.statusCode`，再 sanitize 成 204）。
    // 而 204「不带实体」在 **Vercel 边缘会被顺手剥掉 Content-Type**，
    // 本地 Node adapter 不剥 —— 所以这个差异本地怎么测都测不出来，只能线上 curl -I 发现。
    // 显式返回 200 的空 Response：既不触发 sendNoContent，也保住上面设的全部响应头，
    // 同时贴合 RFC 9110「HEAD 的状态码应与 GET 一致」。
    return new Response(null, { status: 200 })
  }

  return response.body
}

/**
 * GET 与 HEAD 共用的图片代理入口。
 *
 * 所有出口都返回 Response（成功或错误），不再向外抛 H3 错误，见 ImageProxyError 的说明。
 */
export async function handleImageRequest(event: H3Event, method: 'GET' | 'HEAD') {
  try {
    return await proxyImage(event, method)
  } catch (error) {
    if (error instanceof ImageProxyError) {
      return errorResponse(error.status, error.message, method)
    }

    // 未预料的异常：记日志，对外仍只给一个通用 502，不泄露内部细节。
    console.warn('[image] 图片代理异常：', error instanceof Error ? error.message : String(error))
    return errorResponse(502, 'Unable to fetch image', method)
  }
}
