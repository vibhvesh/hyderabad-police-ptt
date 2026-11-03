import { ELEVEN_MODEL } from './constants.ts'
import type { WorkerOut } from './whisper-types.ts'

export type ModelStatus =
  | { state: 'idle' }
  | { state: 'loading'; progress: number }
  | { state: 'ready' }
  | { state: 'error'; message: string }

type StatusHandler = (status: ModelStatus) => void

let worker: Worker | null = null
let ready: Promise<void> | null = null
let resolveReady: (() => void) | null = null
let rejectReady: ((error: Error) => void) | null = null
let onStatus: StatusHandler = () => {}
const pending = new Map<string, { resolve: (text: string) => void; reject: (error: Error) => void }>()

function failModel(message: string) {
  onStatus({ state: 'error', message })
  rejectReady?.(new Error(message))
  for (const job of pending.values()) job.reject(new Error(message))
  pending.clear()
  worker?.terminate()
  worker = null
  ready = null
  resolveReady = null
  rejectReady = null
}

export function watchModel(handler: StatusHandler) {
  onStatus = handler
}

export function ensureModel() {
  if (worker) return
  ready = new Promise((resolve, reject) => {
    resolveReady = resolve
    rejectReady = reject
  })
  onStatus({ state: 'loading', progress: 0 })
  worker = new Worker(new URL('../whisper.worker.ts', import.meta.url), { type: 'module' })
  worker.onmessage = (event: MessageEvent<WorkerOut>) => {
    const msg = event.data
    if (msg.type === 'progress') {
      onStatus({ state: 'loading', progress: Math.max(0, Math.min(100, Math.round(msg.progress))) })
      return
    }
    if (msg.type === 'ready') {
      onStatus({ state: 'ready' })
      resolveReady?.()
      return
    }
    if (msg.type === 'result') {
      pending.get(msg.id)?.resolve(msg.text)
      pending.delete(msg.id)
      return
    }
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)?.reject(new Error(msg.message))
      pending.delete(msg.id)
      return
    }
    failModel(msg.message)
  }
  worker.onerror = () => failModel('The speech model could not start in this browser.')
  worker.postMessage({ type: 'load' })
}

export async function transcribeLocal(audio: Float32Array, language: string): Promise<string> {
  ensureModel()
  await ready
  const id = crypto.randomUUID()
  const current = worker
  if (!current) throw new Error('Speech model is not loaded.')
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject })
    current.postMessage({ type: 'transcribe', id, audio, language }, [audio.buffer])
  })
}

export async function transcribeEleven(wav: ArrayBuffer, language: string, apiKey: string): Promise<string> {
  const body = new FormData()
  body.append('model_id', ELEVEN_MODEL)
  body.append('language_code', language)
  body.append('file', new Blob([wav], { type: 'audio/wav' }), 'clip.wav')
  const response = await fetch('https://api.elevenlabs.io/v1/speech-to-text', {
    method: 'POST',
    headers: { 'xi-api-key': apiKey },
    body,
  })
  if (!response.ok) {
    let detail = `ElevenLabs returned ${response.status}`
    try {
      const payload = (await response.json()) as { detail?: { message?: string } | string }
      if (typeof payload.detail === 'string') detail = payload.detail
      else if (payload.detail?.message) detail = payload.detail.message
    } catch {
      /* keep the status text */
    }
    throw new Error(detail.slice(0, 180))
  }
  const payload = (await response.json()) as { text?: string }
  return (payload.text ?? '').trim()
}
