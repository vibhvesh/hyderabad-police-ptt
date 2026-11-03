import type { EngineId, LangId } from './types.ts'

const NAME = 'hp-unit-name'
const LANG = 'hp-lang'
const ENGINE = 'hp-engine'
const KEY = 'hp-eleven-key'

function read(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function write(key: string, value: string) {
  try {
    localStorage.setItem(key, value)
  } catch {
    /* private mode */
  }
}

export function loadName(): string {
  const existing = read(NAME)?.trim()
  if (existing) return existing.slice(0, 40)
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  const bytes = new Uint8Array(4)
  crypto.getRandomValues(bytes)
  let suffix = ''
  for (const b of bytes) suffix += alphabet[b % alphabet.length]
  const name = `Unit-${suffix}`
  write(NAME, name)
  return name
}

export function saveName(name: string) {
  write(NAME, name.slice(0, 40))
}

export function loadLang(): LangId {
  const value = read(LANG)
  if (value === 'te' || value === 'en' || value === 'hi') return value
  return 'te'
}

export function saveLang(lang: LangId) {
  write(LANG, lang)
}

export function loadEngine(): EngineId {
  return read(ENGINE) === 'elevenlabs' ? 'elevenlabs' : 'whisper'
}

export function saveEngine(engine: EngineId) {
  write(ENGINE, engine)
}

export function loadElevenKey(): string {
  return read(KEY) ?? ''
}

export function saveElevenKey(key: string) {
  write(KEY, key.trim())
}
