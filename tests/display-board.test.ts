import { describe, expect, it } from 'vitest'
import { controlPage } from '../src/lib/control-page.ts'
import { boardKpis, isEmergency, messagesTodayOnLine } from '../src/lib/display-board.ts'

describe('display board', () => {
  it('keeps the display board as the first screen and the old wall route', () => {
    expect(controlPage('')).toEqual({ name: 'dashboard' })
    expect(controlPage('#/control')).toEqual({ name: 'dashboard' })
    expect(controlPage('#/control/display')).toEqual({ name: 'dashboard' })
    expect(controlPage('#/control/wall')).toEqual({ name: 'dashboard' })
    expect(controlPage('#/control/manage')).toEqual({ name: 'manage' })
  })

  it('flags emergency words in English and Hindi and ignores ordinary traffic', () => {
    expect(isEmergency('Officer needs help at the gate')).toBe(true)
    expect(isEmergency('S.O.S. from unit 4')).toBe(true)
    expect(isEmergency('bachao, fire near the market')).toBe(true)
    expect(isEmergency('मदद चाहिए')).toBe(true)
    expect(isEmergency('दुर्घटना on the ring road')).toBe(true)
    expect(isEmergency('Line is clear, moving to post')).toBe(false)
    expect(isEmergency('')).toBe(false)
    expect(isEmergency(null)).toBe(false)
  })

  it('counts the wall totals, the last hour, and open alerts', () => {
    const now = Date.parse('2026-11-10T08:30:00.000Z')
    const clips = [
      { id: 'now', lineId: 'north', at: '2026-11-10T08:20:00.000Z', transcript: 'Fire at the gate, bachao', translation: 'मदद' },
      { id: 'hour', lineId: 'south', at: '2026-11-10T07:40:00.000Z', transcript: 'Unit is moving', translation: null },
      { id: 'today', lineId: 'north', at: '2026-11-10T02:00:00.000Z', transcript: 'Accident reported', translation: null },
      { id: 'old', lineId: 'gate', at: '2026-11-09T08:00:00.000Z', transcript: 'Yesterday', translation: null },
    ]
    const totals = boardKpis({
      now,
      lines: [
        { id: 'north', enabled: true },
        { id: 'south', enabled: true },
        { id: 'gate', enabled: false },
      ],
      users: [{ lineId: 'north' }, { lineId: 'north' }, { lineId: 'south' }],
      floors: [{ lineId: 'north' }],
      clips,
      acked: new Set(['today']),
    })
    expect(totals).toMatchObject({
      linesActive: 2,
      linesTotal: 3,
      devicesOnline: 3,
      messagesToday: 3,
      messagesLastHour: 2,
      talkers: 1,
      openAlerts: 1,
    })
    expect(totals.perMinute.reduce((sum, value) => sum + value, 0)).toBe(1)
    expect(totals.perMinute[11 - Math.floor((now - Date.parse(clips[0].at)) / 60_000)]).toBe(1)
    expect(messagesTodayOnLine(clips, 'north', now)).toBe(2)
    expect(messagesTodayOnLine(clips, 'gate', now)).toBe(0)
  })
})
