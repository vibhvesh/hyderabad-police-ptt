export type DiffLine = { op: ' ' | '+' | '-'; text: string }

export function diffLines(before: string, after: string): DiffLine[] {
  const a = before.replace(/\r\n/g, '\n').split('\n')
  const b = after.replace(/\r\n/g, '\n').split('\n')
  if (a.length * b.length > 80_000) {
    return [...a.map((text) => ({ op: '-' as const, text })), ...b.map((text) => ({ op: '+' as const, text }))]
  }
  const dp: number[][] = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0))
  for (let i = a.length - 1; i >= 0; i--) {
    const row = dp[i]
    const next = dp[i + 1]
    if (!row || !next) continue
    for (let j = b.length - 1; j >= 0; j--) {
      row[j] = a[i] === b[j] ? (next[j + 1] ?? 0) + 1 : Math.max(next[j] ?? 0, row[j + 1] ?? 0)
    }
  }
  const out: DiffLine[] = []
  let i = 0
  let j = 0
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      out.push({ op: ' ', text: a[i] ?? '' })
      i++
      j++
      continue
    }
    const down = dp[i + 1]?.[j] ?? 0
    const right = dp[i]?.[j + 1] ?? 0
    if (down >= right) out.push({ op: '-', text: a[i++] ?? '' })
    else out.push({ op: '+', text: b[j++] ?? '' })
  }
  while (i < a.length) out.push({ op: '-', text: a[i++] ?? '' })
  while (j < b.length) out.push({ op: '+', text: b[j++] ?? '' })
  return out
}

export function supersededFacts(diff: readonly DiffLine[]): string[] {
  return diff.filter((line) => line.op === '-' && line.text.trim() && /\d/.test(line.text)).map((line) => line.text)
}
