interface CatalogProduct {
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
}

const products: CatalogProduct[] = [
  {
    name: 'Vitruvi Stone Diffuser 智能香薰机',
    brand: 'Vitruvi',
    category: '家居香氛',
    price_range: 'USD 123',
    budget_tier: '中高预算',
    materials: '哑光陶瓷外壳、BPA-free 水箱、超声波雾化模块',
    craftsmanship: '用石材感陶瓷外壳包住电子结构，外观看起来更像一件摆件，而不是普通小家电。',
    signature_specs: ['连续运行约 4 小时，间歇模式约 8 小时', '适合约 500 平方英尺空间', '支持柔和环境灯'],
    style_tags: ['极简', '温润', '酒店感'],
    room_tags: ['卧室', '客厅', '玄关'],
    ideal_for: ['希望家里闻起来干净、克制、不过分甜腻的人', '想在卧室或玄关建立稳定仪式感的人', '偏爱低存在感家居设备的人'],
    avoid_for: ['完全不接受任何香氛的人', '只追求大容量、长时间无人值守的人'],
    pairing_note: '它和亚麻、浅木、奶油白墙面很容易搭在一起，比较适合安静、不堆满物件的空间。',
    source_url: 'https://vitruvi.com/products/stone-essential-oil-diffuser',
    image: 'https://vitruvi.com/cdn/shop/files/pdp_stone-diffuser_front_white_gallery_1_v9_image.png?v=1759291810',
    feature: '超声波扩香、间歇运行、柔和环境灯与陶瓷器物感外观。',
    benefit: '能很快把卧室或玄关的氛围收拢得更完整，适合睡前放松和回家后的情绪切换。',
    scenarios: ['卧室睡前放松', '玄关迎宾香氛', '客厅轻度氛围营造'],
  },
  {
    name: 'BenQ e-Reading Desk Lamp 阅读台灯',
    brand: 'BenQ',
    category: '桌面照明',
    price_range: 'USD 279',
    budget_tier: '中高预算',
    materials: '铝合金灯臂、广角灯头、金属底座',
    craftsmanship: '以大范围不刺眼照明为核心，造型比传统书桌台灯更利落，适合现代住宅和工作台面。',
    signature_specs: ['可调色温与亮度', '非对称广域照明', '适合阅读、办公与双屏桌面'],
    style_tags: ['现代', '理性', '极简'],
    room_tags: ['书房', '卧室', '工作区'],
    ideal_for: ['在意阅读和办公时眼睛舒适度的人', '需要一盏功能明确但外观不过分张扬的台灯的人', '想让桌面更干净、光线更均匀的人'],
    avoid_for: ['只想要纯装饰性小夜灯的人', '偏好复古装饰风格的人'],
    pairing_note: '如果桌面本身已经偏干净，它会让整个阅读区更像一个完整的工作角，而不是临时摆了一盏灯。',
    source_url: 'https://www.benq.com/en-us/lighting/e-reading-desk-lamp/e-reading.html',
    image: 'https://image.benq.com/is/image/benqco/silver-5?$ResponsivePreset$',
    feature: '广域阅读照明、亮度色温调节与针对桌面反光优化的出光方式。',
    benefit: '比起单纯变亮，它更擅长让长时间阅读和夜间使用变得稳定、柔和、不容易累。',
    scenarios: ['卧室床边夜读', '书房办公阅读', '设计师桌面照明'],
  },
  {
    name: 'Sonos Era 300 空间音响',
    brand: 'Sonos',
    category: '居家音响',
    price_range: 'USD 449',
    budget_tier: '中高预算',
    materials: '哑光复合机身、定向声学结构、多单元扬声系统',
    craftsmanship: '不是把音箱做成一块黑盒子，而是通过弧面体量和空间声场去强化房间里的包裹感。',
    signature_specs: ['支持 Dolby Atmos 空间音频', 'Wi-Fi 串流与蓝牙播放', '适合单只独立使用，也适合立体声配对'],
    style_tags: ['现代', '雕塑感', '生活方式'],
    room_tags: ['客厅', '卧室', '休闲区'],
    ideal_for: ['希望居家音乐体验更有包裹感的人', '不想把客厅做成器材感太重的人', '在意声音和外观同时成立的人'],
    avoid_for: ['只追求最低预算蓝牙播放的人', '需要非常便携户外使用的人'],
    pairing_note: '它更适合有一定留白的客厅或卧室角落，周边如果是木质、石材或织物，整体会更显高级。',
    source_url: 'https://www.sonos.com/en-us/shop/era-300',
    image: 'https://media.sonos.com/images/znqtjj88/production/1dfecdf1513cd96cd28e789adac4957b97adf50b-1800x1800.png?q=75&fit=clip&auto=format',
    feature: '空间音频、无线串流、多单元声场设计与 Sonos 多房间生态。',
    benefit: '它能把客厅或卧室的氛围一下子做厚，让音乐不只是背景声，而是空间体验的一部分。',
    scenarios: ['客厅背景音乐', '卧室独处放松', '周末家中会客'],
  },
  {
    name: 'Ember Mug 2 恒温马克杯',
    brand: 'Ember',
    category: '日常饮品',
    price_range: 'USD 129.95',
    budget_tier: '中高预算',
    materials: '陶瓷涂层杯身、恒温发热底座、内置电池',
    craftsmanship: '它不是通过复杂外形取胜，而是把日常喝茶或咖啡这件小事做得更顺、更不容易被打断。',
    signature_specs: ['支持 App 调节饮品温度', '杯身续航约 80 分钟', '配合充电底座可持续保温'],
    style_tags: ['简洁', '克制', '日常高级感'],
    room_tags: ['书房', '办公室', '卧室边柜'],
    ideal_for: ['喝咖啡或茶很慢、总是放凉的人', '希望提升个人日常体验而不是买大件设备的人', '送礼时想要既实用又显得有选择的人'],
    avoid_for: ['只需要普通马克杯的人', '追求超大容量的人'],
    pairing_note: '它特别适合放在阅读桌、办公桌或床边边几上，属于尺寸不大但体验感很明显的一类单品。',
    source_url: 'https://ember.com/products/ember-mug-2',
    image: 'https://ember.com/cdn/shop/files/ember_CM1910_00-black_600x.jpg?v=1762439501',
    feature: '恒温控制、App 调温与底座持续保温。',
    benefit: '对于慢慢喝饮品的人来说，它能明显减少被放凉打断体验的那种小烦躁。',
    scenarios: ['晨间咖啡', '书房长时间阅读', '办公室桌面礼物型单品'],
  },
]

