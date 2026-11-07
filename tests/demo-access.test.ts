import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createApp } from '../server/app.ts'
import { loadConfig } from '../server/config.ts'
import { codesMatch } from '../server/demo-access.ts'

const CODE = 'test-demo-code'
let dir = ''

async function boot() {
  dir = await mkdtemp(path.join(tmpdir(), 'sanket-demo-'))
  const app = createApp({
    config: loadConfig({
      ADMIN_TOKEN: 'admin-test',
      REVIEWER_TOKEN: 'reviewer-test',
      INGEST_TOKEN: 'ingest-test',
      DEMO_ACCESS_CODE: CODE,
      DEMO_ORIGINS: 'https://sanket-ptt.onrender.com,https://vibhvesh.github.io',
      DATA_DIR: dir,
      HOST: '127.0.0.1',
    }),
    log: () => undefined,
  })
  await app.listen(0, '127.0.0.1')
  return { app, base: `http://127.0.0.1:${app.port()}` }
}

function cookieFrom(response: Response): string {
  const raw = response.headers.get('set-cookie') ?? ''
  return raw.split(';')[0] ?? ''
}

afterEach(async () => {
  if (dir) await rm(dir, { recursive: true, force: true })
})

describe('shared demo access', () => {
  it('rejects a wrong code and does not treat it as signed in', async () => {
    const { app, base } = await boot()
    const wrong = await fetch(`${base}/api/demo/unlock`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'https://sanket-ptt.onrender.com' },
      body: JSON.stringify({ code: 'nope' }),
    })
    expect(wrong.status).toBe(401)
    expect(wrong.headers.get('set-cookie')).toBeNull()
    const body = (await wrong.json()) as { message?: string }
    expect(body.message).toMatch(/not accepted/)
    expect(JSON.stringify(body)).not.toContain(CODE)
    await app.close()
  })

  it('files a draft and promotes it only after the code is accepted', async () => {
    const { app, base } = await boot()
    const unlocked = await fetch(`${base}/api/demo/unlock`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'https://sanket-ptt.onrender.com' },
      body: JSON.stringify({ code: CODE }),
    })
    expect(unlocked.status).toBe(200)
    const cookie = cookieFrom(unlocked)
    expect(cookie.startsWith('sanket_demo=')).toBe(true)
    expect(cookie).not.toContain(CODE)
    const headers = { 'content-type': 'application/json', cookie, origin: 'https://sanket-ptt.onrender.com' }
    await fetch(`${base}/api/channels/sanket-1/reviewer`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ name: 'Shared demo' }),
    })
    const filed = await fetch(`${base}/api/channels/sanket-1/proposals`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ origin: 'admin-text', mode: 'replace', text: 'Demo note only.' }),
    })
    expect(filed.status).toBe(201)
    const before = await fetch(`${base}/api/channels/sanket-1/knowledge`, { headers }).then((response) => response.json())
    expect(before.text ?? '').not.toContain('Demo note only.')
    expect(before.proposals[0].provenance.actor).toBe('shared demo')
    const promoted = await fetch(`${base}/api/channels/sanket-1/proposals/${before.proposals[0].id}/promote`, {
      method: 'POST',
      headers,
      body: '{}',
    })
    expect(promoted.status).toBe(200)
    const after = await fetch(`${base}/api/channels/sanket-1/knowledge`, { headers }).then((response) => response.json())
    expect(after.status).toBe('approved')
    expect(after.text).toBe('Demo note only.')
    expect(after.designatedReviewer).toBe('Shared demo')
    const evil = await fetch(`${base}/api/channels/sanket-1/knowledge`, {
      headers: { cookie, origin: 'https://evil.example' },
    })
    expect(evil.status).toBe(401)
    await app.close()
  })

  it('stops accepting guesses after repeated failures', async () => {
    const { app, base } = await boot()
    for (let i = 0; i < 8; i++) {
      const response = await fetch(`${base}/api/demo/unlock`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ code: 'wrong' }),
      })
      expect(response.status).toBe(401)
    }
    const limited = await fetch(`${base}/api/demo/unlock`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code: CODE }),
    })
    expect(limited.status).toBe(429)
    await app.close()
  })

  it('keeps comparing without treating an empty server setting as open', () => {
    expect(codesMatch('anything', null)).toBe('unconfigured')
    expect(codesMatch('test-demo-code', 'test-demo-code')).toBe('ok')
    expect(codesMatch('other', 'test-demo-code')).toBe('unauthorized')
  })
})
