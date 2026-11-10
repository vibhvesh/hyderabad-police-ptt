import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { encodeAudio } from '../src/lib/packets.ts'
import { chirp, scheduleReception } from '../src/lib/playback.ts'
import { Radio } from '../src/lib/radio.ts'
import { relayUrl, RelayWire } from '../src/lib/relay-transport.ts'
import { createApp } from '../server/app.ts'
import { loadConfig } from '../server/config.ts'
import { DeviceHandset } from '../server/device-session.ts'
import { sha256 } from '../server/hash.ts'

let dir = ''

async function boot() {
  dir = await mkdtemp(path.join(tmpdir(), 'sanket-handset-'))
  const lines: string[] = []
  const app = createApp({
    config: loadConfig({
      ADMIN_TOKEN: 'admin-test',
      REVIEWER_TOKEN: 'reviewer-test',
      INGEST_TOKEN: 'ingest-test',
      DATA_DIR: dir,
      HOST: '127.0.0.1',
      ASR_PROVIDER: 'none',
      TRANSLATE_PROVIDER: 'none',
    }),
    log: (line) => lines.push(line),
  })
  await app.listen(0, '127.0.0.1')
  return { app, base: `http://127.0.0.1:${app.port()}`, lines }
}

const headers = { authorization: 'Bearer admin-test', 'content-type': 'application/json' }

async function makeLine(base: string, id: string) {
  const created = await fetch(`${base}/api/control/lines`, { method: 'POST', headers, body: JSON.stringify({ id, name: id, sourceLang: 'te', targetLang: 'en' }) })
  expect(created.status).toBe(201)
}

afterEach(async () => {
  if (dir) await rm(dir, { recursive: true, force: true })
})

