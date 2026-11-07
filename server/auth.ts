import { sameSecret } from './hash.ts'

export type AuthResult = 'ok' | 'unconfigured' | 'unauthorized'

export function authorize(header: string | undefined, expected: string | null): AuthResult {
  if (!expected) return 'unconfigured'
  const match = /^Bearer\s+(\S+)\s*$/.exec(header ?? '')
  if (!match?.[1] || !sameSecret(expected, match[1])) return 'unauthorized'
  return 'ok'
}

export function authStatus(result: AuthResult): { status: number; error: string; message: string } | null {
  if (result === 'ok') return null
  if (result === 'unconfigured') {
    return {
      status: 503,
      error: 'auth_unconfigured',
      message: 'This action needs a server token that is not configured.',
    }
  }
  return { status: 401, error: 'unauthorized', message: 'The token was missing or not accepted.' }
}
