import { env, pipeline } from '@huggingface/transformers'
import { opusModel } from './opus.ts'
import { decodeWav, resampleFloat } from './wav.ts'

const WHISPER_LANGUAGE: Record<string, string> = { en: 'english', hi: 'hindi', te: 'telugu' }

type Transcriber = (audio: Float32Array, options: { language: string; task: string }) => Promise<{ text?: string }>
type Translator = (text: string) => Promise<Array<{ translation_text?: string }>>

let cacheDir = ''
let whisperKey = ''
let whisperPromise: Promise<Transcriber> | null = null
const translators = new Map<string, Promise<Translator>>()

function useCache(dir: string) {
  if (cacheDir === dir) return
  cacheDir = dir
  env.cacheDir = dir
  whisperPromise = null
  whisperKey = ''
  translators.clear()
}

export async function transcribeWithWhisper(options: {
  wav: Buffer
  language: string
  model: string
  cacheDir: string
}): Promise<{ text: string } | { error: string; message: string }> {
  const decoded = decodeWav(options.wav)
  if (!decoded) return { error: 'asr_failed', message: 'Server recognition accepts a 16-bit PCM WAV file.' }
  const audio = resampleFloat(decoded.samples, decoded.rate, 16_000)
  if (audio.length < 1_600) return { error: 'asr_failed', message: 'The clip is shorter than one tenth of a second.' }
  useCache(options.cacheDir)
  try {
    if (!whisperPromise || whisperKey !== options.model) {
      whisperKey = options.model
      whisperPromise = pipeline('automatic-speech-recognition', options.model, { dtype: 'q8' }) as Promise<Transcriber>
    }
    const transcriber = await whisperPromise
    const language = WHISPER_LANGUAGE[options.language] ?? options.language
    const result = await transcriber(audio, { language, task: 'transcribe' })
    const text = (result.text ?? '').replace(/\s+/g, ' ').trim()
    if (!text) return { error: 'asr_failed', message: 'Whisper returned no text.' }
    return { text }
  } catch (error) {
    whisperPromise = null
    const message = error instanceof Error ? error.message : 'Whisper failed'
    return { error: 'asr_failed', message: message.slice(0, 300) }
  }
}

export async function translateWithOpus(options: {
  text: string
  source: string
  target: string
  models?: Partial<Record<string, string>>
  cacheDir: string
}): Promise<{ text: string; provider: string; mode: 'live' } | { error: string; message: string }> {
  if (options.source === options.target) return { text: options.text, provider: 'identity', mode: 'live' }
  const route = opusModel(options.source, options.target, options.models)
  if ('error' in route) return { error: 'translation_unsupported', message: route.error }
  useCache(options.cacheDir)
  try {
    const translator = await translatorFor(route.model)
    const output = await translator(options.text.trim())
    const text = output[0]?.translation_text?.replace(/\s+/g, ' ').trim()
    if (!text) return { error: 'translation_failed', message: `The ${route.model} model returned no text.` }
    return { text, provider: 'opus', mode: 'live' }
  } catch (error) {
    translators.delete(route.model)
    const message = error instanceof Error ? error.message : 'Translation model failed'
    return { error: 'translation_failed', message: message.slice(0, 300) }
  }
}

function translatorFor(model: string): Promise<Translator> {
  let pending = translators.get(model)
  if (!pending) {
    pending = pipeline('translation', model, { dtype: 'q8' }) as Promise<Translator>
    pending.catch(() => translators.delete(model))
    translators.set(model, pending)
  }
  return pending
}

export function localProviderDetail(kind: 'whisper' | 'opus', cached: boolean): string {
  if (kind === 'whisper') {
    return cached
      ? 'Local Whisper tiny is cached in MODEL_DIR.'
      : 'Local Whisper tiny downloads into MODEL_DIR on the first clip.'
  }
  return cached
    ? 'Local English-Hindi OPUS models are cached in MODEL_DIR. Telugu translation is refused because the multilingual model token is unreliable here.'
    : 'Local English-Hindi OPUS models download into MODEL_DIR on the first translation. Telugu translation is refused rather than guessed.'
}
