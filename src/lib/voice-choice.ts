export type VoiceChoice = 'free' | 'elevenlabs'

export const VOICE_WARNING = 'ElevenLabs failed, used free voice'
export const ASR_WARNING = 'ElevenLabs failed, used free recognition'
export const KEY_MISSING = 'Server ElevenLabs key not configured'

export function voiceChoice(value: unknown, fallback: VoiceChoice = 'free'): VoiceChoice {
  return value === 'free' || value === 'elevenlabs' ? value : fallback
}

export function voiceBadge(value: unknown): 'Free' | 'ElevenLabs' {
  return value === 'elevenlabs' ? 'ElevenLabs' : 'Free'
}

export function elevenLabsSelectable(configured: boolean): { disabled: boolean; hint: string | null } {
  return configured ? { disabled: false, hint: null } : { disabled: true, hint: KEY_MISSING }
}

export function latestProviderWarning(items: Array<{ lineId: string; text: string }>, lineId: string): string | null {
  return items.find((item) => item.lineId === lineId && item.text.startsWith('ElevenLabs failed'))?.text ?? null
}
