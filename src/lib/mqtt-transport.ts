import mqtt, { type MqttClient } from 'mqtt'
import { DEFAULT_BROKERS, mqttTarget, nextBrokerIndex, publicHost, retryDelayMs } from './net.ts'
import type { NetSnapshot, Wire } from './transport.ts'

export class MqttWire implements Wire {
  private client: MqttClient | null = null
  private handler: (topic: string, payload: Uint8Array) => void = () => {}
  private stateHandler: (state: NetSnapshot) => void = () => {}
  private topics: string[] = []
  private index = 0
  private attempt = 0
  private generation = 0
  private stopped = false
  private timer: ReturnType<typeof setTimeout> | null = null
  private readonly urls: string[]

  constructor(urls: readonly string[] = DEFAULT_BROKERS) {
    this.urls = urls.length ? [...urls] : [...DEFAULT_BROKERS]
  }

  onMessage(handler: (topic: string, payload: Uint8Array) => void) {
    this.handler = handler
  }

  onState(handler: (state: NetSnapshot) => void) {
    this.stateHandler = handler
  }

  subscribe(topics: string[]) {
    this.topics = topics
    if (this.client?.connected && topics.length) this.client.subscribe(topics)
  }

  start() {
    this.stopped = false
    this.open()
  }

  stop() {
    this.stopped = true
    this.generation++
    if (this.timer) clearTimeout(this.timer)
    this.client?.end(true)
    this.client = null
  }

  publish(topic: string, payload: Uint8Array | string, retain = false): boolean {
    if (!this.client?.connected) return false
    this.client.publish(topic, payload as never, { retain, qos: 0 })
    return true
  }

  private open() {
    if (this.stopped) return
    const generation = ++this.generation
    const raw = this.urls[this.index % this.urls.length] ?? ''
    const target = mqttTarget(raw)
    const label = target.ok ? publicHost(target.url) : 'relay'
    if (!target.ok) {
      this.schedule(generation, target.error, label, 0)
      return
    }
    this.stateHandler({
      state: 'connecting',
      detail: `Connecting · ${label} · attempt ${this.attempt + 1}`,
      attempt: this.attempt + 1,
      broker: label,
      error: null,
      nextRetryMs: null,
      transport: 'mqtt',
    })
    const openedAt = Date.now()
    let opened = false
    let settled = false
    let client: MqttClient
    try {
      client = mqtt.connect(target.url, {
        clientId: `sk_${Math.random().toString(16).slice(2, 10)}`,
        username: target.username,
        password: target.password,
        clean: true,
        keepalive: 20,
        reconnectPeriod: 0,
        connectTimeout: 6_000,
        protocolVersion: 4,
      })
    } catch (error) {
      this.schedule(generation, error instanceof Error ? error.message : 'Connection failed', label, 0)
      return
    }
    this.client = client
    const fail = (message: string) => {
      if (settled || this.stopped || generation !== this.generation) return
      settled = true
      const sessionMs = opened ? Date.now() - openedAt : 0
      client.removeAllListeners()
      client.end(true)
      this.schedule(generation, message, label, sessionMs)
    }
    client.on('connect', () => {
      if (settled || this.stopped || generation !== this.generation) return
      opened = true
      this.attempt = 0
      if (this.topics.length) client.subscribe(this.topics)
      this.stateHandler({
        state: 'online',
        detail: `Connected · ${label}`,
        attempt: 1,
        broker: label,
        error: null,
        nextRetryMs: null,
        transport: 'mqtt',
      })
    })
    client.on('message', (topic, payload) => {
      if (this.stopped || generation !== this.generation) return
      const bytes = payload instanceof Uint8Array ? new Uint8Array(payload) : new Uint8Array()
      this.handler(topic, bytes)
    })
    client.on('error', (error) => fail(error.message || 'Broker error'))
    client.on('close', () => fail(opened ? 'Connection closed' : 'Broker unreachable'))
  }

  private schedule(generation: number, message: string, label: string, sessionMs: number) {
    if (this.stopped || generation !== this.generation) return
    this.generation++
    this.index = nextBrokerIndex(this.index, this.urls.length, sessionMs)
    if (sessionMs >= 20_000) this.attempt = 0
    else this.attempt++
    const delay = retryDelayMs(this.attempt)
    this.stateHandler({
      state: 'offline',
      detail: `Offline · ${label} · ${message} · retry in ${Math.ceil(delay / 1000)}s`,
      attempt: this.attempt,
      broker: label,
      error: message,
      nextRetryMs: delay,
      transport: 'mqtt',
    })
    this.timer = setTimeout(() => this.open(), delay)
  }
}
