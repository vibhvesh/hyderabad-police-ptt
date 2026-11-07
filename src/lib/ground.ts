const STOP = new Set([
  'the', 'a', 'an', 'of', 'is', 'are', 'was', 'what', 'where', 'when', 'who', 'why', 'how', 'which',
  'please', 'tell', 'me', 'for', 'to', 'on', 'in', 'and', 'or', 'do', 'does', 'did', 'can', 'you',
  'your', 'our', 'this', 'that', 'with', 'from', 'about', 'into', 'number', 'phone', 'new',
])

const PHONE = /\+?\d[\d\s().-]{5,}\d/g
const FREQ = /\b\d{2,4}(?:\.\d{1,4})?\s*(?:mhz|khz|hz)\b/gi

export type Passage = { start: number; end: number; text: string }

export type GroundHit =
  | { status: 'answer'; text: string; lines: string }
  | { status: 'not_found'; message: string }
  | { status: 'ambiguous'; message: string }

export function passagesOf(text: string): Passage[] {
  const lines = text.replace(/\r\n/g, '\n').split('\n')
  const out: Passage[] = []
  let buf: string[] = []
  let start = 1
  const flush = (end: number) => {
    const body = buf.join('\n').trim()
    if (body) out.push({ start, end, text: body })
    buf = []
  }
  lines.forEach((line, index) => {
    if (!line.trim()) {
      if (buf.length) flush(index)
      start = index + 2
      return
    }
    if (!buf.length) start = index + 1
    buf.push(line)
  })
  if (buf.length) flush(lines.length)
  return out
}

function tokens(value: string): string[] {
  return value.toLowerCase().match(/[\p{L}\p{N}]{2,}/gu)?.filter((token) => !STOP.has(token)) ?? []
}

function score(query: string[], passage: string): number {
  const have = new Set(tokens(passage))
  let overlap = 0
  for (const token of new Set(query)) if (have.has(token)) overlap++
  return overlap
}

export function ground(question: string, document: string): GroundHit {
  const query = tokens(question)
  const passages = passagesOf(document)
  if (!query.length || !passages.length) {
    return { status: 'not_found', message: 'No approved passage answers that question.' }
  }
  const ranked = passages
    .map((passage) => ({ passage, score: score(query, passage.text) }))
    .sort((a, b) => b.score - a.score)
  const best = ranked[0]
  const second = ranked[1]
  const distinct = new Set(query).size
  if (!best || best.score <= 0) return { status: 'not_found', message: 'No approved passage answers that question.' }
  const strong = best.score >= 2 || best.score === distinct
  if (!strong) return { status: 'not_found', message: 'No approved passage answers that question.' }
  if (second && second.score === best.score) {
    return {
      status: 'ambiguous',
      message: 'More than one approved passage matches. Name the person, place, or item and ask again.',
    }
  }
  return { status: 'answer', text: best.passage.text, lines: `${best.passage.start}-${best.passage.end}` }
}

export function verbatimMarks(passage: string): string[] {
  const phones = passage.match(PHONE) ?? []
  const freqs = passage.match(FREQ) ?? []
  return [...phones, ...freqs]
}
