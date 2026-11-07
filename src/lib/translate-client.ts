import { apiFetch, backendBase, INGEST_TOKEN_KEY } from './api.ts'
import { loadSession } from './storage.ts'

export type Translation =
  | { state: 'same'; text: string; note: string }
  | { state: 'translated'; text: string; note: string }
  | { state: 'unconfigured'; text: ''; note: string }
  | { state: 'error'; text: ''; note: string }

type BrowserTranslator = {
  translate: (text: string) => Promise<string>
}

export async function translateText(text: string, source: string, target: string): Promise<Translation> {
  const original = text.trim()
  if (!original) return { state: 'same', text: '', note: 'Nothing to translate.' }
  if (source === target) return { state: 'same', text: original, note: 'Source and translation language are the same.' }
  const token = loadSession(INGEST_TOKEN_KEY)
  if (backendBase() && token) {
    try {
      const response = await apiFetch('/api/translate', token, {
        method: 'POST',
        body: JSON.stringify({ text: original, source, target }),
      })
      const body = (await response.json()) as { text?: string; provider?: string; message?: string; mode?: string }
      if (!response.ok) return { state: 'unconfigured', text: '', note: body.message ?? 'Server translation is not configured.' }
      return { state: 'translated', text: body.text ?? '', note: `Translated by ${body.provider ?? 'server'} (${body.mode ?? 'live'}).` }
    } catch {
      return { state: 'error', text: '', note: 'The translation server could not be reached.' }
    }
  }
  const browser = await browserTranslator(source, target)
  if (browser) {
    try {
      return { state: 'translated', text: await browser.translate(original), note: 'Translated by this browser.' }
    } catch (error) {
      return { state: 'error', text: '', note: error instanceof Error ? error.message : 'Browser translation failed.' }
    }
  }
  return {
    state: 'unconfigured',
    text: '',
    note: 'Translation is not configured. Set a server translator, or use a browser with the Translator API. The original text is unchanged.',
  }
}

async function browserTranslator(source: string, target: string): Promise<BrowserTranslator | null> {
  const host = globalThis as { Translator?: { create: (options: { sourceLanguage: string; targetLanguage: string }) => Promise<BrowserTranslator> } }
  if (!host.Translator?.create) return null
  try {
    return await host.Translator.create({ sourceLanguage: source, targetLanguage: target })
  } catch {
    return null
  }
}
