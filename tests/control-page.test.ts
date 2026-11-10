import { describe, expect, it } from 'vitest'
import { controlPage, countPhrase, splitClients, talkSecondsLeft } from '../src/lib/control-page.ts'

describe('control room pages', () => {
  it('opens the wall first and keeps manage and connections behind the hash', () => {
    expect(controlPage('')).toEqual({ name: 'dashboard' })
    expect(controlPage('#/control')).toEqual({ name: 'dashboard' })
    expect(controlPage('#/control/manage')).toEqual({ name: 'manage' })
    expect(controlPage('#/control/connections/north-desk')).toEqual({ name: 'connections', lineId: 'north-desk' })
  })

  it('counts phones and handsets apart and counts down a 60 second talk', () => {
    expect(splitClients([{ kind: 'phone' }, { kind: 'handset' }, {}])).toEqual({ phones: 2, handsets: 1 })
    expect(talkSecondsLeft(1_000, 1_000)).toBe(60)
    expect(talkSecondsLeft(1_000, 16_000)).toBe(45)
    expect(talkSecondsLeft(1_000, 80_000)).toBe(0)
    expect(countPhrase(1, 'phone')).toBe('1 phone')
    expect(countPhrase(2, 'handset')).toBe('2 handsets')
  })
})
