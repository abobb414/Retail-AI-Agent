import productsJson from '../data/products.json'
import realProductsJson from '../data/realProducts.json'
import type { CatalogProduct, ProductIntent, ScoredProduct } from './catalogTypes'
import { getGenderPreference, getProductCnyPrice, getRequestedBudget, hasOppositeGender, hasRequestedBrand, isProductInFamily } from './catalogFilters'
import { getRequestedProductFamily } from './catalogIntents'
import { getDominantIntent, getMatchedIntents, getRawProductText } from './catalogIntents'
import { getBrandAliases, normalizeText, scoreKeyword, stableHash, tokenize } from './catalogText'
import { getDisplayImage, isPoorDisplayImage } from './productImagePolicy'
import { shouldClarifyBeforeRecommendation } from './recommendationSlots'

const curatedProducts = productsJson as CatalogProduct[]
const crawledProducts = (realProductsJson as { products: CatalogProduct[] }).products

interface UserTextAnalysis {
  normalizedText: string
  tokens: string[]
  dominantIntent: ProductIntent | null
  matchedIntents: ProductIntent[]
  genderPreference: 'male' | 'female' | null
  budget: number | null
  hasBrand: boolean
}

const _analysisCache = new Map<string, UserTextAnalysis>()
function analyzeUserText(text: string): UserTextAnalysis {
  let cached = _analysisCache.get(text)
  if (cached !== undefined) return cached
  if (_analysisCache.size > 500) _analysisCache.clear()

  const normalizedText = normalizeText(text)
  cached = {
    normalizedText,
    tokens: tokenize(text),
    dominantIntent: getDominantIntent(text),
    matchedIntents: getMatchedIntents(text),
    genderPreference: getGenderPreference(text),
    budget: getRequestedBudget(text),
    hasBrand: hasRequestedBrand(text),
  }
  _analysisCache.set(text, cached)
  return cached
}

function scoreIntentFit(productText: string, ctx: UserTextAnalysis) {
  let score = 0

  for (const intent of ctx.matchedIntents) {
    const isDominant = intent.id === ctx.dominantIntent?.id
    if (intent.productPattern.test(productText)) {
      score += isDominant ? 180 : 70
    } else {
      score -= isDominant ? 140 : 30
    }
    if (intent.requireProductPattern && !intent.requireProductPattern.test(productText)) {
      score -= isDominant ? 80 : 20
    }
    if (intent.excludeProductPattern?.test(productText)) {
      score -= isDominant ? 160 : 40
    }
  }

  if (!/宠物|狗狗|猫咪/.test(ctx.normalizedText) && /宠物|狗狗|猫咪/.test(productText)) {
    score -= 220
  }
  if (!/儿童|孩子|童|幼儿|大童|小童|婴童|宝宝|baby|infant|toddler|kids/.test(ctx.normalizedText) && /儿童|幼儿|婴童|宝宝|大童|小童|男童|女童|童装|baby|infant|toddler|kids/.test(productText)) {
    score -= 160
  }
  if (hasOppositeGender(productText, ctx.genderPreference)) {
    score -= 260
  }

  return score
}

function passIntentFilter(productText: string, intent: ProductIntent | null, text: string) {
  if (!intent) return true
  if (!intent.productPattern.test(productText)) return false
  if (intent.requireProductPattern && !intent.requireProductPattern.test(productText)) return false
  if (intent.excludeProductPattern?.test(productText)) return false
  if (!/宠物|狗狗|猫咪/.test(text) && /宠物|狗狗|猫咪/.test(productText)) return false
  if (!/儿童|孩子|童|幼儿|大童|小童|婴童|宝宝|baby|infant|toddler|kids/.test(text) && /儿童|幼儿|婴童|宝宝|大童|小童|男童|女童|童装|baby|infant|toddler|kids/.test(productText)) return false
  return true
}

