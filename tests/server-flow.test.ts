import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createApp } from '../server/app.ts'
import { loadConfig } from '../server/config.ts'
import { hmacSha256 } from '../server/hash.ts'

const PHONE = '+91 40 2785 2210'
let clock = Date.parse('2026-11-07T12:00:00Z')
let dir = ''

async function boot(extra: NodeJS.ProcessEnv = {}) {
  dir = await mkdtemp(path.join(tmpdir(), 'sanket-'))
  const config = loadConfig({
    ADMIN_TOKEN: 'admin-test',
    REVIEWER_TOKEN: 'reviewer-test',
    INGEST_TOKEN: 'ingest-test',
    WEBHOOK_SECRET: 'hook-secret',
    DATA_DIR: dir,
    ASR_PROVIDER: 'mock',
    TTS_PROVIDER: 'mock',
    ALLOW_MOCK_PROVIDERS: '1',
    ...extra,
  })
  const app = createApp({
    config,
    now: () => clock,
    lookupImpl: async (host) => (host === 'example.com' ? ['93.184.216.34'] : ['127.0.0.1']),
    fetchImpl: async () => new Response('Fetched fact: gate code 0000', { status: 200, headers: { 'content-type': 'text/plain' } }),
    log: () => undefined,
  })
  await app.listen(0, '127.0.0.1')
  return { app, base: `http://127.0.0.1:${app.port()}` }
}

afterEach(async () => {
  if (dir) await rm(dir, { recursive: true, force: true })
})

function auth(token: string) {
  return { authorization: `Bearer ${token}`, 'content-type': 'application/json' }
}

