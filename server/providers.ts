import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { Config, ProviderMode } from './config.ts'

export type ProviderStatus = { id: string; mode: ProviderMode; detail: string }

export type AsrProvider = {
  status: () => ProviderStatus
  transcribe: (wav: Buffer, language: string, hint: string | null) => Promise<{ text: string } | { error: string; message: string }>
}

export function createAsr(config: Config): AsrProvider {
  if (config.asrProvider === 'mock' && config.allowMock) {
    return {
      status: () => ({ id: 'mock', mode: 'mock', detail: 'Test double. It does not decode speech.' }),
      async transcribe(_wav, _language, hint) {
        if (!hint?.trim()) {
          return { error: 'asr_mock', message: 'Mock ASR does not invent a transcript. Pass a test transcript explicitly.' }
        }
        return { text: hint.trim() }
      },
    }
  }
  if (config.asrProvider === 'whisper-cli') {
    return {
      status: () => ({ id: 'whisper-cli', mode: 'live', detail: `${config.whisperCli} model ${config.asrModel}` }),
      transcribe: (wav, language) => whisperCli(config, wav, language),
    }
  }
  return {
    status: () => ({ id: 'none', mode: 'unconfigured', detail: 'Set ASR_PROVIDER=whisper-cli or use on-device Whisper in the browser.' }),
    async transcribe() {
      return { error: 'asr_unconfigured', message: 'Server speech recognition is not configured.' }
    },
  }
}

async function whisperCli(config: Config, wav: Buffer, language: string): Promise<{ text: string } | { error: string; message: string }> {
  const dir = await mkdtemp(path.join(tmpdir(), 'sanket-asr-'))
  const file = path.join(dir, 'clip.wav')
  try {
    await writeFile(file, wav)
    const text = await new Promise<string>((resolve, reject) => {
      const child = spawn(config.whisperCli, ['-m', config.asrModel, '-f', file, '-l', language, '--no-prints'], {
        stdio: ['ignore', 'pipe', 'pipe'],
      })
      let out = ''
      let err = ''
      child.stdout.on('data', (chunk) => {
        out += String(chunk)
      })
      child.stderr.on('data', (chunk) => {
        err += String(chunk)
      })
      child.on('error', reject)
      child.on('close', (code) => {
        if (code === 0) resolve(out.trim())
        else reject(new Error(err.trim() || `whisper-cli exited ${code}`))
      })
    })
    return { text }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'whisper-cli failed'
    if (message.includes('ENOENT')) return { error: 'asr_unconfigured', message: 'whisper-cli is not installed.' }
    return { error: 'asr_failed', message: message.slice(0, 180) }
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

export type TranslateProvider = {
  status: () => ProviderStatus
  translate: (text: string, source: string, target: string) => Promise<{ text: string; provider: string; mode: ProviderMode } | { error: string; message: string }>
}

export function createTranslator(config: Config, fetchImpl: typeof fetch = fetch): TranslateProvider {
  return {
    status() {
      if (config.translateProvider === 'libre' && config.libreUrl) {
        return { id: 'libre', mode: 'live', detail: 'LibreTranslate at the configured URL.' }
      }
      if (config.translateProvider === 'mymemory') {
        return { id: 'mymemory', mode: 'remote', detail: 'Public MyMemory API. Do not send sensitive text.' }
      }
      return { id: 'none', mode: 'unconfigured', detail: 'Translation is not configured. Same-language text is returned unchanged.' }
    },
    async translate(text, source, target) {
      if (source === target) return { text, provider: 'identity', mode: 'live' }
      if (config.translateProvider === 'libre') {
        if (!config.libreUrl) return { error: 'translation_unconfigured', message: 'LIBRETRANSLATE_URL is not set.' }
        return libre(config, text, source, target, fetchImpl)
      }
      if (config.translateProvider === 'mymemory') return myMemory(text, source, target, fetchImpl)
      return { error: 'translation_unconfigured', message: 'Server translation is not configured.' }
    },
  }
}

async function libre(
  config: Config,
  text: string,
  source: string,
  target: string,
  fetchImpl: typeof fetch,
): Promise<{ text: string; provider: string; mode: ProviderMode } | { error: string; message: string }> {
  try {
    const response = await fetchImpl(new URL('/translate', config.libreUrl ?? undefined), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ q: text, source, target, format: 'text', api_key: config.libreKey ?? undefined }),
    })
    if (!response.ok) return { error: 'translation_failed', message: `LibreTranslate returned ${response.status}.` }
    const payload = (await response.json()) as { translatedText?: string }
    if (!payload.translatedText) return { error: 'translation_failed', message: 'LibreTranslate returned no text.' }
    return { text: payload.translatedText, provider: 'libre', mode: 'live' }
  } catch {
    return { error: 'translation_failed', message: 'LibreTranslate could not be reached.' }
  }
}

