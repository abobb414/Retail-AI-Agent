import type { CatalogProduct, ProductFamily } from './catalogTypes'
import { getRequestedProductFamily, getRawProductText } from './catalogIntents'
import { getBrandAliases, normalizeText } from './catalogText'

export function isProductInFamily(product: CatalogProduct, family: ProductFamily) {
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

export function getProductCnyPrice(product: CatalogProduct) {
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
