const ENGLISH = /^(who|what|when|where|why|how|which|whose|is|are|can|do|does|did|could|would|should)\b/i
const INDIC =
  /(क्या|कहाँ|कहां|कब|क्यों|कैसे|कौन|ఏమిటి|ఎక్కడ|ఎప్పుడు|ఎందుకు|ఎలా|ఎవరు|ఏమి)/

/** Only an explicit question or an assistant invocation should be answered. */
export function isExplicitQuestion(text: string): boolean {
  const trimmed = text.trim()
  if (!trimmed) return false
  if (/[?？]/.test(trimmed)) return true
  if (ENGLISH.test(trimmed)) return true
  if (INDIC.test(trimmed)) return true
  if (/\b(assistant|sanket)\b/i.test(trimmed)) return true
  return false
}

export function questionKey(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}
