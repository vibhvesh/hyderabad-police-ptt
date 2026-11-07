import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import { assessUrl } from '../src/lib/ssrf.ts'
import type { SourceConfig } from '../src/lib/kb.ts'

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>

export async function checkSourceUrl(
  input: string,
  lookupImpl: (host: string) => Promise<string[]> = resolveHost,
): Promise<{ ok: true; href: string } | { ok: false; reason: string }> {
  let host = ''
  try {
    host = new URL(input).hostname.replace(/^\[|\]$/g, '')
  } catch {
    return { ok: false, reason: 'The source URL is not valid.' }
  }
  const ips = isIP(host) ? [host] : await lookupImpl(host).catch(() => [])
  return assessUrl(input, ips)
}

export async function resolveHost(host: string): Promise<string[]> {
  const records = await lookup(host, { all: true, verbatim: true })
  return records.map((record) => record.address)
}

export async function pullSource(
  source: SourceConfig,
  options: { bearer: string | null; fetchImpl?: FetchLike; lookupImpl?: (host: string) => Promise<string[]> },
): Promise<{ text: string } | { error: string }> {
  const fetchImpl = options.fetchImpl ?? fetch
  const lookupImpl = options.lookupImpl ?? resolveHost
  let current = source.url
  for (let hop = 0; hop < 3; hop++) {
    let host = ''
    try {
      host = new URL(current).hostname
    } catch {
      return { error: 'The source URL is not valid.' }
    }
    let ips: string[] = []
    try {
      ips = await lookupImpl(host)
    } catch {
      return { error: 'The source host did not resolve.' }
    }
    const verdict = assessUrl(current, ips)
    if (!verdict.ok) return { error: verdict.reason }
    let response: Response
    try {
      response = await fetchImpl(verdict.href, {
        redirect: 'manual',
        headers: {
          accept: 'text/plain, application/json',
          'user-agent': 'sanket-ptt-fetch',
          'x-sanket-origin': 'sanket-ptt',
          ...(options.bearer ? { authorization: `Bearer ${options.bearer}` } : {}),
        },
        signal: AbortSignal.timeout(8_000),
      })
    } catch {
      return { error: 'The source could not be reached.' }
    }
    if (response.status >= 300 && response.status < 400) {
      const next = response.headers.get('location')
      if (!next) return { error: 'The source redirect had no location.' }
      current = new URL(next, verdict.href).toString()
      continue
    }
    if (!response.ok) return { error: `The source returned ${response.status}.` }
    const bytes = Buffer.from(await response.arrayBuffer())
    if (bytes.length > 200_000) return { error: 'The source response is over the size limit.' }
    if (bytes.includes(0)) return { error: 'The source response is not plain text.' }
    const type = response.headers.get('content-type') ?? ''
    const raw = bytes.toString('utf8')
    if (type.includes('json') || raw.trim().startsWith('{')) {
      try {
        const parsed = JSON.parse(raw) as { text?: unknown }
        if (typeof parsed.text === 'string' && parsed.text.trim()) return { text: parsed.text }
      } catch {
        return { error: 'The source JSON had no text field.' }
      }
    }
    if (type.includes('html')) return { error: 'HTML sources are not parsed.' }
    if (!raw.trim()) return { error: 'The source was empty.' }
    return { text: raw }
  }
  return { error: 'The source redirected too many times.' }
}
