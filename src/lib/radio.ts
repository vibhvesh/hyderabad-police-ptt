import {
  CLAIM_GRACE_MS,
  FLOOR_TIMEOUT_MS,
  PRESENCE_BEAT_MS,
  PRESENCE_EXPIRE_MS,
} from './constants.ts'
import { reduceFloor, type Floor, type FloorMsg } from './floor.ts'
import { cleanLoc, type GeoFix } from './format.ts'
import { decodeAudio, decodeNotice, encodeAudio, type ChannelNotice } from './packets.ts'
import type { NetSnapshot, Wire } from './transport.ts'

export type Station = { id: string; name: string; seen: number }
export type RadioView = { users: Station[]; floor: Floor | null; me: string; online: boolean }
export type Speaker = { id: string; name: string; loc: GeoFix | null }

type Handlers = {
  state: (view: RadioView) => void
  audio: (pcm: Int16Array, from: Speaker) => void
  boundary: () => void
  net: (net: NetSnapshot) => void
  lost: () => void
  notice: (notice: ChannelNotice) => void
}

function bytes(payload: Uint8Array): Uint8Array {
  return payload
}

export class Radio {
  readonly id: string
  name = ''
  loc: GeoFix | null = null
  online = false
  private floor: Floor | null = null
  private talking = false
  private users = new Map<string, Station>()
  private timer: number | null = null
  private lastBeat = 0
  private claimTimer: number | null = null
  private recentAudio: string[] = []
  private stopped = false

  private wire: Wire
  private root: string
  private handlers: Handlers

  constructor(wire: Wire, root: string, handlers: Handlers, id?: string) {
    this.wire = wire
    this.root = root
    this.handlers = handlers
    this.id = id ?? randomId()
    this.wire.onState((state) => {
      const was = this.online
      this.online = state.state === 'online'
      this.handlers.net(state)
      if (was && !this.online && this.talking) {
        this.talking = false
        this.handlers.lost()
      }
      this.emit()
    })
    this.wire.onMessage((topic, payload) => this.onMessage(topic, payload))
  }

  start(name: string) {
    this.name = name.slice(0, 40)
    this.stopped = false
    this.wire.subscribe([`${this.root}presence/+`, `${this.root}floor`, `${this.root}audio`, `${this.root}notice`])
    this.wire.start()
    this.timer = setInterval(() => this.tick(), 1000) as unknown as number
  }

  rename(name: string) {
    this.name = name.slice(0, 40)
    this.beat()
  }

  setLoc(loc: GeoFix | null) {
    this.loc = loc
  }

  claim(done: (ok: boolean) => void) {
    if (!this.online || !this.name) {
      done(false)
      return
    }
    if (this.floor && this.floor.id !== this.id) {
      done(false)
      return
    }
    this.talking = true
    const ts = Date.now()
    this.setFloor({ id: this.id, name: this.name, ts, seen: ts, got: ts, loc: this.loc })
    this.publishFloor('claim', ts)
    if (this.claimTimer != null) clearTimeout(this.claimTimer)
    this.claimTimer = setTimeout(() => {
      const ok = this.talking && this.floor?.id === this.id
      if (!ok) this.talking = false
      done(ok)
    }, CLAIM_GRACE_MS) as unknown as number
  }

  release() {
    if (this.claimTimer != null) clearTimeout(this.claimTimer)
    this.talking = false
    if (this.floor?.id !== this.id) return
    this.setFloor(null)
    if (this.online) this.wire.publish(this.topic('floor'), JSON.stringify({ t: 'release', id: this.id, name: this.name, ts: Date.now() }))
  }

  sendAudio(pcm: Int16Array): boolean {
    if (!this.talking || this.floor?.id !== this.id) return false
    const frame = encodeAudio(this.id, pcm)
    if (!frame) return false
    return this.wire.publish(this.topic('audio'), frame)
  }

  stop() {
    if (this.stopped) return
    this.stopped = true
    this.release()
    if (this.online) this.wire.publish(this.topic(`presence/${this.id}`), '', true)
    if (this.timer) clearInterval(this.timer)
    if (this.claimTimer) clearTimeout(this.claimTimer)
    this.wire.stop()
    this.online = false
  }

  private topic(suffix: string) {
    return this.root + suffix
  }

