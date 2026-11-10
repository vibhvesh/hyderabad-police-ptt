import { SAMPLE_RATE } from './constants.ts'

/** Listen-only devices that cannot carry 12 kHz ask for this rate. */
export const LISTEN_RATE = 8_000

export function resamplePcm(pcm: Int16Array, inRate = SAMPLE_RATE, outRate = LISTEN_RATE): Int16Array {
  if (pcm.length === 0 || inRate <= 0 || outRate <= 0 || inRate === outRate) return pcm
  const n = Math.max(1, Math.round((pcm.length * outRate) / inRate))
  const out = new Int16Array(n)
  const step = inRate / outRate
  const last = pcm.length - 1
  for (let i = 0; i < n; i++) {
    const x = Math.min(last, i * step)
    const i0 = Math.floor(x)
    const i1 = Math.min(last, i0 + 1)
    const frac = x - i0
    const sample = (pcm[i0] ?? 0) * (1 - frac) + (pcm[i1] ?? 0) * frac
    out[i] = Math.max(-32768, Math.min(32767, Math.round(sample)))
  }
  return out
}
