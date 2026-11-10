import type { WebSocket } from 'ws'
import { topicAllowed } from '../src/lib/net.ts'
import { decodeAudio, encodeAudio } from '../src/lib/packets.ts'
import { resamplePcm } from '../src/lib/pcm-rate.ts'
import { decodeWire, encodeWire, parseClientFrame } from '../src/lib/relay-frame.ts'

export type RelayTap = (topic: string, payload: Uint8Array) => void

export type DevicePrincipal = { id: string; lineId: string; name: string; listenOnly: boolean; rate: number }

export class Relay {
  readonly sent: Array<{ topic: string; text: string }> = []
  readonly audioFrames: Uint8Array[] = []
  private clients = new Set<WebSocket>()
  private retained = new Map<string, string>()
  private sessions = new Map<WebSocket, DevicePrincipal>()
  private links = new Map<string, number>()
  tap: RelayTap = () => {}
  authenticate: (id: string, token: string) => { id: string; lineId: string; name: string } | null = () => null
  stillAllowed: (id: string) => boolean = () => false
  reserved: (id: string) => boolean = () => false
  onLink: (id: string, online: boolean, listenOnly?: boolean) => void = () => {}

  add(socket: WebSocket) {
    this.clients.add(socket)
    for (const frame of this.retained.values()) socket.send(frame)
    socket.on('message', (data) => this.onClient(socket, String(data)))
    socket.on('close', () => {
      this.clients.delete(socket)
      this.unbind(socket)
    })
  }

  dropDevice(id: string) {
    for (const [socket, principal] of this.sessions) {
      if (principal.id !== id) continue
      socket.close()
    }
  }

  publish(topic: string, payload: Uint8Array | string, retain = false) {
    if (!topicAllowed(topic)) return
    const bytes = typeof payload === 'string' ? new TextEncoder().encode(payload) : payload
    const wire = encodeWire(payload)
    const frame = JSON.stringify({ op: 'msg', topic, encoding: wire.encoding, payload: wire.payload })
    if (retain) this.retained.set(topic, frame)
    this.fanout(null, topic, frame, bytes)
    const text = typeof payload === 'string' ? payload : ''
    this.sent.push({ topic, text })
    if (topic.endsWith('/audio') && typeof payload !== 'string') {
      this.audioFrames.push(payload)
      if (this.audioFrames.length > 8) this.audioFrames.shift()
    }
    if (this.sent.length > 40) this.sent.shift()
    this.tap(topic, bytes)
  }

  private onClient(socket: WebSocket, raw: string) {
    const frame = parseClientFrame(raw)
    if (!frame || frame.op !== 'pub') {
      if (frame?.op === 'hello') this.hello(socket, frame.device)
      return
    }
    if (!topicAllowed(frame.topic)) {
      socket.send(JSON.stringify({ op: 'err', message: 'Topic is outside the configured prefixes.' }))
      return
    }
    const payload = decodeWire(frame.encoding, frame.payload)
    if (!payload) return
    const session = this.sessions.get(socket)
    if (session) {
      if (!this.stillAllowed(session.id)) {
        socket.send(JSON.stringify({ op: 'err', message: 'This handset token is no longer valid.' }))
        socket.close()
        return
      }
      const reason = devicePublishAllowed(frame.topic, session, payload)
      if (reason) {
        socket.send(JSON.stringify({ op: 'err', message: reason }))
        return
      }
    } else {
      const speaker = speakerOf(frame.topic, payload)
      if (speaker && this.reserved(speaker)) {
        socket.send(JSON.stringify({ op: 'err', message: 'That id belongs to a handset.' }))
        return
      }
    }
    const out = JSON.stringify({ op: 'msg', topic: frame.topic, encoding: frame.encoding, payload: frame.payload })
    if (frame.retain) this.retained.set(frame.topic, out)
    this.fanout(socket, frame.topic, out, payload)
    const topic = frame.topic
    const copy = payload.slice()
    queueMicrotask(() => this.tap(topic, copy))
  }

