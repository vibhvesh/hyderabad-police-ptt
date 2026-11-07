import { env, pipeline, type ProgressInfo } from '@huggingface/transformers'
import { applyLanguagePrefix, type PrefixTokenizer } from './lib/marian-prefix.ts'
import { translationPlan } from './lib/translation-plan.ts'
import type { LangId } from './lib/types.ts'

const wasm = env.backends.onnx.wasm
if (wasm) wasm.numThreads = 1
env.allowLocalModels = false
env.useBrowserCache = true

type Translator = ((text: string) => Promise<Array<{ translation_text?: string }>>) & { tokenizer: PrefixTokenizer }

type Inbound =
  | { type: 'prepare'; source: LangId; target: LangId }
  | { type: 'translate'; id: string; text: string; source: LangId; target: LangId }

type Outbound =
  | { type: 'progress'; model: string; progress: number }
  | { type: 'ready'; model: string }
  | { type: 'result'; id: string; text: string; note: string; state: 'translated' | 'same' }
  | { type: 'error'; id?: string; message: string }

const models = new Map<string, Promise<Translator>>()

function post(message: Outbound) {
  self.postMessage(message)
}

function load(model: string): Promise<Translator> {
  let pending = models.get(model)
  if (!pending) {
    pending = (pipeline('translation', model, {
      dtype: 'q8',
      device: 'wasm',
      progress_callback: (info: ProgressInfo) => {
        if (info.status === 'progress' || info.status === 'progress_total') {
          post({ type: 'progress', model, progress: info.progress })
        }
      },
    }) as unknown as Promise<Translator>)
      .then((translator) => {
        applyLanguagePrefix(translator.tokenizer)
        post({ type: 'ready', model })
        return translator
      })
      .catch((error: unknown) => {
        models.delete(model)
        throw error
      })
    models.set(model, pending)
  }
  return pending
}

async function translate(text: string, source: LangId, target: LangId) {
  const plan = translationPlan(source, target)
  if (plan.kind === 'same') return { text, note: plan.note, state: 'same' as const }
  let current = text.trim()
  for (const hop of plan.hops) {
    const model = await load(hop.model)
    const input = hop.prefix ? `${hop.prefix} ${current}` : current
    const output = await model(input)
    const next = output[0]?.translation_text?.replace(/\s+/g, ' ').trim() ?? ''
    if (!next || next.includes('>>')) {
      throw new Error('The translation model returned an unusable string. The original text is unchanged.')
    }
    current = next
  }
  return { text: current, note: plan.note, state: 'translated' as const }
}

self.onmessage = (event: MessageEvent<Inbound>) => {
  const msg = event.data
  void (async () => {
    try {
      if (msg.type === 'prepare') {
        const plan = translationPlan(msg.source, msg.target)
        for (const hop of plan.hops) await load(hop.model)
        return
      }
      const result = await translate(msg.text, msg.source, msg.target)
      post({ type: 'result', id: msg.id, ...result })
    } catch (error) {
      post({
        type: 'error',
        id: msg.type === 'translate' ? msg.id : undefined,
        message: error instanceof Error ? error.message : 'Translation model failed',
      })
    }
  })()
}
