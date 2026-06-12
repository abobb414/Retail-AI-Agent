import productsJson from '../data/products.json'

interface CatalogProduct {
  id: string
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
  keywords: string[]
}

const products = productsJson as CatalogProduct[]

function normalizeText(text: string) {
  return text
    .toLowerCase()
    .replace(/[^\p{Script=Han}a-z0-9]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function tokenize(text: string) {
  return normalizeText(text)
    .split(' ')
    .filter((token) => token.length >= 2)
}

function scoreKeyword(keyword: string, text: string, tokens: string[]) {
  const normalizedKeyword = normalizeText(keyword)
  if (!normalizedKeyword) {
    return 0
  }

  if (text.includes(normalizedKeyword)) {
    return Math.max(6, normalizedKeyword.length * 2)
  }

  const keywordTokens = tokenize(normalizedKeyword)
  if (!keywordTokens.length) {
    return 0
  }

  return keywordTokens.reduce((score, token) => (
    tokens.includes(token) ? score + Math.max(2, token.length) : score
  ), 0)
}

function scoreProduct(product: CatalogProduct, userText: string) {
  const normalizedText = normalizeText(userText)
  const tokens = tokenize(userText)
  const fields = [
    product.name,
    product.brand,
    product.category,
    product.materials,
    product.craftsmanship,
    product.feature,
    product.benefit,
    product.pairing_note,
    ...product.keywords,
    ...product.style_tags,
    ...product.room_tags,
    ...product.scenarios,
  ]

  let score = 0
  for (const field of fields) {
    score += scoreKeyword(field, normalizedText, tokens)
  }

  for (const keyword of product.keywords) {
    score += scoreKeyword(keyword, normalizedText, tokens) * 2
  }

  return score
}

function getMatchedPreferences(product: CatalogProduct, userText: string) {
  const normalizedText = normalizeText(userText)
  const matches = product.keywords
    .filter((keyword) => normalizedText.includes(normalizeText(keyword)))
    .slice(0, 4)

  return matches.length ? matches : product.scenarios.slice(0, 3)
}

export function wantsProductRecommendation(text: string) {
  return /推荐|产品|商品|具体|买|购入|单品|给我一个|给我推荐|直接|想要|需要|适合|找|选|改变|治愈|疲惫|好累|幸福感|一团糟|整理|收纳|理一下|新工作|加班/.test(text)
}

export function pickProductRecommendation(text: string) {
  const scoredProducts = products
    .map((product) => ({
      product,
      score: scoreProduct(product, text),
    }))
    .sort((a, b) => b.score - a.score)

  const bestMatch = scoredProducts[0]
  if (!bestMatch || bestMatch.score < 6) {
    return null
  }

  const { product } = bestMatch

  return {
    ...product,
    consultant_summary: `${product.name} 更适合这类需求里的核心矛盾：既要具体可买，又要和空间、使用习惯、预算感保持一致。`,
    matched_preferences: getMatchedPreferences(product, text),
    why_this: [
      product.benefit,
      product.feature,
      product.pairing_note,
    ],
    why_not_others: '我先给一件最贴近当前语境的核心单品，而不是把多个方向混在一起，方便你判断它是否真正适合这个空间。',
  }
}
