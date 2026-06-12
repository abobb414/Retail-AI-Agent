function isBlockedHost(hostname: string) {
  const normalizedHost = hostname.toLowerCase()
  return (
    normalizedHost === 'localhost' ||
    normalizedHost.endsWith('.localhost') ||
    normalizedHost === '0.0.0.0' ||
    normalizedHost.startsWith('127.') ||
    normalizedHost.startsWith('10.') ||
    normalizedHost.startsWith('192.168.') ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(normalizedHost) ||
    normalizedHost === '::1' ||
    normalizedHost.startsWith('fc') ||
    normalizedHost.startsWith('fd')
  )
}

export default defineEventHandler(async (event) => {
  const rawUrl = getQuery(event).url
  const imageUrl = Array.isArray(rawUrl) ? rawUrl[0] : rawUrl

  if (!imageUrl) {
    throw createError({ statusCode: 400, statusMessage: 'Missing image url' })
  }

  const parsedUrl = new URL(imageUrl)
  if (!['http:', 'https:'].includes(parsedUrl.protocol) || isBlockedHost(parsedUrl.hostname)) {
    throw createError({ statusCode: 400, statusMessage: 'Image url is not allowed' })
  }

  const response = await fetch(parsedUrl, {
    headers: {
      Accept: 'image/avif,image/webp,image/*,*/*',
    },
  })

  if (!response.ok || !response.body) {
    throw createError({ statusCode: response.status || 502, statusMessage: 'Unable to fetch image' })
  }

  setHeader(event, 'Content-Type', response.headers.get('content-type') || 'image/jpeg')
  setHeader(event, 'Cache-Control', 'public, max-age=86400, s-maxage=604800, stale-while-revalidate=604800')

  return response.body
})
