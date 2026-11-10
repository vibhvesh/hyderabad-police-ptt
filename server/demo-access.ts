import { createHash, timingSafeEqual, randomBytes } from 'node:crypto'

const WINDOW_MS = 10 * 60 * 1000
const MAX_FAILURES = 8
const SESSION_MS = 12 * 60 * 60 * 1000

export function codesMatch(given: string, expected: string | null): 'ok' | 'unconfigured' | 'unauthorized' {
  if (!expected) return 'unconfigured'
  const left = createHash('sha256').update(given).digest()
  const right = createHash('sha256').update(expected).digest()
  return timingSafeEqual(left, right) ? 'ok' : 'unauthorized'
}

export class DemoGate {
  private failures = new Map<string, { count: number; start: number }>()
  private sessions = new Map<string, number>()
  private now: () => number

  constructor(now: () => number = Date.now) {
    this.now = now
  }

  blocked(ip: string): boolean {
    const entry = this.failures.get(ip)
    if (!entry) return false
    if (this.now() - entry.start > WINDOW_MS) {
      this.failures.delete(ip)
      return false
    }
    return entry.count >= MAX_FAILURES
  }

  fail(ip: string) {
    const entry = this.failures.get(ip)
    if (!entry || this.now() - entry.start > WINDOW_MS) {
      this.failures.set(ip, { count: 1, start: this.now() })
      return
    }
    entry.count += 1
  }

  clear(ip: string) {
    this.failures.delete(ip)
  }

  open(): string {
    const id = randomBytes(32).toString('hex')
    this.sessions.set(id, this.now() + SESSION_MS)
    return id
  }

  valid(id: string | null): boolean {
    if (!id) return false
    const expires = this.sessions.get(id)
    if (!expires) return false
    if (this.now() > expires) {
      this.sessions.delete(id)
      return false
    }
    return true
  }
}

export function readCookie(header: string | undefined, name: string): string | null {
  if (!header) return null
  for (const part of header.split(';')) {
    const [rawKey, ...rest] = part.trim().split('=')
    if (rawKey === name) return rest.join('=') || null
  }
  return null
}

export function demoCookie(id: string, sameSite: 'None' | 'Lax' = 'None'): string {
  return `sanket_demo=${id}; HttpOnly; Secure; SameSite=${sameSite}; Path=/; Max-Age=${SESSION_MS / 1000}`
}

export function clearDemoCookie(): string {
  return 'sanket_demo=; HttpOnly; Secure; SameSite=None; Path=/; Max-Age=0'
}
