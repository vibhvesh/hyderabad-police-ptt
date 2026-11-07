import { SAMPLE_RATE } from './constants.ts'

/** Keep a short lead so the next chunk is not scheduled in the past. */
export function nextPlayAt(now: number, cursor: number): number {
  if (!(cursor > now + 0.02 && cursor < now + 0.8)) return now + 0.12
  return cursor
}

export type PcmPlayer = {
  push: (pcm: Int16Array) => void
  reset: () => void
}

export function createPlayer(audio: AudioContext): PcmPlayer {
  let cursor = 0
  return {
    reset() {
      cursor = 0
    },
    push(pcm: Int16Array) {
      if (audio.state !== 'running' || pcm.length === 0) return
      const buffer = audio.createBuffer(1, pcm.length, SAMPLE_RATE)
      const channel = buffer.getChannelData(0)
      for (let i = 0; i < pcm.length; i++) channel[i] = (pcm[i] ?? 0) / 32768
      const source = audio.createBufferSource()
      source.buffer = buffer
      source.connect(audio.destination)
      const start = nextPlayAt(audio.currentTime, cursor)
      source.start(start)
      cursor = start + buffer.duration
    },
  }
}