async function myMemory(
  text: string,
  source: string,
  target: string,
  fetchImpl: typeof fetch,
): Promise<{ text: string; provider: string; mode: ProviderMode } | { error: string; message: string }> {
  try {
    const url = new URL('https://api.mymemory.translated.net/get')
    url.searchParams.set('q', text.slice(0, 500))
    url.searchParams.set('langpair', `${source}|${target}`)
    const response = await fetchImpl(url)
    if (!response.ok) return { error: 'translation_failed', message: `MyMemory returned ${response.status}.` }
    const payload = (await response.json()) as { responseData?: { translatedText?: string } }
    const translated = payload.responseData?.translatedText?.trim()
    if (!translated) return { error: 'translation_failed', message: 'MyMemory returned no text.' }
    return { text: translated, provider: 'mymemory', mode: 'remote' }
  } catch {
    return { error: 'translation_failed', message: 'MyMemory could not be reached.' }
  }
}

export type TtsProvider = {
  status: () => ProviderStatus
  speak: (text: string) => Promise<Int16Array | null>
}

export function createTts(config: Config): TtsProvider {
  if (config.ttsProvider === 'mock' && config.allowMock) {
    return {
      status: () => ({ id: 'mock', mode: 'mock', detail: 'Test tone, not speech.' }),
      async speak() {
        return new Int16Array([0, 1000, -1000, 0])
      },
    }
  }
  if (config.ttsProvider === 'espeak') {
    return {
      status: () => ({ id: 'espeak', mode: 'live', detail: config.espeakBin }),
      speak: (text) => espeak(config.espeakBin, text),
    }
  }
  return {
    status: () => ({ id: 'none', mode: 'unconfigured', detail: 'Text notices are sent without spoken audio.' }),
    async speak() {
      return null
    },
  }
}

async function espeak(bin: string, text: string): Promise<Int16Array | null> {
  const dir = await mkdtemp(path.join(tmpdir(), 'sanket-tts-'))
  const file = path.join(dir, 'out.wav')
  try {
    const code = await new Promise<number>((resolve, reject) => {
      const child = spawn(bin, ['-s', '140', '-w', file, text.slice(0, 400)], { stdio: 'ignore' })
      child.on('error', reject)
      child.on('close', (status) => resolve(status ?? 1))
    })
    if (code !== 0) return null
    const wav = await readFile(file)
    return wavToPcm(wav)
  } catch {
    return null
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

function wavToPcm(wav: Buffer): Int16Array | null {
  if (wav.toString('ascii', 0, 4) !== 'RIFF') return null
  const rate = wav.readUInt32LE(24)
  const data = wav.subarray(44)
  const samples = new Int16Array(data.buffer, data.byteOffset, Math.floor(data.length / 2))
  if (rate === 12_000) return samples
  const outLen = Math.max(1, Math.floor((samples.length * 12_000) / rate))
  const out = new Int16Array(outLen)
  for (let i = 0; i < outLen; i++) out[i] = samples[Math.min(samples.length - 1, Math.floor((i * rate) / 12_000))] ?? 0
  return out
}
