import type { WebSocket } from 'ws'
import { topicAllowed } from '../src/lib/net.ts'
import { decodeWire, encodeWire, parseClientFrame } from '../src/lib/relay-frame.ts'

export type RelayTap = (topic: string, payload: Uint8Array) => void

export class Relay {
  readonly sent: Array<{ topic: string; text: string }> = []
  readonly audioFrames: Uint8Array[] = []
  private clients = new Set<WebSocket>()
  private retained = new Map<string, string>()
  tap: RelayTap = () => {}

  add(socket: WebSocket) {
    this.clients.add(socket)
    for (const frame of this.retained.values()) socket.send(frame)
    socket.on('message', (data) => this.onClient(socket, String(data)))
    socket.on('close', () => this.clients.delete(socket))
  }

  publish(topic: string, payload: Uint8Array | string, retain = false) {
    if (!topicAllowed(topic)) return
    const wire = encodeWire(payload)
    const frame = JSON.stringify({ op: 'msg', topic, encoding: wire.encoding, payload: wire.payload })
    if (retain) this.retained.set(topic, frame)
    for (const client of this.clients) {
      if (client.readyState === 1) client.send(frame)
    }
    const text = typeof payload === 'string' ? payload : ''
    this.sent.push({ topic, text })
    if (topic.endsWith('/audio') && typeof payload !== 'string') {
      this.audioFrames.push(payload)
      if (this.audioFrames.length > 8) this.audioFrames.shift()
    }
    if (this.sent.length > 40) this.sent.shift()
    const bytes = typeof payload === 'string' ? new TextEncoder().encode(payload) : payload
    this.tap(topic, bytes)
  }

  private onClient(socket: WebSocket, raw: string) {
    const frame = parseClientFrame(raw)
    if (!frame || frame.op !== 'pub') {
      if (frame?.op === 'hello') {
        for (const retained of this.retained.values()) socket.send(retained)
      }
      return
    }
    if (!topicAllowed(frame.topic)) {
      socket.send(JSON.stringify({ op: 'err', message: 'Topic is outside the configured prefixes.' }))
      return
    }
    const payload = decodeWire(frame.encoding, frame.payload)
    if (!payload) return
    const out = JSON.stringify({ op: 'msg', topic: frame.topic, encoding: frame.encoding, payload: frame.payload })
    if (frame.retain) this.retained.set(frame.topic, out)
    for (const client of this.clients) {
      if (client !== socket && client.readyState === 1) client.send(out)
    }
    this.tap(frame.topic, payload)
  }
}
