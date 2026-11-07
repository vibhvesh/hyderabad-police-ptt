import { retryDelayMs } from './net.ts'
import { decodeWire, encodeWire, type RelayMsg } from './relay-frame.ts'
import type { NetSnapshot, Wire } from './transport.ts'

export function relayUrl(backend: string): string {
  const base = backend.replace(/\/$/, '')
  const url = new URL(base)
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  url.pathname = '/ws'
  url.search = ''
  url.hash = ''
  return url.toString()
}

export class RelayWire implements Wire {
  private socket: WebSocket | null = null
  private handler: (topic: string, payload: Uint8Array) => void = () => {}
  private stateHandler: (state: NetSnapshot) => void = () => {}
  private attempt = 0
  private generation = 0
  private stopped = false
  private timer: ReturnType<typeof setTimeout> | null = null

  private backend: string

  constructor(backend: string) {
    this.backend = backend
  }

  onMessage(handler: (topic: string, payload: Uint8Array) => void) {
    this.handler = handler
  }

  onState(handler: (state: NetSnapshot) => void) {
    this.stateHandler = handler
  }

  subscribe(_topics: string[]) {}

  start() {
    this.stopped = false
    this.open()
  }

  stop() {
    this.stopped = true
    this.generation++
    if (this.timer) clearTimeout(this.timer)
    this.socket?.close()
    this.socket = null
  }

  publish(topic: string, payload: Uint8Array | string, retain = false): boolean {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return false
    const body = encodeWire(payload)
    this.socket.send(JSON.stringify({ op: 'pub', topic, retain, ...body }))
    return true
  }

  private open() {
    if (this.stopped) return
    const generation = ++this.generation
    let url = ''
    try {
      url = relayUrl(this.backend)
    } catch {
      this.schedule(generation, 'Backend URL is not valid')
      return
    }
    this.stateHandler({
      state: 'connecting',
      detail: `Connecting · server relay · attempt ${this.attempt + 1}`,
      attempt: this.attempt + 1,
      broker: new URL(url).host,
      error: null,
      nextRetryMs: null,
      transport: 'server',
    })
    let socket: WebSocket
    try {
      socket = new WebSocket(url)
    } catch (error) {
      this.schedule(generation, error instanceof Error ? error.message : 'Relay connection failed')
      return
    }
    this.socket = socket
    let opened = false
    socket.addEventListener('open', () => {
      if (this.stopped || generation !== this.generation) return
      opened = true
      this.attempt = 0
      socket.send(JSON.stringify({ op: 'hello' }))
      this.stateHandler({
        state: 'online',
        detail: `Connected · server relay`,
        attempt: 1,
        broker: new URL(url).host,
        error: null,
        nextRetryMs: null,
        transport: 'server',
      })
    })
    socket.addEventListener('message', (event) => {
      if (typeof event.data !== 'string') return
      try {
        const msg = JSON.parse(event.data) as RelayMsg
        if (msg.op !== 'msg' || typeof msg.topic !== 'string') return
        const payload = decodeWire(msg.encoding, msg.payload)
        if (payload) this.handler(msg.topic, payload)
      } catch {
        /* ignore malformed relay frames */
      }
    })
    socket.addEventListener('close', () => {
      if (this.stopped || generation !== this.generation) return
      this.schedule(generation, opened ? 'Relay closed' : 'Relay unreachable')
    })
    socket.addEventListener('error', () => {
      if (!opened) this.schedule(generation, 'Relay unreachable')
    })
  }

  private schedule(generation: number, message: string) {
    if (this.stopped || generation !== this.generation) return
    this.generation++
    this.attempt++
    const delay = retryDelayMs(this.attempt)
    this.stateHandler({
      state: 'offline',
      detail: `Offline · server relay · ${message} · retry in ${Math.ceil(delay / 1000)}s`,
      attempt: this.attempt,
      broker: null,
      error: message,
      nextRetryMs: delay,
      transport: 'server',
    })
    this.timer = setTimeout(() => this.open(), delay)
  }
}
