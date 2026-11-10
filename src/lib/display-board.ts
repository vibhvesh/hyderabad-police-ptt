const TERMS = ['emergency', 'help', 'sos', 'fire', 'accident', 'bachao', 'madad', 'आपात', 'मदद', 'बचाओ', 'आग', 'दुर्घटना']

export function isEmergency(text: string | null | undefined): boolean {
  if (!text) return false
  const hay = text.toLowerCase().replace(/[.\-_/]/g, '')
  return TERMS.some((term) => hay.includes(term.toLowerCase()))
}

export function istDayKey(ms: number): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms))
}

export type BoardClip = {
  id: string
  lineId: string
  at: string
  transcript: string | null
  translation: string | null
}

export type BoardHit = { id: string; lineId: string; at: string; text: string }

export function emergencyHits(clips: BoardClip[], activity: Array<{ at: string; lineId: string; text: string }> = []): BoardHit[] {
  const hits: BoardHit[] = []
  for (const clip of clips) {
    const text = [clip.transcript, clip.translation].filter(Boolean).join(' — ')
    if (isEmergency(text)) hits.push({ id: clip.id, lineId: clip.lineId, at: clip.at, text })
  }
  for (const item of activity) {
    if (!isEmergency(item.text)) continue
    hits.push({ id: `act:${item.at}:${item.lineId}:${item.text}`, lineId: item.lineId, at: item.at, text: item.text })
  }
  return hits
}

export function boardKpis(input: {
  lines: Array<{ id: string; enabled: boolean }>
  users: Array<{ lineId: string }>
  floors: Array<{ lineId: string }>
  clips: BoardClip[]
  activity?: Array<{ at: string; lineId: string; text: string }>
  acked?: ReadonlySet<string>
  now?: number
}): {
  linesActive: number
  linesTotal: number
  devicesOnline: number
  messagesToday: number
  messagesLastHour: number
  talkers: number
  openAlerts: number
  perMinute: number[]
} {
  const now = input.now ?? Date.now()
  const today = istDayKey(now)
  const busy = new Set<string>()
  for (const user of input.users) busy.add(user.lineId)
  for (const floor of input.floors) busy.add(floor.lineId)
  let messagesToday = 0
  let messagesLastHour = 0
  const perMinute = Array.from({ length: 12 }, () => 0)
  for (const clip of input.clips) {
    const at = Date.parse(clip.at)
    if (!Number.isFinite(at)) continue
    if (istDayKey(at) === today) messagesToday += 1
    const age = now - at
    if (age >= 0 && age < 60 * 60 * 1000) messagesLastHour += 1
    if (age >= 0 && age < 12 * 60 * 1000) perMinute[11 - Math.floor(age / 60_000)] += 1
  }
  const acked = input.acked ?? new Set<string>()
  const openAlerts = emergencyHits(input.clips, input.activity).filter((hit) => !acked.has(hit.id)).length
  return {
    linesActive: input.lines.filter((line) => line.enabled && busy.has(line.id)).length,
    linesTotal: input.lines.length,
    devicesOnline: input.users.length,
    messagesToday,
    messagesLastHour,
    talkers: input.floors.length,
    openAlerts,
    perMinute,
  }
}

export function messagesTodayOnLine(clips: BoardClip[], lineId: string, now = Date.now()): number {
  const today = istDayKey(now)
  return clips.filter((clip) => clip.lineId === lineId && Number.isFinite(Date.parse(clip.at)) && istDayKey(Date.parse(clip.at)) === today).length
}
