import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { buildWav } from '../src/lib/audio.ts'
import { cloudKeyPrompt } from '../src/lib/scribe-prompt.ts'
import { createApp } from '../server/app.ts'
import { loadConfig } from '../server/config.ts'
import { SCRIBE_TTL_MS } from '../server/scribe-session.ts'

const KEY_A = 'session-key-alpha-a'
const KEY_B = 'session-key-bravo-b'
const SERVER_KEY = 'configured-server-key'

let dir = ''

function clip(seconds = 0.5): Buffer {
  return Buffer.from(buildWav([new Int16Array(Math.round(12_000 * seconds))], 12_000))
}

function cookieFrom(response: Response): string {
  return (response.headers.get('set-cookie') ?? '').split(';')[0] ?? ''
}

afterEach(async () => {
  if (dir) await rm(dir, { recursive: true, force: true })
})

describe('cloud key prompt', () => {
  it('stays hidden until cloud transcription is opted in', () => {
    expect(cloudKeyPrompt(false, 'none')).toBe('hidden')
    expect(cloudKeyPrompt(false, 'server')).toBe('hidden')
    expect(cloudKeyPrompt(true, 'none')).toBe('ask')
    expect(cloudKeyPrompt(true, 'server')).toBe('ready')
    expect(cloudKeyPrompt(true, 'session')).toBe('ready')
  })
})

