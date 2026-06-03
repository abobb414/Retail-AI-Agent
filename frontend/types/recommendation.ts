export interface Recommendation {
  name: string
  brand: string
  category: string
  image: string
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
