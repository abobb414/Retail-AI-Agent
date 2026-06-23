import productsJson from '../data/products.json'
import realProductsJson from '../data/realProducts.json'
import type { CatalogProduct, ProductIntent, ScoredProduct } from './catalogTypes'
import { BRAND_GROUPS, getGenderPreference, getProductCnyPrice, getRequestedBudget, hasOppositeGender, hasRequestedBrand, isProductCompatibleWithRequest, isProductInFamily } from './catalogFilters'
import { getDominantIntent, getMatchedIntents, getRequestedProductFamily, getRawProductText } from './catalogIntents'
import { getBrandAliases, normalizeText, scoreKeyword, stableHash, tokenize } from './catalogText'
import { getDisplayImage, isPoorDisplayImage } from './productImagePolicy'
import { shouldClarifyBeforeRecommendation } from './recommendationSlots'

const curatedProducts = productsJson as CatalogProduct[]
const crawledProducts = (realProductsJson as { products: CatalogProduct[] }).products

// ── Shared regex constants ──
const RE_PET_USER = /宠物|狗狗|猫咪/
const RE_PET_PRODUCT = /宠物|狗狗|猫咪/
const RE_CHILD_USER = /儿童|孩子|童|幼儿|大童|小童|婴童|宝宝|baby|infant|toddler|kids/
const RE_CHILD_PRODUCT = /儿童|幼儿|婴童|宝宝|大童|小童|男童|女童|童装|baby|infant|toddler|kids/

// ── User text analysis (cached) ──
interface UserTextAnalysis {
  normalizedText: string
  tokens: string[]
  dominantIntent: ProductIntent | null
  matchedIntents: ProductIntent[]
  genderPreference: 'male' | 'female' | null
  budget: number | null
  hasBrand: boolean
  requestedFamily: string | null
}

const _analysisCache = new Map<string, UserTextAnalysis>()
function analyzeUserText(text: string): UserTextAnalysis {
  let cached = _analysisCache.get(text)
  if (cached !== undefined) return cached
  if (_analysisCache.size > 500) _analysisCache.clear()

  const normalizedText = normalizeText(text)
  const dominantIntent = getDominantIntent(text)
  cached = {
    normalizedText,
    tokens: tokenize(text),
    dominantIntent,
    matchedIntents: getMatchedIntents(text),
    genderPreference: getGenderPreference(text),
    budget: getRequestedBudget(text),
    hasBrand: hasRequestedBrand(text),
    requestedFamily: dominantIntent ? getRequestedProductFamily(text) : null,
  }
  _analysisCache.set(text, cached)
  return cached
}

// ── Intent fit scoring (no gender check — already filtered) ──
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
  if (!RE_PET_USER.test(ctx.normalizedText) && RE_PET_PRODUCT.test(productText)) score -= 220
  if (!RE_CHILD_USER.test(ctx.normalizedText) && RE_CHILD_PRODUCT.test(productText)) score -= 160
  return score
}

// ── Intent filter for product pass/fail ──
function passIntentFilter(productText: string, intent: ProductIntent | null, normalizedText: string) {
  if (!intent) return true
  if (!intent.productPattern.test(productText)) return false
  if (intent.requireProductPattern && !intent.requireProductPattern.test(productText)) return false
  if (intent.excludeProductPattern?.test(productText)) return false
  if (!RE_PET_USER.test(normalizedText) && RE_PET_PRODUCT.test(productText)) return false
  if (!RE_CHILD_USER.test(normalizedText) && RE_CHILD_PRODUCT.test(productText)) return false
  return true
}

