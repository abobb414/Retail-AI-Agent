#!/usr/bin/env node
/**
 * SSRF 守卫（`netGuard.isBlockedHost`）的回归测试 —— 纯离线、不联网、不需要密钥。
 *
 * ── 为什么必须有这个文件 ─────────────────────────────────────────
 * 2026-10-08 的安全修复把守卫从「内联在 image.get.ts / sourcePage.ts 各一份」
 * 抽成了共享模块 `frontend/server/utils/netGuard.ts`，并修掉三个洞：
 *
 *   1. IPv6 字面量带方括号（`[::1]`）导致正则永远匹配不上 —— 回环地址直接放行；
 *   2. `startsWith('fc') / startsWith('fd')` 误伤 `fdsports.com`、`fdic.gov` 这类**正常域名**；
 *   3. `fetch` 默认跟随重定向，公网地址 302 到内网即可绕过（现在改成逐跳校验）。
 *
 * 当时是用一次性脚本验的（58 例全绿），但**没落盘** —— 守卫再改一次就没有回归保护了。
 * 这个文件把那批用例固化下来，顺带补了几条映射写法的边界。
 *
 * ── 断言口径分三层 ───────────────────────────────────────────────
 *   ① 字面量：按 `URL.hostname` 的真实形态传（IPv6 保留方括号）
 *   ② 边界：紧贴私网区间**外侧**的地址必须放行 —— 172.32 / 100.128 / fe7f 之类。
 *      少了这层就会「守卫生效的代价是正常图片全挂」，这是最容易漏测的方向。
 *   ③ 规范化：经 WHATWG URL 解析后的值。`127.1`、`2130706433`、`0x7f000001`
 *      都会被解析成 `127.0.0.1`，这才是线上实际传进来的输入。
 *
 * 用法：
 *   node --experimental-strip-types scripts/test-net-guard.mjs
 */

const { isBlockedHost } = await import('../frontend/server/utils/netGuard.ts')

/** 必须拦截。 */
const BLOCKED_GROUPS = [
  ['回环 / localhost', [
    '127.0.0.1', '127.1.2.3', 'localhost', 'LOCALHOST', 'localhost.', 'sub.localhost',
  ]],
  ['IPv6 回环与未指定', [
    '[::1]', '::1', '[::]',
  ]],
  ['IPv4 映射的 IPv6', [
    '[::ffff:127.0.0.1]', '[::ffff:7f00:1]', '[::ffff:192.168.1.1]', '[::ffff:c0a8:101]',
  ]],
  ['IPv4 私网', [
    '10.0.0.1', '10.255.255.255',
    '172.16.0.1', '172.31.255.255',
    '192.168.0.1', '192.168.255.254',
  ]],
  ['链路本地 / 云元数据', [
    '169.254.0.1', '169.254.169.254',
  ]],
  ['运营商级 NAT 100.64/10', [
    '100.64.0.1', '100.127.255.255',
  ]],
  ['0.0.0.0/8', [
    '0.0.0.0', '0.1.2.3',
  ]],
  ['IPv6 ULA fc00::/7 与链路本地 fe80::/10', [
    '[fc00::1]', '[fd12:3456::1]', '[fe80::1]', '[fe80::a1b2]', '[febf::1]',
  ]],
]

/**
 * 必须放行。
 * 前两组是本次修复的直接回归项；其余全是**区间外侧的边界值** —— 拦住它们等于误伤正常站点。
 */
const ALLOWED_GROUPS = [
  ['曾被 startsWith(fc/fd) 误伤的正常域名', [
    'fdsports.com', 'fc-barcelona.com', 'fdic.gov', 'fda.gov',
  ]],
  ['正常公网域名与 IP', [
    'example.com', '8.8.8.8', '1.1.1.1',
  ]],
  ['IPv4 私网区间外侧（下沿）', [
    '172.15.255.255', '100.63.255.255', '169.253.255.255', '9.255.255.255', '192.167.255.255', '11.0.0.0',
  ]],
  ['IPv4 私网区间外侧（上沿）', [
    '172.32.0.0', '100.128.0.0', '169.255.0.0', '192.169.0.0',
  ]],
  ['映射写法指向公网', [
    '[::ffff:8.8.8.8]',
  ]],
  ['公网 IPv6', [
    '[2001:4860:4860::8888]', '[2606:4700::1111]',
  ]],
  ['fe80::/10 外侧（fe7f 不在 fe80..febf 内）', [
    '[fe7f::1]',
  ]],
]

/**
 * 经 WHATWG URL 规范化之后**真实传进守卫**的 hostname。
 * 这一层最接近线上：攻击者写 `http://2130706433/` 也能打到 127.0.0.1。
 */
const NORMALIZED_CASES = [
  ['http://127.1/', true],
  ['http://2130706433/', true],
  ['http://0x7f000001/', true],
  ['http://[::1]/', true],
  ['http://[0:0:0:0:0:0:0:1]/', true],
  ['http://[::ffff:127.0.0.1]/', true],
  ['http://localhost:8080/', true],
  ['http://169.254.169.254/latest/meta-data/', true],
  ['http://[::ffff:8.8.8.8]/', false],
  ['https://fdsports.com/x.png', false],
]

let checked = 0
let failed = 0

/** 每条用例跑一次断言；失败时立刻打印，便于定位。 */
function check(host, expectBlocked, note) {
  checked += 1
  const got = isBlockedHost(host)
  if (got === expectBlocked) {
    return true
  }
  failed += 1
  const want = expectBlocked ? '拦截' : '放行'
  const actual = got ? '拦截' : '放行'
  console.log(`      ❌ ${host}${note ? `（${note}）` : ''} → 期望${want}，实际${actual}`)
  return false
}

function runGroup(label, entries, expectBlocked) {
  const pass = entries.filter((entry) => check(entry, expectBlocked)).length
  const mark = pass === entries.length ? '✅' : '❌'
  console.log(`  ${mark} ${label.padEnd(38)} ${pass}/${entries.length}`)
}

console.log('')
console.log('SSRF 守卫 netGuard.isBlockedHost · 离线回归')
console.log('─'.repeat(62))

console.log('')
console.log('必须拦截')
for (const [label, hosts] of BLOCKED_GROUPS) {
  runGroup(label, hosts, true)
}

console.log('')
console.log('必须放行（区间外侧的边界值是重点）')
for (const [label, hosts] of ALLOWED_GROUPS) {
  runGroup(label, hosts, false)
}

console.log('')
console.log('经 URL 规范化后的真实 hostname')
{
  let pass = 0
  for (const [raw, expectBlocked] of NORMALIZED_CASES) {
    let hostname
    try {
      hostname = new URL(raw).hostname
    } catch {
      failed += 1
      checked += 1
      console.log(`      ❌ ${raw} → URL 解析失败`)
      continue
    }
    if (check(hostname, expectBlocked, raw)) {
      pass += 1
    }
  }
  const mark = pass === NORMALIZED_CASES.length ? '✅' : '❌'
  console.log(`  ${mark} ${'解析后判定'.padEnd(38)} ${pass}/${NORMALIZED_CASES.length}`)
}

console.log('')
if (failed) {
  console.log(`❌ SSRF 守卫 ${checked - failed}/${checked} 通过，${failed} 例失败`)
  process.exit(1)
}

console.log(`✅ SSRF 守卫全部通过（${checked} 例；含 ${BLOCKED_GROUPS.length + ALLOWED_GROUPS.length} 组分类用例）`)
