import type { EngineId, LangId } from './types.ts'

const NAME = 'hp-unit-name'
const LANG = 'hp-lang'
const ENGINE = 'hp-engine'
const KEY = 'hp-eleven-key'
const BACKEND = 'sanket-backend-url'
const TRANSPORT = 'sanket-transport'
const TOPIC = 'sanket-topic'

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

export type TransportMode = 'auto' | 'mqtt' | 'server'

export function loadBackend(): string {
  return read(BACKEND) ?? import.meta.env.VITE_BACKEND_URL ?? ''
}

export function saveBackend(value: string) {
  write(BACKEND, value.trim())
}

export function loadTransport(): TransportMode {
  const value = read(TRANSPORT)
  if (value === 'mqtt' || value === 'server' || value === 'auto') return value
  return 'auto'
}

export function saveTransport(value: TransportMode) {
  write(TRANSPORT, value)
}

export function loadTopic(): string {
  return read(TOPIC) ?? ''
}

export function saveTopic(value: string) {
  write(TOPIC, value.trim())
}

export function loadSession(key: string): string {
  try {
    return sessionStorage.getItem(key) ?? ''
  } catch {
    return ''
  }
}

export function saveSession(key: string, value: string): boolean {
  try {
    if (value) sessionStorage.setItem(key, value)
    else sessionStorage.removeItem(key)
    return true
  } catch {
    return false
  }
}
