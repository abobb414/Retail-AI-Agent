export function normalizeText(text: string) {
  return text
    .toLowerCase()
    .replace(/[^\p{Script=Han}a-z0-9]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function tokenize(text: string) {
  return normalizeText(text)
    .split(' ')
    .filter((token) => token.length >= 2)
}

export function scoreKeyword(keyword: string, text: string, tokens: string[]) {
  const normalizedKeyword = normalizeText(keyword)
  if (!normalizedKeyword) {
    return 0
  }

  if (/^\d+$/.test(normalizedKeyword)) {
    return tokens.includes(normalizedKeyword) ? Math.max(2, normalizedKeyword.length) : 0
  }

  if (text.includes(normalizedKeyword)) {
    return Math.max(6, normalizedKeyword.length * 2)
  }

  const keywordTokens = tokenize(normalizedKeyword)
  if (!keywordTokens.length) {
    return 0
  }

  const reverseTokenScore = tokens.reduce((score, token) => (
    normalizedKeyword.includes(token) ? score + Math.max(2, token.length) : score
  ), 0)

  return reverseTokenScore + keywordTokens.reduce((score, token) => (
    tokens.includes(token) ? score + Math.max(2, token.length) : score
  ), 0)
}

export function stableHash(value: string) {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }

  return hash >>> 0
}

export function getBrandAliases(brand: string) {
  const normalizedBrand = normalizeText(brand)
  const aliases: Record<string, string[]> = {
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

  return aliases[normalizedBrand] ?? []
}
