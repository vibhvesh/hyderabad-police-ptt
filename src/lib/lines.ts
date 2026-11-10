import type { VoiceChoice } from './voice-choice.ts'

export type LineLang = 'te' | 'en' | 'hi'

export type LineRecord = {
  id: string
  name: string
  enabled: boolean
  sourceLang: LineLang
  targetLang: LineLang
  ttsProvider: VoiceChoice
  asrProvider: VoiceChoice
  createdAt: string
  updatedAt: string
}

const ID = /^[a-z0-9][a-z0-9-]{0,40}$/

export function lineId(value: string): string | null {
  const id = value.trim().toLowerCase()
  return ID.test(id) ? id : null
}

export function lineTopic(id: string): string {
  return `sanket-ptt/v1/${id}/`
}

export function lineLang(value: unknown, fallback: LineLang = 'te'): LineLang {
  return value === 'en' || value === 'hi' || value === 'te' ? value : fallback
}

export function defaultLine(nowIso: string): LineRecord {
  return {
    id: 'sanket-1',
    name: 'SANKET-1',
    enabled: true,
    sourceLang: 'te',
    targetLang: 'en',
    ttsProvider: 'free',
    asrProvider: 'free',
    createdAt: nowIso,
    updatedAt: nowIso,
  }
}

export function lineForTopic(lines: readonly LineRecord[], topic: string): LineRecord | null {
  return lines.find((line) => topic.startsWith(lineTopic(line.id))) ?? null
}
