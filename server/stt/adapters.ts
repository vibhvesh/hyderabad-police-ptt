import type { SttProviderId } from '../../src/lib/stt.ts'

type FetchLike = typeof fetch

/** Calls one cloud speech API. Errors never include the key. */
export async function transcribeCloud(input: {
  provider: SttProviderId
  wav: Buffer
  language: string
  key: string
  fetchImpl?: FetchLike
}): Promise<string> {
  const fetchImpl = input.fetchImpl ?? fetch
  const key = input.key.trim()
  if (!key) throw new Error('Speech provider is not configured.')
  if (input.provider === 'openai') return openai(fetchImpl, input.wav, input.language, key)
  if (input.provider === 'deepgram') return deepgram(fetchImpl, input.wav, input.language, key)
  if (input.provider === 'google') return google(fetchImpl, input.wav, input.language, key)
  if (input.provider === 'azure') return azure(fetchImpl, input.wav, input.language, key)
  throw new Error('Speech provider is not configured.')
}

function failed(status: number): never {
  throw new Error(`Speech provider returned ${status}.`)
}

async function openai(fetchImpl: FetchLike, wav: Buffer, language: string, key: string): Promise<string> {
  const body = new FormData()
  body.set('model', 'whisper-1')
  body.set('language', language)
  body.set('file', new Blob([new Uint8Array(wav)], { type: 'audio/wav' }), 'clip.wav')
  const response = await fetchImpl('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { authorization: `Bearer ${key}` },
    body,
  })
  if (!response.ok) failed(response.status)
  const payload = (await response.json()) as { text?: string }
  return (payload.text ?? '').trim()
}

async function deepgram(fetchImpl: FetchLike, wav: Buffer, language: string, key: string): Promise<string> {
  const url = new URL('https://api.deepgram.com/v1/listen')
  url.searchParams.set('language', language)
  url.searchParams.set('punctuate', 'true')
  const response = await fetchImpl(url, {
    method: 'POST',
    headers: { authorization: `Token ${key}`, 'content-type': 'audio/wav' },
    body: new Uint8Array(wav),
  })
  if (!response.ok) failed(response.status)
  const payload = (await response.json()) as { results?: { channels?: Array<{ alternatives?: Array<{ transcript?: string }> }> } }
  return (payload.results?.channels?.[0]?.alternatives?.[0]?.transcript ?? '').trim()
}

async function google(fetchImpl: FetchLike, wav: Buffer, language: string, key: string): Promise<string> {
  const url = new URL('https://speech.googleapis.com/v1/speech:recognize')
  url.searchParams.set('key', key)
  const response = await fetchImpl(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      config: { encoding: 'LINEAR16', languageCode: language },
      audio: { content: wav.toString('base64') },
    }),
  })
  if (!response.ok) failed(response.status)
  const payload = (await response.json()) as { results?: Array<{ alternatives?: Array<{ transcript?: string }> }> }
  return (payload.results?.[0]?.alternatives?.[0]?.transcript ?? '').trim()
}

async function azure(fetchImpl: FetchLike, wav: Buffer, language: string, packed: string): Promise<string> {
  const [key, region] = packed.split('|')
  if (!key || !region) throw new Error('Azure Speech needs a key and a region.')
  const url = `https://${region}.stt.speech.microsoft.com/speech/recognition/conversation/cognitiveservices/v1?language=${encodeURIComponent(language)}`
  const response = await fetchImpl(url, {
    method: 'POST',
    headers: { 'Ocp-Apim-Subscription-Key': key, 'content-type': 'audio/wav' },
    body: new Uint8Array(wav),
  })
  if (!response.ok) failed(response.status)
  const payload = (await response.json()) as { DisplayText?: string }
  return (payload.DisplayText ?? '').trim()
}