function scoreProduct(product: CatalogProduct, ctx: UserTextAnalysis) {
  const productText = getRawProductText(product)
  const fields = [
    product.name, product.brand, product.category, product.materials,
    product.craftsmanship, product.feature, product.benefit, product.pairing_note,
    ...getBrandAliases(product.brand),
    ...product.keywords, ...product.style_tags, ...product.room_tags, ...product.scenarios,
  ]

  let score = 0
  for (let i = 0; i < fields.length; i++) {
    score += scoreKeyword(fields[i], ctx.normalizedText, ctx.tokens)
  }

  score += scoreKeyword(product.brand, ctx.normalizedText, ctx.tokens) * 6
  const aliases = getBrandAliases(product.brand)
  for (let i = 0; i < aliases.length; i++) {
    score += scoreKeyword(aliases[i], ctx.normalizedText, ctx.tokens) * 8
  }

  for (let i = 0; i < product.keywords.length; i++) {
    score += scoreKeyword(product.keywords[i], ctx.normalizedText, ctx.tokens) * 2
  }

  score += scoreIntentFit(productText, ctx)

  if (isPoorDisplayImage(product) && !ctx.hasBrand) {
    score -= 44
  }

  if (ctx.budget) {
    const price = getProductCnyPrice(product)
    if (price) {
      score += price <= ctx.budget ? 24 : -80
    } else if (/价格以官网为准|price on request|官网/.test(product.price_range)) {
      score -= 12
    }
  }

  return score
}

function scoreExactProductSignal(product: CatalogProduct, normalizedText: string) {
  let score = 0

  const normalizedName = normalizeText(product.name)
  if (normalizedName.length >= 4 && normalizedText.includes(normalizedName)) {
    score += 260
  }

  const normalizedId = normalizeText(product.id)
  if (normalizedId.length >= 4 && normalizedText.includes(normalizedId)) {
    score += 160
  }

  const brandAliases = [product.brand, ...getBrandAliases(product.brand)]
  for (let i = 0; i < brandAliases.length; i++) {
    const nb = normalizeText(brandAliases[i])
    if (nb && normalizedText.includes(nb)) {
      score += 80
      break
    }
  }

  const modelTokens = tokenize(product.name)
  for (let i = 0; i < modelTokens.length && i < 6; i++) {
    if (/[a-z0-9]/i.test(modelTokens[i]) && modelTokens[i].length >= 3 && normalizedText.includes(modelTokens[i])) {
      score += 36
    }
  }

  return score
}

function pickFromRelevantPool(scoredProducts: ScoredProduct[], text: string, ctx: UserTextAnalysis) {
  const sortedProducts = [...scoredProducts].sort((a, b) => {
    if (b.exactScore !== a.exactScore) return b.exactScore - a.exactScore
    if (b.score !== a.score) return b.score - a.score
    return b.spreadScore - a.spreadScore
  })

  const bestMatch = sortedProducts[0]
  if (!bestMatch) return undefined
  if (bestMatch.exactScore >= 180) return bestMatch

  const topScore = bestMatch.score
  const floorScore = Math.max(6, topScore - 16, topScore * 0.92)
  const relevantPool = sortedProducts
    .filter((c) => c.score >= floorScore)
    .slice(0, 48)

  if (relevantPool.length <= 1) return bestMatch

  const poolIndex = stableHash(`${ctx.normalizedText}|${ctx.dominantIntent?.id ?? 'general'}`) % relevantPool.length
  return relevantPool[poolIndex]
}

function getMatchedPreferences(product: CatalogProduct, normalizedText: string) {
  const matches = product.keywords
    .filter((kw) => normalizedText.includes(normalizeText(kw)))
    .slice(0, 4)
  return matches.length ? matches : product.scenarios.slice(0, 3)
}

