import mqtt, { type MqttClient } from 'mqtt'
import {
  BROKERS,
  CLAIM_GRACE_MS,
  FLOOR_TIMEOUT_MS,
  PRESENCE_BEAT_MS,
  PRESENCE_EXPIRE_MS,
  TOPIC_ROOT,
} from './constants.ts'
import { reduceFloor, type Floor, type FloorMsg } from './floor.ts'
import { brokerLabel, cleanLoc, uid, type GeoFix } from './format.ts'

export type Station = {
  id: string
  name: string
  seen: number
}

export type RadioView = {
  users: Station[]
  floor: Floor | null
  me: string
  online: boolean
}

export type Speaker = {
  id: string
  name: string
  loc: GeoFix | null
}

export type NetState = {
  state: 'connecting' | 'online' | 'offline'
  detail: string
}

type Handlers = {
  state: (view: RadioView) => void
  audio: (pcm: Int16Array, from: Speaker) => void
  boundary: () => void
  net: (net: NetState) => void
  lost: () => void
}

function asBytes(payload: Uint8Array | ArrayBuffer | string): Uint8Array {
  if (typeof payload === 'string') return new TextEncoder().encode(payload)
  if (payload instanceof Uint8Array) return new Uint8Array(payload)
  return new Uint8Array(payload)
}

export class Radio {
  readonly id = uid()
  name = ''
  loc: GeoFix | null = null
  online = false
  private floor: Floor | null = null
  private talking = false
  private users = new Map<string, Station>()
  private client: MqttClient | null = null
  private gen = 0
  private brokerIndex = 0
  private stopped = false
  private lastBeat = 0
  private timer = 0
  private retry = 0
  private readonly handlers: Handlers

  constructor(handlers: Handlers) {
    this.handlers = handlers
  }

  start(name: string) {
    this.name = name.slice(0, 40)
    this.timer = window.setInterval(() => this.tick(), 1000)
    this.connect()
  }

  rename(name: string) {
    this.name = name.slice(0, 40)
    this.beat()
  }

  setLoc(loc: GeoFix | null) {
    this.loc = loc
  }

  claim(done: (ok: boolean) => void) {
    if (!this.client?.connected || !this.name) {
      done(false)
      return
    }
    if (this.floor && this.floor.id !== this.id) {
      done(false)
      return
    }
    this.talking = true
    const ts = Date.now()
    this.setFloor({
      id: this.id,
      name: this.name,
      ts,
      seen: ts,
      got: ts,
      loc: this.loc,
    })
    this.publishFloor('claim', ts)
    window.setTimeout(() => {
      const ok = this.talking && this.floor?.id === this.id
      if (!ok) this.talking = false
      done(ok)
    }, CLAIM_GRACE_MS)
  }

  release() {
    this.talking = false
    if (this.floor?.id === this.id) {
      this.setFloor(null)
      if (this.client?.connected) {
        this.client.publish(
          this.topic('floor'),
          JSON.stringify({ t: 'release', id: this.id, name: this.name, ts: Date.now() }),
        )
      }
    }
  }

