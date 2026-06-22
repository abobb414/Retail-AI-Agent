const _normalizeCache = new Map<string, string>()
export function normalizeText(text: string) {
  let cached = _normalizeCache.get(text)
  if (cached !== undefined) return cached
  if (_normalizeCache.size > 20000) _normalizeCache.clear()
  cached = text
    .toLowerCase()
    .replace(/[^\p{Script=Han}a-z0-9]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  _normalizeCache.set(text, cached)
  return cached
}

const _tokenizeCache = new Map<string, string[]>()
export function tokenize(text: string) {
  const key = normalizeText(text)
  let cached = _tokenizeCache.get(key)
  if (cached !== undefined) return cached
  if (_tokenizeCache.size > 10000) _tokenizeCache.clear()
  cached = key.split(' ').filter((token) => token.length >= 2)
  _tokenizeCache.set(key, cached)
  return cached
}

export function scoreKeyword(keyword: string, text: string, tokens: string[]) {
  const normalizedKeyword = normalizeText(keyword)
  if (!normalizedKeyword) {
    return 0
  }

  if (text.includes(normalizedKeyword)) {
    return Math.max(6, normalizedKeyword.length * 2)
  }

  const keywordTokens = tokenize(normalizedKeyword)
  if (!keywordTokens.length) {
    return 0
  }

  let reverseScore = 0
  for (let i = 0; i < tokens.length; i++) {
    if (normalizedKeyword.includes(tokens[i])) {
      reverseScore += Math.max(2, tokens[i].length)
    }
  }

  let forwardScore = 0
  for (let i = 0; i < keywordTokens.length; i++) {
    if (tokens.includes(keywordTokens[i])) {
      forwardScore += Math.max(2, keywordTokens[i].length)
    }
  }

  return reverseScore + forwardScore
}

export function stableHash(value: string) {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }

  return hash >>> 0
}

const _brandAliases: Record<string, string[]> = {
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

export function getBrandAliases(brand: string) {
  return _brandAliases[normalizeText(brand)] ?? []
}