// ── Product scoring (receives pre-computed values) ──
function scoreProduct(product: CatalogProduct, ctx: UserTextAnalysis, productText: string, price: number | null) {
  // Score descriptive fields (brand/aliases/keywords scored separately with weights)
  const fields = [
    product.name, product.category, product.materials,
    product.craftsmanship, product.feature, product.benefit, product.pairing_note,
    ...product.style_tags, ...product.room_tags, ...product.scenarios,
  ]
  let score = 0
  for (let i = 0; i < fields.length; i++) {
    score += scoreKeyword(fields[i], ctx.normalizedText, ctx.tokens)
  }

  // Brand with weight
  score += scoreKeyword(product.brand, ctx.normalizedText, ctx.tokens) * 6
  const aliases = getBrandAliases(product.brand)
  for (let i = 0; i < aliases.length; i++) {
    score += scoreKeyword(aliases[i], ctx.normalizedText, ctx.tokens) * 8
  }

  // Keywords with weight
  for (let i = 0; i < product.keywords.length; i++) {
    score += scoreKeyword(product.keywords[i], ctx.normalizedText, ctx.tokens) * 2
  }

  // Double-match boost: keyword in both user text and product name
  const normalizedName = normalizeText(product.name)
  for (const kw of product.keywords) {
    const nk = normalizeText(kw)
    if (nk.length >= 2 && ctx.normalizedText.includes(nk) && normalizedName.includes(nk)) {
      score += nk.length * 10
    }
  }

  score += scoreIntentFit(productText, ctx)

  if (isPoorDisplayImage(product) && !ctx.hasBrand) {
    score -= 44
  }

  if (ctx.budget && price !== null) {
    score += price <= ctx.budget ? 24 : -80
  } else if (ctx.budget && /价格以官网为准|price on request|官网/.test(product.price_range)) {
    score -= 12
  }

  return score
}

// ── Exact product signal ──
function scoreExactProductSignal(product: CatalogProduct, normalizedText: string, aliases: string[]) {
  let score = 0
  const normalizedName = normalizeText(product.name)
  if (normalizedName.length >= 4 && normalizedText.includes(normalizedName)) score += 260

  const normalizedId = normalizeText(product.id)
  if (normalizedId.length >= 4 && normalizedText.includes(normalizedId)) score += 160

  const allBrands = [product.brand, ...aliases]
  for (let i = 0; i < allBrands.length; i++) {
    const nb = normalizeText(allBrands[i])
    if (nb && normalizedText.includes(nb)) { score += 80; break }
  }

  const modelTokens = tokenize(product.name)
  for (let i = 0; i < modelTokens.length && i < 6; i++) {
    if (/[a-z0-9]/i.test(modelTokens[i]) && modelTokens[i].length >= 3 && normalizedText.includes(modelTokens[i])) {
      score += 36
    }
  }
  return score
}

// ── Pool selection ──
function pickFromRelevantPool(scoredProducts: ScoredProduct[], ctx: UserTextAnalysis) {
  scoredProducts.sort((a, b) => {
    if (b.exactScore !== a.exactScore) return b.exactScore - a.exactScore
    if (b.score !== a.score) return b.score - a.score
    return b.spreadScore - a.spreadScore
  })

  const bestMatch = scoredProducts[0]
  if (!bestMatch) return undefined
  if (bestMatch.exactScore >= 180) return bestMatch

  const topScore = bestMatch.score
  const floorScore = Math.max(6, topScore - 16, topScore * 0.92)
  const relevantPool = scoredProducts
    .filter((c) => c.score >= floorScore)
    .slice(0, 48)

  if (relevantPool.length <= 1) return bestMatch

  const poolIndex = stableHash(`${ctx.normalizedText}|${ctx.dominantIntent?.id ?? 'general'}`) % relevantPool.length
  return relevantPool[poolIndex]
}

// ── Matched preferences (from pre-computed data) ──
function getMatchedPreferences(product: CatalogProduct, normalizedText: string) {
  const matches = product.keywords
    .filter((kw) => normalizedText.includes(normalizeText(kw)))
    .slice(0, 4)
  return matches.length ? matches : product.scenarios.slice(0, 3)
}

