export function encodeAudio(id: string, pcm: Int16Array, seq?: number): Uint8Array | null {
  const idBytes = new TextEncoder().encode(id)
  if (idBytes.length < 1 || idBytes.length > 80) return null
  const versioned = seq !== undefined
  const out = new Uint8Array(1 + idBytes.length + (versioned ? 4 : 0) + pcm.byteLength)
  out[0] = idBytes.length | (versioned ? 0x80 : 0)
  out.set(idBytes, 1)
  let offset = 1 + idBytes.length
  if (versioned) {
    new DataView(out.buffer).setUint32(offset, seq >>> 0, true)
    offset += 4
  }
  out.set(new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength), offset)
  return out
}

export function decodeAudio(raw: Uint8Array): { id: string; pcm: Int16Array; seq: number | null } | null {
  if (raw.length < 4) return null
  const marker = raw[0] ?? 0
  const versioned = (marker & 0x80) !== 0
  const n = marker & 0x7f
  if (n < 1 || n > 80) return null
  const pcmStart = 1 + n + (versioned ? 4 : 0)
  if (raw.length < pcmStart + 2) return null
  const id = new TextDecoder().decode(raw.subarray(1, 1 + n))
  if (!id || id.includes('\u0000')) return null
  const seq = versioned ? new DataView(raw.buffer, raw.byteOffset + 1 + n, 4).getUint32(0, true) : null
  const body = raw.subarray(pcmStart)
  const even = body.length - (body.length % 2)
  const pcm = new Int16Array(even / 2)
  new Uint8Array(pcm.buffer).set(body.subarray(0, even))
  return { id, pcm, seq }
}

export type ChannelNotice = {
  id: string
  name: string
  text: string
  answerId: string
  citation: string | null
}

export type ServerCaption = {
  clipId: string
  lineId: string
  speakerId: string
  speakerName: string
  at: string
  transcript: string | null
  translation: string | null
  translationNote: string | null
  status: 'ready' | 'unconfigured' | 'failed'
}

export function decodeCaption(raw: Uint8Array): ServerCaption | null {
  try {
    const value = JSON.parse(new TextDecoder().decode(raw)) as Partial<ServerCaption>
    if (typeof value.clipId !== 'string' || typeof value.speakerId !== 'string') return null
    const status = value.status === 'ready' || value.status === 'failed' || value.status === 'unconfigured' ? value.status : 'ready'
    return {
      clipId: value.clipId.slice(0, 80),
      lineId: String(value.lineId ?? '').slice(0, 40),
      speakerId: value.speakerId.slice(0, 80),
      speakerName: String(value.speakerName ?? value.speakerId).slice(0, 40),
      at: typeof value.at === 'string' ? value.at : new Date().toISOString(),
      transcript: typeof value.transcript === 'string' ? value.transcript.slice(0, 4_000) : null,
      translation: typeof value.translation === 'string' ? value.translation.slice(0, 4_000) : null,
      translationNote: typeof value.translationNote === 'string' ? value.translationNote.slice(0, 500) : null,
      status,
    }
  } catch {
    return null
  }
}

export function encodeNotice(notice: ChannelNotice): string {
  return JSON.stringify(notice)
}

export function decodeNotice(raw: Uint8Array): ChannelNotice | null {
  try {
    const value = JSON.parse(new TextDecoder().decode(raw)) as Partial<ChannelNotice>
    if (typeof value.text !== 'string' || typeof value.answerId !== 'string') return null
    if (typeof value.id !== 'string' || typeof value.name !== 'string') return null
    return {
      id: value.id.slice(0, 40),
      name: value.name.slice(0, 40),
      text: value.text.slice(0, 4_000),
      answerId: value.answerId.slice(0, 80),
      citation: typeof value.citation === 'string' ? value.citation.slice(0, 500) : null,
    }
  } catch {
    return null
  }
}
