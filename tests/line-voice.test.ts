import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import nodePath from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { ASR_WARNING, KEY_MISSING, VOICE_WARNING, elevenLabsSelectable, latestProviderWarning, voiceBadge } from '../src/lib/voice-choice.ts'
import { createApp } from '../server/app.ts'
import { loadConfig } from '../server/config.ts'
import { testElevenLabsKey } from '../server/elevenlabs-voice.ts'
import { recognizeForLine, speakForLine } from '../server/line-voice.ts'
import { processRadioClip } from '../server/radio-processor.ts'

const dirs: string[] = []

async function boot(extra: NodeJS.ProcessEnv = {}, fetchImpl?: typeof fetch, prepare?: (dataDir: string) => Promise<void>) {
  const dataDir = await mkdtemp(nodePath.join(tmpdir(), 'sanket-voice-'))
  dirs.push(dataDir)
  if (prepare) await prepare(dataDir)
  const logs: string[] = []
  const app = createApp({
    config: loadConfig({
      ADMIN_TOKEN: 'admin-test',
      REVIEWER_TOKEN: 'reviewer-test',
      INGEST_TOKEN: 'ingest-test',
      DATA_DIR: dataDir,
      HOST: '127.0.0.1',
      PUBLIC_HOST: 'ptt.bowlinger.net',
      ADMIN_HOST: 'pttadmin.bowlinger.net',
      ...extra,
    }),
    log: (line) => logs.push(line),
    fetchImpl,
  })
  await app.listen(0, '127.0.0.1')
  return { app, base: `http://127.0.0.1:${app.port()}`, logs, dataDir }
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((item) => rm(item, { recursive: true, force: true })))
})

const admin = {
  authorization: 'Bearer admin-test',
  'content-type': 'application/json',
  'x-forwarded-host': 'pttadmin.bowlinger.net',
}

