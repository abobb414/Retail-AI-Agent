export interface CatalogProduct {
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

export interface ProductIntent {
  id: string
  userPattern: RegExp
  productPattern: RegExp
  promptTerms: string[]
  excludeProductPattern?: RegExp
  requireProductPattern?: RegExp
}

export type ProductFamily = 'apparel' | 'furniture' | 'appliance' | 'lighting' | 'tableware'

export interface SlotRequirement {
  id: string
  label: string
  isSatisfied: (text: string) => boolean
}

export interface ScoredProduct {
  product: CatalogProduct
  score: number
  exactScore: number
  spreadScore: number
}
