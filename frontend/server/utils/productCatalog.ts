import productsJson from '../data/products.json'
import realProductsJson from '../data/realProducts.json'

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
  catalog_source?: string
}

const curatedProducts = productsJson as CatalogProduct[]
const crawledProducts = (realProductsJson as { products: CatalogProduct[] }).products

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

  if (/^\d+$/.test(normalizedKeyword)) {
    return tokens.includes(normalizedKeyword) ? Math.max(2, normalizedKeyword.length) : 0
  }

  if (text.includes(normalizedKeyword)) {
    return Math.max(6, normalizedKeyword.length * 2)
  }

  const keywordTokens = tokenize(normalizedKeyword)
  if (!keywordTokens.length) {
    return 0
  }

  const reverseTokenScore = tokens.reduce((score, token) => (
    normalizedKeyword.includes(token) ? score + Math.max(2, token.length) : score
  ), 0)

  return reverseTokenScore + keywordTokens.reduce((score, token) => (
    tokens.includes(token) ? score + Math.max(2, token.length) : score
  ), 0)
}

function getBrandAliases(brand: string) {
  const normalizedBrand = normalizeText(brand)
  const aliases: Record<string, string[]> = {
    adidas: ['阿迪达斯'],
    nike: ['耐克'],
    xiaomi: ['小米', '米家', 'redmi', '红米'],
    samsung: ['三星'],
    haier: ['海尔'],
    gree: ['格力'],
    aux: ['奥克斯'],
    tcl: ['tcl'],
    ikea: ['宜家'],
    muji: ['无印良品'],
    uniqlo: ['优衣库'],
    lululemon: ['露露乐蒙'],
    'the north face': ['北面', 'tnf'],
    lg: ['乐金'],
    bosch: ['博世'],
    panasonic: ['松下'],
    ge: ['通用电气'],
  }

  return aliases[normalizedBrand] ?? []
}

interface ProductIntent {
  id: string
  userPattern: RegExp
  productPattern: RegExp
  promptTerms: string[]
  excludeProductPattern?: RegExp
  requireProductPattern?: RegExp
}