describe('line voice choice', () => {
  it('defaults every new and existing line to free', async () => {
    const { app, base } = await boot({}, undefined, async (dataDir) => {
      await mkdir(nodePath.join(dataDir, 'console'), { recursive: true })
      await writeFile(nodePath.join(dataDir, 'console', 'lines.json'), JSON.stringify([
        { id: 'old-desk', name: 'Old desk', enabled: true, sourceLang: 'te', targetLang: 'en', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' },
      ]))
    })
    const listed = await fetch(`${base}/api/control/lines`, { headers: admin }).then((response) => response.json()) as { lines: Array<{ id: string; ttsProvider: string; asrProvider: string }> }
    expect(listed.lines.find((line) => line.id === 'old-desk')).toMatchObject({ ttsProvider: 'free', asrProvider: 'free' })
    const created = await fetch(`${base}/api/control/lines`, {
      method: 'POST',
      headers: admin,
      body: JSON.stringify({ id: 'gate', name: 'Gate', sourceLang: 'en', targetLang: 'hi' }),
    })
    expect(await created.json()).toMatchObject({ ttsProvider: 'free', asrProvider: 'free' })
    await app.close()
  })

  it('keeps the server key out of every response, the database, and the log', async () => {
    const secret = 'el-server-key-must-not-leak'
    const { app, base, logs, dataDir } = await boot({ ELEVENLABS_API_KEY: secret }, undefined, async (folder) => {
      await mkdir(nodePath.join(folder, 'console'), { recursive: true })
      await writeFile(nodePath.join(folder, 'console', 'settings.json'), JSON.stringify({
        asrProvider: 'none',
        translateProvider: 'none',
        elevenLabsFallback: false,
        elevenLabsApiKey: 'stored-key-must-be-removed',
        retentionDays: 14,
      }))
    })
    const created = await fetch(`${base}/api/control/lines`, {
      method: 'POST',
      headers: admin,
      body: JSON.stringify({ id: 'north', name: 'North', sourceLang: 'te', targetLang: 'en', elevenLabsApiKey: secret, ttsProvider: 'elevenlabs', asrProvider: 'free' }),
    })
    const line = await created.json()
    const saved = await fetch(`${base}/api/control/settings`, {
      method: 'PUT',
      headers: admin,
      body: JSON.stringify({ asrProvider: 'none', translateProvider: 'none', elevenLabsFallback: false, elevenLabsApiKey: secret, retentionDays: 9 }),
    })
    const settings = await saved.json()
    const bodies = [JSON.stringify(line), JSON.stringify(settings)]
    for (const route of ['/api/control/lines', '/api/control/live', '/api/control/settings', '/api/lines', '/health']) {
      bodies.push(await fetch(`${base}${route}`, { headers: admin }).then((response) => response.text()))
    }
    const talk = await fetch(`${base}/api/control/elevenlabs/test`, { method: 'POST', headers: { ...admin, 'x-forwarded-host': 'ptt.bowlinger.net' } })
    expect(talk.status).toBe(404)
    const disk = await readFile(nodePath.join(dataDir, 'console', 'settings.json'), 'utf8')
    const linesFile = await readFile(nodePath.join(dataDir, 'console', 'lines.json'), 'utf8')
    const joined = [...bodies, disk, linesFile, logs.join('\n')].join('\n')
    expect(joined).not.toContain(secret)
    expect(joined).not.toContain('stored-key-must-be-removed')
    expect(settings).toMatchObject({ elevenLabsConfigured: true })
    expect(settings).not.toHaveProperty('elevenLabsApiKey')
    expect(line).toMatchObject({ ttsProvider: 'elevenlabs', asrProvider: 'free' })
    await app.close()
  })

  it('disables ElevenLabs when the server key is missing and tests the key without returning it', async () => {
    expect(elevenLabsSelectable(false)).toEqual({ disabled: true, hint: KEY_MISSING })
    expect(elevenLabsSelectable(true)).toEqual({ disabled: false, hint: null })
    expect(voiceBadge(undefined)).toBe('Free')
    expect(voiceBadge('elevenlabs')).toBe('ElevenLabs')
    expect(latestProviderWarning([{ lineId: 'north', text: VOICE_WARNING }, { lineId: 'south', text: 'Unit is online' }], 'north')).toBe(VOICE_WARNING)

    const missing = await boot()
    const denied = await fetch(`${missing.base}/api/control/elevenlabs/test`, { method: 'POST', headers: admin })
    expect(await denied.json()).toEqual({ ok: false, message: KEY_MISSING })
    await missing.app.close()

    const secret = 'el-test-key-stays-on-the-server'
    let seenHeader = ''
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      seenHeader = new Headers(init?.headers).get('xi-api-key') ?? ''
      expect(String(url)).toBe('https://api.elevenlabs.io/v1/user')
      expect(String(url)).not.toContain(secret)
      return new Response('{}', { status: 200 })
    }) as typeof fetch
    const ready = await boot({ ELEVENLABS_API_KEY: secret }, fetchImpl)
    const checked = await fetch(`${ready.base}/api/control/elevenlabs/test`, { method: 'POST', headers: admin })
    const body = await checked.json() as { ok?: boolean; message?: string }
    expect(body).toEqual({ ok: true })
    expect(JSON.stringify(body)).not.toContain(secret)
    expect(seenHeader).toBe(secret)
    await ready.app.close()
  })

  it('falls back to the free recognizer and the free voice when ElevenLabs fails', async () => {
    const secret = 'el-fallback-key'
    let scribeSaw = ''
    const heard = await recognizeForLine({
      choice: 'elevenlabs',
      apiKey: secret,
      wav: Buffer.from('wav'),
      language: 'en',
      scribe: async (apiKey) => {
        scribeSaw = apiKey
        throw new Error(`quota exceeded for ${apiKey}`)
      },
      local: async () => ({ transcript: 'desk clear', note: null, status: 'ready' }),
    })
    expect(scribeSaw).toBe(secret)
    expect(heard).toMatchObject({ transcript: 'desk clear', warning: ASR_WARNING })
    expect(JSON.stringify(heard)).not.toContain(secret)

    const freeOnly = await recognizeForLine({
      choice: 'free',
      apiKey: secret,
      wav: Buffer.from('wav'),
      language: 'en',
      scribe: async () => {
        throw new Error('should not run')
      },
      local: async () => ({ transcript: 'local only', note: null, status: 'ready' }),
    })
    expect(freeOnly).toMatchObject({ transcript: 'local only', warning: null })

    const spoken = await speakForLine({
      choice: 'elevenlabs',
      apiKey: secret,
      text: 'desk clear',
      eleven: async () => null,
      free: async () => new Int16Array([1, 2, 3]),
    })
    expect(spoken.warning).toBe(VOICE_WARNING)
    expect(spoken.pcm).toEqual(new Int16Array([1, 2, 3]))

    const clip = await processRadioClip({
      wav: Buffer.from('RIFFxxxx'),
      source: 'en',
      target: 'en',
      settings: { asrProvider: 'none', translateProvider: 'none', elevenLabsFallback: false, retentionDays: 14 },
      config: loadConfig({}),
      asrProvider: 'elevenlabs',
      elevenLabsKey: secret,
      scribe: async () => {
        throw new Error(`bad key ${secret}`)
      },
    })
    expect(clip.voiceWarning).toBe(ASR_WARNING)
    expect(clip.transcript).toBeNull()
    expect(JSON.stringify(clip)).not.toContain(secret)

    const check = await testElevenLabsKey(secret, (async () => new Response('', { status: 401 })) as typeof fetch)
    expect(check).toEqual({ ok: false, message: 'ElevenLabs returned 401.' })
    expect(JSON.stringify(check)).not.toContain(secret)
  })
})
