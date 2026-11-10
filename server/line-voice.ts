import { ASR_WARNING, VOICE_WARNING, type VoiceChoice } from '../src/lib/voice-choice.ts'

export type LocalTranscript = { transcript: string | null; note: string | null; status: 'ready' | 'unconfigured' | 'failed' }

export async function recognizeForLine(input: {
  choice: VoiceChoice
  apiKey: string | null
  wav: Buffer
  language: string
  scribe?: (apiKey: string, wav: Buffer, language: string) => Promise<string>
  local: () => Promise<LocalTranscript>
}): Promise<LocalTranscript & { warning: string | null }> {
  if (input.choice !== 'elevenlabs') {
    const heard = await input.local()
    return { ...heard, warning: null }
  }
  if (input.apiKey && input.scribe) {
    try {
      const text = (await input.scribe(input.apiKey, input.wav, input.language)).trim()
      if (text) return { transcript: text, note: null, status: 'ready', warning: null }
    } catch {
      /* The message still gets the free recognizer. The error text is dropped so a key cannot leak. */
    }
  }
  const heard = await input.local()
  return { ...heard, warning: ASR_WARNING }
}

export async function speakForLine(input: {
  choice: VoiceChoice
  apiKey: string | null
  text: string
  eleven: (apiKey: string, text: string) => Promise<Int16Array | null>
  free: (text: string) => Promise<Int16Array | null>
}): Promise<{ pcm: Int16Array | null; warning: string | null }> {
  if (input.choice !== 'elevenlabs') return { pcm: await input.free(input.text), warning: null }
  if (input.apiKey) {
    try {
      const pcm = await input.eleven(input.apiKey, input.text)
      if (pcm && pcm.length > 0) return { pcm, warning: null }
    } catch {
      /* Fall through to the local voice. */
    }
  }
  return { pcm: await input.free(input.text), warning: VOICE_WARNING }
}
