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

export class CloudKeyNeeded extends Error {
  readonly needsKey = true
  constructor(message: string) {
    super(message)
  }
}

export type ScribeKeyStatus = { source: 'server' | 'session' | 'none'; serverRejected: boolean }

export async function scribeKeyStatus(): Promise<ScribeKeyStatus> {
  const response = await fetch(`${backendBase()}/api/speech/scribe-key`, { credentials: 'include' })
  const body = (await response.json().catch(() => ({}))) as Partial<ScribeKeyStatus> & { message?: string }
  if (!response.ok) throw new Error(body.message ?? 'Cloud key status is unavailable.')
  const source = body.source === 'server' || body.source === 'session' ? body.source : 'none'
  return { source, serverRejected: body.serverRejected === true }
}

export async function saveScribeKey(key: string): Promise<void> {
  const response = await fetch(`${backendBase()}/api/speech/scribe-key`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ key }),
  })
  const body = (await response.json().catch(() => ({}))) as { message?: string }
  if (!response.ok) throw new Error(body.message ?? 'That key was not saved.')
}

export async function clearScribeKey(): Promise<void> {
  const response = await fetch(`${backendBase()}/api/speech/scribe-key`, { method: 'DELETE', credentials: 'include' })
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { message?: string }
    throw new Error(body.message ?? 'The session key was not cleared.')
  }
}

export async function transcribeScribe(wav: ArrayBuffer, language: string): Promise<string> {
  const request = scribeRequest('batch', wav, language)
  const response = await fetch(request.url, request.init)
  const body = (await response.json().catch(() => ({}))) as { text?: string; message?: string; translates?: boolean; needsKey?: boolean }
  if (!response.ok) {
    const message = body.message ?? 'Cloud transcription is not available.'
    if (body.needsKey) throw new CloudKeyNeeded(message)
    throw new Error(message)
  }
  if (body.translates === true) throw new Error('The cloud endpoint returned a translation flag. Scribe is transcription only.')
  return (body.text ?? '').trim()
}
