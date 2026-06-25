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
const RE_CHILD_PRODUCT = /儿童|幼儿|幼童|婴童|宝宝|大童|小童|男童|女童|童装|baby|infant|toddler|kids/

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

  // Keywords with weight + substring match in user query
  for (let i = 0; i < product.keywords.length; i++) {
    score += scoreKeyword(product.keywords[i], ctx.normalizedText, ctx.tokens) * 2
    // If keyword is a substring of user query (e.g. "跑鞋" in "我想要一双跑鞋")
    const nk = normalizeText(product.keywords[i])
    if (nk.length >= 2 && ctx.normalizedText.includes(nk)) {
      score += nk.length * 4
    }
  }

  // Double-match boost: keyword in both user text and product name
  const normalizedName = normalizeText(product.name)
  for (const kw of product.keywords) {
    const nk = normalizeText(kw)
    if (nk.length >= 2 && ctx.normalizedText.includes(nk) && normalizedName.includes(nk)) {
      score += nk.length * 10
    }
  }

  // Name-match boost: product name contains user's specific query terms
  for (let i = 0; i < ctx.tokens.length; i++) {
    const token = ctx.tokens[i]
    if (token.length >= 2 && normalizedName.includes(token)) {
      // Stronger boost when token appears at a word boundary (end of name or followed by space)
      const pos = normalizedName.indexOf(token)
      const atBoundary = pos >= 0 && (pos + token.length >= normalizedName.length || normalizedName[pos + token.length] === ' ')
      score += token.length * (atBoundary ? 16 : 8)
    }
  }

  // Subcategory boost: product's detected subcategory matches user query
  const subCat = (product as any)._subCategory
  if (subCat) {
    const subCatNorm = normalizeText(subCat)
    for (const token of ctx.tokens) {
      if (token.length >= 2 && subCatNorm.includes(token)) {
        score += 40
        break
      }
    }
    // Exact product type match: query token == subcategory → strong signal
    for (const token of ctx.tokens) {
      if (token.length >= 2 && subCatNorm === token) {
        score += 60
        break
      }
    }
    // Also check if query term maps to subcategory
    const subCatMappings: Record<string, string[]> = {
      '椅凳': ['椅', '凳', 'chair', 'seat', 'stool'],
      '沙发': ['沙发', 'sofa'],
      '沙发床': ['沙发床'],
      '桌子': ['桌', 'desk', 'table'],
      '床/床架': ['床', 'bed', 'mattress'],
      '柜架': ['柜', '架', 'shelf', 'cabinet'],
      '收纳': ['收纳', '储物', '整理', 'storage'],
      '灯具': ['灯', '灯具', '台灯', '落地灯', 'lamp', 'light'],
      '餐具': ['餐具', '碗', '盘', '杯', 'dinnerware'],
      '运动装备': ['运动鞋', '跑鞋', '板鞋', '跑步鞋'],
      'T恤': ['t恤', 'tee'],
      '衬衫': ['衬衫', 'shirt'],
      '裤装': ['裤', 'pants', 'jeans'],
      '裙装': ['裙', 'skirt', 'dress'],
      '外套': ['外套', '夹克', 'jacket'],
    }
    const matchTerms = subCatMappings[subCat]
    if (matchTerms) {
      for (const term of matchTerms) {
        if (ctx.normalizedText.includes(normalizeText(term))) {
          score += 30
          break
        }
      }
    }
  }

  // Subcategory mismatch penalty: product's category doesn't match query intent
  if (ctx.dominantIntent) {
    const intentToExpectedSubCat: Record<string, string[]> = {
      table_desk: ['桌子'],
      seating: ['椅凳'],
      office_chair: ['椅凳'],
      sofa_bed: ['沙发', '沙发床'],
      storage: ['收纳', '柜架'],
      lighting: ['灯具'],
      kitchenware: ['餐具', '锅具', '刀具', '水壶'],
      shoes: ['运动装备'],
      tee: ['T恤'],
      shirt: ['衬衫'],
      pants: ['裤装'],
      dress: ['裙装'],
    }
    const expected = intentToExpectedSubCat[ctx.dominantIntent.id]
    if (expected) {
      if (!subCat) {
        score -= 30 // No subcategory tag → slight penalty when intent is clear
      } else if (!expected.includes(subCat)) {
        score -= 50 // Wrong subcategory → bigger penalty
      }
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
  // Tighter threshold: only include products within 5% or 8 points of the top score
  const floorScore = Math.max(6, topScore - 8, topScore * 0.95)
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
  const bestCurated = findBestProduct(curatedProducts, text)

  // Pick the better match across both pools
  let selectedMatch = bestCrawled
  if (bestCurated && (!selectedMatch || bestCurated.score > selectedMatch.score)) {
    selectedMatch = bestCurated
  }

  if (!selectedMatch || selectedMatch.score < 6) return null

  // If best match fails compatibility, try the other pool
  if (!isProductCompatibleWithRequest(selectedMatch.product, text)) {
    const fallback = selectedMatch === bestCrawled ? bestCurated : bestCrawled
    if (fallback && fallback.score >= 6 && isProductCompatibleWithRequest(fallback.product, text)) {
      selectedMatch = fallback
    } else {
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
