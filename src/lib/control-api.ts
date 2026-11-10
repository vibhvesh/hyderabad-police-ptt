import { loadSession } from './storage.ts'

const ADMIN = 'sanket-admin-token'

export function controlToken(): string {
  return loadSession(ADMIN)
}

export function saveControlToken(value: string) {
  try {
    if (value.trim()) sessionStorage.setItem(ADMIN, value.trim())
    else sessionStorage.removeItem(ADMIN)
  } catch {
    /* private mode */
  }
}

export async function controlFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers)
  const token = controlToken()
  if (token) headers.set('authorization', `Bearer ${token}`)
  if (init.body && typeof init.body === 'string' && !headers.has('content-type')) headers.set('content-type', 'application/json')
  return fetch(path, { ...init, headers, credentials: 'include' })
}
