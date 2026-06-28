import productsJson from '../data/products.json'
import realProductsJson from '../data/realProducts.json'
import enrichedJson from '../data/realProductsEnriched.json'
import type { CatalogProduct, ProductIntent, ScoredProduct } from './catalogTypes'
import { BRAND_GROUPS, getGenderPreference, getProductCnyPrice, getRequestedBudget, hasOppositeGender, hasRequestedBrand, isProductCompatibleWithRequest, isProductInFamily } from './catalogFilters'
import { getDominantIntent, getMatchedIntents, getRequestedProductFamily, getRawProductText, getCoreProductText } from './catalogIntents'
import { getBrandAliases, normalizeText, scoreKeyword, stableHash, tokenize } from './catalogText'
import { getDisplayImage, isPoorDisplayImage } from './productImagePolicy'
import { shouldClarifyBeforeRecommendation } from './recommendationSlots'

// ── Curated products (unchanged) ──
const curatedProducts = productsJson as CatalogProduct[]

// ── Build enriched subcategory lookup ──
const enrichedSubCategoryMap = new Map<string, string>()
for (const p of (enrichedJson as { products: CatalogProduct[] }).products) {
  const sc = (p as any)._subCategory
  if (sc) enrichedSubCategoryMap.set(p.id, sc)
}

// ── Precomputed product index (computed once at load time) ──
interface PrecomputedProduct {
  product: CatalogProduct
  normalizedName: string
  normalizedKeywords: string[]
  nameTokens: string[]
  normalizedBrand: string
  brandAliasNorms: string[]
  productText: string   // full text for scoring (includes feature/benefit/pairing)
  coreText: string      // lean text for intent filtering (name/brand/category/keywords only)
  subCat: string
  mainCat: string
  price: number | null
  poorImage: boolean
}

const precomputedIndex: PrecomputedProduct[] = []
const invertedIndex = new Map<string, Set<number>>()

function addToInvertedIndex(token: string, idx: number, weight: number) {
  if (token.length < 2) return
  let entry = invertedIndex.get(token)
  if (!entry) {
    entry = new Set<number>()
    invertedIndex.set(token, entry)
  }
  entry.add(idx)
}

for (let i = 0; i < realProductsJson.products.length; i++) {
  const product = realProductsJson.products[i] as CatalogProduct
  const enrichedSubCat = enrichedSubCategoryMap.get(product.id)
  const enrichedMainCat = (enrichedJson.products[i] as any)?._mainCategory ?? ''

  const normalizedName = normalizeText(product.name)
  const normalizedKeywords = product.keywords.map((kw) => normalizeText(kw))
  const nameTokens = tokenize(product.name)
  const normalizedBrand = normalizeText(product.brand)
  const brandAliasNorms = getBrandAliases(product.brand).map((a) => normalizeText(a))
  const productText = getRawProductText(product)
  const coreText = getCoreProductText(product)
  const subCat = enrichedSubCat || (product as any)._subCategory || ''
  const mainCat = enrichedMainCat
  const price = getProductCnyPrice(product)
  const poorImage = isPoorDisplayImage(product)

  precomputedIndex.push({
    product, normalizedName, normalizedKeywords, nameTokens,
    normalizedBrand, brandAliasNorms, productText, coreText,
    subCat, mainCat, price, poorImage,
  })

  for (const kw of normalizedKeywords) addToInvertedIndex(kw, i, 2)
  addToInvertedIndex(normalizedBrand, i, 6)
  for (const alias of brandAliasNorms) addToInvertedIndex(alias, i, 8)
  for (const t of nameTokens) addToInvertedIndex(t, i, 4)
}

