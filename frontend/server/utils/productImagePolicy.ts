import type { CatalogProduct } from './catalogTypes'
import { normalizeText, stableHash } from './catalogText'

export function isPoorDisplayImage(product: CatalogProduct) {
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

export function getDisplayImage(product: CatalogProduct) {
  if (!isPoorDisplayImage(product)) {
    return product.image
  }

  if (normalizeText(product.brand).includes('uniqlo')) {
    return getUniqloFallbackImage(product)
  }

  return ''
}
