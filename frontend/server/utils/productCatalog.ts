import productsJson from '../data/products.json'
import realProductsJson from '../data/realProducts.json'
import type { CatalogProduct, ScoredProduct } from './catalogTypes'
import { filterByRequestedBrand, getGenderPreference, getProductCnyPrice, getRequestedBudget, hasOppositeGender, hasRequestedBrand, isProductCompatibleWithRequest } from './catalogFilters'
import { getDominantIntent, getMatchedIntents, getRawProductText } from './catalogIntents'
import { getBrandAliases, normalizeText, scoreKeyword, stableHash, tokenize } from './catalogText'
import { getDisplayImage, isPoorDisplayImage } from './productImagePolicy'
import { shouldClarifyBeforeRecommendation } from './recommendationSlots'

const curatedProducts = productsJson as CatalogProduct[]
const crawledProducts = (realProductsJson as { products: CatalogProduct[] }).products

function scoreIntentFit(product: CatalogProduct, userText: string) {
  const productText = getRawProductText(product)
  const dominantIntent = getDominantIntent(userText)
  const genderPreference = getGenderPreference(userText)
  let score = 0

  for (const intent of getMatchedIntents(userText)) {
    if (intent.productPattern.test(productText)) {
      score += intent.id === dominantIntent?.id ? 180 : 70
    } else {
      score -= intent.id === dominantIntent?.id ? 140 : 30
    }

    if (intent.requireProductPattern && !intent.requireProductPattern.test(productText)) {
      score -= intent.id === dominantIntent?.id ? 80 : 20
    }
    if (intent.excludeProductPattern?.test(productText)) {
      score -= intent.id === dominantIntent?.id ? 160 : 40
    }
  }

  if (!/宠物|狗狗|猫咪/.test(userText) && /宠物|狗狗|猫咪/.test(productText)) {
    score -= 220
  }
  if (!/儿童|孩子|童|幼儿|大童|小童|婴童|宝宝|baby|infant|toddler|kids/.test(userText) && /儿童|幼儿|婴童|宝宝|大童|小童|男童|女童|童装|baby|infant|toddler|kids/.test(productText)) {
    score -= 160
  }
  if (hasOppositeGender(productText, genderPreference)) {
    score -= 260
  }
  if (isPoorDisplayImage(product) && !hasRequestedBrand(userText)) {
    score -= 44
  }

  const budget = getRequestedBudget(userText)
  const price = getProductCnyPrice(product)
  if (budget && price) {
    score += price <= budget ? 24 : -80
  } else if (budget && /价格以官网为准|price on request|官网/.test(product.price_range)) {
    score -= 12
  }

  return score
}

function filterByStrongIntent(products: CatalogProduct[], text: string) {
  const intent = getDominantIntent(text)
  const genderPreference = getGenderPreference(text)
  if (!intent) {
    return products
  }

  const filteredProducts = products
    .filter((product) => {
      const productText = getRawProductText(product)
      if (!intent.productPattern.test(productText)) {
        return false
      }
      if (intent.requireProductPattern && !intent.requireProductPattern.test(productText)) {
        return false
      }
      if (intent.excludeProductPattern?.test(productText)) {
        return false
      }
      if (!/宠物|狗狗|猫咪/.test(text) && /宠物|狗狗|猫咪/.test(productText)) {
        return false
      }
      if (!/儿童|孩子|童|幼儿|大童|小童|婴童|宝宝|baby|infant|toddler|kids/.test(text) && /儿童|幼儿|婴童|宝宝|大童|小童|男童|女童|童装|baby|infant|toddler|kids/.test(productText)) {
        return false
      }
      if (hasOppositeGender(productText, genderPreference)) {
        return false
      }
      if (!isProductCompatibleWithRequest(product, text)) {
        return false
      }
      return true
    })

  if (filteredProducts.length) {
    return filteredProducts
  }

  return intent.requireProductPattern ? [] : products
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
    ...getBrandAliases(product.brand),
    ...product.keywords,
    ...product.style_tags,
    ...product.room_tags,
    ...product.scenarios,
  ]

  let score = 0
  for (const field of fields) {
    score += scoreKeyword(field, normalizedText, tokens)
  }

  score += scoreKeyword(product.brand, normalizedText, tokens) * 6
  for (const alias of getBrandAliases(product.brand)) {
    score += scoreKeyword(alias, normalizedText, tokens) * 8
  }

  for (const keyword of product.keywords) {
    score += scoreKeyword(keyword, normalizedText, tokens) * 2
  }

  return score + scoreIntentFit(product, userText)
}

