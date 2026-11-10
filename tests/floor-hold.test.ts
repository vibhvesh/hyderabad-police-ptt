import { describe, expect, it, vi } from 'vitest'
import { reduceHold, shouldEndHold } from '../src/lib/hold.ts'
import { Radio } from '../src/lib/radio.ts'
import type { NetSnapshot, Wire } from '../src/lib/transport.ts'

class QuietRelay {
  private peers: QuietWire[] = []

  connect(): QuietWire {
    const wire = new QuietWire(this)
    this.peers.push(wire)
    return wire
  }

  fanout(from: QuietWire, topic: string, payload: Uint8Array) {
    for (const peer of this.peers) {
      if (peer !== from) peer.deliver(topic, payload)
    }
  }
}

class QuietWire implements Wire {
  private handler: (topic: string, payload: Uint8Array) => void = () => undefined
  private stateHandler: (state: NetSnapshot) => void = () => undefined
  private running = false
  private relay: QuietRelay

  constructor(relay: QuietRelay) {
    this.relay = relay
  }

  subscribe(_topics: string[]) {}

  start() {
    this.running = true
    this.stateHandler({
      state: 'online',
      detail: 'Connected',
      attempt: 1,
      broker: 'relay',
      error: null,
      nextRetryMs: null,
      transport: 'server',
    })
  }

  stop() {
    this.running = false
  }

  publish(topic: string, payload: Uint8Array | string): boolean {
    if (!this.running) return false
    const bytes = typeof payload === 'string' ? new TextEncoder().encode(payload) : payload
    this.relay.fanout(this, topic, bytes)
    return true
  }

  onMessage(handler: (topic: string, payload: Uint8Array) => void) {
    this.handler = handler
  }

  onState(handler: (state: NetSnapshot) => void) {
    this.stateHandler = handler
  }

  deliver(topic: string, payload: Uint8Array) {
    if (this.running) this.handler(topic, payload)
  }
}

function handlers(lost: () => void) {
  return {
    state: () => undefined,
    audio: () => undefined,
    boundary: () => undefined,
    net: () => undefined,
    lost,
    notice: () => undefined,
  }
}

describe('floor lease while the button is held', () => {
  it('keeps transmitting for 10s when the relay does not echo our heartbeat', async () => {
    let now = 1_700_000_000_000
    vi.spyOn(Date, 'now').mockImplementation(() => now)
    const relay = new QuietRelay()
    const lost: string[] = []
    const me = new Radio(relay.connect(), 'sanket-ptt/v1/sanket-1/', handlers(() => lost.push('lost')), 'holder1')
    me.start('Holder')
    const claimed = await new Promise<boolean>((resolve) => me.claim(resolve))
    expect(claimed).toBe(true)
    for (let second = 1; second <= 10; second++) {
      now += 1000
      me.pulse(now)
      expect(me.sendAudio(new Int16Array([second, 2, 3, 4]))).toBe(true)
    }
    expect(lost).toEqual([])
    me.stop()
    vi.restoreAllMocks()
  })

  it('does not treat a long-press cancel as letting go', () => {
    let holding = false
    for (const kind of ['pointerdown', 'pointercancel', 'pointerleave', 'contextmenu'] as const) {
      holding = reduceHold(holding, kind)
    }
    expect(holding).toBe(true)
    expect(shouldEndHold('pointercancel')).toBe(false)
    expect(shouldEndHold('pointerleave')).toBe(false)
    expect(reduceHold(holding, 'pointerup')).toBe(false)
    expect(reduceHold(true, 'touchend')).toBe(false)
  })
})