function scoreProduct(product: CatalogProduct, text: string) {
  const haystack = [
    product.name,
    product.brand,
    product.category,
    product.materials,
    product.craftsmanship,
    product.pairing_note,
    product.feature,
    product.benefit,
    ...product.style_tags,
    ...product.room_tags,
    ...product.scenarios,
    ...product.ideal_for,
  ].join(' ')

  let score = 0
  for (const token of text.match(/[\p{Script=Han}A-Za-z0-9]+/gu) ?? []) {
    if (token.length > 1 && haystack.includes(token)) {
      score += token.length
    }
  }

  if (/睡眠|睡前|卧室|玄关|香|香氛|扩香|气味|味道/.test(text) && product.name.includes('Vitruvi')) score += 22
  if (/阅读|书房|台灯|灯光|光线|护眼|照明/.test(text) && product.name.includes('BenQ')) score += 28
  if (/音乐|音响|客厅|影院|电视|沉浸/.test(text) && product.name.includes('Sonos')) score += 22
  if (/噪音|隔音|吵|白噪音/.test(text) && product.name.includes('Sonos')) score += 8
  if (/咖啡|茶|杯|温度|保温|办公室/.test(text) && product.name.includes('Ember')) score += 20

  return score
}

export function wantsProductRecommendation(text: string) {
  return /推荐|产品|商品|具体|买|购入|单品|给我一个|给我推荐|直接/.test(text)
}

function asksForFurnitureTable(text: string) {
  return /书桌|办公桌|电脑桌|写字桌|桌子|木桌|实木桌/.test(text)
}

export function pickProductRecommendation(text: string) {
  if (asksForFurnitureTable(text)) {
    return null
  }

  const scoredProducts = products
    .map((product) => ({
      product,
      score: scoreProduct(product, text),
    }))
    .sort((a, b) => b.score - a.score)

  const bestMatch = scoredProducts[0]
  if (!bestMatch || bestMatch.score < 8) {
    return null
  }

  const { product } = bestMatch

  return {
    ...product,
    consultant_summary: `${product.name} 更像是一件把 ${product.category} 融进生活方式里的单品，重点不是参数堆得多，而是它进入日常之后会不会让使用感受更顺。`,
    matched_preferences: product.scenarios.slice(0, 3),
    why_this: [
      product.benefit,
      product.feature,
      product.pairing_note,
    ],
    why_not_others: '我先给一件最贴近当前语境的核心单品，而不是把多个方向混在一起，方便你判断它是否真正适合这个空间。',
  }
}
