/** Read a 16-bit PCM WAV file, including files whose data chunk is not at byte 44. */
export function decodeWav(buffer: Buffer): { rate: number; samples: Float32Array } | null {
  if (buffer.length < 44) return null
  if (buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WAVE') return null
  let offset = 12
  let rate = 0
  let channels = 1
  let bits = 16
  let data: Buffer | null = null
  while (offset + 8 <= buffer.length) {
    const id = buffer.toString('ascii', offset, offset + 4)
    const size = buffer.readUInt32LE(offset + 4)
    const start = offset + 8
    if (size < 0 || start + size > buffer.length) break
    if (id === 'fmt ' && size >= 16) {
      const format = buffer.readUInt16LE(start)
      channels = buffer.readUInt16LE(start + 2)
      rate = buffer.readUInt32LE(start + 4)
      bits = buffer.readUInt16LE(start + 14)
      if (format !== 1 || channels < 1) return null
    } else if (id === 'data') {
      data = buffer.subarray(start, start + size)
    }
    offset = start + size + (size % 2)
  }
  if (!data || !rate || bits !== 16) return null
  const frame = channels * 2
  const count = Math.floor(data.length / frame)
  const samples = new Float32Array(count)
  for (let i = 0; i < count; i++) {
    let sum = 0
    for (let channel = 0; channel < channels; channel++) sum += data.readInt16LE(i * frame + channel * 2)
    samples[i] = sum / channels / 32768
  }
  return { rate, samples }
}

export function resampleFloat(input: Float32Array, inRate: number, outRate: number): Float32Array {
  if (input.length === 0 || inRate <= 0 || outRate <= 0) return new Float32Array()
  if (inRate === outRate) return input
  const count = Math.max(1, Math.floor((input.length * outRate) / inRate))
  const out = new Float32Array(count)
  const last = input.length - 1
  for (let i = 0; i < count; i++) {
    const position = (i * inRate) / outRate
    const left = Math.min(last, Math.floor(position))
    const right = Math.min(last, left + 1)
    const fraction = position - left
    out[i] = (input[left] ?? 0) * (1 - fraction) + (input[right] ?? 0) * fraction
  }
  return out
}
