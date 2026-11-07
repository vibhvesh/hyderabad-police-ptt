import { loadBackend, loadSession } from './storage.ts'

export const ADMIN_TOKEN_KEY = 'sanket-admin-token'
export const REVIEWER_TOKEN_KEY = 'sanket-reviewer-token'
export const INGEST_TOKEN_KEY = 'sanket-ingest-token'

export function backendBase(): string {
  return loadBackend().replace(/\/$/, '')
}

export async function apiFetch(path: string, token: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers)
  if (token) headers.set('authorization', `Bearer ${token}`)
  if (init.body && typeof init.body === 'string' && !headers.has('content-type')) headers.set('content-type', 'application/json')
  return fetch(`${backendBase()}${path}`, { ...init, headers })
}

export async function askChannel(text: string, speakerId: string, topicRoot: string): Promise<void> {
  const token = loadSession(INGEST_TOKEN_KEY)
  if (!backendBase() || !token) return
  const channel = topicRoot.split('/').filter(Boolean).at(-1) || 'sanket-1'
  await apiFetch(`/api/channels/${encodeURIComponent(channel)}/ask`, token, {
    method: 'POST',
    body: JSON.stringify({ text, speakerId, topicRoot }),
  }).catch(() => undefined)
}

export async function forwardMessage(input: {
  channel: string
  messageKey: string
  speaker: string
  eventAt: string
  transcript: string
}): Promise<{ ok: true; message: string } | { ok: false; message: string }> {
  const token = loadSession(ADMIN_TOKEN_KEY)
  if (!backendBase()) return { ok: false, message: 'Set the server address on the Reference page first.' }
  if (!token) return { ok: false, message: 'Enter the administrator token on the Reference page. Forwarding files a draft and does not change the approved reference.' }
  try {
    const response = await apiFetch(`/api/channels/${encodeURIComponent(input.channel)}/proposals`, token, {
      method: 'POST',
      body: JSON.stringify({ origin: 'forward', actor: 'operator', ...input }),
    })
    const body = (await response.json()) as { message?: string; status?: string }
    if (response.status === 409) return { ok: true, message: 'That message is already filed as a draft.' }
    if (!response.ok) return { ok: false, message: body.message ?? 'The draft was not filed.' }
    return { ok: true, message: 'Draft filed. The approved reference is unchanged until the commander promotes it.' }
  } catch {
    return { ok: false, message: 'The server could not be reached.' }
  }
}
