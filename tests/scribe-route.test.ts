import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { buildWav } from '../src/lib/audio.ts'
import { createApp } from '../server/app.ts'
import { loadConfig } from '../server/config.ts'
import type { ScribeGateway } from '../server/scribe.ts'

function clip(): Buffer {
  return Buffer.from(buildWav([new Int16Array(6_000)], 12_000))
}

let dir = ''

async function boot(extra: NodeJS.ProcessEnv = {}, scribe?: ScribeGateway) {
  dir = await mkdtemp(path.join(tmpdir(), 'sanket-scribe-'))
  const app = createApp({
    config: loadConfig({
      ADMIN_TOKEN: 'admin-test',
      REVIEWER_TOKEN: 'reviewer-test',
      INGEST_TOKEN: 'ingest-test',
      DATA_DIR: dir,
      HOST: '127.0.0.1',
      ...extra,
    }),
    log: () => undefined,
    scribe,
  })
  await app.listen(0, '127.0.0.1')
  return { app, base: `http://127.0.0.1:${app.port()}` }
}

afterEach(async () => {
  if (dir) await rm(dir, { recursive: true, force: true })
})

describe('optional Scribe route', () => {
  it('names the missing server key and does not call ElevenLabs', async () => {
    let called = false
    const scribe: ScribeGateway = {
      convert: async () => {
        called = true
        return 'should not run'
      },
      realtimeToken: async () => {
        called = true
        return 'should-not-run'
      },
    }
    const { app, base } = await boot({}, scribe)
    const health = await fetch(`${base}/health`).then((response) => response.json()) as { providers: { scribe: { mode: string; detail: string } } }
    expect(health.providers.scribe.mode).toBe('unconfigured')
    expect(health.providers.scribe.detail).toContain('No server key')
    const response = await fetch(`${base}/api/speech/scribe`, {
      method: 'POST',
      headers: { 'x-cloud-consent': 'yes', 'x-language': 'te' },
      body: clip(),
    })
    const body = await response.json() as { message?: string; translates?: boolean; needsKey?: boolean }
    expect(response.status).toBe(409)
    expect(body.translates).toBe(false)
    expect(body.needsKey).toBe(true)
    expect(called).toBe(false)
    await app.close()
  })

  it('transcribes only after consent and does not present the result as a translation', async () => {
    const seen: string[] = []
    const scribe: ScribeGateway = {
      convert: async (_wav, language) => {
        seen.push(language)
        return 'practice desk'
      },
      realtimeToken: async () => 'short-lived-test-token',
    }
    const { app, base } = await boot({ ELEVENLABS_API_KEY: 'test-key-not-used' }, scribe)
    const denied = await fetch(`${base}/api/speech/scribe`, {
      method: 'POST',
      headers: { 'x-language': 'en' },
      body: clip(),
    })
    expect(denied.status).toBe(400)
    expect(seen).toEqual([])
    const accepted = await fetch(`${base}/api/speech/scribe`, {
      method: 'POST',
      headers: { 'x-cloud-consent': 'yes', 'x-language': 'en' },
      body: clip(),
    })
    const body = await accepted.json() as { text?: string; model?: string; translates?: boolean }
    expect(accepted.status).toBe(200)
    expect(body).toMatchObject({ text: 'practice desk', model: 'scribe_v2', translates: false })
    const token = await fetch(`${base}/api/speech/scribe-token`, {
      method: 'POST',
      headers: { authorization: 'Bearer ingest-test', 'x-cloud-consent': 'yes' },
    })
    const issued = await token.json() as { modelId?: string; token?: string; translates?: boolean }
    expect(token.status).toBe(200)
    expect(issued.modelId).toBe('scribe_v2_realtime')
    expect(issued.translates).toBe(false)
    expect(issued.token).toBe('short-lived-test-token')
    expect(JSON.stringify(body)).not.toContain('test-key-not-used')
    expect(JSON.stringify(issued)).not.toContain('test-key-not-used')
    await app.close()
  })
})
