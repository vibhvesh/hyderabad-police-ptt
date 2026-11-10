import { CLAIM_GRACE_MS, MAX_CLIP_MS, SAMPLE_RATE } from '../src/lib/constants.ts'
import { reduceFloor, type Floor } from '../src/lib/floor.ts'
import { decodeAudio, encodeAudio } from '../src/lib/packets.ts'
import { LivePlayout } from '../src/lib/playback.ts'
import { decodeWire, encodeWire } from '../src/lib/relay-frame.ts'
import { relayUrl } from '../src/lib/relay-transport.ts'

export type HandsetAuth = { id: string; token: string; name: string }
export type HandsetReady = { id: string; lineId: string; name: string }

/** Node stand-in for the ESP32 handset. It speaks the same WebSocket relay as the firmware. */
export class DeviceHandset {
  private socket: WebSocket | null = null
  private lineId = ''
  private talking = false
  private floor: Floor | null = null
  private claimTs = 0
  private seq = 0
  private timer: ReturnType<typeof setInterval> | null = null
  private readonly playout: LivePlayout
  private readonly played: Int16Array[] = []
  private readonly raw: Int16Array[] = []
  closed = false
  readonly errors: string[] = []
  private readonly base: string
  private readonly auth: HandsetAuth

  constructor(base: string, auth: HandsetAuth) {
    this.base = base
    this.auth = auth
    this.playout = new LivePlayout(SAMPLE_RATE, () => Date.now() / 1000)
  }

  playedSamples(): Int16Array {
    return concat(this.played)
  }

  rawSamples(): Int16Array {
    return concat(this.raw)
  }

  async connect(): Promise<HandsetReady> {
    const socket = new WebSocket(relayUrl(this.base))
    this.socket = socket
    return new Promise((resolve, reject) => {
      let settled = false
      const finish = (error: Error | null, ready?: HandsetReady) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        if (error || !ready) reject(error ?? new Error('Handset hello failed'))
        else resolve(ready)
      }
      const timer = setTimeout(() => finish(new Error('Handset hello timed out')), 4_000)
      socket.addEventListener('open', () => {
        socket.send(JSON.stringify({ op: 'hello', device: { id: this.auth.id, token: this.auth.token } }))
      })
      socket.addEventListener('error', () => finish(new Error('Handset socket failed')))
      socket.addEventListener('close', () => {
        this.closed = true
        this.talking = false
        finish(new Error('Handset socket closed'))
      })
      socket.addEventListener('message', (event) => {
        if (typeof event.data !== 'string') return
        let value: { op?: string; message?: string; device?: HandsetReady; topic?: string; encoding?: string; payload?: string }
        try {
          value = JSON.parse(event.data) as typeof value
        } catch {
          return
        }
        if (value.op === 'err') {
          this.errors.push(value.message || 'Device token was not accepted.')
          finish(new Error(value.message || 'Device token was not accepted.'))
          return
        }
        if (value.op === 'ready' && value.device?.lineId) {
          this.lineId = value.device.lineId
          finish(null, value.device)
          return
        }
        if (value.op === 'msg' && value.topic && value.encoding && typeof value.payload === 'string') {
          const payload = decodeWire(value.encoding, value.payload)
          if (payload) this.onMessage(value.topic, payload)
        }
      })
    })
  }

  sendRaw(topic: string, payload: string) {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return
    const body = encodeWire(payload)
    this.socket.send(JSON.stringify({ op: 'pub', topic, retain: false, ...body }))
  }

  close() {
    this.release()
    this.socket?.close()
  }

  presence(report: { battery: number; rssi: number; voltage: number }) {
    this.publish(`presence/${this.auth.id}`, JSON.stringify({
      id: this.auth.id,
      name: this.auth.name,
      ts: Date.now(),
      kind: 'handset',
      battery: report.battery,
      rssi: report.rssi,
      voltage: report.voltage,
      charging: false,
    }), true)
  }

  /** Claims the floor and renews the lease locally. The relay does not echo our own heartbeat. */
  async hold(): Promise<boolean> {
    if (!this.lineId) return false
    this.talking = true
    this.claimTs = Date.now()
    this.floor = { id: this.auth.id, name: this.auth.name, ts: this.claimTs, seen: this.claimTs, got: this.claimTs, loc: null }
    this.publishFloor('claim')
    if (this.timer) clearInterval(this.timer)
    this.timer = setInterval(() => this.pulse(), 1_000)
    await delay(CLAIM_GRACE_MS)
    return this.talking && this.floor?.id === this.auth.id
  }

  sendPcm(pcm: Int16Array): boolean {
    if (!this.talking || this.floor?.id !== this.auth.id) return false
    if (Date.now() - this.claimTs > MAX_CLIP_MS) {
      this.release()
      return false
    }
    const frame = encodeAudio(this.auth.id, pcm, this.seq++)
    if (!frame) return false
    return this.publish('audio', frame)
  }

  release() {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    const mine = this.talking || this.floor?.id === this.auth.id
    this.talking = false
    if (!mine || !this.lineId) return
    this.floor = null
    this.publish('floor', JSON.stringify({ t: 'release', id: this.auth.id, name: this.auth.name, ts: Date.now() }))
  }

  private pulse() {
    if (!this.talking || this.floor?.id !== this.auth.id) return
    if (Date.now() - this.claimTs > MAX_CLIP_MS) {
      this.release()
      return
    }
    this.floor = { ...this.floor, seen: Date.now() }
    this.publishFloor('hb')
  }

  private publishFloor(kind: 'claim' | 'hb') {
    this.publish('floor', JSON.stringify({ t: kind, id: this.auth.id, name: this.auth.name, ts: this.claimTs }))
  }

  private publish(suffix: string, payload: Uint8Array | string, retain = false): boolean {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN || !this.lineId) return false
    const body = encodeWire(payload)
    this.socket.send(JSON.stringify({ op: 'pub', topic: `sanket-ptt/v1/${this.lineId}/${suffix}`, retain, ...body }))
    return true
  }

  private onMessage(topic: string, payload: Uint8Array) {
    const root = `sanket-ptt/v1/${this.lineId}/`
    if (!this.lineId || !topic.startsWith(root)) return
    const rest = topic.slice(root.length)
    if (rest === 'floor') {
      try {
        const msg = JSON.parse(new TextDecoder().decode(payload)) as { t?: string; id?: string; name?: string; ts?: number }
        if (msg.t !== 'claim' && msg.t !== 'hb' && msg.t !== 'release') return
        if (typeof msg.id !== 'string') return
        const next = reduceFloor(this.floor, { t: msg.t, id: msg.id, name: String(msg.name ?? '').slice(0, 40), ts: Number(msg.ts) || Date.now() }, Date.now())
        this.floor = next
        if (this.talking && next?.id !== this.auth.id) this.talking = false
      } catch {
        /* ignore malformed floor */
      }
      return
    }
    if (rest !== 'audio') return
    const decoded = decodeAudio(payload)
    if (!decoded || decoded.id === this.auth.id) return
    if (!this.floor || this.floor.id !== decoded.id) return
    this.raw.push(new Int16Array(decoded.pcm))
    for (const item of this.playout.push(decoded.seq, decoded.pcm, () => undefined)) this.played.push(item.pcm)
  }
}

function concat(chunks: Int16Array[]): Int16Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0)
  const out = new Int16Array(total)
  let offset = 0
  for (const chunk of chunks) {
    out.set(chunk, offset)
    offset += chunk.length
  }
  return out
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
