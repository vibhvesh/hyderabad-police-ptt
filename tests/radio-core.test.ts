import { describe, expect, it } from 'vitest'
import { PcmRing, buildWav, downsampleToPcm, rms, toWhisperAudio } from '../src/lib/audio.ts'
import { SAMPLE_RATE } from '../src/lib/constants.ts'
import { beats, expireFloor, reduceFloor, type Floor } from '../src/lib/floor.ts'
import { CLAIM_GRACE_MS, FLOOR_TIMEOUT_MS } from '../src/lib/constants.ts'
import { cleanLoc, formatLoc, readableTranscript } from '../src/lib/format.ts'

describe('floor control', () => {
  const claimA = { t: 'claim' as const, id: 'a', name: 'Alpha', ts: 1_000, loc: { lat: 17.38504, lon: 78.48667, acc: 12 } }

  it('gives the channel to the first claim', () => {
    const floor = reduceFloor(null, claimA, 1_000)
    expect(floor?.id).toBe('a')
    expect(floor?.loc?.lat).toBe(17.38504)
  })

  it('keeps the earlier claim when two people key up together', () => {
    const first = reduceFloor(null, claimA, 1_000)
    const later = reduceFloor(first, { t: 'claim', id: 'b', name: 'Bravo', ts: 1_050 }, 1_100)
    expect(later?.id).toBe('a')
    const earlier = reduceFloor(first, { t: 'claim', id: 'c', name: 'Charlie', ts: 900 }, 1_100)
    expect(earlier?.id).toBe('c')
  })

  it('does not let a late claim steal the channel', () => {
    const first = reduceFloor(null, claimA, 1_000)
    const late = reduceFloor(
      first,
      { t: 'claim', id: 'z', name: 'Zulu', ts: 1 },
      1_000 + CLAIM_GRACE_MS * 3 + 5,
    )
    expect(late?.id).toBe('a')
  })

  it('releases only the station that holds the floor', () => {
    const held = reduceFloor(null, claimA, 1_000)
    expect(reduceFloor(held, { t: 'release', id: 'b', name: 'Bravo', ts: 2 }, 2_000)?.id).toBe('a')
    expect(reduceFloor(held, { t: 'release', id: 'a', name: 'Alpha', ts: 2 }, 2_000)).toBeNull()
  })

  it('refreshes a heartbeat without dropping the fix', () => {
    const held = reduceFloor(null, claimA, 1_000) as Floor
    const beat = reduceFloor(held, { t: 'hb', id: 'a', name: 'Alpha', ts: 1_000 }, 2_000)
    expect(beat?.seen).toBe(2_000)
    expect(beat?.loc?.acc).toBe(12)
    expect(beat?.got).toBe(held.got)
  })

  it('expires a silent floor', () => {
    const held = reduceFloor(null, claimA, 1_000) as Floor
    expect(expireFloor({ ...held, seen: 0 }, FLOOR_TIMEOUT_MS + 1)).toBeNull()
  })

  it('orders equal timestamps by name and id', () => {
    expect(beats({ ts: 5, name: 'A', id: '1' }, { ts: 5, name: 'B', id: '1' })).toBe(true)
    expect(beats({ ts: 6, name: 'A', id: '1' }, { ts: 5, name: 'A', id: '1' })).toBe(false)
  })
})

describe('location text', () => {
  it('prints latitude, longitude, and accuracy', () => {
    expect(formatLoc({ lat: 17.38504, lon: 78.48667, acc: 18 })).toBe('17.38504, 78.48667 · ±18 m')
    expect(formatLoc(null)).toBe('Location unavailable')
  })

  it('drops a repeated Whisper loop', () => {
    expect(readableTranscript('...')).toBe('No speech detected')
    expect(readableTranscript('పది నిమిషాలు')).toBe('పది నిమిషాలు')
    expect(readableTranscript('put put put put put put')).toBe('No speech detected')
  })

  it('rejects impossible coordinates', () => {
    expect(cleanLoc({ lat: 91, lon: 0, acc: 5 })).toBeNull()
    expect(cleanLoc({ lat: 17.385044, lon: 78.486671, acc: 11.2 })).toEqual({
      lat: 17.38504,
      lon: 78.48667,
      acc: 11,
    })
  })
})

describe('audio helpers', () => {
  it('writes a 16-bit wav header', () => {
    const pcm = new Int16Array([0, 1000, -1000])
    const view = new DataView(buildWav([pcm], SAMPLE_RATE))
    const tag = String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3))
    expect(tag).toBe('RIFF')
    expect(view.getUint32(24, true)).toBe(SAMPLE_RATE)
    expect(view.getUint32(40, true)).toBe(6)
    expect(view.getInt16(46, true)).toBe(1000)
  })

  it('keeps the newest pre-roll samples in order', () => {
    const ring = new PcmRing(4)
    ring.push(new Int16Array([1, 2, 3]))
    ring.push(new Int16Array([4, 5]))
    expect([...ring.snapshot()]).toEqual([2, 3, 4, 5])
    ring.clear()
    expect(ring.snapshot().length).toBe(0)
  })

  it('downsamples and resamples toward 16 kHz', () => {
    const input = new Float32Array([0, 0.5, -0.5, 1])
    const pcm = downsampleToPcm(input, 24_000, 12_000)
    expect(pcm.length).toBe(2)
    expect(rms(new Int16Array(4000))).toBe(0)
    expect(toWhisperAudio(new Int16Array([0, 16000, -16000])).length).toBeGreaterThan(2)
  })
})
