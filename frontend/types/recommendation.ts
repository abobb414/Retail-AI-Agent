export interface Recommendation {
  name: string
  brand: string
  category: string
  image: string
  /**
   * 图片类型。空串 = 普通商品图（铺满裁切）；
   * `'logo'` = 品牌官方标兜底（居中等比缩放，不能裁也不能铺满）。
   */
  image_kind?: string
  price_range: string
  budget_tier: string
  consultant_summary: string
  materials: string
  craftsmanship: string
  pairing_note: string
  style_tags: string[]
  room_tags: string[]
  signature_specs: string[]
  matched_preferences: string[]
  why_this: string[]
  ideal_for: string[]
  avoid_for: string[]
  why_not_others: string
  scenarios: string[]
  source_url?: string
}

export interface ChatMessage {
  id: number
  role: 'assistant' | 'user'
  content: string
  isStreaming?: boolean
  recommendation: Recommendation | null
}
