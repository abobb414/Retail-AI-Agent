import type { CatalogProduct, ProductFamily, ProductIntent } from './catalogTypes'
import { normalizeText } from './catalogText'

export const productIntents: ProductIntent[] = [
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

export function getRawProductText(product: CatalogProduct) {
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

export function getDominantIntent(text: string) {
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

export function getMatchedIntents(text: string) {
  const normalizedText = normalizeText(text)
  return productIntents.filter((intent) => intent.userPattern.test(normalizedText))
}

export function getRequestedProductFamily(text: string) {
  const dominantIntent = getDominantIntent(text)
  return dominantIntent ? intentFamilyMap[dominantIntent.id] ?? null : null
}
