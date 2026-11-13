export const STT_IDS = ['free', 'elevenlabs', 'openai', 'google', 'azure', 'deepgram'] as const
export type SttProviderId = (typeof STT_IDS)[number]
export type SttChoice = SttProviderId | 'inherit'

export const STT_LABELS: Record<SttProviderId, string> = {
  free: 'Free (local Whisper)',
  elevenlabs: 'ElevenLabs Scribe',
  openai: 'OpenAI Whisper API',
  google: 'Google Speech',
  azure: 'Azure Speech',
  deepgram: 'Deepgram',
}

const CHOICES = new Set<string>(['inherit', ...STT_IDS])

export function parseStt(value: unknown, fallback: SttChoice = 'free'): SttChoice {
  return typeof value === 'string' && CHOICES.has(value) ? (value as SttChoice) : fallback
}

/** A line set to inherit uses the server default. Anything else stays on that provider. */
export function storedStt(value: unknown, fallback: SttProviderId = 'free'): SttProviderId {
  const parsed = parseStt(value, fallback)
  return parsed === 'inherit' ? fallback : parsed
}

export function resolveStt(line: unknown, globalDefault: unknown): SttProviderId {
  const global = parseStt(globalDefault, 'free')
  const chosen = parseStt(line, 'free')
  const resolved = chosen === 'inherit' ? global : chosen
  return resolved === 'inherit' ? 'free' : resolved
}

export function sttWarning(provider: SttProviderId): string {
  return `${STT_LABELS[provider]} failed, used free recognition`
}

export type PublicSttProvider = {
  id: SttProviderId
  label: string
  needsKey: boolean
  configured: boolean
}

export function publicStt(input: { defaultProvider: unknown; configured: readonly string[]; localEngine: boolean }) {
  const configured = new Set(input.configured)
  return {
    defaultProvider: resolveStt('inherit', input.defaultProvider),
    localEngine: input.localEngine,
    providers: STT_IDS.map((id) => ({
      id,
      label: STT_LABELS[id],
      needsKey: id !== 'free',
      configured: id === 'free' ? input.localEngine : configured.has(id),
    })),
  }
}
