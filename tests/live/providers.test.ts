import { execFileSync } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildWav } from '../../src/lib/audio.ts'
import { decodeAudio } from '../../src/lib/packets.ts'
import { createApp } from '../../server/app.ts'
import { loadConfig } from '../../server/config.ts'

const enabled = process.env.LIVE_PROVIDERS === '1'
const PHONE = '0000'

describe.skipIf(!enabled)('installed local providers', () => {
  it('recognizes a short clip, answers from the approved file, speaks, and translates', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'sanket-live-'))
    const wavPath = path.join(dir, 'question.wav')
    execFileSync('espeak-ng', ['-s', '120', '-w', wavPath, 'Where is the practice desk?'])
    const wav = await readFile(wavPath)
    const config = loadConfig({
      ADMIN_TOKEN: 'admin-test',
      REVIEWER_TOKEN: 'reviewer-test',
      INGEST_TOKEN: 'ingest-test',
      DATA_DIR: dir,
      MODEL_DIR: '/tmp/hf-models',
      ASR_PROVIDER: 'transformers',
      TRANSLATE_PROVIDER: 'opus',
      TTS_PROVIDER: 'espeak',
      HOST: '127.0.0.1',
    })
    const app = createApp({ config, log: () => undefined })
    await app.listen(0, '127.0.0.1')
    const base = `http://127.0.0.1:${app.port()}`
    const admin = { authorization: 'Bearer admin-test', 'content-type': 'application/json' }
    const reviewer = { authorization: 'Bearer reviewer-test', 'content-type': 'application/json' }
    try {
      await fetch(`${base}/api/channels/drill-1/reviewer`, { method: 'POST', headers: admin, body: JSON.stringify({ name: 'Example commander' }) })
      await fetch(`${base}/api/channels/drill-1/proposals`, {
        method: 'POST',
        headers: admin,
        body: JSON.stringify({ origin: 'admin-text', mode: 'replace', text: `The practice desk code is ${PHONE}.` }),
      })
      const knowledge = await fetch(`${base}/api/channels/drill-1/knowledge`, { headers: reviewer }).then((response) => response.json())
      const proposalId = knowledge.proposals[0].id as string
      const promoted = await fetch(`${base}/api/channels/drill-1/proposals/${proposalId}/promote`, {
        method: 'POST',
        headers: reviewer,
        body: '{}',
      })
      expect(promoted.status).toBe(200)

      const audio = await fetch(`${base}/api/channels/drill-1/audio`, {
        method: 'POST',
        headers: { authorization: 'Bearer ingest-test', 'content-type': 'audio/wav', 'x-language': 'en', 'x-speaker-id': 'example-unit' },
        body: wav,
      })
      const body = (await audio.json()) as { transcript?: string; decision?: { action?: string; text?: string }; message?: string; error?: string }
      console.log(JSON.stringify({ http: audio.status, body }))
      expect(audio.status, JSON.stringify(body)).toBe(200)
      expect(body.transcript && body.transcript.length > 0).toBe(true)
      expect(body.decision?.action).toBe('answer')
      expect(body.decision?.text).toContain(PHONE)
      const frames = app.relay.audioFrames.map((frame) => decodeAudio(frame)?.pcm.length ?? 0)
      const samples = frames.reduce((sum, count) => sum + count, 0)
      expect(samples).toBeGreaterThan(4_000)
      const pcm = concatAudio(app.relay.audioFrames)
      await writeFile('/opt/cursor/artifacts/assistant-reply.wav', wavFromPcm(pcm, 12_000))

      const translated = await fetch(`${base}/api/translate`, {
        method: 'POST',
        headers: { authorization: 'Bearer ingest-test', 'content-type': 'application/json' },
        body: JSON.stringify({ text: 'practice desk', source: 'en', target: 'hi' }),
      })
      const translation = (await translated.json()) as { text?: string; provider?: string; message?: string }
      expect(translated.status, JSON.stringify(translation)).toBe(200)
      expect(translation.provider).toBe('opus')
      expect(translation.text).not.toBe('practice desk')
      expect(translation.text).toMatch(/\p{Script=Devanagari}/u)
      const telugu = await fetch(`${base}/api/translate`, {
        method: 'POST',
        headers: { authorization: 'Bearer ingest-test', 'content-type': 'application/json' },
        body: JSON.stringify({ text: 'practice desk', source: 'en', target: 'te' }),
      })
      const teluguBody = (await telugu.json()) as { error?: string; message?: string }
      expect(telugu.status).toBe(503)
      expect(teluguBody.message ?? '').toMatch(/Telugu translation is not enabled/)
      const evidence = { transcript: body.transcript, answer: body.decision?.text, samples, hindi: translation.text, telugu: teluguBody.message }
      await writeFile('/tmp/live-result.json', JSON.stringify(evidence, null, 2))
      console.log(JSON.stringify(evidence))
    } finally {
      await app.close()
      await rm(dir, { recursive: true, force: true })
    }
  }, 600_000)
})

function concatAudio(frames: Uint8Array[]): Int16Array {
  const parts = frames.map((frame) => decodeAudio(frame)?.pcm).filter((pcm): pcm is Int16Array => !!pcm)
  const total = parts.reduce((sum, pcm) => sum + pcm.length, 0)
  const out = new Int16Array(total)
  let offset = 0
  for (const pcm of parts) {
    out.set(pcm, offset)
    offset += pcm.length
  }
  return out
}

function wavFromPcm(pcm: Int16Array, rate: number): Buffer {
  return Buffer.from(buildWav([pcm], rate))
}