// ── Core: find best product from a catalog ──
function findBestProduct(products: CatalogProduct[], text: string) {
  const ctx = analyzeUserText(text)
  const intent = ctx.dominantIntent

  // Brand pre-filter
  const requestedBrandGroup = BRAND_GROUPS.find((g) => g.some((b) => ctx.normalizedText.includes(normalizeText(b))))
  const requestedBrandNorms = requestedBrandGroup?.map((b) => normalizeText(b))

  const scored: ScoredProduct[] = []

  for (let i = 0; i < products.length; i++) {
    const product = products[i]

    // Brand filter
    if (requestedBrandNorms) {
      const pBrand = normalizeText(product.brand)
      const pAliases = getBrandAliases(product.brand).map((a) => normalizeText(a))
      if (!requestedBrandNorms.some((b) => pBrand.includes(b) || pAliases.some((a) => a.includes(b)))) continue
    }

    const productText = getRawProductText(product)

    // Intent filter
    if (intent && !passIntentFilter(productText, intent, ctx.normalizedText)) continue

    // Gender filter
    if (hasOppositeGender(productText, ctx.genderPreference)) continue

    // Family filter
    if (ctx.requestedFamily && !isProductInFamily(product, ctx.requestedFamily as any)) continue

    // Budget filter + price caching
    const price = getProductCnyPrice(product)
    if (ctx.budget && price && price > ctx.budget) continue

    const aliases = getBrandAliases(product.brand)

    scored.push({
      product,
      score: scoreProduct(product, ctx, productText, price),
      exactScore: scoreExactProductSignal(product, ctx.normalizedText, aliases),
      spreadScore: stableHash(`${ctx.normalizedText}|${product.id}|${product.name}|${product.source_url}`) % 1000,
    })
  }

  if (scored.length === 0 && intent?.requireProductPattern) return undefined
  return pickFromRelevantPool(scored, ctx)
}

// ── Main entry point ──
export function pickProductRecommendation(text: string) {
  if (shouldClarifyBeforeRecommendation(text)) return null

  const bestCrawled = findBestProduct(crawledProducts, text)
  let selectedMatch = bestCrawled && bestCrawled.score >= 6
    ? bestCrawled
    : findBestProduct(curatedProducts, text)

  if (!selectedMatch || selectedMatch.score < 6) return null

  // If best crawled fails compatibility, try curated (cached from previous call if same text)
  if (!isProductCompatibleWithRequest(selectedMatch.product, text)) {
    selectedMatch = findBestProduct(curatedProducts, text)
    if (!selectedMatch || selectedMatch.score < 6 || !isProductCompatibleWithRequest(selectedMatch.product, text)) {
      return null
    }
  }

  const p = selectedMatch.product
  const isCrawled = Boolean(p.catalog_source)
  const { catalog_source: _, ...product } = p
  const displayCategory = product.category || '精选商品'
  const displayFeature = isCrawled
    ? `${product.brand} 的 ${displayCategory} 单品，适合用商品图、价格和详情页进一步确认。`
    : product.feature
  const displayBenefit = isCrawled
    ? `它和你这次提到的「${text.slice(0, 18)}」有明确关联，能先作为一个具体可比较的选择。`
    : product.benefit
  const displayPairing = isCrawled
    ? `先看尺码、颜色、使用场景和官网详情；如果这些都对，再和同品牌相近款放在一起比较。`
    : product.pairing_note

  return {
    ...product,
    image: getDisplayImage(product),
    feature: displayFeature,
    benefit: displayBenefit,
    pairing_note: displayPairing,
    craftsmanship: product.craftsmanship || displayFeature,
    consultant_summary: `${product.name} 是当前信息里比较贴近的一款：有清晰商品页、价格和图片，适合先拿它作为判断基准。`,
    matched_preferences: getMatchedPreferences(product, normalizeText(text)),
    why_this: [displayBenefit, displayFeature, displayPairing],
    why_not_others: '我先给一件最贴近当前语境的核心单品，方便你判断方向；如果你补充预算、尺码或使用场景，再继续缩小范围。',
  }
}