const productIntents: ProductIntent[] = [
  {
    id: 'weather_outerwear',
    userPattern: /冲锋衣|硬壳|gore|gore-tex|gtx|登山|户外外套|防风外套|防水外套|防风防雨|防风|防雨|防水|雨衣/,
    productPattern: /冲锋衣|硬壳|gore|gore tex|gtx|storm fit|户外.*(夹克|外套)|登山.*(夹克|外套)|防风.*(夹克|外套)|防水.*(夹克|外套)|拒水.*(夹克|外套)|夹克|外套|jacket|coat|雨衣/,
    requireProductPattern: /冲锋衣|硬壳|gore|gore tex|gtx|storm fit|防风|防水|拒水|雨衣/,
    excludeProductPattern: /家具|沙发|床|椅|凳|豆袋|裤|短袖|半袖|t恤|tee|shirt|背心|鞋|shoe|sneaker|宠物|狗狗|猫咪/,
    promptTerms: ['冲锋衣', '硬壳', '防风', '防雨', '防水', '拒水', '户外外套', '登山外套', '雨衣', '城市通勤防雨'],
  },
  {
    id: 'tee',
    userPattern: /半袖|短袖|t恤|tee|t-shirt|夏天.*通勤|通勤.*半袖/,
    productPattern: /半袖|短袖|t恤|tee|t shirt|t-shirt|shirt|上衣/,
    excludeProductPattern: /长袖|夹克|外套|裤|帽|无袖|背心|幼儿|婴童|儿童|童装|宠物|狗狗|猫咪|long sleeve/,
    promptTerms: ['半袖', '短袖', 'T恤', '上衣', '夏天通勤', '透气', '凉感', '休闲短袖'],
  },
  {
    id: 'shirt',
    userPattern: /衬衫|衬衣|shirt|商务休闲/,
    productPattern: /衬衫|衬衣|shirt/,
    promptTerms: ['衬衫', '衬衣', '商务休闲', '通勤上衣'],
  },
  {
    id: 'pants',
    userPattern: /裤子|长裤|短裤|运动裤|休闲裤|pants|trouser/,
    productPattern: /裤|pants|trouser|shorts/,
    excludeProductPattern: /上衣|短袖|t恤|夹克|外套/,
    promptTerms: ['裤子', '长裤', '短裤', '运动裤', '休闲裤', '通勤裤'],
  },
  {
    id: 'shoes',
    userPattern: /鞋|鞋子|跑鞋|运动鞋|板鞋|登山鞋|徒步鞋|sneaker|shoe/,
    productPattern: /鞋|sneaker|shoe|footwear/,
    promptTerms: ['鞋', '运动鞋', '跑鞋', '板鞋', '徒步鞋', '通勤鞋'],
  },
  {
    id: 'accessory',
    userPattern: /帽|帽子|包|背包|手套|配件|cap|hat|bag/,
    productPattern: /帽|包|背包|手套|配件|cap|hat|bag|accessor/,
    promptTerms: ['帽子', '背包', '手套', '配件', '户外配件', '运动配件'],
  },
  {
    id: 'lighting',
    userPattern: /灯|台灯|落地灯|灯泡|照明|lamp|light/,
    productPattern: /灯|台灯|落地灯|灯泡|照明|lamp|light|lantern/,
    requireProductPattern: /灯|台灯|落地灯|灯泡|照明|lamp|light|lantern/,
    excludeProductPattern: /服饰|鞋|裤|t恤|电视|显示器|手环|耳机|手机|平板|电脑/,
    promptTerms: ['台灯', '灯具', '照明', '灯泡', '阅读灯', '卧室灯'],
  },
  {
    id: 'office_chair',
    userPattern: /办公椅|工作椅|电脑椅|人体工学椅|久坐|office chair|desk chair/,
    productPattern: /办公椅|工作椅|电脑椅|转椅|office chair|desk chair|chair/,
    requireProductPattern: /办公椅|工作椅|电脑椅|转椅|office chair|desk chair|椅|chair/,
    excludeProductPattern: /儿童|幼儿|婴童|童|沙发|床|桌|餐椅|躺椅|贵妃椅|坐垫|靠垫|椅垫|垫|扶手|套件|配件|零件|accessor/,
    promptTerms: ['办公椅', '工作椅', '电脑椅', '人体工学椅', '久坐', '书房办公'],
  },
  {
    id: 'seating',
    userPattern: /椅子|座椅|办公椅|餐椅|休闲椅|凳子|chair|seating/,
    productPattern: /椅|座椅|凳|chair/,
    excludeProductPattern: /服饰|短袖|t恤|鞋|家电|空调|冰箱|电视|沙发|床|儿童|幼儿|婴童|bench|长凳|椅垫|坐垫|靠垫|垫套|凳套|套$/,
    promptTerms: ['椅子', '座椅', '办公椅', '餐椅', '休闲椅', '客厅椅', '书房椅'],
  },
  {
    id: 'sofa_bed',
    userPattern: /沙发|沙发床|床|床垫|sofa|bed|mattress/,
    productPattern: /沙发|床|床垫|sofa|bed|mattress/,
    excludeProductPattern: /服饰|短袖|t恤|鞋|家电/,
    promptTerms: ['沙发', '沙发床', '床', '床垫', '卧室', '客厅', '小户型'],
  },
  {
    id: 'table_desk',
    userPattern: /桌|书桌|餐桌|办公桌|茶几|边桌|desk|table/,
    productPattern: /桌|茶几|desk|table/,
    excludeProductPattern: /服饰|家电/,
    promptTerms: ['桌子', '书桌', '办公桌', '餐桌', '茶几', '边桌'],
  },
  {
    id: 'storage',
    userPattern: /收纳|柜|衣柜|储物|整理|置物架|storage|cabinet|wardrobe/,
    productPattern: /收纳|柜|储物|置物|架|storage|cabinet|wardrobe|shelf/,
    excludeProductPattern: /服饰|短袖|t恤/,
    promptTerms: ['收纳', '柜子', '衣柜', '储物', '置物架', '桌面整理'],
  },
  {
    id: 'air_conditioner',
    userPattern: /空调|冷气|制冷|除湿|air conditioner|cooling/,
    productPattern: /空调|冷气|制冷|air conditioner/,
    requireProductPattern: /空调|air conditioner/,
    excludeProductPattern: /服饰|家具|冰箱|冷藏|冷冻|风冷|直冷|refrigerator|fridge/,
    promptTerms: ['空调', '制冷', '除湿', '客厅空调', '卧室空调', '节能'],
  },
  {
    id: 'refrigerator',
    userPattern: /冰箱|冷藏|冷冻|refrigerator|fridge/,
    productPattern: /冰箱|冷藏|冷冻|refrigerator|fridge/,
    excludeProductPattern: /服饰|家具/,
    promptTerms: ['冰箱', '冷藏', '冷冻', '厨房家电', '容量'],
  },
  {
    id: 'washer',
    userPattern: /洗衣机|烘干|洗烘|washer|dryer|laundry/,
    productPattern: /洗衣|烘干|洗烘|washer|dryer|laundry/,
    excludeProductPattern: /服饰|家具/,
    promptTerms: ['洗衣机', '烘干机', '洗烘', '家用电器'],
  },
  {
    id: 'tv_monitor',
    userPattern: /电视|显示器|屏幕|影院|游戏屏|monitor|tv/,
    productPattern: /电视|显示器|屏幕|monitor|tv|mini led|oled/,
    excludeProductPattern: /服饰|家具/,
    promptTerms: ['电视', '显示器', '屏幕', '客厅影音', '游戏屏', 'Mini LED'],
  },
  {
    id: 'kitchen_appliance',
    userPattern: /洗碗机|烤箱|微波炉|厨电|厨房电器|dishwasher|oven|microwave/,
    productPattern: /洗碗机|烤箱|微波|厨电|dishwasher|oven|microwave|kitchen appliance/,
    excludeProductPattern: /服饰|家具/,
    promptTerms: ['洗碗机', '烤箱', '微波炉', '厨房电器', '厨电'],
  },
]

