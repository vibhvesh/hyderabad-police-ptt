import { translateLocal } from './translate-local.ts'
import type { LangId } from './types.ts'

export type Translation =
  | { state: 'same'; text: string; note: string }
  | { state: 'translated'; text: string; note: string }
  | { state: 'unconfigured'; text: ''; note: string }
  | { state: 'error'; text: ''; note: string }

export async function translateText(text: string, source: string, target: string): Promise<Translation> {
  const original = text.trim()
  if (!original) return { state: 'same', text: '', note: 'Nothing to translate.' }
  if (source !== 'te' && source !== 'en' && source !== 'hi') {
    return { state: 'unconfigured', text: '', note: 'Translation on this device supports Telugu, Hindi, and English.' }
  }
  if (target !== 'te' && target !== 'en' && target !== 'hi') {
    return { state: 'unconfigured', text: '', note: 'Translation on this device supports Telugu, Hindi, and English.' }
  }
  try {
    const result = await translateLocal(original, source as LangId, target as LangId)
    return result.state === 'same'
      ? { state: 'same', text: original, note: result.note }
      : { state: 'translated', text: result.text, note: result.note }
  } catch (error) {
    return { state: 'error', text: '', note: error instanceof Error ? error.message : 'On-device translation failed.' }
  }
}
