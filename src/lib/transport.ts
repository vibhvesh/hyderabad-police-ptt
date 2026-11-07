export type NetSnapshot = {
  state: 'connecting' | 'online' | 'offline'
  detail: string
  attempt: number
  broker: string | null
  error: string | null
  nextRetryMs: number | null
  transport: 'mqtt' | 'server' | 'memory'
}

export type Wire = {
  start: () => void
  stop: () => void
  subscribe: (topics: string[]) => void
  publish: (topic: string, payload: Uint8Array | string, retain?: boolean) => boolean
  onMessage: (handler: (topic: string, payload: Uint8Array) => void) => void
  onState: (handler: (state: NetSnapshot) => void) => void
}

type Listener = (topic: string, payload: Uint8Array) => void

export class MemoryHub {
  private clients: MemoryWire[] = []
  private retained = new Map<string, Uint8Array>()

  connect(): MemoryWire {
    const wire = new MemoryWire(this)
    this.clients.push(wire)
    return wire
  }

  publish(topic: string, payload: Uint8Array, retain: boolean) {
    if (retain) this.retained.set(topic, payload)
    for (const client of this.clients) client.receive(topic, payload)
  }

  takeRetained(): Array<[string, Uint8Array]> {
    return [...this.retained]
  }

  forget(wire: MemoryWire) {
    this.clients = this.clients.filter((client) => client !== wire)
  }
}

export class MemoryWire implements Wire {
  private handler: Listener = () => {}
  private stateHandler: (state: NetSnapshot) => void = () => {}
  private running = false

  private hub: MemoryHub

  constructor(hub: MemoryHub) {
    this.hub = hub
  }

  subscribe(_topics: string[]) {}

  start() {
    this.running = true
    this.stateHandler({
      state: 'online',
      detail: 'Connected · local test channel',
      attempt: 1,
      broker: 'memory',
      error: null,
      nextRetryMs: null,
      transport: 'memory',
    })
    for (const [topic, payload] of this.hub.takeRetained()) this.handler(topic, payload)
  }

  stop() {
    this.running = false
    this.hub.forget(this)
  }

  publish(topic: string, payload: Uint8Array | string, retain = false): boolean {
    if (!this.running) return false
    const bytes = typeof payload === 'string' ? new TextEncoder().encode(payload) : payload
    this.hub.publish(topic, bytes, retain)
    return true
  }

  onMessage(handler: Listener) {
    this.handler = handler
  }

  onState(handler: (state: NetSnapshot) => void) {
    this.stateHandler = handler
  }

  receive(topic: string, payload: Uint8Array) {
    if (this.running) this.handler(topic, payload.slice())
  }
}
