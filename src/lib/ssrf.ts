function ipv4(ip: string): number | null {
  const parts = ip.split('.')
  if (parts.length !== 4) return null
  let value = 0
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null
    const n = Number(part)
    if (n > 255) return null
    value = (value << 8) | n
  }
  return value >>> 0
}

function inCidr(ip: number, base: number, bits: number): boolean {
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0
  return (ip & mask) === (base & mask)
}

export function isBlockedIp(raw: string): boolean {
  const ip = raw.toLowerCase().replace(/^\[|\]$/g, '')
  const mapped = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)
  const v4 = ipv4(mapped?.[1] ?? ip)
  if (v4 != null) {
    const blocked: Array<[number, number]> = [
      [ipv4('0.0.0.0') ?? 0, 8],
      [ipv4('10.0.0.0') ?? 0, 8],
      [ipv4('127.0.0.0') ?? 0, 8],
      [ipv4('169.254.0.0') ?? 0, 16],
      [ipv4('172.16.0.0') ?? 0, 12],
      [ipv4('192.168.0.0') ?? 0, 16],
      [ipv4('100.64.0.0') ?? 0, 10],
      [ipv4('192.0.2.0') ?? 0, 24],
      [ipv4('224.0.0.0') ?? 0, 4],
      [ipv4('255.255.255.255') ?? 0, 32],
    ]
    return blocked.some(([base, bits]) => inCidr(v4, base, bits))
  }
  if (!ip.includes(':')) return false
  if (ip === '::' || ip === '::1') return true
  const head = ip.split(':')[0] ?? ''
  const first = Number.parseInt(head || '0', 16)
  if (Number.isNaN(first)) return true
  if ((first & 0xfe00) === 0xfc00) return true
  if ((first & 0xffc0) === 0xfe80) return true
  if ((first & 0xff00) === 0xff00) return true
  return false
}

const BLOCKED_HOST = /(^|\.)(localhost|localdomain|internal|intranet|local)$/i

export function assessUrl(input: string, resolved: readonly string[]): { ok: true; href: string } | { ok: false; reason: string } {
  let url: URL
  try {
    url = new URL(input)
  } catch {
    return { ok: false, reason: 'The source URL is not valid.' }
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return { ok: false, reason: 'Only http and https sources are allowed.' }
  if (url.username || url.password) return { ok: false, reason: 'Source URLs cannot include a username or password.' }
  const host = url.hostname.replace(/^\[|\]$/g, '')
  if (!host || BLOCKED_HOST.test(host) || host === 'metadata.google.internal') {
    return { ok: false, reason: 'That host is not an approved public source.' }
  }
  if (/^\d+$/.test(host)) return { ok: false, reason: 'Numeric source hosts are blocked.' }
  if (isBlockedIp(host)) return { ok: false, reason: 'That address is not a public source.' }
  if (resolved.length === 0) return { ok: false, reason: 'The source host did not resolve.' }
  for (const ip of resolved) {
    if (isBlockedIp(ip)) return { ok: false, reason: 'The source host resolves to a private or local address.' }
  }
  return { ok: true, href: url.toString() }
}
