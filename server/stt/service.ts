import type { ConsoleSettingsStore } from '../console-settings.ts'
import { storedStt, publicStt, type SttProviderId } from '../../src/lib/stt.ts'
import { SttSecrets } from './secrets.ts'

export class SttService {
  private secrets: SttSecrets
  private settings: ConsoleSettingsStore
  private envElevenLabs: string | null
  private localEngine: boolean

  constructor(secrets: SttSecrets, settings: ConsoleSettingsStore, envElevenLabs: string | null, localEngine: boolean) {
    this.secrets = secrets
    this.settings = settings
    this.envElevenLabs = envElevenLabs
    this.localEngine = localEngine
  }

  view() {
    const configured = new Set(this.secrets.configured())
    if (this.envElevenLabs) configured.add('elevenlabs')
    return publicStt({
      defaultProvider: this.settings.get().sttProvider,
      configured: [...configured],
      localEngine: this.localEngine,
    })
  }

  save(body: Record<string, unknown>) {
    if (typeof body.defaultProvider === 'string') {
      this.settings.update({ sttProvider: storedStt(body.defaultProvider, 'free') })
    }
    const provider = storedStt(body.provider, 'free')
    if (provider !== 'free' && typeof body.key === 'string' && body.key.trim()) {
      const key = provider === 'azure' && typeof body.region === 'string' && body.region.trim()
        ? `${body.key.trim()}|${body.region.trim()}`
        : body.key.trim()
      this.secrets.set(provider, key)
    }
    return this.view()
  }

  keyFor(id: SttProviderId): string | null {
    return this.secrets.get(id) || (id === 'elevenlabs' ? this.envElevenLabs : null)
  }
}
