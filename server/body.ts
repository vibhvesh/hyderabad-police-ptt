import type { IncomingMessage } from 'node:http'

export async function readBody(req: IncomingMessage, limit: number): Promise<Buffer | 'too_large'> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buf.length
    if (size > limit) {
      req.resume()
      return 'too_large'
    }
    chunks.push(buf)
  }
  return Buffer.concat(chunks)
}
