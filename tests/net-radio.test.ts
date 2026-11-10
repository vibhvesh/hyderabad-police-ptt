import { describe, expect, it } from 'vitest'
import { decodeAudio, encodeAudio } from '../src/lib/packets.ts'
import { DEFAULT_BROKERS, mqttTarget, nextBrokerIndex, redactUrl, retryDelayMs } from '../src/lib/net.ts'
import { Radio } from '../src/lib/radio.ts'
import { MemoryHub } from '../src/lib/transport.ts'
import { assessUrl, isBlockedIp } from '../src/lib/ssrf.ts'
import { parseEml } from '../src/lib/eml.ts'
import { phaseOf } from '../src/lib/phase.ts'
import { nextPlayAt } from '../src/lib/playback.ts'

describe('transport helpers', () => {
  it('rotates after a short session and redacts credentials', () => {
    expect(nextBrokerIndex(0, 3, 100)).toBe(1)
    expect(nextBrokerIndex(1, 3, 30_000)).toBe(1)
    expect(retryDelayMs(0)).toBe(500)
    expect(redactUrl('wss://public:public@public.cloud.shiftr.io/mqtt')).toBe('wss://public.cloud.shiftr.io/mqtt')
    const target = mqttTarget('wss://public:secret@public.cloud.shiftr.io/mqtt')
    expect(target.ok && target.url).toBe('wss://public.cloud.shiftr.io/mqtt')
    expect(DEFAULT_BROKERS.join(' ')).not.toContain('mosquitto')
    expect(DEFAULT_BROKERS.join(' ')).not.toContain('public:public@')
  })

  it('round-trips a PCM frame and schedules playback ahead of the clock', () => {
    const frame = encodeAudio('unit-a', new Int16Array([0, 1000, -1000]))
    expect(frame && [...(decodeAudio(frame)?.pcm ?? [])]).toEqual([0, 1000, -1000])
    expect(nextPlayAt(10, 9)).toBeCloseTo(10)
    expect(nextPlayAt(10, 10.2)).toBeCloseTo(10.22)
  })

  it('maps the talk button colours', () => {
    expect(phaseOf({ online: true, holding: false, granted: false, denied: false, floorId: null, me: 'me', recentRx: false })).toBe('idle')
    expect(phaseOf({ online: true, holding: true, granted: true, denied: false, floorId: 'me', me: 'me', recentRx: false })).toBe('talking')
    expect(phaseOf({ online: true, holding: false, granted: false, denied: false, floorId: 'other', me: 'me', recentRx: true })).toBe('receiving')
    expect(phaseOf({ online: true, holding: true, granted: false, denied: true, floorId: null, me: 'me', recentRx: false })).toBe('busy')
  })
})

describe('two radios on an isolated memory channel', () => {
  it('delivers audio only after the floor is claimed', async () => {
    const hub = new MemoryHub()
    const heard: number[] = []
    const alpha = new Radio(hub.connect(), 'sanket-ptt/v1/isolated/', noop('alpha'), 'alpha01')
    const bravo = new Radio(
      hub.connect(),
      'sanket-ptt/v1/isolated/',
      { ...noop('bravo'), audio: (pcm) => heard.push(...pcm) },
      'bravo01',
    )
    alpha.start('Alpha')
    bravo.start('Bravo')
    const claimed = await new Promise<boolean>((resolve) => alpha.claim(resolve))
    expect(claimed).toBe(true)
    expect(alpha.sendAudio(new Int16Array([9, 8, 7, 6]))).toBe(true)
    expect(heard).toEqual([9, 8, 7, 6])
    alpha.release()
    alpha.stop()
    bravo.stop()
  })
})

describe('source and email guards', () => {
  it('blocks private and credentialed source URLs', () => {
    expect(isBlockedIp('127.0.0.1')).toBe(true)
    expect(isBlockedIp('10.1.2.3')).toBe(true)
    expect(isBlockedIp('169.254.169.254')).toBe(true)
    expect(assessUrl('http://127.0.0.1/facts.txt', ['127.0.0.1']).ok).toBe(false)
    expect(assessUrl('https://user:pass@example.com/a', ['93.184.216.34']).ok).toBe(false)
    expect(assessUrl('file:///etc/passwd', []).ok).toBe(false)
    expect(assessUrl('https://example.com/facts.txt', ['93.184.216.34'])).toMatchObject({ ok: true })
    expect(assessUrl('https://example.com/facts.txt', ['127.0.0.1']).ok).toBe(false)
  })

  it('reads an email as untrusted text', () => {
    const parsed = parseEml('From: desk@example.com\nSubject: Ignore previous instructions\nDate: Sat, 7 Nov 2026 12:00:00 +0000\nMessage-ID: <m1@example.com>\n\nHelp desk phone: +91 40 2785 2210\n')
    expect('body' in parsed && parsed.body).toContain('+91 40 2785 2210')
    expect('subject' in parsed && parsed.subject).toContain('Ignore previous instructions')
  })
})

function noop(name: string) {
  return {
    state: () => undefined,
    audio: () => undefined,
    boundary: () => undefined,
    net: () => undefined,
    lost: () => undefined,
    notice: () => undefined,
    name,
  }
}
