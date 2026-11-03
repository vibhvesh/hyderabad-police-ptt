import { env, pipeline, type ProgressInfo } from '@huggingface/transformers'
import { WHISPER_MODEL } from './lib/constants.ts'
import type { WorkerIn, WorkerOut } from './lib/whisper-types.ts'

const wasm = env.backends.onnx.wasm
if (wasm) wasm.numThreads = 1
env.allowLocalModels = false
env.useBrowserCache = true

type Asr = Awaited<ReturnType<typeof pipeline<'automatic-speech-recognition'>>>

let asr: Asr | null = null
let loading: Promise<Asr> | null = null

function post(message: WorkerOut) {
  self.postMessage(message)
}

function load(): Promise<Asr> {
  if (asr) return Promise.resolve(asr)
  if (!loading) {
    loading = pipeline('automatic-speech-recognition', WHISPER_MODEL, {
      dtype: 'q8',
      device: 'wasm',
      progress_callback: (info: ProgressInfo) => {
        if (info.status === 'progress_total' || info.status === 'progress') {
          post({ type: 'progress', progress: info.progress, status: info.status })
        }
      },
    })
      .then((model) => {
        asr = model
        post({ type: 'ready' })
        return model
      })
      .catch((error: unknown) => {
        loading = null
        throw error
      })
  }
  return loading
}

self.onmessage = (event: MessageEvent<WorkerIn>) => {
  const msg = event.data
  void (async () => {
    try {
      if (msg.type === 'load') {
        await load()
        return
      }
      const model = await load()
      const result = await model(msg.audio, {
        language: msg.language,
        task: 'transcribe',
        return_timestamps: false,
        chunk_length_s: 30,
        stride_length_s: 5,
      })
      post({ type: 'result', id: msg.id, text: result.text ?? '' })
    } catch (error) {
      post({
        type: 'error',
        id: msg.type === 'transcribe' ? msg.id : undefined,
        message: error instanceof Error ? error.message : 'Speech model failed',
      })
    }
  })()
}
