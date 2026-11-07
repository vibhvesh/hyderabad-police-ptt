const SIMD = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11])

export type SpeechRuntime = {
  worker: boolean
  wasm: boolean
  simd: boolean
  note: string
}

export function speechRuntime(): SpeechRuntime {
  const worker = typeof Worker !== 'undefined'
  const wasm = typeof WebAssembly !== 'undefined' && typeof WebAssembly.validate === 'function'
  let simd = false
  if (wasm) {
    try {
      simd = WebAssembly.validate(SIMD)
    } catch {
      simd = false
    }
  }
  if (!worker || !wasm) {
    return {
      worker,
      wasm,
      simd,
      note: 'This browser cannot run the on-device speech model. Voice still works. Transcripts stay empty until a browser with WebAssembly workers is used.',
    }
  }
  return {
    worker,
    wasm,
    simd,
    note: simd
      ? 'On-device Whisper tiny uses WebAssembly. The download is about 41 MB and does not use the server.'
      : 'WebAssembly is available without SIMD. Whisper tiny still loads, and it may be slow. The download is about 41 MB.',
  }
}
