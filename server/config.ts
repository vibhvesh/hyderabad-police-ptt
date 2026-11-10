import { hostnameOf } from '../src/lib/host-surface.ts'

export type ProviderMode = 'unconfigured' | 'live' | 'mock' | 'remote'

export type Config = {
  host: string
  port: number
  adminToken: string | null
  reviewerToken: string | null
  ingestToken: string | null
  webhookSecret: string | null
  webhookToken: string | null
  dataDir: string
  staticDir: string | null
  cors: string
  kbMaxBytes: number
  audioMaxBytes: number
  fetchBearer: string | null
  asrProvider: 'none' | 'mock' | 'whisper-cli' | 'transformers'
  asrModel: string
  whisperCli: string
  allowMock: boolean
  translateProvider: 'none' | 'libre' | 'mymemory' | 'opus'
  translateModelEnHi: string
  translateModelHiEn: string
  modelDir: string
  libreUrl: string | null
  libreKey: string | null
  ttsProvider: 'none' | 'mock' | 'espeak'
  espeakBin: string
  audioInput: string | null
  audioOutput: string | null
  piProfile: string | null
  tlsCert: string | null
  tlsKey: string | null
  demoAccessCode: string | null
  demoOrigins: string[]
  elevenLabsApiKey: string | null
  publicHost: string | null
  adminHost: string | null
}

function blank(value: string | undefined): string | null {
  const trimmed = value?.trim()
  return trimmed ? trimmed : null
}

function numberValue(value: string | undefined, fallback: number): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const asr = env.ASR_PROVIDER?.trim() || 'none'
  const translate = env.TRANSLATE_PROVIDER?.trim() || 'none'
  const tts = env.TTS_PROVIDER?.trim() || 'none'
  return {
    host: env.HOST?.trim() || '0.0.0.0',
    port: numberValue(env.PORT, 8080),
    adminToken: blank(env.ADMIN_TOKEN),
    reviewerToken: blank(env.REVIEWER_TOKEN),
    ingestToken: blank(env.INGEST_TOKEN),
    webhookSecret: blank(env.WEBHOOK_SECRET),
    webhookToken: blank(env.WEBHOOK_TOKEN),
    dataDir: env.DATA_DIR?.trim() || 'data',
    staticDir: blank(env.STATIC_DIR),
    cors: env.CORS_ORIGINS?.trim() || '*',
    kbMaxBytes: numberValue(env.KB_MAX_BYTES, 262_144),
    audioMaxBytes: numberValue(env.AUDIO_MAX_BYTES, 5_000_000),
    fetchBearer: blank(env.SOURCE_FETCH_BEARER),
    asrProvider: asr === 'mock' || asr === 'whisper-cli' || asr === 'transformers' ? asr : 'none',
    asrModel: env.ASR_MODEL?.trim() || 'onnx-community/whisper-tiny',
    whisperCli: env.WHISPER_CLI?.trim() || 'whisper-cli',
    allowMock: env.ALLOW_MOCK_PROVIDERS === '1',
    translateProvider: translate === 'libre' || translate === 'mymemory' || translate === 'opus' ? translate : 'none',
    translateModelEnHi: env.TRANSLATE_MODEL_EN_HI?.trim() || 'Xenova/opus-mt-en-hi',
    translateModelHiEn: env.TRANSLATE_MODEL_HI_EN?.trim() || 'Xenova/opus-mt-hi-en',
    modelDir: env.MODEL_DIR?.trim() || 'data/models',
    libreUrl: blank(env.LIBRETRANSLATE_URL),
    libreKey: blank(env.LIBRETRANSLATE_API_KEY),
    ttsProvider: tts === 'mock' || tts === 'espeak' ? tts : 'none',
    espeakBin: env.ESPEAK_BIN?.trim() || 'espeak-ng',
    audioInput: blank(env.AUDIO_INPUT),
    audioOutput: blank(env.AUDIO_OUTPUT),
    piProfile: blank(env.PI_PROFILE),
    tlsCert: blank(env.TLS_CERT),
    tlsKey: blank(env.TLS_KEY),
    demoAccessCode: blank(env.DEMO_ACCESS_CODE),
    demoOrigins: (env.DEMO_ORIGINS?.trim() || 'https://sanket-ptt.onrender.com,https://vibhvesh.github.io,https://ptt.bowlinger.net,https://pttadmin.bowlinger.net')
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean),
    elevenLabsApiKey: blank(env.ELEVENLABS_API_KEY),
    publicHost: hostnameOf(env.PUBLIC_HOST),
    adminHost: hostnameOf(env.ADMIN_HOST),
  }
}
