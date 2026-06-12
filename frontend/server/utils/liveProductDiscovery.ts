interface LiveProductCandidate {
  name: string
  brand: string
  category: string
  price_range: string
  budget_tier: string
  materials: string
  craftsmanship: string
  signature_specs: string[]
  style_tags: string[]
  room_tags: string[]
  ideal_for: string[]
  avoid_for: string[]
  pairing_note: string
  source_url: string
  image: string
  feature: string
  benefit: string
  scenarios: string[]
  consultant_summary: string
  matched_preferences: string[]
  why_this: string[]
  why_not_others: string
}

const blockedSearchHosts = new Set([
  'amazon.com',
  'www.amazon.com',
  'duckduckgo.com',
  'www.duckduckgo.com',
  'ebay.com',
  'www.ebay.com',
  'reddit.com',
  'www.reddit.com',
  'walmart.com',
  'www.walmart.com',
  'youtube.com',
  'www.youtube.com',
])

function stripTags(value: string) {
  return value
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function decodeHtml(value: string) {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
}

function extractMeta(html: string, attrName: 'property' | 'name', attrValue: string) {
  const escaped = attrValue.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const patterns = [
    new RegExp(`<meta[^>]+${attrName}=["']${escaped}["'][^>]+content=["']([^"']+)["']`, 'i'),
    new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+${attrName}=["']${escaped}["']`, 'i'),
  ]

  for (const pattern of patterns) {
    const match = html.match(pattern)
    if (match?.[1]) {
      return decodeHtml(match[1]).trim()
    }
  }

  return ''
}

function extractTitle(html: string) {
  const match = html.match(/<title>([\s\S]*?)<\/title>/i)
  return match?.[1] ? stripTags(decodeHtml(match[1])) : ''
}

function extractPrice(html: string) {
  const structuredPrice = html.match(/"product_prices":\["([^"]+)"\]/i) || html.match(/"price":\["([^"]+)"\]/i)
  if (structuredPrice?.[1]) {
    return `USD ${structuredPrice[1]}`
  }

  const match = html.match(/(?:USD|\$|RMB|CNY|¥|EUR|€)\s?\d[\d,]*(?:\.\d{2})?/i)
  return match?.[0] ?? '以官网页面为准'
}

function cleanProductName(title: string) {
  return title
    .split('|')[0]
    .split('–')[0]
    .split('—')[0]
    .replace(/\s+/g, ' ')
    .trim()
}

function domainBrand(url: string) {
  const host = new URL(url).hostname.replace(/^www\./, '')
  return host.split('.')[0]?.replace(/-/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase()) || '官方品牌'
}

function decodeDuckDuckGoUrl(url: string) {
  const normalizedUrl = url.startsWith('//') ? `https:${url}` : url
  const parsedUrl = new URL(normalizedUrl)
  if (!parsedUrl.hostname.includes('duckduckgo.com')) {
    return normalizedUrl
  }

  return parsedUrl.searchParams.get('uddg') ?? normalizedUrl
}

function extractRecommendedQueries(assistantText: string, userContext: string) {
  const queries: string[] = []
  const isUsefulQuery = (query: string) => {
    const normalizedQuery = query.trim()
    return (
      normalizedQuery.length >= 3 &&
      !/^(一个|一款|具体|产品|具体产品|一款具体产品|图片|推荐)$/.test(normalizedQuery) &&
      !/回复后|我会|立刻|附上|产品图片/.test(normalizedQuery)
    )
  }
  const quotePatterns = [
    /「([^」]{2,80})」/g,
    /"([^"]{2,80})"/g,
    /“([^”]{2,80})”/g,
  ]

  for (const pattern of quotePatterns) {
    for (const match of assistantText.matchAll(pattern)) {
      const value = match[1]?.trim()
      if (value && isUsefulQuery(value) && !/[？?。！!，,]/.test(value)) {
        queries.push(value)
      }
    }
  }

  const recommendationLines = assistantText
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => /推荐|可以看看|可以看|更倾向于/.test(line))

  for (const line of recommendationLines) {
    const match = line.match(/(?:推荐|看看|看|倾向于)(?:这款|一个|一款)?\s*([^。，；;\n]{4,80})/)
    const value = match?.[1]?.replace(/^(叫做|是|：|:)/, '').trim()
    if (value && isUsefulQuery(value)) {
      queries.push(value)
    }
  }

  if (!queries.some(isUsefulQuery)) {
    queries.push(userContext)
  }

  return [...new Set(queries)]
    .map((query) => query.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .slice(0, 3)
}

async function fetchText(url: string) {
  const response = await fetch(url, {
    headers: {
      Accept: 'text/html,application/xhtml+xml',
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/135.0 Safari/537.36',
    },
  })

  if (!response.ok) {
    throw new Error(`Unable to fetch ${url}`)
  }

  return await response.text()
}

