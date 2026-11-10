import type { LineLang } from './lines.ts'

export type TranslatePlan =
  | { action: 'skip'; note: string }
  | { action: 'translate' }

/** Telugu is never guessed. English and Hindi use the dedicated OPUS pair when translation is on. */
export function translatePlan(source: LineLang, target: LineLang, translateEnabled: boolean): TranslatePlan {
  if (!source || source === target) return { action: 'skip', note: 'Source and output language match.' }
  if (source === 'te' || target === 'te') {
    return { action: 'skip', note: 'Telugu translation is not enabled. The original transcript is unchanged.' }
  }
  if (!translateEnabled) return { action: 'skip', note: 'Server translation is off for this console.' }
  if ((source === 'en' && target === 'hi') || (source === 'hi' && target === 'en')) return { action: 'translate' }
  return { action: 'skip', note: 'This language pair is not translated on the server.' }
}