  private hello(socket: WebSocket, device: { id: string; token: string; listenOnly: boolean; rate: number } | undefined) {
    if (device) {
      const found = this.authenticate(device.id, device.token)
      if (!found) {
        socket.send(JSON.stringify({ op: 'err', message: 'Device token was not accepted.' }))
        socket.close()
        return
      }
      const principal: DevicePrincipal = { ...found, listenOnly: device.listenOnly, rate: device.rate }
      this.bind(socket, principal)
      socket.send(JSON.stringify({
        op: 'ready',
        device: { id: principal.id, lineId: principal.lineId, name: principal.name, listenOnly: principal.listenOnly, rate: principal.rate },
      }))
    }
    for (const retained of this.retained.values()) socket.send(retained)
  }

  private fanout(from: WebSocket | null, topic: string, frame: string, raw: Uint8Array) {
    let slow: string[] | null = null
    for (const client of this.clients) {
      if (from && client === from) continue
      if (client.readyState !== 1) continue
      const prefs = this.sessions.get(client)
      if (prefs?.rate === 8000 && topic.endsWith('/audio')) {
        if (!slow) slow = slowAudioFrames(topic, raw)
        for (const item of slow) client.send(item)
        continue
      }
      client.send(frame)
    }
  }

  private bind(socket: WebSocket, principal: DevicePrincipal) {
    const previous = this.sessions.get(socket)
    if (previous) this.unbind(socket)
    this.sessions.set(socket, principal)
    const count = (this.links.get(principal.id) ?? 0) + 1
    this.links.set(principal.id, count)
    if (count === 1) this.onLink(principal.id, true, principal.listenOnly)
  }

  private unbind(socket: WebSocket) {
    const principal = this.sessions.get(socket)
    if (!principal) return
    this.sessions.delete(socket)
    const count = (this.links.get(principal.id) ?? 1) - 1
    if (count <= 0) {
      this.links.delete(principal.id)
      this.onLink(principal.id, false)
    } else {
      this.links.set(principal.id, count)
    }
  }
}

export function devicePublishAllowed(topic: string, session: DevicePrincipal, payload: Uint8Array): string | null {
  const root = `sanket-ptt/v1/${session.lineId}/`
  if (session.listenOnly && (topic === `${root}audio` || topic === `${root}floor`)) return 'This handset is listen-only.'
  if (!topic.startsWith(root)) return 'This handset is bound to another line.'
  const rest = topic.slice(root.length)
  if (rest === 'audio') {
    const decoded = decodeAudio(payload)
    if (!decoded || decoded.id !== session.id) return 'Audio must use this handset id.'
    return null
  }
  if (rest === 'floor') {
    try {
      const body = JSON.parse(new TextDecoder().decode(payload)) as { id?: unknown }
      if (body.id !== session.id) return 'Floor messages must use this handset id.'
    } catch {
      return 'Floor message was not valid.'
    }
    return null
  }
  if (rest === `presence/${session.id}`) return null
  return 'This handset cannot publish that topic.'
}

function slowAudioFrames(topic: string, raw: Uint8Array): string[] {
  const decoded = decodeAudio(raw)
  if (!decoded) return []
  const pcm = resamplePcm(decoded.pcm)
  const frames: string[] = []
  const step = 320
  for (let offset = 0, part = 0; offset < pcm.length; offset += step, part++) {
    const slice = pcm.subarray(offset, Math.min(pcm.length, offset + step))
    const seq = (((decoded.seq ?? 0) * 16) + part) >>> 0
    const packet = encodeAudio(decoded.id, slice, seq)
    if (!packet) continue
    const wire = encodeWire(packet)
    frames.push(JSON.stringify({ op: 'msg', topic, encoding: wire.encoding, payload: wire.payload }))
  }
  return frames
}

function speakerOf(topic: string, payload: Uint8Array): string | null {
  if (topic.endsWith('/audio')) return decodeAudio(payload)?.id ?? null
  if (topic.endsWith('/floor')) {
    try {
      const body = JSON.parse(new TextDecoder().decode(payload)) as { id?: unknown }
      return typeof body.id === 'string' ? body.id : null
    } catch {
      return null
    }
  }
  const marker = '/presence/'
  const at = topic.lastIndexOf(marker)
  if (at >= 0) return topic.slice(at + marker.length) || null
  return null
}
