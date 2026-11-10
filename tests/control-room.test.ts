import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { encodeAudio } from '../src/lib/packets.ts'
import { translatePlan } from '../src/lib/server-caption.ts'
import { createApp } from '../server/app.ts'
import { CaptionQueue } from '../server/caption-queue.ts'
import { loadConfig } from '../server/config.ts'
import { LinesStore } from '../server/lines-store.ts'
import { RadioLog } from '../server/radio-log.ts'
import { RadioMonitor } from '../server/radio-monitor.ts'

let dir = ''

async function boot(extra: NodeJS.ProcessEnv = {}) {
  dir = await mkdtemp(path.join(tmpdir(), 'sanket-control-'))
  const app = createApp({
    config: loadConfig({
      ADMIN_TOKEN: 'admin-test',
      REVIEWER_TOKEN: 'reviewer-test',
      INGEST_TOKEN: 'ingest-test',
      DEMO_ACCESS_CODE: 'demo-test',
      DATA_DIR: dir,
      HOST: '127.0.0.1',
      ...extra,
    }),
    log: () => undefined,
  })
  await app.listen(0, '127.0.0.1')
  return { app, base: `http://127.0.0.1:${app.port()}` }
}

afterEach(async () => {
  if (dir) await rm(dir, { recursive: true, force: true })
})

describe('host split', () => {
  it('hides admin routes on the talk host and keeps a single host when the env is unset', async () => {
    const { app, base } = await boot({ PUBLIC_HOST: 'ptt.bowlinger.net', ADMIN_HOST: 'pttadmin.bowlinger.net' })
    const talk = await fetch(`${base}/api/control/lines`, { headers: { 'x-forwarded-host': 'ptt.bowlinger.net', authorization: 'Bearer admin-test' } })
    expect(talk.status).toBe(404)
    const admin = await fetch(`${base}/api/control/lines`, { headers: { 'x-forwarded-host': 'pttadmin.bowlinger.net', authorization: 'Bearer admin-test' } })
    expect(admin.status).toBe(200)
    const site = await fetch(`${base}/api/site`, { headers: { 'x-forwarded-host': 'ptt.bowlinger.net' } })
    expect(await site.json()).toMatchObject({ surface: 'talk', talkOrigin: 'https://ptt.bowlinger.net' })
    const unlock = await fetch(`${base}/api/demo/unlock`, {
      method: 'POST',
      headers: { 'x-forwarded-host': 'pttadmin.bowlinger.net', 'content-type': 'application/json' },
      body: JSON.stringify({ code: 'demo-test' }),
    })
    const cookie = unlock.headers.get('set-cookie') ?? ''
    expect(cookie).toContain('SameSite=Lax')
    expect(cookie.toLowerCase()).not.toContain('domain=')
    await app.close()
  })

  it('serves the control API on one host when PUBLIC_HOST is unset', async () => {
    const { app, base } = await boot()
    const site = await fetch(`${base}/api/site`)
    expect(await site.json()).toMatchObject({ surface: 'combined', talkOrigin: null })
    const denied = await fetch(`${base}/api/control/lines`)
    expect(denied.status).toBe(401)
    await app.close()
  })
})

describe('lines and log', () => {
  it('creates, renames, and removes a line, and refuses talk clients without admin auth', async () => {
    const { app, base } = await boot()
    const headers = { authorization: 'Bearer admin-test', 'content-type': 'application/json' }
    const created = await fetch(`${base}/api/control/lines`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ id: 'north-1', name: 'North', sourceLang: 'hi', targetLang: 'en' }),
    })
    expect(created.status).toBe(201)
    const renamed = await fetch(`${base}/api/control/lines/north-1`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ name: 'North desk', enabled: false }),
    })
    expect(await renamed.json()).toMatchObject({ name: 'North desk', enabled: false, topic: 'sanket-ptt/v1/north-1/' })
    const secret = 'scribe-key-should-not-leak'
    const saved = await fetch(`${base}/api/control/settings`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({ asrProvider: 'none', translateProvider: 'opus', elevenLabsFallback: true, elevenLabsApiKey: secret, retentionDays: 7 }),
    })
    const view = await saved.json() as { elevenLabsConfigured?: boolean; elevenLabsApiKey?: string }
    expect(view.elevenLabsConfigured).toBe(true)
    expect(JSON.stringify(view)).not.toContain(secret)
    const file = await readFile(path.join(dir, 'console', 'settings.json'), 'utf8')
    expect(file).toContain(secret)
    const listed = await fetch(`${base}/api/lines`).then((response) => response.json()) as { lines: Array<{ id: string }> }
    expect(listed.lines.some((line) => line.id === 'north-1')).toBe(false)
    await fetch(`${base}/api/control/lines/north-1`, { method: 'PATCH', headers, body: JSON.stringify({ enabled: true }) })
    const enabled = await fetch(`${base}/api/lines`).then((response) => response.json()) as { lines: Array<{ id: string }> }
    expect(enabled.lines.some((line) => line.id === 'north-1')).toBe(true)
    expect((await fetch(`${base}/api/control/lines/north-1`, { method: 'DELETE', headers })).status).toBe(200)
    await app.close()
  })

  it('stores a relayed clip from a background queue without blocking the relay', async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'sanket-radio-'))
    const lines = new LinesStore(path.join(dir, 'lines.json'), () => '2026-11-07T00:00:00.000Z')
    const log = new RadioLog(path.join(dir, 'radio'))
    let started = false
    let release: () => void = () => undefined
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const queue = new CaptionQueue<{ id: string }>(async (job) => {
      started = true
      await gate
      await log.add({
        id: job.id,
        lineId: 'sanket-1',
        lineName: 'SANKET-1',
        speakerId: 'aa01',
        speakerName: 'Unit',
        at: '2026-11-07T01:00:00.000Z',
        durationMs: 500,
        wav: Buffer.from('RIFFfake'),
        status: 'ready',
      })
      log.finish(job.id, { transcript: 'desk', translation: 'डेस्क', translationNote: 'Translated on the server.', status: 'ready' })
    })
    const monitor = new RadioMonitor(lines, () => queue.enqueue({ id: 'clip-1' }))
    const frame = encodeAudio('aa01', new Int16Array(4_000).fill(1000))
    expect(frame).not.toBeNull()
    const before = Date.now()
    monitor.ingest('sanket-ptt/v1/sanket-1/audio', frame!, before)
    monitor.sweep(before + 2_000)
    await Promise.resolve()
    expect(started).toBe(true)
    expect(log.query()).toHaveLength(0)
    release()
    await queue.drained()
    expect(log.query({ q: 'desk' })).toHaveLength(1)
    expect(log.toTxt()).toContain('IST')
    expect(log.toCsv()).toContain('desk')
    log.retain(1, Date.parse('2026-11-10T00:00:00.000Z'))
    expect(log.query()).toHaveLength(0)
  })
})

describe('server translation plan', () => {
  it('refuses to guess Telugu and translates English and Hindi only when enabled', () => {
    expect(translatePlan('te', 'en', true)).toMatchObject({ action: 'skip' })
    expect(translatePlan('en', 'te', true).action).toBe('skip')
    expect(translatePlan('en', 'hi', true)).toEqual({ action: 'translate' })
    expect(translatePlan('en', 'hi', false).action).toBe('skip')
    expect(translatePlan('hi', 'hi', true).action).toBe('skip')
  })
})
