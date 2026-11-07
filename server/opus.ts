/** Direct local pairs that the installed OPUS ONNX models actually translate. */
export const OPUS_MODELS: Record<string, string> = {
  'en-hi': 'Xenova/opus-mt-en-hi',
  'hi-en': 'Xenova/opus-mt-hi-en',
}

const SUPPORTED = new Set(['en', 'hi', 'te'])

export function opusModel(source: string, target: string, overrides: Partial<Record<string, string>> = {}): { model: string } | { error: string } {
  if (!SUPPORTED.has(source) || !SUPPORTED.has(target)) {
    return { error: `Local translation supports English, Hindi, and Telugu labels. ${source} to ${target} is not one of those.` }
  }
  if (source === target) return { model: '' }
  if (source === 'te' || target === 'te') {
    return {
      error:
        'Telugu translation is not enabled. The multilingual OPUS model splits its Telugu language token in this runtime, so the server refuses that pair instead of returning a broken string. English and Hindi use the dedicated OPUS models.',
    }
  }
  const key = `${source}-${target}`
  const model = overrides[key] || OPUS_MODELS[key]
  if (!model) return { error: `No local model is configured for ${source} to ${target}.` }
  return { model }
}