  sendAudio(pcm: Int16Array): boolean {
    if (!this.talking || this.floor?.id !== this.id || !this.client?.connected) return false
    const idBytes = new TextEncoder().encode(this.id)
    const body = new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength)
    const out = new Uint8Array(1 + idBytes.length + body.length)
    out[0] = idBytes.length
    out.set(idBytes, 1)
    out.set(body, 1 + idBytes.length)
    this.client.publish(this.topic('audio'), out as never)
    return true
  }

  stop() {
    if (this.stopped) return
    this.stopped = true
    this.release()
    if (this.client?.connected) {
      this.client.publish(this.topic(`presence/${this.id}`), '', { retain: true })
    }
    window.clearInterval(this.timer)
    window.clearTimeout(this.retry)
    this.gen++
    this.client?.end(false)
    this.online = false
  }

  private topic(suffix: string) {
    return TOPIC_ROOT + suffix
  }

  private connect() {
    if (this.stopped) return
    const gen = ++this.gen
    const url = BROKERS[this.brokerIndex % BROKERS.length] ?? BROKERS[0]
    this.handlers.net({ state: 'connecting', detail: `Connecting to ${brokerLabel(url)}` })
    let opened = false
    const client = mqtt.connect(url, {
      clientId: `hp_${this.id}_${Date.now() % 1_000_000}`,
      clean: true,
      keepalive: 20,
      reconnectPeriod: 0,
      connectTimeout: 8_000,
      protocolVersion: 4,
      will: {
        topic: this.topic(`presence/${this.id}`),
        payload: '',
        retain: true,
        qos: 0,
      },
    })
    this.client = client
    let handled = false
    client.on('connect', () => {
      if (this.stopped || this.gen !== gen) return
      opened = true
      this.online = true
      client.subscribe([this.topic('presence/+'), this.topic('floor'), this.topic('audio')], () => {
        if (this.name) this.beat()
      })
      this.handlers.net({ state: 'online', detail: `Connected · ${brokerLabel(url)}` })
      this.emit()
    })
    client.on('message', (topic, payload) => {
      if (this.stopped || this.gen !== gen) return
      this.onMessage(topic, payload)
    })
    client.on('error', () => {})
    client.on('close', () => {
      if (handled || this.stopped || this.gen !== gen) return
      handled = true
      this.online = false
      this.handlers.net({ state: 'offline', detail: 'Reconnecting' })
      if (!opened) this.brokerIndex++
      this.retry = window.setTimeout(() => {
        if (this.stopped || this.gen !== gen) return
        client.end(true)
        this.connect()
      }, opened ? 1_200 : 400)
    })
  }

  private beat() {
    if (!this.name || !this.client?.connected) return
    this.lastBeat = Date.now()
    const body: { id: string; name: string; ts: number; loc?: GeoFix } = {
      id: this.id,
      name: this.name,
      ts: this.lastBeat,
    }
    if (this.loc) body.loc = this.loc
    this.client.publish(this.topic(`presence/${this.id}`), JSON.stringify(body), { retain: true })
  }

  private publishFloor(kind: 'claim' | 'hb', ts: number) {
    if (!this.client?.connected) return
    const body: FloorMsg = { t: kind, id: this.id, name: this.name, ts, loc: this.loc }
    this.client.publish(this.topic('floor'), JSON.stringify(body))
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
    if (!topic.startsWith(TOPIC_ROOT)) return
    const rest = topic.slice(TOPIC_ROOT.length)
    const now = Date.now()
    if (rest.startsWith('presence/')) {
      const id = rest.slice('presence/'.length)
      const raw = asBytes(payload)
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
        const name = String(msg.name ?? 'Unit').slice(0, 40)
        this.users.set(id, { id, name, seen: now })
        this.emit()
      } catch {
        /* ignore malformed presence */
      }
      return
    }
    if (rest === 'floor') {
      try {
        const msg = JSON.parse(new TextDecoder().decode(asBytes(payload))) as FloorMsg
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
        if (next && this.users.has(next.id)) {
          const user = this.users.get(next.id)
          if (user) user.seen = now
        }
        this.setFloor(next)
      } catch {
        /* ignore malformed floor */
      }
      return
    }
    if (rest === 'audio') {
      const raw = asBytes(payload)
      if (raw.length < 2) return
      const n = raw[0] ?? 0
      if (n < 1 || raw.length < 1 + n + 2) return
      const id = new TextDecoder().decode(raw.subarray(1, 1 + n))
      const floor = this.floor
      if (!floor || id === this.id || floor.id !== id) return
      floor.seen = now
      const body = raw.subarray(1 + n)
      const even = body.length - (body.length % 2)
      const pcm = new Int16Array(even / 2)
      new Uint8Array(pcm.buffer).set(body.subarray(0, even))
      this.handlers.audio(pcm, { id, name: floor.name, loc: floor.loc })
    }
  }
}
