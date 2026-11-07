import { spawnSync } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { applyLanguagePrefix } from '../../src/lib/marian-prefix.ts'
import { decodeWav, resampleFloat } from '../../server/wav.ts'

const enabled = process.env.LIVE_MT === '1'

describe.skipIf(!enabled)('installed browser models', () => {
  it('runs Whisper tiny on a real spoken clip and OPUS on Telugu, Hindi, and English', async () => {
    const { pipeline, env } = await import('@huggingface/transformers')
    env.cacheDir = process.env.MODEL_DIR || '/tmp/mt-cache'
    env.allowLocalModels = false
    const dir = await mkdtemp(path.join(tmpdir(), 'sanket-speech-'))
    const wavPath = path.join(dir, 'desk.wav')
    const spoken = spawnSync('espeak-ng', ['-v', 'en-us', '-w', wavPath, 'The desk is down the hall.'], { encoding: 'utf8' })
    expect(spoken.status).toBe(0)
    const decoded = decodeWav(await readFile(wavPath))
    expect(decoded).not.toBeNull()
    const audio = resampleFloat(decoded!.samples, decoded!.rate, 16_000)
    const asr = await pipeline('automatic-speech-recognition', 'onnx-community/whisper-tiny', { dtype: 'q8' })
    const heard = await asr(audio, { language: 'english', task: 'transcribe' })
    const transcript = (heard.text ?? '').trim()
    expect(transcript.length).toBeGreaterThan(0)
    expect(transcript.toLowerCase()).not.toContain('mock')

    const enhi = await pipeline('translation', 'Xenova/opus-mt-en-hi', { dtype: 'q8' })
    const hindi = await enhi('The desk is down the hall.')
    expect(hindi[0]?.translation_text ?? '').toMatch(/\p{Script=Devanagari}/u)

    const enmul = await pipeline('translation', 'Xenova/opus-mt-en-mul', { dtype: 'q8' })
    applyLanguagePrefix(enmul.tokenizer)
    const telugu = await enmul('>>tel<< The desk is down the hall.')
    const teluguText = telugu[0]?.translation_text ?? ''
    expect(teluguText).not.toContain('>>')
    expect(teluguText).toMatch(/\p{Script=Telugu}/u)

    const mulen = await pipeline('translation', 'Xenova/opus-mt-mul-en', { dtype: 'q8' })
    const english = await mulen('నమస్కారం. డెస్క్ హాల్ చివర ఉంది.')
    expect((english[0]?.translation_text ?? '').toLowerCase()).toMatch(/desk|hall/)
    await rm(dir, { recursive: true, force: true })
  }, 180_000)
})
