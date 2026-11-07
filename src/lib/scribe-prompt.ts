export type CloudKeySource = 'server' | 'session' | 'none'

/** The masked field stays hidden until this visit explicitly opts into cloud transcription. */
export function cloudKeyPrompt(optedIn: boolean, source: CloudKeySource): 'hidden' | 'ask' | 'ready' {
  if (!optedIn) return 'hidden'
  if (source === 'none') return 'ask'
  return 'ready'
}
