export type WorkerIn =
  | { type: 'load' }
  | { type: 'transcribe'; id: string; audio: Float32Array; language: string }

export type WorkerOut =
  | { type: 'progress'; progress: number; status: string }
  | { type: 'ready' }
  | { type: 'result'; id: string; text: string }
  | { type: 'error'; message: string; id?: string }