function getRawProductText(product: CatalogProduct) {
  return normalizeText([
    product.name,
    product.brand,
    product.category,
    product.materials,
    product.feature,
    product.craftsmanship,
    product.benefit,
    product.pairing_note,
    ...product.keywords,
    ...product.style_tags,
    ...product.room_tags,
    ...product.scenarios,
  ].join(' '))
}

function getDominantIntent(text: string) {
  const turns = text.split(/[；;\n]/).map((turn) => turn.trim()).filter(Boolean)
  for (const turn of [...turns].reverse()) {
    const normalizedTurn = normalizeText(turn)
    const intent = productIntents.find((candidate) => candidate.userPattern.test(normalizedTurn))
    if (intent) {
      return intent
    }
  }

  const normalizedText = normalizeText(text)
  return productIntents.find((intent) => intent.userPattern.test(normalizedText)) ?? null
}

function getMatchedIntents(text: string) {
  const normalizedText = normalizeText(text)
  return productIntents.filter((intent) => intent.userPattern.test(normalizedText))
}

type ProductFamily = 'apparel' | 'furniture' | 'appliance' | 'lighting'

const intentFamilyMap: Record<string, ProductFamily> = {
  accessory: 'apparel',
  air_conditioner: 'appliance',
  kitchen_appliance: 'appliance',
  lighting: 'lighting',
  office_chair: 'furniture',
  pants: 'apparel',
  refrigerator: 'appliance',
  seating: 'furniture',
  shirt: 'apparel',
  shoes: 'apparel',
  sofa_bed: 'furniture',
  storage: 'furniture',
  table_desk: 'furniture',
  tee: 'apparel',
  tv_monitor: 'appliance',
  washer: 'appliance',
  weather_outerwear: 'apparel',
}

function getRequestedProductFamily(text: string) {
  const dominantIntent = getDominantIntent(text)
  return dominantIntent ? intentFamilyMap[dominantIntent.id] ?? null : null
}

function isProductInFamily(product: CatalogProduct, family: ProductFamily) {
  const productText = getRawProductText(product)
  if (family === 'apparel') {
    return /服饰|女装|男装|童装|衣服|上衣|t恤|半袖|短袖|衬衫|衬衣|外套|夹克|裤|鞋|帽|背包|配件|tee|t shirt|t-shirt|shirt|jacket|coat|pants|trouser|shorts|sneaker|shoe|footwear|apparel|clothing/.test(productText)
      && !/家具|家居|沙发|床|椅|凳|桌|柜|家电|空调|冰箱|电视|洗衣机|office furniture|chair|sofa|bed|desk|table|cabinet|appliance/.test(productText)
  }

  if (family === 'furniture') {
    return /家具|家居|沙发|床|椅|凳|桌|柜|收纳|置物|书房|客厅|卧室|office furniture|chair|sofa|bed|desk|table|cabinet|storage|shelf|wood-focused furniture/.test(productText)
      && !/服饰|衣服|t恤|半袖|短袖|衬衫|裤|鞋|家电|空调|冰箱|电视|洗衣机/.test(productText)
  }

  if (family === 'appliance') {
    return /家电|空调|冰箱|电视|显示器|洗衣机|烘干|厨电|洗碗机|烤箱|微波炉|air conditioner|refrigerator|fridge|washer|dryer|monitor|tv|dishwasher|oven|microwave|appliance|cooling/.test(productText)
      && !/服饰|衣服|t恤|半袖|短袖|衬衫|裤|鞋|家具|沙发|床|椅|桌/.test(productText)
  }

  return /灯|台灯|落地灯|灯泡|照明|\blamp\b|\blight\b|\blantern\b/.test(productText)
    && !/服饰|衣服|t恤|半袖|短袖|衬衫|裤|鞋|家具|沙发|床|椅|桌|家电|空调|冰箱|电视|furniture|chair|sofa|bed|headboard|desk|table|appliance/.test(productText)
}

