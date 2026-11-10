import { SAMPLE_RATE } from './constants.ts'

/** How much audio to hold before the first sample, so a short stall does not open a hole. */
export const PLAYOUT_TARGET_MS = 200

export type ScheduledChunk = { pcm: Int16Array; start: number; duration: number }

/**
 * Orders packets and plays them at 1x. A burst is queued, not sped up.
 * An underrun starts again just ahead of now instead of overlapping audio already scheduled.
 */
export class LivePlayout {
  private waiting = new Map<number, Int16Array>()
  private next: number | null = null
  private samples = 0
  private primed = false
  private playAt = 0
  private readonly rate: number
  private readonly now: () => number
  private readonly targetSamples: number

  constructor(rate: number, now: () => number, targetMs = PLAYOUT_TARGET_MS) {
    this.rate = rate
    this.now = now
    this.targetSamples = Math.max(1, Math.round((rate * targetMs) / 1000))
  }

  push(seq: number | null, pcm: Int16Array, schedule: (pcm: Int16Array, when: number) => void): ScheduledChunk[] {
    const key = seq ?? this.fallbackSeq()
    if (this.waiting.has(key)) return []
    this.waiting.set(key, pcm)
    this.samples += pcm.length
    if (this.next == null || (!this.primed && key < this.next)) this.next = key
    if (!this.primed) {
      if (this.samples < this.targetSamples) return []
      this.primed = true
      this.playAt = this.now() + 0.02
    }
    return this.flush(schedule)
  }

  private fallbackSeq(): number {
    if (this.waiting.size === 0) return this.next ?? 0
    return Math.max(...this.waiting.keys()) + 1
  }

  private flush(schedule: (pcm: Int16Array, when: number) => void): ScheduledChunk[] {
    const out: ScheduledChunk[] = []
    const now = this.now()
    const pending = [...this.waiting.keys()].sort((a, b) => a - b)
    if (this.next != null && pending.length > 0 && pending[0]! > this.next && this.playAt < now) {
      this.next = pending[0]!
    }
    while (this.next != null && this.waiting.has(this.next)) {
      const pcm = this.waiting.get(this.next)!
      this.waiting.delete(this.next)
      this.samples -= pcm.length
      this.playAt = nextPlayAt(this.playAt, now)
      const duration = pcm.length / this.rate
      schedule(pcm, this.playAt)
      out.push({ pcm, start: this.playAt, duration })
      this.playAt += duration
      this.next++
    }
    return out
  }
}

/** The previous clock jumped back into audio that was already queued, which shortens what you hear. */
export function legacyPlayAt(playAt: number, now: number): number {
  if (playAt < now || playAt > now + 0.8) return now + 0.12
  return playAt
}

/** Next start time. A late packet begins just after now. A packet that is early keeps its place in line. */
export function nextPlayAt(playAt: number, now: number): number {
  if (playAt < now) return now + 0.02
  return playAt
}

export function pcmToContextFloat(pcm: Int16Array, inRate: number, outRate: number): Float32Array {
  if (pcm.length === 0 || inRate <= 0 || outRate <= 0) return new Float32Array()
  if (inRate === outRate) {
    const same = new Float32Array(pcm.length)
    for (let i = 0; i < pcm.length; i++) same[i] = (pcm[i] ?? 0) / 32768
    return same
  }
  const n = Math.max(1, Math.round((pcm.length * outRate) / inRate))
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

export function chirp(seconds: number, rate = SAMPLE_RATE): Int16Array {
  const n = Math.round(seconds * rate)
  const out = new Int16Array(n)
  const f0 = 180
  const f1 = 1800
  for (let i = 0; i < n; i++) {
    const t = i / rate
    const phase = 2 * Math.PI * (f0 * t + ((f1 - f0) * t * t) / (2 * seconds))
    out[i] = Math.round(Math.sin(phase) * 14000)
  }
  return out
}

export type Arrival = { seq: number; pcm: Int16Array; at: number }

/** One connection keeps order. A stall delays that packet and the ones behind it, then the delay drains. */
export function moderateArrivalTimes(count: number, chunkDur: number): number[] {
  const times: number[] = []
  let lag = 0
  for (let i = 0; i < count; i++) {
    if (i % 12 === 0) lag += 0.12
    else lag = Math.max(0, lag - 0.035)
    const wobble = ((i * 17) % 5) * 0.006
    times.push(i * chunkDur + lag + wobble)
  }
  for (let i = 1; i < times.length; i++) times[i] = Math.max(times[i]!, times[i - 1]! + 0.001)
  return times
}

export function scheduleReception(chunks: Int16Array[], rate = SAMPLE_RATE): { received: Int16Array; maxGapMs: number; gapMs: number; gapCount: number; ratio: number } {
  const chunkDur = (chunks[0]?.length ?? 1) / rate
  const times = moderateArrivalTimes(chunks.length, chunkDur)
  const arrivals: Arrival[] = chunks.map((pcm, seq) => ({ seq, pcm, at: times[seq] ?? seq * chunkDur }))
  arrivals.sort((a, b) => a.at - b.at || a.seq - b.seq)
  let clock = arrivals[0]?.at ?? 0
  const playout = new LivePlayout(rate, () => clock)
  const placed: ScheduledChunk[] = []
  for (const item of arrivals) {
    clock = item.at
    placed.push(...playout.push(item.seq, item.pcm, () => undefined))
  }
  return measurePlaced(chunks, placed, rate)
}

export function measurePlaced(chunks: Int16Array[], placed: ScheduledChunk[], rate: number) {
  const sent = chunks.reduce((sum, chunk) => sum + chunk.length, 0)
  if (placed.length === 0) return { received: new Int16Array(), maxGapMs: 0, gapMs: 0, gapCount: 0, ratio: 0 }
  const begin = placed[0]!.start
  const end = placed.reduce((max, item) => Math.max(max, item.start + item.duration), begin)
  const n = Math.max(1, Math.round((end - begin) * rate))
  const received = new Int16Array(n)
  const sorted = [...placed].sort((a, b) => a.start - b.start)
  let gapMs = 0
  let gapCount = 0
  let maxGapMs = 0
  let cursor = begin
  for (const item of sorted) {
    const hole = item.start - cursor
    if (hole > 0.02) {
      const ms = hole * 1000
      gapMs += ms
      gapCount++
      maxGapMs = Math.max(maxGapMs, ms)
    }
    cursor = Math.max(cursor, item.start + item.duration)
    const offset = Math.round((item.start - begin) * rate)
    for (let i = 0; i < item.pcm.length && offset + i < received.length; i++) received[offset + i] = item.pcm[i] ?? 0
  }
  return { received, maxGapMs, gapMs, gapCount, ratio: received.length / sent }
}

export function silenceRuns(pcm: Int16Array, rate: number, threshold = 400): { count: number; totalMs: number; maxMs: number } {
  let run = 0
  let count = 0
  let total = 0
  let max = 0
  const minRun = Math.round(rate * 0.02)
  const close = () => {
    if (run >= minRun) {
      count++
      const ms = (run / rate) * 1000
      total += ms
      max = Math.max(max, ms)
    }
    run = 0
  }
  for (let i = 0; i < pcm.length; i++) {
    if (Math.abs(pcm[i] ?? 0) < threshold) run++
    else close()
  }
  close()
  return { count, totalMs: total, maxMs: max }
}