describe('handset tokens', () => {
  it('stores a hash, rejects a bad token, and keeps a handset on its own line', async () => {
    const { app, base, lines } = await boot()
    await makeLine(base, 'gate')
    const created = await fetch(`${base}/api/control/lines/gate/devices`, { method: 'POST', headers, body: JSON.stringify({ name: 'Gate post' }) })
    expect(created.status).toBe(201)
    const body = await created.json() as { id: string; token: string; name: string; lineId: string }
    expect(body.token.startsWith('sdt_')).toBe(true)
    const file = await readFile(path.join(dir, 'console', 'devices.json'), 'utf8')
    expect(file).not.toContain(body.token)
    expect(file).toContain(sha256(body.token))
    expect(lines.join('\n')).not.toContain(body.token)

    const bad = new DeviceHandset(base, { id: body.id, token: 'sdt_not-the-token', name: 'Gate post' })
    await expect(bad.connect()).rejects.toThrow(/not accepted/i)
    bad.close()

    const handset = new DeviceHandset(base, { id: body.id, token: body.token, name: 'Gate post' })
    const ready = await handset.connect()
    expect(ready).toMatchObject({ id: body.id, lineId: 'gate', name: 'Gate post' })
    const sniffed: number[] = []
    const spy = new Radio(new RelayWire(base), 'sanket-ptt/v1/other/', {
      state: () => undefined,
      audio: (pcm) => sniffed.push(pcm.length),
      boundary: () => undefined,
      net: () => undefined,
      lost: () => undefined,
      notice: () => undefined,
    }, 'spy001')
    spy.start('Spy')
    await delay(200)
    handset.sendRaw('sanket-ptt/v1/other/audio', 'nope')
    await delay(100)
    expect(handset.errors.some((item) => item.includes('another line'))).toBe(true)
    expect(sniffed).toHaveLength(0)

    const spoof = new WebSocket(relayUrl(base))
    const spoofErrors: string[] = []
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('spoof socket timed out')), 3000)
      spoof.addEventListener('open', () => {
        spoof.send(JSON.stringify({ op: 'hello' }))
        const frame = encodeAudio(body.id, new Int16Array([1, 2, 3]), 1)
        const payload = Buffer.from(frame!).toString('base64')
        spoof.send(JSON.stringify({ op: 'pub', topic: 'sanket-ptt/v1/gate/audio', encoding: 'base64', payload }))
      })
      spoof.addEventListener('message', (event) => {
        const msg = JSON.parse(String(event.data)) as { op?: string; message?: string }
        if (msg.op === 'err' && msg.message) spoofErrors.push(msg.message)
        if (spoofErrors.length > 0) {
          clearTimeout(timer)
          resolve()
        }
      })
    })
    expect(spoofErrors.some((item) => item.includes('belongs to a handset'))).toBe(true)
    spoof.close()

    const revoked = await fetch(`${base}/api/control/devices/${body.id}`, { method: 'DELETE', headers })
    expect(revoked.status).toBe(200)
    await delay(80)
    expect(handset.closed || handset.errors.some((item) => item.includes('no longer valid'))).toBe(true)
    const again = new DeviceHandset(base, { id: body.id, token: body.token, name: 'Gate post' })
    await expect(again.connect()).rejects.toThrow(/not accepted/i)
    again.close()
    handset.close()
    spy.stop()
    await app.close()
  })

  it('carries audio both ways and logs the handset clip with battery', async () => {
    const { app, base } = await boot()
    await makeLine(base, 'gate')
    const created = await fetch(`${base}/api/control/lines/gate/devices`, { method: 'POST', headers, body: JSON.stringify({ name: 'Gate post' }) })
    const body = await created.json() as { id: string; token: string }
    const handset = new DeviceHandset(base, { id: body.id, token: body.token, name: 'Gate post' })
    await handset.connect()
    handset.presence({ battery: 74, rssi: -61, voltage: 3.92 })
    const phoneGot: Int16Array[] = []
    let phoneOnline = false
    const phone = new Radio(new RelayWire(base), 'sanket-ptt/v1/gate/', {
      state: () => undefined,
      audio: (pcm) => phoneGot.push(new Int16Array(pcm)),
      boundary: () => undefined,
      net: (state) => {
        phoneOnline = state.state === 'online'
      },
      lost: () => undefined,
      notice: () => undefined,
    }, 'phone01')
    phone.start('Phone')
    const deadline = Date.now() + 4_000
    while (!phoneOnline && Date.now() < deadline) await delay(20)
    expect(phoneOnline).toBe(true)
    expect(await handset.hold()).toBe(true)
    await delay(3_100)
    const tone = chirp(0.64)
    const chunks = split(tone, 960)
    expect(handset.sendPcm(chunks[0]!)).toBe(true)
    for (const chunk of chunks.slice(1)) expect(handset.sendPcm(chunk)).toBe(true)
    const wait = Date.now() + 2_000
    while (phoneGot.reduce((sum, chunk) => sum + chunk.length, 0) < tone.length && Date.now() < wait) await delay(20)
    expect(concat(phoneGot)).toEqual(tone)
    handset.release()
    await delay(200)

    const claimed = await new Promise<boolean>((resolve) => phone.claim(resolve))
    expect(claimed).toBe(true)
    for (const chunk of chunks) expect(phone.sendAudio(chunk)).toBe(true)
    const back = Date.now() + 2_000
    while (handset.rawSamples().length < tone.length && Date.now() < back) await delay(20)
    expect(handset.rawSamples()).toEqual(tone)
    expect(handset.playedSamples()).toEqual(tone)
    const paced = scheduleReception(chunks)
    expect(paced.ratio).toBeGreaterThan(0.97)
    expect(paced.ratio).toBeLessThan(1.03)
    expect(paced.maxGapMs).toBeLessThan(100)

    const logDeadline = Date.now() + 4_000
    let clips: Array<{ speakerId: string; status: string }> = []
    while (Date.now() < logDeadline) {
      const log = await fetch(`${base}/api/control/log?sender=${body.id}`, { headers })
      clips = ((await log.json()) as { clips: Array<{ speakerId: string; status: string }> }).clips
      if (clips.length > 0) break
      await delay(100)
    }
    expect(clips.some((clip) => clip.speakerId === body.id)).toBe(true)
    const live = await fetch(`${base}/api/control/devices`, { headers })
    const listed = (await live.json()) as { devices: Array<{ id: string; online: boolean; battery: number | null; rssi: number | null }> }
    expect(listed.devices.find((item) => item.id === body.id)).toMatchObject({ online: true, battery: 74, rssi: -61 })

    phone.stop()
    handset.close()
    await app.close()
  })

  it('gives a listen-only handset 8 kHz audio and refuses its transmit', async () => {
    const { app, base } = await boot()
    await makeLine(base, 'gate')
    const created = await fetch(`${base}/api/control/lines/gate/devices`, { method: 'POST', headers, body: JSON.stringify({ name: 'Speaker' }) })
    const speaker = await created.json() as { id: string; token: string }
    const phoneCreated = await fetch(`${base}/api/control/lines/gate/devices`, { method: 'POST', headers, body: JSON.stringify({ name: 'Phone set' }) })
    const phoneDev = await phoneCreated.json() as { id: string; token: string }
    const ear = new DeviceHandset(base, { id: speaker.id, token: speaker.token, name: 'Speaker', listenOnly: true, rate: 8000 })
    await ear.connect()
    ear.presence({ battery: 0, rssi: -70, voltage: 0 })
    let phoneOnline = false
    const phone = new Radio(new RelayWire(base), 'sanket-ptt/v1/gate/', {
      state: () => undefined,
      audio: () => undefined,
      boundary: () => undefined,
      net: (state) => {
        phoneOnline = state.state === 'online'
      },
      lost: () => undefined,
      notice: () => undefined,
    }, 'phone01')
    phone.start('Phone')
    const deadline = Date.now() + 4_000
    while (!phoneOnline && Date.now() < deadline) await delay(20)
    const claimed = await new Promise<boolean>((resolve) => phone.claim(resolve))
    expect(claimed).toBe(true)
    const tone = chirp(0.1)
    phone.sendAudio(tone)
    const wait = Date.now() + 2_000
    while (ear.rawSamples().length < 700 && Date.now() < wait) await delay(20)
    const heard = ear.rawSamples().length
    expect(heard).toBeGreaterThan(700)
    expect(heard).toBeLessThan(900)
    ear.sendRaw('sanket-ptt/v1/gate/audio', 'nope')
    await delay(80)
    expect(ear.errors.some((item) => item.includes('listen-only'))).toBe(true)
    const listed = await fetch(`${base}/api/control/devices`, { headers }).then((response) => response.json()) as { devices: Array<{ id: string; listenOnly: boolean }> }
    expect(listed.devices.find((item) => item.id === speaker.id)?.listenOnly).toBe(true)
    expect(listed.devices.find((item) => item.id === phoneDev.id)?.listenOnly).toBe(false)
    phone.stop()
    ear.close()
    await app.close()
  })
})

function split(pcm: Int16Array, size: number): Int16Array[] {
  const out: Int16Array[] = []
  for (let i = 0; i < pcm.length; i += size) out.push(pcm.subarray(i, Math.min(pcm.length, i + size)))
  return out
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