function isProductCompatibleWithRequest(product: CatalogProduct, text: string) {
  const requestedFamily = getRequestedProductFamily(text)
  if (requestedFamily && !isProductInFamily(product, requestedFamily)) {
    return false
  }

  return isProductWithinBudget(product, text)
}

function getGenderPreference(text: string) {
  if (/男的|我是男|男士|男式|男子|男款|男生|男性|men|mens|man/.test(text)) {
    return 'male'
  }
  if (/女的|我是女|女士|女式|女子|女款|女生|女性|women|womens|woman/.test(text)) {
    return 'female'
  }
  return null
}

function hasOppositeGender(productText: string, preference: 'male' | 'female' | null) {
  if (preference === 'male') {
    return /女式|女士|女子|女款|女生|女性|女装|连衣裙|裙装|半身裙|胸衣|内衣|文胸|bra|dress|skirt|women|womens|woman/.test(productText)
  }
  if (preference === 'female') {
    return /男式|男士|男子|男款|男生|男性|men|mens|man/.test(productText)
  }
  return false
}

function hasRequestedBrand(text: string) {
  const normalizedText = normalizeText(text)
  return ['uniqlo', '优衣库', 'lululemon', '露露乐蒙', 'muji', '无印良品', 'ikea', '宜家', 'xiaomi', '小米', '米家', 'adidas', '阿迪达斯', 'nike', '耐克']
    .some((brand) => normalizedText.includes(normalizeText(brand)))
}

function getRequestedBudget(text: string) {
  const budgetMatch = text.match(/(?:预算|价格|价位)?\s*(\d{2,6})\s*(?:元|块|以内|以下|左右|上下)?/)
  if (!budgetMatch) {
    return null
  }

  const budget = Number(budgetMatch[1])
  return Number.isFinite(budget) ? budget : null
}

function getProductCnyPrice(product: CatalogProduct) {
  const cnyMatch = product.price_range.match(/CNY\s*([\d.]+)/i)
  const cnyPrice = Number(cnyMatch?.[1])
  const productText = [
    product.name,
    product.price_range,
    ...product.keywords,
  ].join(' ')
  const yuanPrices = [...productText.matchAll(/(\d{2,6})\s*元/g)]
    .map((match) => Number(match[1]))
    .filter((price) => Number.isFinite(price))

  if (yuanPrices.length) {
    return Math.max(...yuanPrices)
  }

  return Number.isFinite(cnyPrice) && cnyPrice >= 20 ? cnyPrice : null
}

function isProductWithinBudget(product: CatalogProduct, text: string) {
  const budget = getRequestedBudget(text)
  if (!budget) {
    return true
  }

  const price = getProductCnyPrice(product)
  if (!price) {
    return false
  }

  return price <= budget
}

function getRequestedBrandAliases(text: string) {
  const normalizedText = normalizeText(text)
  const brandGroups = [
    ['uniqlo', '优衣库'],
    ['lululemon', '露露乐蒙'],
    ['muji', '无印良品'],
    ['ikea', '宜家'],
    ['xiaomi', '小米', '米家', 'redmi', '红米'],
    ['adidas', '阿迪达斯'],
    ['nike', '耐克'],
  ]

  return brandGroups.find((group) => group.some((brand) => normalizedText.includes(normalizeText(brand)))) ?? []
}

