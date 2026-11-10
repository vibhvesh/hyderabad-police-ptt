import type http from 'node:http'
import { lineId, lineTopic } from '../src/lib/lines.ts'
import type { ConsoleSettingsStore } from './console-settings.ts'
import type { LinesStore } from './lines-store.ts'
import type { RadioLog, ClipQuery } from './radio-log.ts'
import type { RadioMonitor } from './radio-monitor.ts'

type Deps = {
  lines: LinesStore
  settings: ConsoleSettingsStore
  log: RadioLog
  monitor: RadioMonitor
  now: () => number
  talkOrigin: string | null
  send: (res: http.ServerResponse, status: number, body: unknown) => void
  jsonBody: (req: http.IncomingMessage, res: http.ServerResponse, limit: number) => Promise<Record<string, unknown> | null>
  admin: (req: http.IncomingMessage, res: http.ServerResponse) => boolean
}

export async function handleControl(req: http.IncomingMessage, res: http.ServerResponse, deps: Deps): Promise<boolean> {
  const url = new URL(req.url ?? '/', 'http://localhost')
  if (!url.pathname.startsWith('/api/control')) return false
  if (!deps.admin(req, res)) return true
  const parts = url.pathname.split('/').filter(Boolean)
  if (req.method === 'GET' && url.pathname === '/api/control/live') {
    deps.monitor.sweep(deps.now())
    deps.send(res, 200, { ...deps.monitor.snapshot(deps.now()), talkOrigin: deps.talkOrigin })
    return true
  }
  if (req.method === 'GET' && url.pathname === '/api/control/lines') {
    deps.send(res, 200, { lines: deps.lines.list().map(viewLine), talkOrigin: deps.talkOrigin })
    return true
  }
  if (req.method === 'POST' && url.pathname === '/api/control/lines') {
    const body = await deps.jsonBody(req, res, 8_192)
    if (!body) return true
    const created = deps.lines.create({
      id: String(body.id ?? ''),
      name: String(body.name ?? ''),
      sourceLang: body.sourceLang,
      targetLang: body.targetLang,
    })
    if ('error' in created) {
      deps.send(res, 400, { error: 'line', message: created.error })
      return true
    }
    deps.send(res, 201, viewLine(created))
    return true
  }
  if (parts[0] === 'api' && parts[1] === 'control' && parts[2] === 'lines' && parts[3] && !parts[4]) {
    const id = lineId(parts[3])
    if (!id) {
      deps.send(res, 400, { error: 'line', message: 'Line ids use letters, numbers, and hyphens.' })
      return true
    }
    if (req.method === 'PATCH') {
      const body = await deps.jsonBody(req, res, 8_192)
      if (!body) return true
      const updated = deps.lines.update(id, body)
      if ('error' in updated) {
        deps.send(res, 404, { error: 'line', message: updated.error })
        return true
      }
      deps.send(res, 200, viewLine(updated))
      return true
    }
    if (req.method === 'DELETE') {
      const removed = deps.lines.remove(id)
      if ('error' in removed) {
        deps.send(res, 404, { error: 'line', message: removed.error })
        return true
      }
      deps.send(res, 200, { ok: true })
      return true
    }
  }
  if (url.pathname === '/api/control/settings' && req.method === 'GET') {
    deps.send(res, 200, deps.settings.view())
    return true
  }
  if (url.pathname === '/api/control/settings' && req.method === 'PUT') {
    const body = await deps.jsonBody(req, res, 8_192)
    if (!body) return true
    const key = typeof body.elevenLabsApiKey === 'string' ? body.elevenLabsApiKey : undefined
    const view = deps.settings.update({
      asrProvider: body.asrProvider as 'none' | 'transformers' | 'whisper-cli' | 'mock' | undefined,
      translateProvider: body.translateProvider as 'none' | 'opus' | undefined,
      elevenLabsFallback: typeof body.elevenLabsFallback === 'boolean' ? body.elevenLabsFallback : undefined,
      elevenLabsApiKey: key,
      clearElevenLabsKey: body.elevenLabsApiKey === '',
      retentionDays: Number(body.retentionDays),
    })
    deps.log.retain(view.retentionDays, deps.now())
    deps.send(res, 200, view)
    return true
  }
  if (req.method === 'GET' && (url.pathname === '/api/control/log' || url.pathname === '/api/control/log.csv' || url.pathname === '/api/control/log.txt')) {
    const filter = queryOf(url)
    if (url.pathname === '/api/control/log.csv') return file(res, 'text/csv; charset=utf-8', 'sanket-log.csv', deps.log.toCsv(filter))
    if (url.pathname === '/api/control/log.txt') return file(res, 'text/plain; charset=utf-8', 'sanket-log.txt', deps.log.toTxt(filter))
    deps.send(res, 200, { clips: deps.log.query(filter) })
    return true
  }
  if (req.method === 'GET' && parts[2] === 'clips' && parts[3] && parts[4] === 'audio') {
    const audio = deps.log.readAudio(parts[3])
    if (!audio) {
      deps.send(res, 404, { error: 'clip', message: 'That clip is not on this server.' })
      return true
    }
    res.statusCode = 200
    res.setHeader('content-type', 'audio/wav')
    res.setHeader('cache-control', 'no-store')
    res.end(audio)
    return true
  }
  deps.send(res, 404, { error: 'not_found', message: 'No such control route.' })
  return true
}

function viewLine(line: { id: string; name: string; enabled: boolean; sourceLang: string; targetLang: string }) {
  return { ...line, topic: lineTopic(line.id) }
}

function queryOf(url: URL): ClipQuery {
  return {
    lineId: url.searchParams.get('line') || undefined,
    sender: url.searchParams.get('sender') || undefined,
    from: url.searchParams.get('from') || undefined,
    to: url.searchParams.get('to') || undefined,
    q: url.searchParams.get('q') || undefined,
  }
}

function file(res: http.ServerResponse, type: string, name: string, body: string): true {
  res.statusCode = 200
  res.setHeader('content-type', type)
  res.setHeader('content-disposition', `attachment; filename="${name}"`)
  res.setHeader('cache-control', 'no-store')
  res.end(body)
  return true
}