function findBestProduct(products: CatalogProduct[], text: string) {
  const ctx = analyzeUserText(text)
  const intent = ctx.dominantIntent

  // Brand pre-filter
  const brandGroups = [
    ['uniqlo', '优衣库'], ['lululemon', '露露乐蒙'], ['muji', '无印良品'],
    ['ikea', '宜家'], ['xiaomi', '小米', '米家', 'redmi', '红米'],
    ['adidas', '阿迪达斯'], ['nike', '耐克'],
  ]
  const requestedBrandGroup = brandGroups.find((g) => g.some((b) => ctx.normalizedText.includes(normalizeText(b))))
  const requestedBrandNorms = requestedBrandGroup?.map((b) => normalizeText(b))

  const requestedFamily = getRequestedProductFamily(text)
  const scored: ScoredProduct[] = []

  for (let i = 0; i < products.length; i++) {
    const product = products[i]

    // Brand filter
    if (requestedBrandNorms) {
      const pBrand = normalizeText(product.brand)
      const pAliases = getBrandAliases(product.brand).map((a) => normalizeText(a))
      const brandMatch = requestedBrandNorms.some((b) => pBrand.includes(b) || pAliases.some((a) => a.includes(b)))
      if (!brandMatch) continue
    }

    const productText = getRawProductText(product)

    // Intent filter
    if (intent && !passIntentFilter(productText, intent, text)) continue
    intentFilteredCount++

    // Gender filter
    if (hasOppositeGender(productText, ctx.genderPreference)) continue

    // Family filter
    if (requestedFamily && !isProductInFamily(product, requestedFamily)) continue

    // Budget filter
    if (ctx.budget) {
      const price = getProductCnyPrice(product)
      if (price && price > ctx.budget) continue
    }

    scored.push({
      product,
      score: scoreProduct(product, ctx),
      exactScore: scoreExactProductSignal(product, ctx.normalizedText),
      spreadScore: stableHash(`${ctx.normalizedText}|${product.id}|${product.name}|${product.source_url}`) % 1000,
    })
  }

  // Fallback: if intent filter removed everything, try without it
  if (scored.length === 0 && intent?.requireProductPattern) {
    return undefined
  }

  return pickFromRelevantPool(scored, text, ctx)
}

export function pickProductRecommendation(text: string) {
  if (shouldClarifyBeforeRecommendation(text)) {
    return null
  }

  const bestMatch = findBestProduct(crawledProducts, text)
  const selectedMatch = bestMatch && bestMatch.score >= 6
    ? bestMatch
    : findBestProduct(curatedProducts, text)

  if (!selectedMatch || selectedMatch.score < 6 || !isProductCompatibleWithRequest(selectedMatch.product, text)) {
    return null
  }

  const isCrawledProduct = Boolean(selectedMatch.product.catalog_source)
  const { catalog_source: _catalogSource, ...product } = selectedMatch.product
  const displayCategory = product.category || '精选商品'
  const displayFeature = isCrawledProduct
    ? `${product.brand} 的 ${displayCategory} 单品，适合用商品图、价格和详情页进一步确认。`
    : product.feature
  const displayBenefit = isCrawledProduct
    ? `它和你这次提到的「${text.slice(0, 18)}」有明确关联，能先作为一个具体可比较的选择。`
    : product.benefit
  const displayPairing = isCrawledProduct
    ? `先看尺码、颜色、使用场景和官网详情；如果这些都对，再和同品牌相近款放在一起比较。`
    : product.pairing_note
  const displayImage = getDisplayImage(product)

  return {
    ...product,
    image: displayImage,
    feature: displayFeature,
    benefit: displayBenefit,
    pairing_note: displayPairing,
    craftsmanship: product.craftsmanship || displayFeature,
    consultant_summary: `${product.name} 是当前信息里比较贴近的一款：有清晰商品页、价格和图片，适合先拿它作为判断基准。`,
    matched_preferences: getMatchedPreferences(product, normalizeText(text)),
    why_this: [
      displayBenefit,
      displayFeature,
      displayPairing,
    ],
    why_not_others: '我先给一件最贴近当前语境的核心单品，方便你判断方向；如果你补充预算、尺码或使用场景，再继续缩小范围。',
  }
}
