import type { CatalogProduct, ProductFamily } from './catalogTypes'
import { getRequestedProductFamily, getRawProductText } from './catalogIntents'
import { getBrandAliases, normalizeText } from './catalogText'

export const BRAND_GROUPS: string[][] = [
  ['uniqlo', '优衣库'],
  ['lululemon', '露露乐蒙'],
  ['muji', '无印良品'],
  ['ikea', '宜家'],
  ['xiaomi', '小米', '米家', 'redmi', '红米'],
  ['adidas', '阿迪达斯'],
  ['nike', '耐克'],
]

const _familyCache = new Map<string, boolean>()
export function isProductInFamily(product: CatalogProduct, family: ProductFamily) {
  const cacheKey = product.id + '|' + family
  const cached = _familyCache.get(cacheKey)
  if (cached !== undefined) return cached

  const productText = getRawProductText(product)
  const productName = normalizeText(product.name)
  let result: boolean

  if (family === 'apparel') {
    result = /服饰|女装|男装|童装|衣服|上衣|t恤|半袖|短袖|衬衫|衬衣|外套|夹克|裤|鞋|袜|内衣|内裤|文胸|bra|睡衣|家居服|帽|背包|配件|裙|tee|t shirt|t-shirt|shirt|jacket|coat|pants|trouser|shorts|sneaker|shoe|sock|footwear|apparel|clothing/.test(productText)
      && !/家具|家居|沙发|床|椅|凳|桌|柜|家电|空调|冰箱|电视|洗衣机|office furniture|chair|sofa|bed|desk|table|cabinet|appliance/.test(productText)
  } else if (family === 'furniture') {
    result = /家具|家居|沙发|床|椅|凳|桌|柜|收纳|置物|书房|客厅|卧室|office furniture|chair|sofa|bed|desk|table|cabinet|storage|shelf|wood-focused furniture/.test(productText)
      && !/服饰|衣服|t恤|半袖|短袖|衬衫|裤|鞋|家电|空调|冰箱|电视|洗衣机/.test(productText)
  } else if (family === 'appliance') {
    result = /家电|空调|冰箱|电视|显示器|洗衣机|烘干|厨电|洗碗机|烤箱|微波炉|air conditioner|refrigerator|fridge|washer|dryer|monitor|tv|dishwasher|oven|microwave|appliance|cooling/.test(productText)
      && !/服饰|衣服|t恤|半袖|短袖|衬衫|裤|鞋|家具|沙发|床|椅|桌/.test(productText)
  } else if (family === 'tableware') {
    result = /杯|碗|盘|筷|勺|叉|壶|餐垫|餐具|马克杯|保温杯|bowl|plate|cup|mug|chopstick|spoon|fork/.test(productName)
      && /杯|碗|盘|筷|勺|叉|壶|餐垫|餐具|厨具|马克杯|保温杯|餐盘|饭碗|汤碗|容器|便当|餐盒|bowl|plate|cup|mug|chopstick|spoon|fork|kitchenware|tableware|dinnerware/.test(productText)
      && !/硬盘|键盘|鼠标|显示器|手机|电脑|笔记本|平板|电视|冰箱|空调|洗衣机|沙发|床|椅|桌|柜|世界杯|洗碗机|洗碗|盘扣|眼影|吸盘/.test(productText)
  } else if (family === 'misc') {
    result = true
  } else {
    result = /灯|台灯|落地灯|灯泡|照明|\blamp\b|\blight\b|\blantern\b/.test(productText)
      && !/服饰|衣服|t恤|半袖|短袖|衬衫|裤|鞋|家具|沙发|床|椅|桌|家电|空调|冰箱|电视|furniture|chair|sofa|bed|headboard|desk|table|appliance/.test(productText)
  }

  _familyCache.set(cacheKey, result)
  return result
}

export function isProductCompatibleWithRequest(product: CatalogProduct, text: string) {
  const requestedFamily = getRequestedProductFamily(text)
  if (requestedFamily && !isProductInFamily(product, requestedFamily)) {
    return false
  }

  return isProductWithinBudget(product, text)
}

export function getGenderPreference(text: string) {
  if (/男的|我是男|男士|男式|男子|男款|男生|男性|men|mens|man/.test(text)) {
    return 'male'
  }
  if (/女的|我是女|女士|女式|女子|女款|女生|女性|women|womens|woman/.test(text)) {
    return 'female'
  }
  return null
}

export function hasOppositeGender(productText: string, preference: 'male' | 'female' | null) {
  if (preference === 'male') {
    return /女式|女士|女子|女款|女生|女性|女装|连衣裙|裙装|半身裙|胸衣|内衣|文胸|bra|dress|skirt|women|womens|woman/.test(productText)
  }
  if (preference === 'female') {
    return /男式|男士|男子|男款|男生|男性|men|mens|man/.test(productText)
  }
  return false
}

export function hasRequestedBrand(text: string) {
  const normalizedText = normalizeText(text)
  return ['uniqlo', '优衣库', 'lululemon', '露露乐蒙', 'muji', '无印良品', 'ikea', '宜家', 'xiaomi', '小米', '米家', 'adidas', '阿迪达斯', 'nike', '耐克']
    .some((brand) => normalizedText.includes(normalizeText(brand)))
}

export function getRequestedBudget(text: string) {
  const budgetMatch = text.match(/(?:预算|价格|价位)?\s*(\d{2,6})\s*(?:元|块|以内|以下|左右|上下)?/)
  if (!budgetMatch) {
    return null
  }

  const budget = Number(budgetMatch[1])
  return Number.isFinite(budget) ? budget : null
}

const _priceCache = new Map<string, number | null>()
export function getProductCnyPrice(product: CatalogProduct) {
  const cached = _priceCache.get(product.id)
  if (cached !== undefined) return cached
  const cnyMatch = product.price_range.match(/CNY\s*([\d.]+)/i)
  const cnyPrice = Number(cnyMatch?.[1])

  // USD → CNY (approx 7.2)
  const usdMatch = product.price_range.match(/USD\s*([\d.]+)/i)
  const usdPrice = Number(usdMatch?.[1])
  const usdToCny = Number.isFinite(usdPrice) ? Math.round(usdPrice * 7.2) : null

  const productText = [
    product.name,
    product.price_range,
    ...product.keywords,
  ].join(' ')
  const yuanPrices = [...productText.matchAll(/(\d{2,6})\s*元/g)]
    .map((match) => Number(match[1]))
    .filter((price) => Number.isFinite(price))

  let result: number | null = null
  if (yuanPrices.length) {
    result = Math.max(...yuanPrices)
  } else if (Number.isFinite(cnyPrice) && cnyPrice >= 20) {
    result = cnyPrice
  } else if (usdToCny && usdToCny >= 20) {
    result = usdToCny
  }

  _priceCache.set(product.id, result)
  return result
}

export function isProductWithinBudget(product: CatalogProduct, text: string) {
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
  return BRAND_GROUPS.find((group) => group.some((brand) => normalizedText.includes(normalizeText(brand)))) ?? []
}

export function filterByRequestedBrand(products: CatalogProduct[], text: string) {
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
