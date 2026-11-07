import type { LangId } from './types.ts'

export type TranslationHop = {
  model: string
  /** Marian language token the browser tokenizer otherwise splits. */
  prefix: string | null
  megabytes: number
}

export type TranslationPlan =
  | { kind: 'same'; note: string; megabytes: 0; hops: [] }
  | { kind: 'translate'; note: string; megabytes: number; hops: TranslationHop[] }

const EN_HI: TranslationHop = { model: 'Xenova/opus-mt-en-hi', prefix: null, megabytes: 110 }
const HI_EN: TranslationHop = { model: 'Xenova/opus-mt-hi-en', prefix: null, megabytes: 110 }
const EN_TE: TranslationHop = { model: 'Xenova/opus-mt-en-mul', prefix: '>>tel<<', megabytes: 112 }
const TE_EN: TranslationHop = { model: 'Xenova/opus-mt-mul-en', prefix: null, megabytes: 112 }

/** Browser OPUS routes. Hindi uses the dedicated pair. Telugu uses the multilingual pair with an explicit language token. */
export function translationPlan(source: LangId, target: LangId): TranslationPlan {
  if (source === target) {
    return { kind: 'same', note: 'Source and output language match, so the original text is shown once.', megabytes: 0, hops: [] }
  }
  const hops =
    source === 'en' && target === 'hi' ? [EN_HI]
    : source === 'hi' && target === 'en' ? [HI_EN]
    : source === 'en' && target === 'te' ? [EN_TE]
    : source === 'te' && target === 'en' ? [TE_EN]
    : source === 'hi' && target === 'te' ? [HI_EN, EN_TE]
    : [TE_EN, EN_HI]
  const through = hops.length > 1 ? ' This pair is translated through English on this device.' : ''
  const megabytes = hops.reduce((sum, hop) => sum + hop.megabytes, 0)
  return {
    kind: 'translate',
    hops,
    megabytes,
    note: `On-device OPUS translation, about ${megabytes} MB the first time, then cached in this browser. WebAssembly, not the server.${through}`,
  }
}
