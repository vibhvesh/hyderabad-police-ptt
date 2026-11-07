import { randomBytes } from 'node:crypto'
import { decodeWav } from './wav.ts'

export const SCRIBE_COOKIE = 'sanket_scribe'
export const SCRIBE_TTL_MS = 2 * 60 * 60 * 1000
const MAX_SESSIONS = 200
export const MAX_CLIP_MS = 60_000

type Entry = { key: string; expires: number }

/** In-memory keys for one browser session. Nothing here is written to disk. */
export class ScribeSessions {
  private items = new Map<string, Entry>()
  private now: () => number

  constructor(now: () => number = Date.now) {
    this.now = now
  }

  save(existingId: string | null, key: string): string {
    this.prune()
    const current = existingId ? this.items.get(existingId) : undefined
    if (existingId && current && current.expires >= this.now()) {
      current.key = key
      current.expires = this.now() + SCRIBE_TTL_MS
      return existingId
    }
    while (this.items.size >= MAX_SESSIONS) {
      const oldest = this.items.keys().next().value
      if (!oldest) break
      this.items.delete(oldest)
    }
    const id = randomBytes(32).toString('hex')
    this.items.set(id, { key, expires: this.now() + SCRIBE_TTL_MS })
    return id
  }

  read(id: string | null): string | null {
    if (!id) return null
    const entry = this.items.get(id)
    if (!entry) return null
    if (entry.expires < this.now()) {
      this.items.delete(id)
      return null
    }
    return entry.key
  }

  clear(id: string | null) {
    if (id) this.items.delete(id)
  }

  size(): number {
    this.prune()
    return this.items.size
  }

  private prune() {
    const at = this.now()
    for (const [id, entry] of this.items) {
      if (entry.expires < at) this.items.delete(id)
    }
  }
}

export function scribeCookie(id: string): string {
  return `${SCRIBE_COOKIE}=${id}; HttpOnly; Secure; SameSite=None; Path=/; Max-Age=${SCRIBE_TTL_MS / 1000}`
}

export function clearScribeCookie(): string {
  return `${SCRIBE_COOKIE}=; HttpOnly; Secure; SameSite=None; Path=/; Max-Age=0`
}

export function clipDurationMs(wav: Buffer): number | null {
  const decoded = decodeWav(wav)
  if (!decoded || decoded.rate <= 0) return null
  return Math.round((decoded.samples.length / decoded.rate) * 1000)
}

export function publicScribeError(error: unknown, secret: string): { auth: boolean; message: string } {
  const status = error && typeof error === 'object' && 'statusCode' in error ? Number((error as { statusCode?: number }).statusCode) : NaN
  const auth = status === 401 || status === 403
  if (auth) return { auth: true, message: 'That key was not accepted.' }
  const raw = error instanceof Error ? error.message : 'Scribe failed'
  const cleaned = secret ? raw.split(secret).join('').trim() : raw
  return { auth: false, message: (cleaned || 'Scribe failed').slice(0, 180) }
}
