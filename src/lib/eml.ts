export type ParsedEmail = {
  from: string
  subject: string
  date: string | null
  messageId: string | null
  body: string
}

function unfold(raw: string): string {
  return raw.replace(/\r\n/g, '\n').replace(/\n[ \t]+/g, ' ')
}

function headersOf(block: string): Map<string, string> {
  const headers = new Map<string, string>()
  for (const line of unfold(block).split('\n')) {
    const index = line.indexOf(':')
    if (index < 1) continue
    headers.set(line.slice(0, index).trim().toLowerCase(), line.slice(index + 1).trim())
  }
  return headers
}

function decodeBody(body: string, encoding: string | undefined): string {
  const kind = encoding?.toLowerCase() ?? ''
  if (kind.includes('base64')) {
    try {
      const binary = atob(body.replace(/\s+/g, ''))
      const bytes = new Uint8Array(binary.length)
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
      return new TextDecoder().decode(bytes)
    } catch {
      return body
    }
  }
  if (kind.includes('quoted-printable')) {
    const soft = body.replace(/=\n/g, '')
    return soft.replace(/=([0-9A-Fa-f]{2})/g, (_, hex: string) => String.fromCharCode(Number.parseInt(hex, 16)))
  }
  return body
}

function plainPart(raw: string, headers: Map<string, string>): string {
  const type = headers.get('content-type') ?? ''
  const boundary = /boundary="?([^";]+)"?/i.exec(type)?.[1]
  if (!boundary) return decodeBody(raw, headers.get('content-transfer-encoding'))
  const parts = raw.split(new RegExp(`--${boundary.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`))
  for (const part of parts) {
    const split = part.indexOf('\n\n')
    if (split < 0) continue
    const partHeaders = headersOf(part.slice(0, split))
    const partType = partHeaders.get('content-type') ?? 'text/plain'
    if (partType.toLowerCase().includes('text/plain')) {
      return decodeBody(part.slice(split + 2).replace(/--\s*$/, ''), partHeaders.get('content-transfer-encoding')).trim()
    }
  }
  return ''
}

export function parseEml(raw: string): ParsedEmail | { error: string } {
  const text = raw.replace(/^\uFEFF/, '')
  if (text.length > 200_000) return { error: 'The email is over the size limit.' }
  const split = text.replace(/\r\n/g, '\n').indexOf('\n\n')
  if (split < 0) return { error: 'The email is missing a body.' }
  const headers = headersOf(text.slice(0, split))
  const body = plainPart(text.slice(split + 2), headers).trim()
  if (!body) return { error: 'The email has no plain-text body. PDF and HTML-only mail are not parsed.' }
  return {
    from: headers.get('from') || 'unknown',
    subject: headers.get('subject') || '(no subject)',
    date: headers.get('date') ?? null,
    messageId: headers.get('message-id') ?? null,
    body,
  }
}
