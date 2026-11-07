import { describe, expect, it } from 'vitest'
import { buildWav } from '../src/lib/audio.ts'
import { SAMPLE_RATE } from '../src/lib/constants.ts'
import { opusModel } from '../server/opus.ts'
import { decodeWav, resampleFloat } from '../server/wav.ts'

describe('local translation plan', () => {
  it('routes Hindi and Telugu through the English OPUS models', () => {
    expect(opusModel('en', 'hi')).toEqual({ model: 'Xenova/opus-mt-en-hi' })
    expect(opusModel('hi', 'en')).toEqual({ model: 'Xenova/opus-mt-hi-en' })
    expect(opusModel('en', 'en')).toEqual({ model: '' })
    expect(opusModel('en', 'te')).toMatchObject({ error: expect.stringContaining('Telugu translation is not enabled') })
    expect(opusModel('fr', 'en')).toMatchObject({ error: expect.stringContaining('English, Hindi, and Telugu') })
  })
})

describe('wav decode', () => {
  it('reads the app wav writer and resamples toward 16 kHz', () => {
    const pcm = new Int16Array([0, 16000, -16000, 0])
    const decoded = decodeWav(Buffer.from(buildWav([pcm], SAMPLE_RATE)))
    expect(decoded?.rate).toBe(SAMPLE_RATE)
    expect(decoded && resampleFloat(decoded.samples, decoded.rate, 16_000).length).toBeGreaterThan(4)
  })
})
