import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createApp } from '../server/app.ts'
import { loadConfig } from '../server/config.ts'
import { openSecret, sealSecret } from '../server/secret-box.ts'
import { transcribeCloud } from '../server/stt/adapters.ts'
import { parseStt, publicStt, resolveStt, sttWarning } from '../src/lib/stt.ts'

let dir = ''

afterEach(async () => {
  if (dir) await rm(dir, { recursive: true, force: true })
})

describe('speech providers', () => {
  it('uses the line choice, then the server default, and never publishes a key', () => {
    expect(resolveStt('inherit', 'openai')).toBe('openai')
    expect(resolveStt('free', 'openai')).toBe('free')
    expect(resolveStt('nope', 'deepgram')).toBe('free')
    expect(resolveStt('azure', 'free')).toBe('azure')
    expect(parseStt('google', 'free')).toBe('google')
    const secret = 'sk-this-must-not-leak'
    const view = publicStt({ defaultProvider: 'openai', configured: ['openai'], localEngine: false })
    expect(view.defaultProvider).toBe('openai')
    expect(view.providers.find((item) => item.id === 'openai')).toMatchObject({ configured: true, needsKey: true })
    expect(view.providers.find((item) => item.id === 'free')).toMatchObject({ configured: false })
    expect(JSON.stringify(view)).not.toContain(secret)
    expect(sttWarning('openai')).toContain('used free recognition')
  })

  it('encrypts a provider key and the control API does not return it', async () => {
    const secret = 'sk-live-openai-key'
    const sealed = sealSecret(secret, 'test-secret')
    expect(JSON.stringify(sealed)).not.toContain(secret)
    expect(openSecret(sealed, 'test-secret')).toBe(secret)

    dir = await mkdtemp(path.join(tmpdir(), 'sanket-stt-'))
    const app = createApp({
      config: loadConfig({
        ADMIN_TOKEN: 'admin-test',
        REVIEWER_TOKEN: 'reviewer-test',
        INGEST_TOKEN: 'ingest-test',
        DATA_DIR: dir,
        HOST: '127.0.0.1',
        SECRETS_KEY: 'test-secret',
        ASR_PROVIDER: 'none',
      }),
      log: () => undefined,
    })
    await app.listen(0, '127.0.0.1')
    const base = `http://127.0.0.1:${app.port()}`
    const headers = { authorization: 'Bearer admin-test', 'content-type': 'application/json' }
    const saved = await fetch(`${base}/api/control/stt`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({ defaultProvider: 'openai', provider: 'openai', key: secret }),
    })
    const body = await saved.json() as { defaultProvider?: string; providers?: Array<{ id: string; configured: boolean }> }
    expect(body.defaultProvider).toBe('openai')
    expect(body.providers?.find((item) => item.id === 'openai')?.configured).toBe(true)
    const packed = JSON.stringify(body)
    expect(packed).not.toContain(secret)
    const file = await readFile(path.join(dir, 'console', 'stt-secrets.json'), 'utf8')
    expect(file).not.toContain(secret)
    const settings = await readFile(path.join(dir, 'console', 'settings.json'), 'utf8')
    expect(settings).not.toContain(secret)

    const created = await fetch(`${base}/api/control/lines/sanket-1/devices`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ name: 'Gate speaker', listenOnly: true }),
    })
    const device = await created.json() as { id: string; listenOnly?: boolean; token?: string }
    expect(created.status).toBe(201)
    expect(device.listenOnly).toBe(true)
    const devicesFile = await readFile(path.join(dir, 'console', 'devices.json'), 'utf8')
    expect(devicesFile).toContain('"listenOnly": true')
    expect(devicesFile).not.toContain(device.token)
    await app.close()
  })

  it('selects the OpenAI adapter and hides the key when the call fails', async () => {
    const secret = 'sk-adapter-key'
    let seen = ''
    await expect(transcribeCloud({
      provider: 'openai',
      wav: Buffer.from('RIFFxxxx'),
      language: 'en',
      key: secret,
      fetchImpl: (async (url, init) => {
        seen = String(url)
        const header = new Headers(init?.headers).get('authorization') ?? ''
        expect(header).toBe(`Bearer ${secret}`)
        return new Response(JSON.stringify({ error: secret }), { status: 401 })
      }) as typeof fetch,
    })).rejects.toThrow('Speech provider returned 401.')
    expect(seen).toBe('https://api.openai.com/v1/audio/transcriptions')
    try {
      await transcribeCloud({
        provider: 'openai',
        wav: Buffer.from('RIFFxxxx'),
        language: 'en',
        key: secret,
        fetchImpl: (async () => new Response('no', { status: 500 })) as typeof fetch,
      })
    } catch (error) {
      expect(String(error)).not.toContain(secret)
    }
  })
})
