export type RelayPub = {
  op: 'pub'
  topic: string
  retain?: boolean
  encoding: 'utf8' | 'base64'
  payload: string
}

export type DeviceCredentials = { id: string; token: string }
export type RelayHello = { op: 'hello'; device?: DeviceCredentials }
export type RelayMsg = { op: 'msg'; topic: string; encoding: 'utf8' | 'base64'; payload: string }
export type RelayErr = { op: 'err'; message: string }

export function encodeWire(data: Uint8Array | string): { encoding: 'utf8' | 'base64'; payload: string } {
  if (typeof data === 'string') return { encoding: 'utf8', payload: data }
  let binary = ''
  for (const byte of data) binary += String.fromCharCode(byte)
  return { encoding: 'base64', payload: btoa(binary) }
}

export function decodeWire(encoding: string, payload: string): Uint8Array | null {
  if (typeof payload !== 'string' || payload.length > 80_000) return null
  if (encoding === 'utf8') return new TextEncoder().encode(payload)
  if (encoding !== 'base64') return null
  try {
    const binary = atob(payload)
    const out = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i)
    return out
  } catch {
    return null
  }
}

function deviceCredentials(value: unknown): DeviceCredentials | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as { id?: unknown; token?: unknown }
  if (typeof raw.id !== 'string' || typeof raw.token !== 'string') return null
  const id = raw.id.trim()
  if (id.length < 2 || id.length > 40 || raw.token.length < 8 || raw.token.length > 200) return null
  return { id, token: raw.token }
}

export function parseClientFrame(raw: string): RelayHello | RelayPub | null {
  if (raw.length > 100_000) return null
  try {
    const value = JSON.parse(raw) as { op?: string; topic?: unknown; payload?: unknown; encoding?: unknown; retain?: unknown; device?: unknown }
    if (value.op === 'hello') {
      if (value.device === undefined) return { op: 'hello' }
      const device = deviceCredentials(value.device)
      return device ? { op: 'hello', device } : null
    }
    if (value.op !== 'pub') return null
    if (typeof value.topic !== 'string' || typeof value.payload !== 'string') return null
    if (value.encoding !== 'utf8' && value.encoding !== 'base64') return null
    return {
      op: 'pub',
      topic: value.topic,
      retain: value.retain === true,
      encoding: value.encoding,
      payload: value.payload,
    }
  } catch {
    return null
  }
}
