import { ElevenLabsClient } from '@elevenlabs/elevenlabs-js'

export type ScribeGateway = {
  convert: (wav: Buffer, language: string) => Promise<string>
  realtimeToken: () => Promise<string>
}

/** Builds a gateway only when the server holds ELEVENLABS_API_KEY. Callers must not construct this without a key. */
export function liveScribe(apiKey: string): ScribeGateway {
  const client = new ElevenLabsClient({ apiKey })
  return {
    async convert(wav, language) {
      const result = await client.speechToText.convert({
        file: new File([wav], 'clip.wav', { type: 'audio/wav' }),
        modelId: 'scribe_v2',
        languageCode: language,
        timestampsGranularity: 'none',
        diarize: false,
        tagAudioEvents: false,
      })
      if (!result || typeof result !== 'object' || !('text' in result) || typeof result.text !== 'string') {
        throw new Error('Scribe did not return a transcript.')
      }
      return result.text.trim()
    },
    async realtimeToken() {
      const created = await client.tokens.singleUse.create('realtime_scribe')
      return created.token
    },
  }
}

export function scribeConfiguredDetail(configured: boolean): string {
  return configured
    ? 'Scribe v2 can transcribe a clip after this device opts in. It does not translate. Realtime uses a short-lived scribe_v2_realtime token.'
    : 'Set ELEVENLABS_API_KEY on the server to enable optional Scribe transcription. The browser never receives that key.'
}