describe('reference service', () => {
  it('answers only from the promoted version and keeps forwards as drafts', async () => {
    const { app, base } = await boot()
    const health = await fetch(`${base}/health`).then((response) => response.json())
    expect(health.reviewDefaults.reviewDue).toBeNull()
    expect(health.ingestion.mailbox).toBe('not_connected')
    expect(health.providers.asr.mode).toBe('mock')

    const denied = await fetch(`${base}/api/channels/sanket-1/proposals`, { method: 'POST', body: '{}' })
    expect(denied.status).toBe(401)
    const traversal = await fetch(`${base}/api/channels/..%2Fsecret/knowledge`, { headers: auth('admin-test') })
    expect(traversal.status).toBe(400)

    await fetch(`${base}/api/channels/sanket-1/proposals`, {
      method: 'POST',
      headers: auth('admin-test'),
      body: JSON.stringify({ origin: 'admin-text', text: `Help desk phone: ${PHONE}`, mode: 'replace' }),
    })
    const pending = await fetch(`${base}/api/channels/sanket-1/ask`, {
      method: 'POST',
      headers: auth('ingest-test'),
      body: JSON.stringify({ text: 'what is the help desk phone?', speakerId: 'unit-a' }),
    }).then((response) => response.json())
    expect(pending.action).toBe('unavailable')
    expect(JSON.stringify(pending)).not.toContain(PHONE)

    const window = await fetch(`${base}/api/channels/sanket-1/review-window`, {
      method: 'POST',
      headers: auth('admin-test'),
      body: JSON.stringify({ reviewIntervalDays: 30 }),
    })
    expect(window.status).toBe(400)

    await fetch(`${base}/api/channels/sanket-1/reviewer`, {
      method: 'POST',
      headers: auth('admin-test'),
      body: JSON.stringify({ name: 'Watch commander' }),
    })
    const knowledge = await fetch(`${base}/api/channels/sanket-1/knowledge`, { headers: auth('reviewer-test') }).then((response) => response.json())
    const proposalId = knowledge.proposals[0].id as string
    const adminPromote = await fetch(`${base}/api/channels/sanket-1/proposals/${proposalId}/promote`, {
      method: 'POST',
      headers: auth('admin-test'),
      body: '{}',
    })
    expect(adminPromote.status).toBe(401)
    const promoted = await fetch(`${base}/api/channels/sanket-1/proposals/${proposalId}/promote`, {
      method: 'POST',
      headers: auth('reviewer-test'),
      body: JSON.stringify({ validUntil: new Date(clock + 3_600_000).toISOString(), reviewDue: null }),
    })
    expect(promoted.status).toBe(200)

    const answer = await fetch(`${base}/api/channels/sanket-1/ask`, {
      method: 'POST',
      headers: auth('ingest-test'),
      body: JSON.stringify({ text: 'what is the help desk phone?', speakerId: 'unit-a' }),
    }).then((response) => response.json())
    expect(answer.action).toBe('answer')
    expect(answer.text).toContain(PHONE)
    expect(answer.version).toBe(1)
    expect(app.relay.sent.some((item) => item.text.includes(PHONE))).toBe(true)

    const forwarded = await fetch(`${base}/api/channels/sanket-1/proposals`, {
      method: 'POST',
      headers: auth('admin-test'),
      body: JSON.stringify({
        origin: 'forward',
        messageKey: 'msg-1',
        speaker: 'Unit-A',
        eventAt: new Date(clock).toISOString(),
        transcript: 'Temporary gate code 9999',
        actor: 'operator',
      }),
    }).then((response) => response.json())
    expect(forwarded.status).toBe('created')
    const duplicate = await fetch(`${base}/api/channels/sanket-1/proposals`, {
      method: 'POST',
      headers: auth('admin-test'),
      body: JSON.stringify({
        origin: 'forward',
        messageKey: 'msg-1',
        speaker: 'Unit-A',
        eventAt: new Date(clock).toISOString(),
        transcript: 'Temporary gate code 9999',
      }),
    })
    expect(duplicate.status).toBe(409)
    const filed = await fetch(`${base}/api/channels/sanket-1/knowledge`, { headers: auth('admin-test') }).then((response) => response.json())
    expect(filed.text).toContain(PHONE)
    expect(filed.text).not.toContain('9999')
    expect(filed.validUntil).toBe(new Date(clock + 3_600_000).toISOString())
    expect(filed.proposals.some((item: { provenance?: { origin?: string; transcript?: string } }) => item.provenance?.origin === 'forward' && item.provenance.transcript === 'Temporary gate code 9999')).toBe(true)

    const voice = await fetch(`${base}/api/channels/sanket-1/proposals`, {
      method: 'POST',
      headers: auth('admin-test'),
      body: JSON.stringify({ origin: 'voice', asrTranscript: '154.725', text: '15A.72S', transcriptConfirmed: false }),
    })
    expect(voice.status).toBe(400)
    const voiceOk = await fetch(`${base}/api/channels/sanket-1/proposals`, {
      method: 'POST',
      headers: auth('admin-test'),
      body: JSON.stringify({ origin: 'voice', asrTranscript: '154.725', text: '15A.72S', transcriptConfirmed: true, inferDigits: true }),
    })
    expect(voiceOk.status).toBe(400)

    const audio = await fetch(`${base}/api/channels/sanket-1/audio`, {
      method: 'POST',
      headers: { authorization: 'Bearer ingest-test', 'x-test-transcript': 'what is the help desk phone?', 'x-speaker-id': 'unit-a' },
      body: Buffer.from('not-real-audio'),
    }).then((response) => response.json())
    expect(audio.drafted).toBe(false)
    expect(audio.transcript).toContain('help desk')

    clock += 3_600_001
    const expired = await fetch(`${base}/api/channels/sanket-1/ask`, {
      method: 'POST',
      headers: auth('ingest-test'),
      body: JSON.stringify({ text: 'where is the help desk phone?', speakerId: 'unit-c' }),
    }).then((response) => response.json())
    expect(expired.action).toBe('unavailable')
    expect(JSON.stringify(expired)).not.toContain(PHONE)
    await app.close()
  })

  it('accepts a signed webhook and rejects a private fetch URL', async () => {
    const { app, base } = await boot()
    const payload = Buffer.from(JSON.stringify({
      channel: 'sanket-1',
      externalId: 'evt-1',
      eventAt: new Date(clock).toISOString(),
      text: 'Gate note from the webhook',
      sourceLabel: 'watch desk',
      sourceService: 'desk',
    }))
    const bad = await fetch(`${base}/api/ingest/webhook`, { method: 'POST', body: payload })
    expect(bad.status).toBe(401)
    const ok = await fetch(`${base}/api/ingest/webhook`, {
      method: 'POST',
      headers: { 'x-sanket-signature': hmacSha256('hook-secret', payload) },
      body: payload,
    })
    expect(ok.status).toBe(201)
    const loop = await fetch(`${base}/api/ingest/webhook`, {
      method: 'POST',
      headers: { 'x-sanket-signature': hmacSha256('hook-secret', Buffer.from('{"sourceService":"sanket-ptt","channel":"sanket-1","text":"x"}')) },
      body: '{"sourceService":"sanket-ptt","channel":"sanket-1","text":"x"}',
    })
    expect(loop.status).toBe(409)
    const source = await fetch(`${base}/api/channels/sanket-1/sources`, {
      method: 'POST',
      headers: auth('admin-test'),
      body: JSON.stringify({ name: 'local', url: 'http://127.0.0.1/secret.txt', everyMinutes: null }),
    })
    expect(source.status).toBe(400)
    const file = await fetch(`${base}/api/channels/sanket-1/proposals/file`, {
      method: 'POST',
      headers: { authorization: 'Bearer admin-test', 'x-filename': 'notes.pdf' },
      body: '%PDF',
    })
    expect(file.status).toBe(415)
    await app.close()
  })

  it('reports an unconfigured recognizer instead of a fake transcript', async () => {
    const { app, base } = await boot({ ASR_PROVIDER: 'none', ALLOW_MOCK_PROVIDERS: '0', TTS_PROVIDER: 'none' })
    const health = await fetch(`${base}/health`).then((response) => response.json())
    expect(health.providers.asr.mode).toBe('unconfigured')
    expect(health.providers.tts.mode).toBe('unconfigured')
    const response = await fetch(`${base}/api/transcribe`, {
      method: 'POST',
      headers: auth('ingest-test'),
      body: Buffer.from('x'),
    })
    expect(response.status).toBe(503)
    await app.close()
  })
})
