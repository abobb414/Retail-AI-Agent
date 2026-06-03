const allowedHosts = new Set([
  'vitruvi.com',
  'www.vitruvi.com',
  'image.benq.com',
  'media.sonos.com',
  'ember.com',
  'www.ember.com',
  'fellowproducts.com',
  'www.fellowproducts.com',
])

export default defineEventHandler(async (event) => {
  const rawUrl = getQuery(event).url
  const imageUrl = Array.isArray(rawUrl) ? rawUrl[0] : rawUrl

  if (!imageUrl) {
    throw createError({ statusCode: 400, statusMessage: 'Missing image url' })
  }

  const parsedUrl = new URL(imageUrl)
  if (!allowedHosts.has(parsedUrl.hostname)) {
    throw createError({ statusCode: 400, statusMessage: 'Image host is not allowed' })
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
