import { SAMPLE_RATE } from './constants.ts'

export function downsampleToPcm(input: Float32Array, inRate: number, outRate = SAMPLE_RATE): Int16Array {
  if (input.length === 0 || inRate <= 0) return new Int16Array()
  const ratio = inRate / outRate
  const n = Math.max(1, Math.floor(input.length / ratio))
  const out = new Int16Array(n)
  for (let i = 0; i < n; i++) {
    const s = Math.max(-1, Math.min(1, input[Math.min(input.length - 1, Math.floor(i * ratio))] ?? 0))
    out[i] = s < 0 ? Math.round(s * 0x8000) : Math.round(s * 0x7fff)
  }
  return out
}

/** Whisper expects 16 kHz mono float audio in the range -1..1. */
export function toWhisperAudio(pcm: Int16Array, inRate = SAMPLE_RATE): Float32Array {
  const outRate = 16_000
  if (pcm.length === 0) return new Float32Array()
  const n = Math.max(1, Math.floor((pcm.length * outRate) / inRate))
  const out = new Float32Array(n)
  const step = inRate / outRate
  const last = pcm.length - 1
  for (let i = 0; i < n; i++) {
    const x = i * step
    const i0 = Math.min(last, Math.floor(x))
    const i1 = Math.min(last, i0 + 1)
    const frac = x - i0
    const sample = (pcm[i0] ?? 0) * (1 - frac) + (pcm[i1] ?? 0) * frac
    out[i] = sample / 32768
  }
  return out
}

export function concatInt16(chunks: readonly Int16Array[]): Int16Array {
  let n = 0
  for (const chunk of chunks) n += chunk.length
  const out = new Int16Array(n)
  let offset = 0
  for (const chunk of chunks) {
    out.set(chunk, offset)
    offset += chunk.length
  }
  return out
}

export function rms(pcm: Int16Array): number {
  if (pcm.length === 0) return 0
  const step = Math.max(1, Math.floor(pcm.length / 4_000))
  let sum = 0
  let count = 0
  for (let i = 0; i < pcm.length; i += step) {
    const v = pcm[i] ?? 0
    sum += v * v
    count++
  }
  return Math.sqrt(sum / count) / 32768
}

export class PcmRing {
  private buf: Int16Array
  private pos = 0
  private filled = 0

  constructor(samples: number) {
    this.buf = new Int16Array(Math.max(1, samples))
  }

  push(frame: Int16Array) {
    const cap = this.buf.length
    if (frame.length >= cap) {
      this.buf.set(frame.subarray(frame.length - cap))
      this.pos = 0
      this.filled = cap
      return
    }
    for (let i = 0; i < frame.length; i++) {
      this.buf[this.pos] = frame[i] ?? 0
      this.pos++
      if (this.pos === cap) this.pos = 0
      if (this.filled < cap) this.filled++
    }
  }

  snapshot(): Int16Array {
    const out = new Int16Array(this.filled)
    const cap = this.buf.length
    const start = (this.pos - this.filled + cap) % cap
    for (let i = 0; i < this.filled; i++) out[i] = this.buf[(start + i) % cap] ?? 0
    return out
  }

  clear() {
    this.pos = 0
    this.filled = 0
  }
}

export function buildWav(chunks: readonly Int16Array[], rate: number): ArrayBuffer {
  let n = 0
  for (const chunk of chunks) n += chunk.length
  const buf = new ArrayBuffer(44 + n * 2)
  const view = new DataView(buf)
  let p = 0
  const str = (s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(p++, s.charCodeAt(i))
  }
  const u32 = (x: number) => {
    view.setUint32(p, x, true)
    p += 4
  }
  const u16 = (x: number) => {
    view.setUint16(p, x, true)
    p += 2
  }
  str('RIFF')
  u32(36 + n * 2)
  str('WAVE')
  str('fmt ')
  u32(16)
  u16(1)
  u16(1)
  u32(rate)
  u32(rate * 2)
  u16(2)
  u16(16)
  str('data')
  u32(n * 2)
  for (const chunk of chunks) {
    for (let i = 0; i < chunk.length; i++) {
      view.setInt16(p, chunk[i] ?? 0, true)
      p += 2
    }
  }
  return buf
}
