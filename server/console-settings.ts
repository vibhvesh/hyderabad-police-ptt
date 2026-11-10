import type { Config } from './config.ts'
import { readJsonFile, writeJsonFile } from './json-file.ts'

export type AsrChoice = 'none' | 'transformers' | 'whisper-cli' | 'mock'
export type TranslateChoice = 'none' | 'opus'

export type ConsoleSettings = {
  asrProvider: AsrChoice
  translateProvider: TranslateChoice
  elevenLabsFallback: boolean
  elevenLabsApiKey: string | null
  retentionDays: number
}

export type PublicConsoleSettings = {
  asrProvider: AsrChoice
  translateProvider: TranslateChoice
  elevenLabsFallback: boolean
  elevenLabsConfigured: boolean
  retentionDays: number
}

export function defaultConsoleSettings(config: Config): ConsoleSettings {
  const asr = config.asrProvider
  return {
    asrProvider: asr === 'transformers' || asr === 'whisper-cli' || asr === 'mock' ? asr : 'none',
    translateProvider: config.translateProvider === 'opus' ? 'opus' : 'none',
    elevenLabsFallback: false,
    elevenLabsApiKey: config.elevenLabsApiKey,
    retentionDays: 14,
  }
}

export function publicConsoleSettings(settings: ConsoleSettings): PublicConsoleSettings {
  return {
    asrProvider: settings.asrProvider,
    translateProvider: settings.translateProvider,
    elevenLabsFallback: settings.elevenLabsFallback,
    elevenLabsConfigured: Boolean(settings.elevenLabsApiKey),
    retentionDays: settings.retentionDays,
  }
}

export class ConsoleSettingsStore {
  private settings: ConsoleSettings
  private file: string

  constructor(file: string, defaults: ConsoleSettings) {
    this.file = file
    const loaded = readJsonFile<Partial<ConsoleSettings>>(file, () => defaults)
    this.settings = sanitize(loaded, defaults)
  }

  get(): ConsoleSettings {
    return { ...this.settings }
  }

  view(): PublicConsoleSettings {
    return publicConsoleSettings(this.settings)
  }

  update(patch: Partial<ConsoleSettings> & { clearElevenLabsKey?: boolean }): PublicConsoleSettings {
    const next = sanitize({ ...this.settings, ...patch }, this.settings)
    if (patch.clearElevenLabsKey) next.elevenLabsApiKey = null
    else if (patch.elevenLabsApiKey === undefined) next.elevenLabsApiKey = this.settings.elevenLabsApiKey
    this.settings = next
    writeJsonFile(this.file, this.settings)
    return this.view()
  }
}

function sanitize(value: Partial<ConsoleSettings>, fallback: ConsoleSettings): ConsoleSettings {
  const asr = value.asrProvider
  const translate = value.translateProvider
  const days = Number(value.retentionDays)
  const key = typeof value.elevenLabsApiKey === 'string' ? value.elevenLabsApiKey.trim() : value.elevenLabsApiKey
  return {
    asrProvider: asr === 'transformers' || asr === 'whisper-cli' || asr === 'mock' || asr === 'none' ? asr : fallback.asrProvider,
    translateProvider: translate === 'opus' || translate === 'none' ? translate : fallback.translateProvider,
    elevenLabsFallback: typeof value.elevenLabsFallback === 'boolean' ? value.elevenLabsFallback : fallback.elevenLabsFallback,
    elevenLabsApiKey: key ? String(key).slice(0, 200) : key === null ? null : fallback.elevenLabsApiKey,
    retentionDays: Number.isFinite(days) ? Math.min(365, Math.max(1, Math.round(days))) : fallback.retentionDays,
  }
}
