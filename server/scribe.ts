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

export function scribeConfiguredDetail(mode: 'configured' | 'rejected' | 'unconfigured'): string {
  if (mode === 'configured') {
    return 'A server key is configured for optional Scribe transcription. It does not translate. A rejected key is not reused.'
  }
  if (mode === 'rejected') {
    return 'The configured server key was rejected and is not being used. A browser can paste a different key for its own session.'
  }
  return 'No server key is saved. After opting in, a browser can paste a key for this session only. It is not written to disk.'
}