describe('session cloud keys', () => {
  it('isolates keys, expires them, clears them, and does not log or store them', async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'sanket-scribe-session-'))
    const logs: string[] = []
    let clock = 1_000_000
    const used: string[] = []
    const app = createApp({
      config: loadConfig({ DATA_DIR: dir, HOST: '127.0.0.1', DEMO_ORIGINS: 'https://sanket-ptt.onrender.com' }),
      now: () => clock,
      log: (line) => logs.push(line),
      scribeFactory: (apiKey) => ({
        convert: async () => {
          used.push(apiKey)
          return 'desk'
        },
        realtimeToken: async () => 'realtime-token',
      }),
    })
    await app.listen(0, '127.0.0.1')
    const base = `http://127.0.0.1:${app.port()}`
    const headers = { origin: 'https://sanket-ptt.onrender.com', 'content-type': 'application/json' }

    const closed = await fetch(`${base}/api/speech/scribe-key`, { headers: { origin: headers.origin } })
    expect((await closed.json() as { source: string }).source).toBe('none')

    const savedA = await fetch(`${base}/api/speech/scribe-key`, { method: 'POST', headers, body: JSON.stringify({ key: KEY_A }) })
    const cookieA = cookieFrom(savedA)
    const savedB = await fetch(`${base}/api/speech/scribe-key`, { method: 'POST', headers, body: JSON.stringify({ key: KEY_B }) })
    const cookieB = cookieFrom(savedB)
    expect(savedA.status).toBe(200)
    expect(cookieA.startsWith('sanket_scribe=')).toBe(true)
    expect(cookieA).not.toContain(KEY_A)
    expect(cookieB).not.toContain(KEY_B)
    expect(cookieA).not.toBe(cookieB)

    const heardA = await fetch(`${base}/api/speech/scribe`, {
      method: 'POST',
      headers: { origin: headers.origin, cookie: cookieA, 'x-cloud-consent': 'yes', 'x-language': 'en' },
      body: clip(),
    })
    const heardB = await fetch(`${base}/api/speech/scribe`, {
      method: 'POST',
      headers: { origin: headers.origin, cookie: cookieB, 'x-cloud-consent': 'yes', 'x-language': 'en' },
      body: clip(),
    })
    expect(heardA.status).toBe(200)
    expect(heardB.status).toBe(200)
    expect(used).toEqual([KEY_A, KEY_B])

    clock += SCRIBE_TTL_MS + 1
    const expired = await fetch(`${base}/api/speech/scribe`, {
      method: 'POST',
      headers: { origin: headers.origin, cookie: cookieA, 'x-cloud-consent': 'yes' },
      body: clip(),
    })
    expect(expired.status).toBe(409)
    expect(used).toEqual([KEY_A, KEY_B])

    clock = 2_000_000
    const again = await fetch(`${base}/api/speech/scribe-key`, { method: 'POST', headers, body: JSON.stringify({ key: KEY_A }) })
    const fresh = cookieFrom(again)
    const cleared = await fetch(`${base}/api/speech/scribe-key`, { method: 'DELETE', headers: { origin: headers.origin, cookie: fresh } })
    expect(cleared.status).toBe(200)
    const afterClear = await fetch(`${base}/api/speech/scribe`, {
      method: 'POST',
      headers: { origin: headers.origin, cookie: fresh, 'x-cloud-consent': 'yes' },
      body: clip(),
    })
    expect(afterClear.status).toBe(409)

    const leaked = await fetch(`${base}/api/speech/scribe-key?key=${KEY_A}`, { method: 'POST', headers, body: JSON.stringify({ key: KEY_B }) })
    expect(leaked.status).toBe(400)
    const evil = await fetch(`${base}/api/speech/scribe-key`, {
      method: 'POST',
      headers: { ...headers, origin: 'https://evil.example' },
      body: JSON.stringify({ key: KEY_A }),
    })
    expect(evil.status).toBe(403)
    expect(evil.headers.get('set-cookie')).toBeNull()

    const longClip = await fetch(`${base}/api/speech/scribe`, {
      method: 'POST',
      headers: { origin: headers.origin, cookie: cookieB, 'x-cloud-consent': 'yes' },
      body: clip(61),
    })
    expect(longClip.status).toBe(413)

    const dumped = JSON.stringify({ logs, saved: await savedA.clone().json(), evil: await evil.clone().json() })
    expect(dumped).not.toContain(KEY_A)
    expect(dumped).not.toContain(KEY_B)
    const files = await readdir(dir).catch(() => [])
    for (const name of files) {
      const text = await readFile(path.join(dir, name), 'utf8').catch(() => '')
      expect(text).not.toContain(KEY_A)
      expect(text).not.toContain(KEY_B)
    }
    await app.close()
  })

  it('stops using a rejected configured key and does not echo it', async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'sanket-scribe-reject-'))
    const used: string[] = []
    const app = createApp({
      config: loadConfig({
        DATA_DIR: dir,
        HOST: '127.0.0.1',
        ELEVENLABS_API_KEY: SERVER_KEY,
        DEMO_ORIGINS: 'https://sanket-ptt.onrender.com',
      }),
      log: () => undefined,
      scribeFactory: (apiKey) => ({
        convert: async () => {
          used.push(apiKey)
          if (apiKey === SERVER_KEY) {
            const error = new Error(`rejected ${apiKey}`)
            Object.assign(error, { statusCode: 401 })
            throw error
          }
          return 'from session'
        },
        realtimeToken: async () => 'nope',
      }),
    })
    await app.listen(0, '127.0.0.1')
    const base = `http://127.0.0.1:${app.port()}`
    const origin = 'https://sanket-ptt.onrender.com'
    const first = await fetch(`${base}/api/speech/scribe`, {
      method: 'POST',
      headers: { origin, 'x-cloud-consent': 'yes' },
      body: clip(),
    })
    const firstBody = await first.json() as { message?: string; needsKey?: boolean }
    expect(first.status).toBe(401)
    expect(firstBody.needsKey).toBe(true)
    expect(JSON.stringify(firstBody)).not.toContain(SERVER_KEY)
    const health = await fetch(`${base}/health`).then((response) => response.json()) as { providers: { scribe: { mode: string; detail: string } } }
    expect(health.providers.scribe.mode).toBe('rejected')
    expect(health.providers.scribe.detail).not.toContain(SERVER_KEY)
    const second = await fetch(`${base}/api/speech/scribe`, {
      method: 'POST',
      headers: { origin, 'x-cloud-consent': 'yes' },
      body: clip(),
    })
    expect(second.status).toBe(409)
    expect(used).toEqual([SERVER_KEY])
    const saved = await fetch(`${base}/api/speech/scribe-key`, {
      method: 'POST',
      headers: { origin, 'content-type': 'application/json' },
      body: JSON.stringify({ key: KEY_A }),
    })
    const cookie = cookieFrom(saved)
    const third = await fetch(`${base}/api/speech/scribe`, {
      method: 'POST',
      headers: { origin, cookie, 'x-cloud-consent': 'yes' },
      body: clip(),
    })
    expect(third.status).toBe(200)
    expect(await third.json()).toMatchObject({ text: 'from session', translates: false })
    expect(used).toEqual([SERVER_KEY, KEY_A])
    await app.close()
  })
})
