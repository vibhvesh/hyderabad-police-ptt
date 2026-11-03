import type { GeoFix } from './types.ts'

export type { GeoFix }

export function cleanLoc(value: unknown): GeoFix | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Record<string, unknown>
  const lat = Number(raw.lat)
  const lon = Number(raw.lon)
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null
  const acc = Number(raw.acc)
  return {
    lat: Math.round(lat * 1e5) / 1e5,
    lon: Math.round(lon * 1e5) / 1e5,
    acc: Number.isFinite(acc) ? Math.max(0, Math.round(acc)) : null,
  }
}

export function formatLoc(loc: GeoFix | null): string {
  if (!loc) return 'Location unavailable'
  const acc = loc.acc == null ? '' : ` · ±${loc.acc} m`
  return `${loc.lat.toFixed(5)}, ${loc.lon.toFixed(5)}${acc}`
}

/** Whisper loops on tones and noise. Collapse that into a plain result. */
export function readableTranscript(text: string): string {
  const trimmed = text.trim()
  if (!trimmed || !/\p{L}/u.test(trimmed)) return 'No speech detected'
  const words = trimmed.split(/\s+/).filter(Boolean)
  if (words.length < 6) return trimmed
  const counts = new Map<string, number>()
  for (const word of words) counts.set(word, (counts.get(word) ?? 0) + 1)
  let top = 0
  for (const count of counts.values()) top = Math.max(top, count)
  if (top / words.length > 0.55) return 'No speech detected'
  return trimmed
}

export function formatDur(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0.0s'
  if (seconds < 60) return `${seconds.toFixed(1)}s`
  const minutes = Math.floor(seconds / 60)
  const rest = Math.round(seconds % 60)
  return `${minutes}m ${rest.toString().padStart(2, '0')}s`
}

export function formatClock(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

export function uid(): string {
  const bytes = new Uint8Array(4)
  crypto.getRandomValues(bytes)
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
}

export function brokerLabel(url: string): string {
  try {
    return new URL(url.replace(/^wss:/, 'https:')).host
  } catch {
    return 'relay'
  }
}
