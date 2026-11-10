import { CLIP_GAP_MS, SAMPLE_RATE } from '../src/lib/constants.ts'
import { buildWav } from '../src/lib/audio.ts'
import { formatLoc } from '../src/lib/format.ts'
import { lineForTopic, type LineRecord } from '../src/lib/lines.ts'
import { decodeAudio } from '../src/lib/packets.ts'
import type { LinesStore } from './lines-store.ts'

const PRESENCE_MS = 15_000

export type OpenSpeaker = {
  line: LineRecord
  speakerId: string
  speakerName: string
  chunks: Int16Array[]
  samples: number
  startedAt: number
  lastAt: number
}

export type ClosedClip = {
  line: LineRecord
  speakerId: string
  speakerName: string
  startedAt: number
  wav: Buffer
  durationMs: number
}

export type LiveUser = { lineId: string; id: string; name: string; lastSeen: number; location: string | null }
export type LiveFloor = { lineId: string; id: string; name: string; since: number }
export type LiveActivity = { at: string; lineId: string; text: string }

export class RadioMonitor {
  private open = new Map<string, OpenSpeaker>()
  private users = new Map<string, LiveUser>()
  private floors = new Map<string, LiveFloor>()
  private feed: LiveActivity[] = []
  private lines: LinesStore
  private onClip: (clip: ClosedClip) => void

  constructor(lines: LinesStore, onClip: (clip: ClosedClip) => void) {
    this.lines = lines
    this.onClip = onClip
  }

  ingest(topic: string, payload: Uint8Array, now: number) {
    const line = lineForTopic(this.lines.list(), topic)
    if (!line) return
    const rest = topic.slice(`sanket-ptt/v1/${line.id}/`.length)
    if (rest.startsWith('presence/')) {
      this.presence(line, rest.slice('presence/'.length), payload, now)
      return
    }
    if (rest === 'floor') {
      this.floor(line, payload, now)
      return
    }
    if (rest !== 'audio' || !line.enabled) return
    const decoded = decodeAudio(payload)
    if (!decoded) return
    const key = `${line.id}:${decoded.id}`
    const current = this.open.get(key)
    if (current && now - current.lastAt > CLIP_GAP_MS) this.close(key, current)
    const next = this.open.get(key) ?? this.start(line, decoded.id, now)
    next.chunks.push(decoded.pcm)
    next.samples += decoded.pcm.length
    next.lastAt = now
    const known = this.users.get(key)
    if (known?.name) next.speakerName = known.name
    this.open.set(key, next)
  }

  sweep(now: number) {
    for (const [key, clip] of this.open) {
      if (now - clip.lastAt > CLIP_GAP_MS) this.close(key, clip)
    }
    for (const [key, user] of this.users) {
      if (now - user.lastSeen > PRESENCE_MS) this.users.delete(key)
    }
  }

  snapshot(now: number) {
    this.sweep(now)
    return {
      users: [...this.users.values()].filter((user) => now - user.lastSeen <= PRESENCE_MS),
      floors: [...this.floors.values()],
      activity: this.feed.slice(0, 40),
    }
  }

  note(lineId: string, text: string, at = new Date().toISOString()) {
    this.feed = [{ at, lineId, text }, ...this.feed].slice(0, 40)
  }

  private start(line: LineRecord, speakerId: string, now: number): OpenSpeaker {
    const known = this.users.get(`${line.id}:${speakerId}`)
    return {
      line,
      speakerId,
      speakerName: known?.name || speakerId,
      chunks: [],
      samples: 0,
      startedAt: now,
      lastAt: now,
    }
  }

  private close(key: string, clip: OpenSpeaker) {
    this.open.delete(key)
    if (clip.samples < SAMPLE_RATE * 0.25) return
    const wav = Buffer.from(buildWav(clip.chunks, SAMPLE_RATE))
    this.note(clip.line.id, `${clip.speakerName} finished a transmission`, new Date(clip.startedAt).toISOString())
    this.onClip({
      line: clip.line,
      speakerId: clip.speakerId,
      speakerName: clip.speakerName,
      startedAt: clip.startedAt,
      wav,
      durationMs: Math.round((clip.samples / SAMPLE_RATE) * 1000),
    })
  }

  private presence(line: LineRecord, id: string, payload: Uint8Array, now: number) {
    const key = `${line.id}:${id}`
    if (payload.length === 0) {
      this.users.delete(key)
      this.note(line.id, `${id} left`)
      return
    }
    try {
      const body = JSON.parse(new TextDecoder().decode(payload)) as { name?: unknown; loc?: unknown }
      const name = String(body.name ?? id).slice(0, 40)
      const location = formatLoc(clean(body.loc))
      this.users.set(key, { lineId: line.id, id, name, lastSeen: now, location: location === 'Location unavailable' ? null : location })
      this.note(line.id, `${name} is online`)
    } catch {
      /* ignore malformed presence */
    }
  }

  private floor(line: LineRecord, payload: Uint8Array, now: number) {
    try {
      const body = JSON.parse(new TextDecoder().decode(payload)) as { t?: unknown; id?: unknown; name?: unknown }
      if (body.t === 'release' || typeof body.id !== 'string') {
        this.floors.delete(line.id)
        this.note(line.id, 'The floor is clear')
        return
      }
      this.floors.set(line.id, { lineId: line.id, id: body.id, name: String(body.name ?? body.id).slice(0, 40), since: now })
      this.note(line.id, `${String(body.name ?? body.id)} has the floor`)
    } catch {
      /* ignore malformed floor */
    }
  }
}

function clean(value: unknown): { lat: number; lon: number; acc: number | null } | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as { lat?: unknown; lon?: unknown; acc?: unknown }
  const lat = Number(raw.lat)
  const lon = Number(raw.lon)
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null
  const acc = Number(raw.acc)
  return { lat, lon, acc: Number.isFinite(acc) ? acc : null }
}
