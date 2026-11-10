import type { LineLang } from '../src/lib/lines.ts'
import { translatePlan } from '../src/lib/server-caption.ts'
import type { VoiceChoice } from '../src/lib/voice-choice.ts'
import type { Config } from './config.ts'
import type { ConsoleSettings } from './console-settings.ts'
import { recognizeForLine } from './line-voice.ts'
import { publicScribeError } from './scribe-session.ts'

export type CaptionResult = {
  transcript: string | null
  translation: string | null
  translationNote: string | null
  status: 'ready' | 'unconfigured' | 'failed'
  voiceWarning: string | null
}

export async function processRadioClip(input: {
  wav: Buffer
  source: LineLang
  target: LineLang
  settings: ConsoleSettings
  config: Config
  asrProvider?: VoiceChoice
  elevenLabsKey?: string | null
  scribe?: (apiKey: string, wav: Buffer, language: string) => Promise<string>
}): Promise<CaptionResult> {
  const heard = await recognize(input)
  if (!heard.transcript) {
    return { transcript: null, translation: null, translationNote: heard.note, status: heard.status, voiceWarning: heard.warning }
  }
  const plan = translatePlan(input.source, input.target, input.settings.translateProvider === 'opus')
  if (plan.action === 'skip') {
    return { transcript: heard.transcript, translation: null, translationNote: plan.note, status: 'ready', voiceWarning: heard.warning }
  }
  try {
    const runtime = await import('./local-runtime.ts')
    const translated = await runtime.translateWithOpus({
      text: heard.transcript,
      source: input.source,
      target: input.target,
      models: { 'en-hi': input.config.translateModelEnHi, 'hi-en': input.config.translateModelHiEn },
      cacheDir: input.config.modelDir,
    })
    if ('error' in translated) {
      return { transcript: heard.transcript, translation: null, translationNote: translated.message, status: 'ready', voiceWarning: heard.warning }
    }
    return { transcript: heard.transcript, translation: translated.text, translationNote: 'Translated on the server.', status: 'ready', voiceWarning: heard.warning }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Translation failed'
    return { transcript: heard.transcript, translation: null, translationNote: message.slice(0, 180), status: 'ready', voiceWarning: heard.warning }
  }
}

async function recognize(input: {
  wav: Buffer
  source: LineLang
  settings: ConsoleSettings
  config: Config
  asrProvider?: VoiceChoice
  elevenLabsKey?: string | null
  scribe?: (apiKey: string, wav: Buffer, language: string) => Promise<string>
}): Promise<{ transcript: string | null; note: string | null; status: 'ready' | 'unconfigured' | 'failed'; warning: string | null }> {
  const choice = input.asrProvider === 'elevenlabs' ? 'elevenlabs' : 'free'
  const heard = await recognizeForLine({
    choice,
    apiKey: input.elevenLabsKey ?? null,
    wav: input.wav,
    language: input.source,
    scribe: input.scribe,
    local: () => primaryTranscript(input),
  })
  if (heard.transcript || choice === 'elevenlabs') return heard
  const key = input.elevenLabsKey ?? null
  if (input.settings.elevenLabsFallback && key && input.scribe) {
    try {
      const text = (await input.scribe(key, input.wav, input.source)).trim()
      if (text) return { transcript: text, note: 'Transcribed by Scribe after the local recognizer failed.', status: 'ready', warning: null }
    } catch (error) {
      const failure = publicScribeError(error, key)
      return { transcript: null, note: failure.message, status: 'failed', warning: null }
    }
  }
  return heard
}

async function primaryTranscript(input: {
  wav: Buffer
  source: LineLang
  settings: ConsoleSettings
  config: Config
}): Promise<{ transcript: string | null; note: string | null; status: 'ready' | 'unconfigured' | 'failed' }> {
  if (input.settings.asrProvider === 'none') {
    return { transcript: null, note: 'Server speech recognition is off. Turn it on in the control room.', status: 'unconfigured' }
  }
  if (input.settings.asrProvider === 'mock') {
    if (!input.config.allowMock) return { transcript: null, note: 'Mock recognition is not enabled on this server.', status: 'unconfigured' }
    return { transcript: null, note: 'Mock recognition does not invent a radio transcript.', status: 'unconfigured' }
  }
  try {
    if (input.settings.asrProvider === 'transformers') {
      const runtime = await import('./local-runtime.ts')
      const result = await runtime.transcribeWithWhisper({
        wav: input.wav,
        language: input.source,
        model: input.config.asrModel,
        cacheDir: input.config.modelDir,
      })
      if ('error' in result) return { transcript: null, note: result.message, status: 'failed' }
      return { transcript: result.text, note: null, status: 'ready' }
    }
    const { createAsr } = await import('./providers.ts')
    const asr = createAsr({ ...input.config, asrProvider: 'whisper-cli' })
    const result = await asr.transcribe(input.wav, input.source, null)
    if ('error' in result) return { transcript: null, note: result.message, status: 'failed' }
    return { transcript: result.text, note: null, status: 'ready' }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Speech recognition failed'
    return { transcript: null, note: message.slice(0, 180), status: 'failed' }
  }
}