// ── Intent → expected mainCategory for cheap candidate expansion ──
const intentToExpectedMainCats: Record<string, string[]> = {
  shoes: ['运动服饰', '户外服饰'],
  sportswear: ['运动服饰', '户外服饰'],
  weather_outerwear: ['运动服饰', '户外服饰'],
  tee: ['T恤', '运动服饰'],
  shirt: ['衬衫', '衬衫·针织衫'],
  pants: ['裤装', '运动服饰'],
  dress: ['连衣裙·半身裙'],
  knitwear: ['运动服饰'],
  outerwear_cold: ['运动服饰', '外套'],
  underwear: ['内衣·内裤'],
  socks: ['运动服饰', '配件'],
  accessory: ['运动服饰', '配件'],
  lighting: ['灯具'],
  office_chair: ['office furniture', 'seating'],
  seating: ['office furniture', 'seating'],
  sofa_bed: ['家具', '卧室家具', '沙发床', '双人沙发床', '三人沙发床'],
  table_desk: ['tables', '家具', '实木/成品家具-客厅', '实木/成品家具-书房茶室'],
  storage: ['storage furniture', '收纳家具', '收纳用品'],
  kitchenware: ['餐具·厨具'],
  air_conditioner: ['空调', 'air-conditioners'],
  refrigerator: ['家用电器', 'refrigerators'],
  washer: ['家用电器', 'washers-and-dryers'],
  tv_monitor: ['电器/数码', '智能电器/数码', 'monitors'],
  kitchen_appliance: ['家用电器', 'kitchen-appliances', 'cooking-baking', 'dishwashers'],
  smart_home: ['家用电器', '智能电器/数码', 'home-appliances', 'vacuum-cleaners'],
  audio: ['电器/数码', 'audio-sound'],
  laptop_tablet: ['电器/数码', '智能电器/数码'],
  cosmetics_skincare: ['精选商品'],
  bedding: ['床上用品', '家具'],
  home_decor: ['精选商品', '家具', '收纳用品'],
  food_snacks: ['精选商品'],
  personal_care_appliance: ['家用电器', 'personal-care/home-appliances'],
  cleaning: ['cleaning-and-care', '家用电器'],
  baby_products: ['新生儿·婴儿', '幼儿服装'],
  phone_accessory: ['精选商品', '智能电器/数码'],
  pet_products: ['精选商品'],
}

// ── Shared regex constants ──
const RE_PET = /宠物|狗狗|猫咪/
const RE_CHILD_USER = /儿童|孩子|童|幼儿|大童|小童|婴童|宝宝|baby|infant|toddler|kids/
const RE_CHILD_PRODUCT = /儿童|幼儿|幼童|婴童|宝宝|大童|小童|男童|女童|童装|baby|infant|toddler|kids/

