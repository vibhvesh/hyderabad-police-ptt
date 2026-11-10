import type { Config } from './config.ts'
import { readJsonFile, writeJsonFile } from './json-file.ts'

export type AsrChoice = 'none' | 'transformers' | 'whisper-cli' | 'mock'
export type TranslateChoice = 'none' | 'opus'

export type ConsoleSettings = {
  asrProvider: AsrChoice
  translateProvider: TranslateChoice
  elevenLabsFallback: boolean
  retentionDays: number
}

export type PublicConsoleSettings = ConsoleSettings & {
  elevenLabsConfigured: boolean
}

export function defaultConsoleSettings(config: Config): ConsoleSettings {
  const asr = config.asrProvider
  return {
    asrProvider: asr === 'transformers' || asr === 'whisper-cli' || asr === 'mock' ? asr : 'none',
    translateProvider: config.translateProvider === 'opus' ? 'opus' : 'none',
    elevenLabsFallback: false,
    retentionDays: 14,
  }
}

export class ConsoleSettingsStore {
  private settings: ConsoleSettings
  private file: string
  private keyConfigured: boolean

  constructor(file: string, defaults: ConsoleSettings, keyConfigured = false) {
    this.file = file
    this.keyConfigured = keyConfigured
    const loaded = readJsonFile<Partial<ConsoleSettings> & { elevenLabsApiKey?: unknown }>(file, () => defaults)
    const hadSecret = Boolean(loaded && typeof loaded === 'object' && loaded.elevenLabsApiKey)
    this.settings = sanitize(loaded, defaults)
    if (hadSecret) writeJsonFile(file, this.settings)
  }

  get(): ConsoleSettings {
    return { ...this.settings }
  }

  view(): PublicConsoleSettings {
    return { ...this.settings, elevenLabsConfigured: this.keyConfigured }
  }

  update(patch: Partial<ConsoleSettings>): PublicConsoleSettings {
    this.settings = sanitize({ ...this.settings, ...patch }, this.settings)
    writeJsonFile(this.file, this.settings)
    return this.view()
  }
}

function sanitize(value: Partial<ConsoleSettings>, fallback: ConsoleSettings): ConsoleSettings {
  const asr = value.asrProvider
  const translate = value.translateProvider
  const days = Number(value.retentionDays)
  return {
    asrProvider: asr === 'transformers' || asr === 'whisper-cli' || asr === 'mock' || asr === 'none' ? asr : fallback.asrProvider,
    translateProvider: translate === 'opus' || translate === 'none' ? translate : fallback.translateProvider,
    elevenLabsFallback: typeof value.elevenLabsFallback === 'boolean' ? value.elevenLabsFallback : fallback.elevenLabsFallback,
    retentionDays: Number.isFinite(days) ? Math.min(365, Math.max(1, Math.round(days))) : fallback.retentionDays,
  }
}