function filterByRequestedBrand(products: CatalogProduct[], text: string) {
  const requestedBrands = getRequestedBrandAliases(text)
  if (!requestedBrands.length) {
    return products
  }

  return products.filter((product) => {
    const productText = normalizeText([
      product.brand,
      product.name,
      ...getBrandAliases(product.brand),
      ...product.keywords,
    ].join(' '))
    return requestedBrands.some((brand) => productText.includes(normalizeText(brand)))
  })
}

function isPoorDisplayImage(product: CatalogProduct) {
  const image = product.image || ''
  const brand = normalizeText(product.brand)
  if (!image) {
    return true
  }

  if (/aws-obg-image-lb-\d+\.tcl\.com/.test(image)) {
    return true
  }

  if (brand.includes('uniqlo') && /\/hmall\/test\//.test(image)) {
    return true
  }

  if (brand.includes('lululemon') && /5113b651e00e0aa139e2348517884e3f75e3b6bb\.png/.test(image)) {
    return true
  }

  return false
}

function getUniqloFallbackImage(product: CatalogProduct) {
  const text = normalizeText([product.name, product.category, product.materials, ...product.keywords].join(' '))
  const fallbackIds = text.includes('airism')
    ? ['475355', '448759', '482295']
    : text.includes('麻') || text.includes('linen')
      ? ['474231', '465185']
      : ['482295', '475355', '465185', '448759']
  const fallbackId = fallbackIds[stableHash(product.id || product.name) % fallbackIds.length]
  const fallbackColors: Record<string, string[]> = {
    '448759': ['00', '09'],
    '465185': ['00', '67'],
    '474231': ['00'],
    '475355': ['00'],
    '482295': ['00'],
  }
  const colors = fallbackColors[fallbackId] ?? ['00']
  const safeColor = colors[stableHash(product.name) % colors.length]

  return `https://image.uniqlo.com/UQ/ST3/WesternCommon/imagesgoods/${fallbackId}/item/goods_${safeColor}_${fallbackId}_3x4.jpg`
}

function getDisplayImage(product: CatalogProduct) {
  if (!isPoorDisplayImage(product)) {
    return product.image
  }

  if (normalizeText(product.brand).includes('uniqlo')) {
    return getUniqloFallbackImage(product)
  }

  return ''
}

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

function stableHash(value: string) {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }

  return hash >>> 0
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

