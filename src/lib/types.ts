export type GeoFix = {
  lat: number
  lon: number
  acc: number | null
}

export type LangId = 'te' | 'en' | 'hi'

export type ChatMessage = {
  key: string
  name: string
  mine: boolean
  direction?: 'tx' | 'rx'
  speakerId?: string
  sourceLang?: LangId
  targetLang?: LangId
  t0: number
  dur: number
  url: string
  loc: GeoFix | null
  transcript: string | null
  translation: string | null
  translationNote: string | null
  via?: 'device' | 'scribe'
  error: string | null
  pending: boolean
  phase?: 'transcribing' | 'translating' | 'done' | 'error'
  role?: 'unit' | 'assistant'
  citation?: string | null
}

export type LangOption = {
  id: LangId
  label: string
  whisper: string
  eleven: string
}

export const LANGUAGES: readonly LangOption[] = [
  { id: 'te', label: 'Telugu', whisper: 'telugu', eleven: 'te' },
  { id: 'en', label: 'English', whisper: 'english', eleven: 'en' },
  { id: 'hi', label: 'Hindi', whisper: 'hindi', eleven: 'hi' },
]
