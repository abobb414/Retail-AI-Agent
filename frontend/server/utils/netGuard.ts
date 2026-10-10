/**
 * 出站请求的 SSRF 守卫：拒绝指向本机、内网、链路本地的目标。
 *
 * 只看主机名 / 字面 IP，不做 DNS 解析。调用方需要逐跳校验重定向（见 image.get.ts、sourcePage.ts），
 * 否则公网地址 302 到内网即可绕过。
 */
export function isBlockedHost(hostname: string) {
  // URL.hostname 对 IPv6 保留方括号；末尾的点（localhost.）也一并去掉。
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '')

  if (host === 'localhost' || host.endsWith('.localhost')) {
    return true
  }

  // IPv4 映射的 IPv6（WHATWG URL 会把 ::ffff:127.0.0.1 规范成 ::ffff:7f00:1）。
  const mapped = host.match(/^::ffff:(?:(\d{1,3}(?:\.\d{1,3}){3})|([0-9a-f]{1,4}):([0-9a-f]{1,4}))$/)
  if (mapped) {
    if (mapped[1]) {
      return isBlockedHost(mapped[1])
    }
    const high = Number.parseInt(mapped[2], 16)
    const low = Number.parseInt(mapped[3], 16)
    return isBlockedHost([high >> 8, high & 0xff, low >> 8, low & 0xff].join('.'))
  }

  if (host.includes(':')) {
    // IPv6：未指定 / 回环 / 唯一本地 fc00::/7 / 链路本地 fe80::/10
    return host === '::' || host === '::1' || /^f[cd]/.test(host) || /^fe[89ab]/.test(host)
  }

  const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/)
  if (!ipv4) {
    return false
  }

  const a = Number(ipv4[1])
  const b = Number(ipv4[2])

  return (
    a === 0 || // 0.0.0.0/8
    a === 10 || // 10.0.0.0/8
    a === 127 || // 回环
    (a === 169 && b === 254) || // 链路本地，含云厂商元数据 169.254.169.254
    (a === 172 && b >= 16 && b <= 31) || // 172.16.0.0/12
    (a === 192 && b === 168) || // 192.168.0.0/16
    (a === 100 && b >= 64 && b <= 127) // 运营商级 NAT 100.64.0.0/10
  )
}