interface ScoredProduct {
  product: CatalogProduct
  score: number
  exactScore: number
  spreadScore: number
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

function hasBudgetSignal(text: string) {
  return /预算|价格|价位|\d{2,6}\s*(元|块|以内|以下|左右|上下)|低预算|中预算|高预算|便宜|平价|贵一点|不差钱/.test(text)
}

function hasWearerSignal(text: string) {
  return /男的|我是男|男士|男式|男子|男款|男生|男性|女的|我是女|女士|女式|女子|女款|女生|女性|中性|情侣|儿童|孩子|童|幼儿|大童|小童|婴童|宝宝|men|mens|man|women|womens|woman|unisex|尺码|码数|s码|m码|l码|xl|xxl|大码|小个子|高个子/.test(text)
}

function hasFurnitureContextSignal(text: string) {
  return /卧室|书房|客厅|餐厅|玄关|厨房|办公室|办公|工作|久坐|电脑|显示器|小户型|租房|儿童房|床头|阳台|收纳|整理|置物|几口人|几个人|单人|双人|尺寸|宽|高|深|cm|厘米|平米|㎡|风格|原木|实木|橡木|日式|北欧/.test(text)
}

function hasApplianceContextSignal(text: string) {
  return /面积|平米|㎡|几口人|容量|升|l\b|安装|预留|嵌入|台式|独立式|能效|一级|二级|变频|制冷|制热|除湿|洗烘|烘干|游戏|观影|客厅|卧室|厨房/.test(text)
}

function hasLightingContextSignal(text: string) {
  return /床头|书桌|桌面|阅读|学习|卧室|客厅|餐厅|玄关|氛围|夜灯|护眼|调光|色温|亮度|落地|台式|吊灯/.test(text)
}

interface SlotRequirement {
  id: string
  label: string
  isSatisfied: (text: string) => boolean
}

const slotRequirementsByFamily: Record<ProductFamily, SlotRequirement[]> = {
  apparel: [
    {
      id: 'wearer',
      label: '男士/女士/中性或尺码',
      isSatisfied: hasWearerSignal,
    },
    {
      id: 'budget',
      label: '预算',
      isSatisfied: hasBudgetSignal,
    },
  ],
  furniture: [
    {
      id: 'space_use_or_size',
      label: '使用空间、用途或尺寸',
      isSatisfied: hasFurnitureContextSignal,
    },
    {
      id: 'budget',
      label: '预算',
      isSatisfied: hasBudgetSignal,
    },
  ],
  appliance: [
    {
      id: 'install_capacity_or_scene',
      label: '安装条件、容量/面积或使用场景',
      isSatisfied: hasApplianceContextSignal,
    },
    {
      id: 'budget',
      label: '预算',
      isSatisfied: hasBudgetSignal,
    },
  ],
  lighting: [
    {
      id: 'location_or_lighting_need',
      label: '使用位置或照明需求',
      isSatisfied: hasLightingContextSignal,
    },
    {
      id: 'budget',
      label: '预算',
      isSatisfied: hasBudgetSignal,
    },
  ],
}

function getMissingSlotRequirements(text: string) {
  const family = getRequestedProductFamily(text)
  if (!family) {
    return []
  }

  return slotRequirementsByFamily[family].filter((requirement) => !requirement.isSatisfied(text))
}

function getClarificationPrefix(family: ProductFamily) {
  if (family === 'apparel') {
    return '可以，我先不急着硬推。'
  }
  if (family === 'furniture') {
    return '可以，我先把方向收窄一下。'
  }
  if (family === 'appliance') {
    return '可以，家电先把关键条件确认好。'
  }
  return '可以，灯具先看使用位置和预算。'
}

function getSlotQuestion(family: ProductFamily, missingRequirements: SlotRequirement[]) {
  const missingLabels = missingRequirements.map((requirement) => requirement.label)
  if (missingLabels.length === 1) {
    return `${getClarificationPrefix(family)}还差一个信息：${missingLabels[0]}？`
  }

  return `${getClarificationPrefix(family)}还差这几个关键信息：${missingLabels.join('、')}？`
}

export function getRecommendationClarificationMessage(text: string) {
  const family = getRequestedProductFamily(text)
  if (!family) {
    return null
  }

  const missingRequirements = getMissingSlotRequirements(text)
  return missingRequirements.length ? getSlotQuestion(family, missingRequirements) : null
}

export function shouldClarifyBeforeRecommendation(text: string) {
  if (getRecommendationClarificationMessage(text)) {
    return true
  }

  const compactText = text.replace(/\s+/g, '')
  const hasStrongContext = /桌面|一团糟|收纳|整理|理一下|新工作|加班|好累|疲惫|治愈|幸福感|卧室|书房|客厅|餐厅|玄关|厨房|办公室|办公|工作|久坐|睡前|放松|浅木|原木|实木|橡木|白橡木|预算|小户型|日式|电脑|显示器|床头|氛围|早餐|通勤|阅读|学习|运动|训练|跑步|瑜伽|户外|登山|露营|空调|冰箱|洗衣|电视|烤箱|微波|品牌|adidas|阿迪达斯|nike|耐克|lululemon|露露乐蒙|uniqlo|优衣库|muji|无印良品|ikea|宜家|三星|小米|米家|海尔|格力|tcl|lg|bosch|博世|panasonic|松下|男|女|儿童|夏天|冬天|透气|宽松|修身|纯棉|速干|防晒|大码|小个子|高个子|[0-9]+元/.test(text)

  if (hasStrongContext) {
    return false
  }

  return /^(我)?(想要|需要|要|想买|买|推荐|给我推荐|给我|找|选)?(一个|一把|一张|一件|一双|一台|一套|一张|一款|个|把|张|件|双|台|套|款)?(椅子|座椅|凳子|桌子|书桌|办公桌|台灯|灯|香薰机|香薰|收纳盒|衣服|半袖|短袖|t恤|鞋|鞋子|裤子|外套|背心|空调|冰箱|洗衣机|电视|沙发|床|柜子)$/.test(compactText)
}

export function wantsProductRecommendation(text: string) {
  return /推荐|产品|商品|具体|买|购入|单品|给我一个|给我推荐|直接|想要|需要|适合|找|选|搭配|官网|型号|改变|治愈|疲惫|好累|幸福感|一团糟|整理|收纳|理一下|新工作|加班|运动|训练|跑步|瑜伽|户外|登山|露营|通勤|穿|鞋|衣服|半袖|短袖|t恤|冲锋衣|硬壳|防风|防雨|防水|外套|夹克|裤|家电|空调|冰箱|洗衣|电视|家具|沙发|床|桌|椅/.test(text)
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
