#!/usr/bin/env node
/**
 * 品牌标兜底的**域名候选**回归测试（纯离线，不联网）。
 *
 * 为什么单独测这个：2026-09-29 出现过一次「看起来成功、其实错得很离谱」的 bug ——
 * 跑批汇总显示「有图 7/8，品牌标兜底 4」，但其中两张的图床是
 * `smzdm.com`（什么值得买）和 `www.jd.com`（京东）：
 *
 *   【游戏方向盘】莱仕达 PXN    图=smzdm.com(标)
 *   【显示器支架】北弧 E350     图=www.jd.com(标)
 *   【有线入耳耳机】兴戈 EA500LM 图=zhuanlan.zhihu.com(标)   ← 更早一轮
 *
 * 根因是 `candidateDomains` 把 `source_url` 的主机**无条件排在第 1 位**，
 * 而 logo 探测是在来源页核验**之前**并行发起的，那一刻 `source_url` 还是模型的原始地址，
 * 经常是第三方页。于是第三方站的 favicon 被当成「品牌官方标」贴上了商品卡。
 *
 * 这个 bug 在跑批输出里**只体现为「图床是第三方域」**，非常容易读成噪声 ——
 * 所以规则必须用测试钉死。
 *
 * 用法：
 *   node --experimental-strip-types scripts/test-brand-logo.mjs
 *
 * ── 为什么要注册一个解析钩子 ─────────────────────────────────────
 * 源码里的相对导入是**无扩展名**的（`import { ... } from './imageTrust'`），
 * 这在 Nuxt/Vite 里没问题，但裸 Node 的 ESM 解析器会直接报
 * `ERR_MODULE_NOT_FOUND: .../imageTrust`。`brandLogo.ts` 恰好有这样一个内部导入，
 * 所以不能像 `test-image-model-tokens.mjs` 那样直接 `import('.../brandLogo.ts')`。
 * 用一个 data: URL 的 resolve 钩子补上 `.ts` 后缀 —— 保持单文件，不额外加脚本。
 */

import { register } from 'node:module'

register(
  'data:text/javascript,' +
    encodeURIComponent(`
export async function resolve(specifier, context, next) {
  try {
    return await next(specifier, context)
  } catch (error) {
    // 只补「相对路径 + 无扩展名」这一种情况，别去猜别的。
    if (specifier.startsWith('.') && !/\\.[cm]?[jt]s$/.test(specifier)) {
      return next(specifier + '.ts', context)
    }
    throw error
  }
}
`),
)

const { candidateDomains } = await import('../frontend/server/utils/brandLogo.ts')

/** 第三方站点的 favicon 绝不允许冒充品牌官方标（这是本测试存在的理由）。 */
const FORBIDDEN_HOSTS = [
  'smzdm.com',
  'post.smzdm.com',
  'qnam.smzdm.com',
  'jd.com',
  'www.jd.com',
  'zhuanlan.zhihu.com',
  'zhimg.com',
  'pic1.zhimg.com',
  '360buyimg.com',
  'img12.360buyimg.com',
  'alicdn.com',
  'g-search1.alicdn.com',
  'sinaimg.cn',
  'baidu.com',
  'coupangcdn.com',
  'momoshop.com.tw',
]

const CASES = [
  {
    name: '第三方来源页不许进候选（PXN ← smzdm）',
    options: { sourceUrl: 'https://post.smzdm.com/p/a50pnn93/', brand: '莱仕达 PXN' },
    mustInclude: [],
  },
  {
    name: '第三方来源页不许进候选（北弧 ← 京东）',
    options: { sourceUrl: 'https://www.jd.com/jiage/670d5106a925f438a23.html', brand: 'Brateck 北弧' },
    mustInclude: [],
  },
  {
    name: '第三方来源页不许进候选（兴戈 ← 知乎）',
    options: { sourceUrl: 'https://zhuanlan.zhihu.com/p/689490993', brand: 'SIMGOT 兴戈' },
    mustInclude: [],
  },
  {
    name: '官方来源页要保留，且补出主站与 www 变体（德生）',
    options: { sourceUrl: 'http://m.tecsun.com.cn/pd.jsp?mid=447&pid=73', brand: '德生 Tecsun' },
    mustInclude: ['m.tecsun.com.cn', 'tecsun.com.cn', 'www.tecsun.com.cn'],
  },
  {
    name: '官方来源页要保留（水月雨 CDN 子域 → 主站）',
    options: { sourceUrl: 'https://globalcdn.moondroplab.com/x.png', brand: '水月雨 MOONDROP' },
    mustInclude: ['globalcdn.moondroplab.com', 'moondroplab.com'],
  },
  {
    name: '品牌词元要能推域（汉匠 KINGrinder）',
    options: { brand: '汉匠 KINGrinder' },
    mustInclude: ['kingrinder.com'],
  },
  {
    name: 'explicit officialDomain 排在候选最前（尼康）',
    options: { officialDomain: 'www.nikon.com.cn', brand: 'Nikon 尼康' },
    mustInclude: ['www.nikon.com.cn', 'nikon.com.cn'],
    mustBeFirst: 'www.nikon.com.cn',
  },
  {
    name: 'officialCandidatePages 的主机要进候选（PXN 的 e-pxn）',
    options: {
      sourceUrl: 'https://post.smzdm.com/p/a50pnn93/',
      brand: '莱仕达 PXN',
      extraHosts: ['www.e-pxn.com.cn'],
    },
    mustInclude: ['www.e-pxn.com.cn'],
  },
  {
    name: '品牌缺失时不能崩，也不能凭空造域',
    options: { sourceUrl: 'https://example.com/x' },
    mustInclude: [],
    mustBeEmpty: true,
  },
]

let failed = 0
let checked = 0

for (const testCase of CASES) {
  const domains = candidateDomains(testCase.options)

  const offenders = domains.filter((domain) =>
    FORBIDDEN_HOSTS.some((bad) => domain === bad || domain.endsWith(`.${bad}`)),
  )

  const missing = (testCase.mustInclude ?? []).filter((host) => !domains.includes(host))
  const wrongFirst =
    testCase.mustBeFirst && domains[0] !== testCase.mustBeFirst ? domains[0] ?? '(空)' : ''
  const notEmpty = testCase.mustBeEmpty && domains.length > 0 ? domains : null

  checked += 1
  const problems = [
    offenders.length ? `混进第三方域 ${JSON.stringify(offenders)}` : '',
    missing.length ? `缺 ${JSON.stringify(missing)}` : '',
    wrongFirst ? `首位应为 ${testCase.mustBeFirst}，实际 ${wrongFirst}` : '',
    notEmpty ? `期望为空，实际 ${JSON.stringify(notEmpty)}` : '',
  ].filter(Boolean)

  if (problems.length) {
    failed += 1
    console.log(`❌ ${testCase.name}`)
    for (const problem of problems) {
      console.log(`     ${problem}`)
    }
  } else {
    console.log(`✅ ${testCase.name}  →  ${JSON.stringify(domains)}`)
  }
}

console.log('')
if (failed) {
  console.log(`❌ 品牌标域名候选 ${checked - failed}/${checked} 通过，${failed} 例失败`)
  process.exit(1)
}

console.log(`✅ 品牌标域名候选 全部通过（${checked} 例；其中 ${FORBIDDEN_HOSTS.length} 类第三方域已确认被拦）`)