function scoreExactProductSignal(product: CatalogProduct, userText: string) {
  const normalizedText = normalizeText(userText)
  let score = 0

  const exactFields = [product.name, product.id, product.source_url]
    .map((field) => normalizeText(field))
    .filter((field) => field.length >= 4)

  for (const field of exactFields) {
    if (normalizedText.includes(field)) {
      score += field === normalizeText(product.name) ? 260 : 160
    }
  }

  const brandAliases = [product.brand, ...getBrandAliases(product.brand)]
  const hasBrand = brandAliases.some((brand) => {
    const normalizedBrand = normalizeText(brand)
    return normalizedBrand && normalizedText.includes(normalizedBrand)
  })
  if (hasBrand) {
    score += 80
  }

  const modelTokens = tokenize(product.name)
    .filter((token) => /[a-z0-9]/i.test(token) && token.length >= 3)
    .slice(0, 6)

  for (const token of modelTokens) {
    if (normalizedText.includes(token)) {
      score += 36
    }
  }

  return score
}

function pickFromRelevantPool(scoredProducts: ScoredProduct[], text: string) {
  const sortedProducts = [...scoredProducts].sort((a, b) => {
    if (b.exactScore !== a.exactScore) {
      return b.exactScore - a.exactScore
    }
    if (b.score !== a.score) {
      return b.score - a.score
    }
    return b.spreadScore - a.spreadScore
  })

  const bestMatch = sortedProducts[0]
  if (!bestMatch) {
    return undefined
  }

  if (bestMatch.exactScore >= 180) {
    return bestMatch
  }

  const topScore = bestMatch.score
  const floorScore = Math.max(6, topScore - 16, topScore * 0.92)
  const relevantPool = sortedProducts
    .filter((candidate) => candidate.score >= floorScore)
    .slice(0, 48)

  if (relevantPool.length <= 1) {
    return bestMatch
  }

  const querySeed = [
    normalizeText(text),
    getDominantIntent(text)?.id ?? 'general',
  ].join('|')
  const poolIndex = stableHash(querySeed) % relevantPool.length

  return relevantPool[poolIndex]
}

function getMatchedPreferences(product: CatalogProduct, userText: string) {
  const normalizedText = normalizeText(userText)
  const matches = product.keywords
    .filter((keyword) => normalizedText.includes(normalizeText(keyword)))
    .slice(0, 4)

  return matches.length ? matches : product.scenarios.slice(0, 3)
}

function findBestProduct(products: CatalogProduct[], text: string) {
  const normalizedText = normalizeText(text)
  const brandFilteredProducts = filterByRequestedBrand(products, text)
  if (!brandFilteredProducts.length) {
    return undefined
  }

  const scoredProducts = filterByStrongIntent(brandFilteredProducts, text)
    .filter((product) => isProductCompatibleWithRequest(product, text))
    .map((product) => ({
      product,
      score: scoreProduct(product, text),
      exactScore: scoreExactProductSignal(product, text),
      spreadScore: stableHash([
        normalizedText,
        product.id,
        product.name,
        product.source_url,
      ].join('|')) % 1000,
    }))

  return pickFromRelevantPool(scoredProducts, text)
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
    matched_preferences: getMatchedPreferences(product, text),
    why_this: [
      displayBenefit,
      displayFeature,
      displayPairing,
    ],
    why_not_others: '我先给一件最贴近当前语境的核心单品，方便你判断方向；如果你补充预算、尺码或使用场景，再继续缩小范围。',
  }
}
