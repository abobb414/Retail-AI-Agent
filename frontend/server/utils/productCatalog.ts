import facetsJson from '../data/productFacets.json'
import realProductsJson from '../data/realProducts.json'
import {
  DEPARTMENT_LABELS,
  detectRequestProfile,
  normalizeText,
  type Department,
  type Gender,
} from '../../../catalogTaxonomy'

interface ProductFacet {
  id: string
  department: Department
  product_type: string
  subcategory: string
  gender: Gender | null
  size_options: string[]
  attributes: Record<string, unknown>
  price_cny: number | null
  price_display: string
}

const facetProducts = (facetsJson as { products: ProductFacet[] }).products
const facetsById = new Map(facetProducts.map((product) => [product.id, product]))
const productsById = new Map(
  (realProductsJson as { products: Array<Record<string, unknown>> }).products.map((product) => [String(product.id), product]),
)

export function pickProductRecommendation(text: string) {
  const profile = detectRequestProfile(text)
  if (!profile.department) return null

  const candidates = facetProducts
    .filter((product) => matchesRequest(product, profile))
    .sort((left, right) => scoreProduct(right, text, profile) - scoreProduct(left, text, profile))

  const facet = candidates[0]
  if (!facet) return null

  const raw = productsById.get(facet.id) ?? { id: facet.id, name: facet.id }
  return {
    ...raw,
    department: facet.department,
    department_label: DEPARTMENT_LABELS[facet.department],
    product_type: facet.product_type,
    subcategory: facet.subcategory,
    gender: facet.gender,
    size_options: facet.size_options,
    attributes: facet.attributes,
    price_cny: facet.price_cny,
    price_display: facet.price_display,
    category: facet.subcategory || DEPARTMENT_LABELS[facet.department],
  }
}

function matchesRequest(product: ProductFacet, profile: ReturnType<typeof detectRequestProfile>) {
  if (product.department !== profile.department) return false
  if (profile.productType && product.product_type !== profile.productType) return false
  if (profile.brand) {
    const raw = productsById.get(product.id)
    if (normalizeText(String(raw?.brand ?? '')) !== normalizeText(profile.brand)) return false
  }
  if (profile.budget !== null && (product.price_cny === null || product.price_cny > profile.budget)) return false
  if (profile.gender && product.department === 'apparel' && product.gender !== profile.gender && product.gender !== 'unisex') return false
  if (profile.size && product.department === 'apparel' && !product.size_options.some((size) => normalizeText(size) === normalizeText(profile.size ?? ''))) return false
  if (profile.screenSizeInch !== null && product.attributes.screen_size_inch !== profile.screenSizeInch) return false
  if (profile.storageGb !== null && (typeof product.attributes.storage_gb !== 'number' || product.attributes.storage_gb < profile.storageGb)) return false
  return true
}

function scoreProduct(product: ProductFacet, text: string, profile: ReturnType<typeof detectRequestProfile>) {
  const raw = productsById.get(product.id)
  const normalizedText = normalizeText(text)
  const normalizedName = normalizeText(String(raw?.name ?? ''))
  let score = normalizedText.includes(normalizedName) ? 100 : 0
  if (profile.productType === product.product_type) score += 40
  if (profile.brand && normalizeText(String(raw?.brand ?? '')) === normalizeText(profile.brand)) score += 30
  if (profile.budget !== null && product.price_cny !== null) score += Math.max(0, 20 - Math.abs(profile.budget - product.price_cny) / 100)
  return score
}

export function getProductFacet(id: string) {
  return facetsById.get(id) ?? null
}