// ── Module-level constant maps (previously rebuilt per product) ──
const SUB_CAT_MAPPINGS: Record<string, string[]> = {
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

const INTENT_TO_EXPECTED_SUB_CAT: Record<string, string[]> = {
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

// ── Intent fit scoring ──
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
  if (!RE_PET.test(ctx.normalizedText) && RE_PET.test(productText)) score -= 220
  if (!RE_CHILD_USER.test(ctx.normalizedText) && RE_CHILD_PRODUCT.test(productText)) score -= 160
  return score
}

// ── Intent filter for product pass/fail ──
function passIntentFilter(productText: string, intent: ProductIntent | null, normalizedText: string) {
  if (!intent) return true
  if (!intent.productPattern.test(productText)) return false
  if (intent.requireProductPattern && !intent.requireProductPattern.test(productText)) return false
  if (intent.excludeProductPattern?.test(productText)) return false
  if (!RE_PET.test(normalizedText) && RE_PET.test(productText)) return false
  if (!RE_CHILD_USER.test(normalizedText) && RE_CHILD_PRODUCT.test(productText)) return false
  return true
}

// ── Product scoring (reads precomputed values, no normalizeText calls) ──
function scoreProduct(pre: PrecomputedProduct, ctx: UserTextAnalysis) {
  const { product } = pre

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
  for (let i = 0; i < pre.brandAliasNorms.length; i++) {
    score += scoreKeyword(pre.brandAliasNorms[i], ctx.normalizedText, ctx.tokens) * 8
  }

  // Keywords with weight + substring match in user query
  for (let i = 0; i < pre.normalizedKeywords.length; i++) {
    score += scoreKeyword(product.keywords[i], ctx.normalizedText, ctx.tokens) * 2
    const nk = pre.normalizedKeywords[i]
    if (nk.length >= 2 && ctx.normalizedText.includes(nk)) {
      score += nk.length * 4
    }
  }

  // Double-match boost: keyword in both user text and product name
  for (let i = 0; i < pre.normalizedKeywords.length; i++) {
    const nk = pre.normalizedKeywords[i]
    if (nk.length >= 2 && ctx.normalizedText.includes(nk) && pre.normalizedName.includes(nk)) {
      score += nk.length * 10
    }
  }

  // Name-match boost: product name contains user's specific query terms
  for (let i = 0; i < ctx.tokens.length; i++) {
    const token = ctx.tokens[i]
    if (token.length >= 2 && pre.normalizedName.includes(token)) {
      const pos = pre.normalizedName.indexOf(token)
      const atBoundary = pos >= 0 && (pos + token.length >= pre.normalizedName.length || pre.normalizedName[pos + token.length] === ' ')
      score += token.length * (atBoundary ? 16 : 8)
    }
  }

  // Subcategory boost
  const subCat = pre.subCat
  if (subCat) {
    const subCatNorm = normalizeText(subCat)
    for (const token of ctx.tokens) {
      if (token.length >= 2 && subCatNorm.includes(token)) {
        score += 40
        break
      }
    }
    for (const token of ctx.tokens) {
      if (token.length >= 2 && subCatNorm === token) {
        score += 60
        break
      }
    }
    const matchTerms = SUB_CAT_MAPPINGS[subCat]
    if (matchTerms) {
      for (const term of matchTerms) {
        if (ctx.normalizedText.includes(normalizeText(term))) {
          score += 30
          break
        }
      }
    }
  }

  // Subcategory mismatch penalty
  if (ctx.dominantIntent) {
    const expected = INTENT_TO_EXPECTED_SUB_CAT[ctx.dominantIntent.id]
    if (expected) {
      if (!subCat) {
        score -= 30
      } else if (!expected.includes(subCat)) {
        score -= 50
      }
    }
  }

  // mainCategory relevance boost
  if (ctx.dominantIntent) {
    const expectedMain = intentToExpectedMainCats[ctx.dominantIntent.id]
    if (expectedMain && pre.mainCat) {
      if (expectedMain.includes(pre.mainCat)) {
        score += 35
      }
    }
  }

  score += scoreIntentFit(pre.productText, ctx)

  if (pre.poorImage && !ctx.hasBrand) {
    score -= 44
  }

  if (ctx.budget && pre.price !== null) {
    score += pre.price <= ctx.budget ? 24 : -80
  } else if (ctx.budget && /价格以官网为准|price on request|官网/.test(product.price_range)) {
    score -= 12
  }

  return score
}

// ── Exact product signal (reads precomputed values) ──
function scoreExactProductSignal(pre: PrecomputedProduct, normalizedText: string) {
  let score = 0
  if (pre.normalizedName.length >= 4 && normalizedText.includes(pre.normalizedName)) score += 260

  const normalizedId = normalizeText(pre.product.id)
  if (normalizedId.length >= 4 && normalizedText.includes(normalizedId)) score += 160

  if (pre.normalizedBrand && normalizedText.includes(pre.normalizedBrand)) { score += 80 }
  else {
    for (const alias of pre.brandAliasNorms) {
      if (alias && normalizedText.includes(alias)) { score += 80; break }
    }
  }

  for (let i = 0; i < pre.nameTokens.length && i < 6; i++) {
    if (/[a-z0-9]/i.test(pre.nameTokens[i]) && pre.nameTokens[i].length >= 3 && normalizedText.includes(pre.nameTokens[i])) {
      score += 36
    }
  }
  return score
}

// ── Pool selection ──
function pickFromRelevantPool(scored: ScoredProduct[], ctx: UserTextAnalysis) {
  scored.sort((a, b) => {
    if (b.exactScore !== a.exactScore) return b.exactScore - a.exactScore
    if (b.score !== a.score) return b.score - a.score
    return b.spreadScore - a.spreadScore
  })

  const bestMatch = scored[0]
  if (!bestMatch) return undefined
  if (bestMatch.exactScore >= 180) return bestMatch

  const topScore = bestMatch.score
  const floorScore = Math.max(6, topScore - 8, topScore * 0.95)
  const relevantPool = scored
    .filter((c) => c.score >= floorScore)
    .slice(0, 48)

  if (relevantPool.length <= 1) return bestMatch

  const poolIndex = stableHash(`${ctx.normalizedText}|${ctx.dominantIntent?.id ?? 'general'}`) % relevantPool.length
  return relevantPool[poolIndex]
}

// ── Matched preferences (match on normalized, return original keyword for display) ──
function getMatchedPreferences(pre: PrecomputedProduct, normalizedText: string) {
  const matches: string[] = []
  for (let i = 0; i < pre.normalizedKeywords.length; i++) {
    if (normalizedText.includes(pre.normalizedKeywords[i])) {
      matches.push(pre.product.keywords[i])
      if (matches.length >= 4) break
    }
  }
  return matches.length ? matches : pre.product.scenarios.slice(0, 3)
}

// ── Core: find best product from precomputed index ──
function findBestFromIndex(text: string) {
  const ctx = analyzeUserText(text)
  const intent = ctx.dominantIntent

  // Brand pre-filter
  const requestedBrandGroup = BRAND_GROUPS.find((g) => g.some((b) => ctx.normalizedText.includes(normalizeText(b))))
  const requestedBrandNorms = requestedBrandGroup?.map((b) => normalizeText(b))

  // Build candidate set via inverted index when tokens exist, else scan all
  let candidateIndices: Set<number> | null = null
  if (ctx.tokens.length > 0) {
    candidateIndices = new Set<number>()
    for (const token of ctx.tokens) {
      const hits = invertedIndex.get(token)
      if (hits) {
        for (const idx of hits) candidateIndices.add(idx)
      }
    }
    // Fallback to full scan when inverted index produces too few candidates
    if (candidateIndices.size < 8) candidateIndices = null
  }

  // mainCategory pre-skip set (only when intent is clear)
  const expectedMainCats = intent ? intentToExpectedMainCats[intent.id] ?? null : null

  const scored: ScoredProduct[] = []
  const len = precomputedIndex.length
  const useCandidate = candidateIndices !== null && candidateIndices.size > 8

  for (let i = 0; i < len; i++) {
    if (useCandidate && !candidateIndices!.has(i)) continue

    const pre = precomputedIndex[i]
    const { product } = pre

    // Brand filter
    if (requestedBrandNorms) {
      const pBrand = pre.normalizedBrand
      const pAliases = pre.brandAliasNorms
      if (!requestedBrandNorms.some((b) => pBrand.includes(b) || pAliases.some((a) => a.includes(b)))) continue
    }

    // Intent filter (uses coreText — excludes feature/benefit/pairing to avoid false matches)
    if (intent && !passIntentFilter(pre.coreText, intent, ctx.normalizedText)) continue

    // Gender filter
    if (hasOppositeGender(pre.productText, ctx.genderPreference)) continue

    // Family filter
    if (ctx.requestedFamily && !isProductInFamily(product, ctx.requestedFamily as any)) continue

    // Budget filter
    if (ctx.budget && pre.price && pre.price > ctx.budget) continue

    // mainCategory cheap skip: skip clearly-unrelated categories (but keep enough candidates)
    if (expectedMainCats && pre.mainCat && !expectedMainCats.includes(pre.mainCat)) {
      if (scored.length > 12) continue
    }

    scored.push({
      product,
      score: scoreProduct(pre, ctx),
      exactScore: scoreExactProductSignal(pre, ctx.normalizedText),
      spreadScore: stableHash(`${ctx.normalizedText}|${product.id}|${product.name}|${product.source_url}`) % 1000,
    })
  }

  if (scored.length === 0 && intent?.requireProductPattern) return undefined
  return pickFromRelevantPool(scored, ctx)
}

// ── Main entry point ──
export function pickProductRecommendation(text: string) {
  if (shouldClarifyBeforeRecommendation(text)) return null

  const bestCrawled = findBestFromIndex(text)
  const bestCurated = findBestProductFromCurated(text)

  let selectedMatch = bestCrawled
  if (bestCurated && (!selectedMatch || bestCurated.score > selectedMatch.score)) {
    selectedMatch = bestCurated
  }

  if (!selectedMatch || selectedMatch.score < 6) return null

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

  // Find the precomputed entry for matched_preferences
  const matchedPre = precomputedIndex.find((e) => e.product.id === product.id)

  return {
    ...product,
    image: getDisplayImage(product),
    feature: displayFeature,
    benefit: displayBenefit,
    pairing_note: displayPairing,
    craftsmanship: product.craftsmanship || displayFeature,
    consultant_summary: `${product.name} 是当前信息里比较贴近的一款：有清晰商品页、价格和图片，适合先拿它作为判断基准。`,
    matched_preferences: matchedPre
      ? getMatchedPreferences(matchedPre, normalizeText(text))
      : product.keywords.slice(0, 4),
    why_this: [displayBenefit, displayFeature, displayPairing],
    why_not_others: '我先给一件最贴近当前语境的核心单品，方便你判断方向；如果你补充预算、尺码或使用场景，再继续缩小范围。',
  }
}

// ── Curated pool (only 8 items, no index needed) ──
function findBestProductFromCurated(text: string) {
  const ctx = analyzeUserText(text)
  const intent = ctx.dominantIntent

  // Brand pre-filter (same logic as findBestFromIndex)
  const requestedBrandGroup = BRAND_GROUPS.find((g) => g.some((b) => ctx.normalizedText.includes(normalizeText(b))))
  const requestedBrandNorms = requestedBrandGroup?.map((b) => normalizeText(b))

  const scored: ScoredProduct[] = []
  for (let i = 0; i < curatedProducts.length; i++) {
    const product = curatedProducts[i]

    // Brand filter
    if (requestedBrandNorms) {
      const pBrand = normalizeText(product.brand)
      const pAliases = getBrandAliases(product.brand).map((a) => normalizeText(a))
      if (!requestedBrandNorms.some((b) => pBrand.includes(b) || pAliases.some((a) => a.includes(b)))) continue
    }

    const productText = getRawProductText(product)
    const coreText = getCoreProductText(product)
    if (intent && !passIntentFilter(coreText, intent, ctx.normalizedText)) continue
    if (hasOppositeGender(productText, ctx.genderPreference)) continue
    if (ctx.requestedFamily && !isProductInFamily(product, ctx.requestedFamily as any)) continue

    const price = getProductCnyPrice(product)
    if (ctx.budget && price && price > ctx.budget) continue

    const aliases = getBrandAliases(product.brand)
    const normalizedName = normalizeText(product.name)
    const normalizedKeywords = product.keywords.map((kw) => normalizeText(kw))
    const nameTokens = tokenize(product.name)
    const normalizedBrand = normalizeText(product.brand)
    const brandAliasNorms = aliases.map((a) => normalizeText(a))

    const pre: PrecomputedProduct = {
      product, normalizedName, normalizedKeywords, nameTokens,
      normalizedBrand, brandAliasNorms, productText, coreText,
      subCat: (product as any)._subCategory || '',
      mainCat: '', price, poorImage: isPoorDisplayImage(product),
    }

    scored.push({
      product,
      score: scoreProduct(pre, ctx),
      exactScore: scoreExactProductSignal(pre, ctx.normalizedText),
      spreadScore: stableHash(`${ctx.normalizedText}|${product.id}|${product.name}|${product.source_url}`) % 1000,
    })
  }

  if (scored.length === 0 && intent?.requireProductPattern) return undefined
  return pickFromRelevantPool(scored, ctx)
}
