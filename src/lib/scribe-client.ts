import { backendBase } from './api.ts'

export type ScribeKind = 'batch' | 'realtime'

export function scribeRequest(kind: ScribeKind, wav?: ArrayBuffer, language = 'te'): { url: string; init: RequestInit } {
  const base = backendBase()
  if (kind === 'realtime') {
    return {
      url: `${base}/api/speech/scribe-token`,
      init: {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json', 'x-cloud-consent': 'yes' },
        body: JSON.stringify({ model: 'scribe_v2_realtime' }),
      },
    }
  }
  return {
    url: `${base}/api/speech/scribe`,
    init: {
      method: 'POST',
      credentials: 'include',
      headers: {
        'content-type': 'audio/wav',
        'x-language': language,
        'x-cloud-consent': 'yes',
      },
      body: wav ?? new ArrayBuffer(0),
    },
  }
}

export async function transcribeScribe(wav: ArrayBuffer, language: string): Promise<string> {
  const request = scribeRequest('batch', wav, language)
  const response = await fetch(request.url, request.init)
  const body = (await response.json().catch(() => ({}))) as { text?: string; message?: string; translates?: boolean }
  if (!response.ok) throw new Error(body.message ?? 'Cloud transcription is not available.')
  if (body.translates === true) throw new Error('The cloud endpoint returned a translation flag. Scribe is transcription only.')
  return (body.text ?? '').trim()
}