  private beat() {
    if (!this.name || !this.online) return
    this.lastBeat = Date.now()
    const body: { id: string; name: string; ts: number; loc?: GeoFix } = { id: this.id, name: this.name, ts: this.lastBeat }
    if (this.loc) body.loc = this.loc
    this.wire.publish(this.topic(`presence/${this.id}`), JSON.stringify(body), true)
  }

  private publishFloor(kind: 'claim' | 'hb', ts: number) {
    if (!this.online) return
    const body: FloorMsg = { t: kind, id: this.id, name: this.name, ts, loc: this.loc }
    this.wire.publish(this.topic('floor'), JSON.stringify(body))
  }

  private tick() {
    const now = Date.now()
    if (this.name && (!this.lastBeat || now - this.lastBeat >= PRESENCE_BEAT_MS)) this.beat()
    let changed = false
    for (const [id, user] of this.users) {
      if (now - user.seen <= PRESENCE_EXPIRE_MS) continue
      this.users.delete(id)
      changed = true
      if (this.floor?.id === id) this.setFloor(null)
    }
    if (this.floor && now - this.floor.seen > FLOOR_TIMEOUT_MS) this.setFloor(null)
    if (this.talking && this.floor?.id === this.id) this.publishFloor('hb', this.floor.ts)
    if (this.talking && this.floor?.id !== this.id) {
      this.talking = false
      this.handlers.lost()
    }
    if (changed) this.emit()
  }

  private setFloor(next: Floor | null) {
    const prev = this.floor
    this.floor = next
    if (prev && (!next || next.id !== prev.id)) this.handlers.boundary()
    this.emit()
  }

  private emit() {
    const users = [...this.users.values()].sort((a, b) => a.name.localeCompare(b.name))
    this.handlers.state({ users, floor: this.floor, me: this.id, online: this.online })
  }

  private onMessage(topic: string, payload: Uint8Array) {
    if (!topic.startsWith(this.root)) return
    const rest = topic.slice(this.root.length)
    const now = Date.now()
    const raw = bytes(payload)
    if (rest.startsWith('presence/')) {
      const id = rest.slice('presence/'.length)
      if (raw.length === 0) {
        this.users.delete(id)
        if (this.floor?.id === id) this.setFloor(null)
        else this.emit()
        return
      }
      try {
        const msg = JSON.parse(new TextDecoder().decode(raw)) as { name?: unknown; ts?: unknown }
        const ts = Number(msg.ts)
        if (!Number.isFinite(ts) || now - ts >= PRESENCE_EXPIRE_MS * 4) return
        this.users.set(id, { id, name: String(msg.name ?? 'Unit').slice(0, 40), seen: now })
        this.emit()
      } catch {
        /* ignore malformed presence */
      }
      return
    }
    if (rest === 'floor') {
      try {
        const msg = JSON.parse(new TextDecoder().decode(raw)) as FloorMsg
        if (msg.t !== 'claim' && msg.t !== 'hb' && msg.t !== 'release') return
        if (typeof msg.id !== 'string' || typeof msg.name !== 'string') return
        const nextMsg: FloorMsg = {
          t: msg.t,
          id: msg.id,
          name: String(msg.name).slice(0, 40),
          ts: Number(msg.ts) || now,
        }
        if ('loc' in msg) nextMsg.loc = cleanLoc(msg.loc)
        const next = reduceFloor(this.floor, nextMsg, now)
        this.setFloor(next)
      } catch {
        /* ignore malformed floor */
      }
      return
    }
    if (rest === 'notice') {
      const notice = decodeNotice(raw)
      if (notice) this.handlers.notice(notice)
      return
    }
    if (rest !== 'audio') return
    const decoded = decodeAudio(raw)
    if (!decoded) return
    const floor = this.floor
    if (!floor || decoded.id === this.id || floor.id !== decoded.id) return
    const hash = `${decoded.id}:${raw.length}:${raw[1]}:${raw[raw.length - 1]}`
    if (this.recentAudio.includes(hash)) return
    this.recentAudio = [...this.recentAudio, hash].slice(-32)
    floor.seen = now
    this.handlers.audio(decoded.pcm, { id: decoded.id, name: floor.name, loc: floor.loc })
  }
}

function randomId(): string {
  const bytes = new Uint8Array(4)
  crypto.getRandomValues(bytes)
  return [...bytes].map((item) => item.toString(16).padStart(2, '0')).join('')
}
