/** Default ElevenLabs voice (Rachel). One server key speaks every line that opts in. */
export const DEFAULT_ELEVENLABS_VOICE = '21m00Tcm4TlvDq8ikWAM'
const TTS_URL = `https://api.elevenlabs.io/v1/text-to-speech/${DEFAULT_ELEVENLABS_VOICE}?output_format=pcm_16000`
const USER_URL = 'https://api.elevenlabs.io/v1/user'

export type KeyCheck = { ok: true } | { ok: false; message: string }

/** Cheap check of the server key. The key stays in the request header and never appears in the result. */
export async function testElevenLabsKey(apiKey: string, fetchImpl: typeof fetch = fetch): Promise<KeyCheck> {
  try {
    const response = await fetchImpl(USER_URL, { headers: { 'xi-api-key': apiKey } })
    if (response.ok) return { ok: true }
    return { ok: false, message: `ElevenLabs returned ${response.status}.` }
  } catch {
    return { ok: false, message: 'ElevenLabs could not be reached.' }
  }
}

/** Speaks with the shared server key. Returns null on any failure so the caller can use espeak. */
export async function speakElevenLabs(apiKey: string, text: string, fetchImpl: typeof fetch = fetch): Promise<Int16Array | null> {
  const spoken = text.replace(/\s+/g, ' ').trim().slice(0, 400)
  if (!spoken) return null
  try {
    const response = await fetchImpl(TTS_URL, {
      method: 'POST',
      headers: { 'xi-api-key': apiKey, 'content-type': 'application/json', accept: 'audio/pcm' },
      body: JSON.stringify({ text: spoken, model_id: 'eleven_flash_v2_5' }),
    })
    if (!response.ok) return null
    const bytes = new Uint8Array(await response.arrayBuffer())
    if (bytes.byteLength < 2) return null
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength - (bytes.byteLength % 2))
    const pcm = new Int16Array(view.byteLength / 2)
    for (let i = 0; i < pcm.length; i++) pcm[i] = view.getInt16(i * 2, true)
    return resample(pcm, 16_000, 12_000)
  } catch {
    return null
  }
}

function resample(samples: Int16Array, from: number, to: number): Int16Array {
  if (from === to || samples.length === 0) return samples
  const outLen = Math.max(1, Math.floor((samples.length * to) / from))
  const out = new Int16Array(outLen)
  for (let i = 0; i < outLen; i++) out[i] = samples[Math.min(samples.length - 1, Math.floor((i * from) / to))] ?? 0
  return out
}
