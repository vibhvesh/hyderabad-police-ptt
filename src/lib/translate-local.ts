import type { LangId } from './types.ts'
import { translationPlan } from './translation-plan.ts'

export type TranslateStatus =
  | { state: 'idle' }
  | { state: 'loading'; progress: number; model: string }
  | { state: 'ready' }
  | { state: 'error'; message: string }

type WorkerOut =
  | { type: 'progress'; model: string; progress: number }
  | { type: 'ready'; model: string }
  | { type: 'result'; id: string; text: string; note: string; state: 'translated' | 'same' }
  | { type: 'error'; id?: string; message: string }

type StatusHandler = (status: TranslateStatus) => void

let worker: Worker | null = null
let onStatus: StatusHandler = () => {}
const pending = new Map<string, { resolve: (value: { text: string; note: string; state: 'translated' | 'same' }) => void; reject: (error: Error) => void }>()

function fail(message: string) {
  onStatus({ state: 'error', message })
  for (const job of pending.values()) job.reject(new Error(message))
  pending.clear()
  worker?.terminate()
  worker = null
}

export function watchTranslation(handler: StatusHandler) {
  onStatus = handler
}

export function ensureTranslation(source: LangId, target: LangId) {
  if (translationPlan(source, target).kind === 'same') return
  const current = worker ?? start()
  current.postMessage({ type: 'prepare', source, target })
}

function start(): Worker {
  if (worker) return worker
  worker = new Worker(new URL('../translate.worker.ts', import.meta.url), { type: 'module' })
  worker.onmessage = (event: MessageEvent<WorkerOut>) => {
    const msg = event.data
    if (msg.type === 'progress') {
      onStatus({ state: 'loading', progress: Math.max(0, Math.min(100, Math.round(msg.progress))), model: msg.model })
      return
    }
    if (msg.type === 'ready') {
      onStatus({ state: 'ready' })
      return
    }
    if (msg.type === 'result') {
      pending.get(msg.id)?.resolve({ text: msg.text, note: msg.note, state: msg.state })
      pending.delete(msg.id)
      return
    }
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)?.reject(new Error(msg.message))
      pending.delete(msg.id)
      return
    }
    fail(msg.message)
  }
  worker.onerror = () => fail('The translation model could not start in this browser.')
  return worker
}

export async function translateLocal(text: string, source: LangId, target: LangId): Promise<{ text: string; note: string; state: 'translated' | 'same' }> {
  const plan = translationPlan(source, target)
  if (plan.kind === 'same') return { text, note: plan.note, state: 'same' }
  const current = start()
  const id = crypto.randomUUID()
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject })
    current.postMessage({ type: 'translate', id, text, source, target })
  })
}