async function searchDuckDuckGo(query: string) {
  const html = await fetchText(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(`${query} official product`)}`)
  const links = [...html.matchAll(/<a[^>]+class=["']result__a["'][^>]+href=["']([^"']+)["']/gi)]
  const urls: string[] = []

  for (const match of links) {
    const rawUrl = decodeHtml(match[1] ?? '')
    if (!rawUrl) {
      continue
    }

    try {
      const url = decodeDuckDuckGoUrl(rawUrl)
      const parsedUrl = new URL(url)
      if (blockedSearchHosts.has(parsedUrl.hostname.replace(/^www\./, '')) || blockedSearchHosts.has(parsedUrl.hostname)) {
        continue
      }

      urls.push(url)
    } catch {
      continue
    }

    if (urls.length >= 5) {
      break
    }
  }

  return urls
}

function directCandidateUrls(query: string) {
  const normalizedQuery = query.toLowerCase()
  const urls: string[] = []

  if (/bekant|贝肯特/.test(normalizedQuery)) {
    urls.push('https://www.ikea.com/us/en/p/bekant-desk-white-s19022808/')
  }

  if (/micke|米克|宜家|ikea/.test(normalizedQuery)) {
    urls.push('https://www.ikea.com/us/en/p/micke-desk-white-80213074/')
  }

  return urls
}

async function extractProductCandidate(url: string, query: string, userContext: string): Promise<LiveProductCandidate | null> {
  try {
    const html = await fetchText(url)
    const title = extractMeta(html, 'property', 'og:title') || extractTitle(html)
    const image = extractMeta(html, 'property', 'og:image') ||
      extractMeta(html, 'name', 'twitter:image') ||
      extractMeta(html, 'property', 'twitter:image')
    const canonical = extractMeta(html, 'property', 'og:url') || url
    const description = extractMeta(html, 'property', 'og:description') || extractMeta(html, 'name', 'description')

    if (!title || !image) {
      return null
    }

    const sourceUrl = new URL(canonical, url).toString()
    const imageUrl = new URL(image, sourceUrl).toString()
    const brand = domainBrand(sourceUrl)
    const name = cleanProductName(title) || query
    const summary = description ? stripTags(decodeHtml(description)).slice(0, 180) : '以官网页面信息为准。'
    const category = /桌|书桌|desk/i.test(`${query} ${userContext}`) ? '桌面家具' : '实时检索单品'

    return {
      name,
      brand,
      category,
      price_range: extractPrice(html),
      budget_tier: '实时检索',
      materials: '以官网页面信息为准',
      craftsmanship: summary,
      signature_specs: ['实时搜索官网页面', `来源域名：${new URL(sourceUrl).hostname}`, '图片来自页面 og:image'],
      style_tags: ['按当前对话筛选'],
      room_tags: /书房|桌面|办公/.test(userContext) ? ['书房', '工作区'] : ['居家日常'],
      ideal_for: ['希望推荐能跟随真实商品页面更新的人', '需要看到具体商品图和来源链接的人'],
      avoid_for: ['如果只想使用离线精选库，可以继续收窄到已收录商品'],
      pairing_note: summary,
      source_url: sourceUrl,
      image: imageUrl,
      feature: summary,
      benefit: summary,
      scenarios: /书房|桌面|办公/.test(userContext) ? ['书房办公', '桌面搭配', '长时间使用'] : ['居家日常'],
      consultant_summary: `${name} 是根据这轮对话实时检索到的具体商品，图片和来源来自公开商品页面。`,
      matched_preferences: [query, ...userContext.split(/\s+/).filter(Boolean).slice(0, 2)].slice(0, 3),
      why_this: [
        '它来自模型本轮实际提到或当前需求对应的商品检索结果。',
        '卡片图片来自商品页面的公开 og:image，便于直接判断外观。',
        summary,
      ],
      why_not_others: '这张卡优先承接模型当前给出的具体商品，而不是强行回退到固定本地商品库。',
    }
  } catch {
    return null
  }
}

export async function discoverLiveProductRecommendation(assistantText: string, userContext: string) {
  const queries = extractRecommendedQueries(assistantText, userContext)
  const seenUrls = new Set<string>()

  for (const query of queries) {
    let urls: string[] = directCandidateUrls(query)
    try {
      urls = [...urls, ...await searchDuckDuckGo(query)]
    } catch {
      if (!urls.length) {
        continue
      }
    }

    for (const url of urls) {
      if (seenUrls.has(url)) {
        continue
      }
      seenUrls.add(url)

      const candidate = await extractProductCandidate(url, query, userContext)
      if (candidate) {
        return candidate
      }
    }
  }

  return null
}
