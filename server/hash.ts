import { createHash, createHmac, timingSafeEqual } from 'node:crypto'

export function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex')
}

export function hmacSha256(secret: string, body: Buffer): string {
  return `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`
}

export function sameSecret(expected: string, given: string): boolean {
  const a = createHash('sha256').update(expected).digest()
  const b = createHash('sha256').update(given).digest()
  return timingSafeEqual(a, b)
}

export function sameHmac(expected: string, given: string): boolean {
  const a = Buffer.from(expected)
  const b = Buffer.from(given)
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}
