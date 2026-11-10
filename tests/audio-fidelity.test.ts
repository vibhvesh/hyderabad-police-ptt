import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { chirp, scheduleReception, silenceRuns } from '../src/lib/playback.ts'
import { Radio, type RadioView } from '../src/lib/radio.ts'
import { RelayWire } from '../src/lib/relay-transport.ts'
import { SAMPLE_RATE } from '../src/lib/constants.ts'
import { createApp } from '../server/app.ts'
import { loadConfig } from '../server/config.ts'

let dir = ''

function split(pcm: Int16Array, size: number): Int16Array[] {
  const out: Int16Array[] = []
  for (let i = 0; i < pcm.length; i += size) out.push(pcm.subarray(i, Math.min(pcm.length, i + size)))
  return out
}

function handlers(audio?: (pcm: Int16Array, seq: number | null) => void) {
  return {
    state: () => undefined,
    audio: (pcm: Int16Array, _from: unknown, seq: number | null) => audio?.(pcm, seq),
    boundary: () => undefined,
    net: () => undefined,
    lost: () => undefined,
    notice: () => undefined,
  }
}

describe('played audio stays at the spoken rate', () => {
  it('keeps a 6s chirp within 3 percent and without a long hole under moderate jitter', () => {
    const sent = chirp(6)
    const chunks = split(sent, 960)
    const result = scheduleReception(chunks)
    const quiet = silenceRuns(result.received, SAMPLE_RATE)
    expect(result.ratio).toBeGreaterThan(0.97)
    expect(result.ratio).toBeLessThan(1.03)
    expect(result.maxGapMs).toBeLessThan(100)
    expect(quiet.maxMs).toBeLessThan(100)
  })

  it('does not drop steady packets on the server relay', async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'sanket-audio-'))
    const app = createApp({
      config: loadConfig({ DATA_DIR: dir, HOST: '127.0.0.1', ADMIN_TOKEN: 'a', REVIEWER_TOKEN: 'b', INGEST_TOKEN: 'c' }),
      log: () => undefined,
    })
    await app.listen(0, '127.0.0.1')
    const base = `http://127.0.0.1:${app.port()}`
    const root = 'sanket-ptt/v1/fidelity/'
    const got: Int16Array[] = []
    let senderOnline = false
    let receiverOnline = false
    const sender = new Radio(new RelayWire(base), root, {
      ...handlers(),
      net: (state) => {
        senderOnline = state.state === 'online'
      },
    }, 'send01')
    const receiver = new Radio(new RelayWire(base), root, {
      ...handlers((pcm) => got.push(new Int16Array(pcm))),
      net: (state) => {
        receiverOnline = state.state === 'online'
      },
      state: (_view: RadioView) => undefined,
    }, 'recv01')
    sender.start('Sender')
    receiver.start('Receiver')
    const deadline = Date.now() + 4_000
    while ((!senderOnline || !receiverOnline) && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 20))
    expect(senderOnline && receiverOnline).toBe(true)
    const claimed = await new Promise<boolean>((resolve) => sender.claim(resolve))
    expect(claimed).toBe(true)
    const tone = new Int16Array(200).fill(8000)
    const copies = 40
    for (let i = 0; i < copies; i++) sender.sendAudio(tone)
    const wait = Date.now() + 2_000
    while (got.length < copies && Date.now() < wait) await new Promise((resolve) => setTimeout(resolve, 20))
    const samples = got.reduce((sum, chunk) => sum + chunk.length, 0)
    expect(got.length).toBe(copies)
    expect(samples).toBe(copies * tone.length)
    sender.stop()
    receiver.stop()
    await app.close()
  })
})

afterEach(async () => {
  if (dir) await rm(dir, { recursive: true, force: true })
})
