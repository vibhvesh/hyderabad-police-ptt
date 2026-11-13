import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto'

export type Sealed = { iv: string; tag: string; data: string }

function keyFor(secret: string): Buffer {
  return scryptSync(secret, 'sanket-stt-v2', 32)
}

export function sealSecret(plain: string, secret: string): Sealed {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', keyFor(secret), iv)
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  return { iv: iv.toString('base64url'), tag: cipher.getAuthTag().toString('base64url'), data: data.toString('base64url') }
}

export function openSecret(sealed: Sealed, secret: string): string {
  const decipher = createDecipheriv('aes-256-gcm', keyFor(secret), Buffer.from(sealed.iv, 'base64url'))
  decipher.setAuthTag(Buffer.from(sealed.tag, 'base64url'))
  return Buffer.concat([decipher.update(Buffer.from(sealed.data, 'base64url')), decipher.final()]).toString('utf8')
}
