import { createReadStream, existsSync, readFileSync } from 'node:fs'
import { readdir } from 'node:fs/promises'
import http from 'node:http'
import https from 'node:https'
import path from 'node:path'
import { WebSocketServer } from 'ws'
import {
  addSource,
  channelStatus,
  intervalError,
  markSource,
  parseOptionalTime,
  promote,
  proposalView,
  reapprove,
  rejectProposal,
  setAssistant,
  setReviewer,
  setWindow,
  dueSources,
  type ChannelState,
  type ReviewWindow,
  type SourceConfig,
} from '../src/lib/kb.ts'
import { sanitizeDevice } from './pi-audio.ts'
import { AssistantRuntime } from './assistant-runtime.ts'
import { authStatus, authorize } from './auth.ts'
import { readBody } from './body.ts'
import { loadConfig, type Config } from './config.ts'
import { hmacSha256, sameHmac, sha256 } from './hash.ts'
import { ingestExternal, ingestFile, ingestJson } from './ingest.ts'
import { createAsr, createTranslator, createTts } from './providers.ts'
import { Relay } from './relay.ts'
import { checkSourceUrl, pullSource, resolveHost, type FetchLike } from './sources.ts'
import { KbStore } from './store.ts'

export type AppOptions = {
  config?: Config
  store?: KbStore
  now?: () => number
  fetchImpl?: FetchLike
  lookupImpl?: (host: string) => Promise<string[]>
  log?: (line: string) => void
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
  '.wasm': 'application/wasm',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
}

export function createApp(options: AppOptions = {}) {
  const config = options.config ?? loadConfig()
  const store = options.store ?? new KbStore(config.dataDir)
  const now = options.now ?? Date.now
  const log = options.log ?? (() => {})
  const asr = createAsr(config)
  const translator = createTranslator(config, options.fetchImpl as typeof fetch | undefined)
  const tts = createTts(config)
  const relay = new Relay()
  const assistant = new AssistantRuntime(relay, store, tts, now)
  const lookupImpl = options.lookupImpl
  const fetchImpl = options.fetchImpl

  function update(
    channel: string,
    fn: (state: ChannelState) => { save?: ChannelState; value: { status: number; body: unknown } } | Promise<{ save?: ChannelState; value: { status: number; body: unknown } }>,
  ): Promise<{ status: number; body: unknown }> {
    return store.change(channel, fn)
  }

  const server =
    config.tlsCert && config.tlsKey
      ? https.createServer({ cert: readFileSyncSafe(config.tlsCert), key: readFileSyncSafe(config.tlsKey) }, onRequest)
      : http.createServer(onRequest)
  const wss = new WebSocketServer({ server, path: '/ws' })
  wss.on('connection', (socket) => relay.add(socket))

  async function onRequest(req: http.IncomingMessage, res: http.ServerResponse) {
    const started = Date.now()
    try {
      await route(req, res)
    } catch {
      send(res, 500, { error: 'server_error', message: 'The server could not complete that request.' })
    } finally {
      log(`${req.method ?? 'GET'} ${pathOnly(req)} ${res.statusCode} ${Date.now() - started}ms`)
    }
  }

  async function route(req: http.IncomingMessage, res: http.ServerResponse) {
    res.setHeader('access-control-allow-origin', config.cors)
    res.setHeader('access-control-allow-headers', 'authorization, content-type, x-sanket-signature, x-filename, x-actor, x-speaker-id, x-test-transcript')
    res.setHeader('access-control-allow-methods', 'GET, POST, OPTIONS')
    if (req.method === 'OPTIONS') {
      res.statusCode = 204
      res.end()
      return
    }
    const url = new URL(req.url ?? '/', 'http://localhost')
    const parts = url.pathname.split('/').filter(Boolean)
    if (req.method === 'GET' && (url.pathname === '/health' || url.pathname === '/api/health')) {
      send(res, 200, health())
      return
    }
    if (req.method === 'POST' && url.pathname === '/api/transcribe') return transcribe(req, res)
    if (req.method === 'POST' && url.pathname === '/api/translate') return translate(req, res)
    if (req.method === 'POST' && url.pathname === '/api/ingest/webhook') return webhook(req, res)
    if (parts[0] === 'api' && parts[1] === 'channels' && parts[2]) return channelRoute(req, res, parts[2], parts.slice(3))
    if (req.method === 'GET' && config.staticDir) return serveStatic(res, url.pathname)
    send(res, 404, { error: 'not_found', message: 'No such route.' })
  }

  function health() {
    const input = sanitizeDevice(config.audioInput)
    const output = sanitizeDevice(config.audioOutput)
    return {
      ok: true,
      service: 'sanket-ptt',
      providers: {
        asr: asr.status(),
        translate: translator.status(),
        tts: tts.status(),
        qa: { id: 'lexical', mode: 'live', detail: 'Quotes the commander-approved file only.' },
      },
      auth: {
        admin: config.adminToken ? 'required' : 'unconfigured',
        reviewer: config.reviewerToken ? 'required' : 'unconfigured',
        ingest: config.ingestToken ? 'required' : 'unconfigured',
        webhook: config.webhookSecret || config.webhookToken ? 'required' : 'unconfigured',
      },
      reviewDefaults: {
        reviewDue: null,
        validUntil: null,
        note: 'No review interval is configured. Approvals do not expire unless an administrator sets a date.',
      },
      ingestion: { mailbox: 'not_connected', fetch: 'manual-or-configured-schedule' },
      audio: {
        input: input.ok ? input.device : null,
        output: output.ok ? output.device : null,
        capture: 'unsupported-until-a-local-device-is-configured',
      },
      piProfile: config.piProfile,
      tls: Boolean(config.tlsCert && config.tlsKey),
    }
  }

  async function channelRoute(req: http.IncomingMessage, res: http.ServerResponse, channel: string, rest: string[]) {
    if (!store.file(channel)) {
      send(res, 400, { error: 'channel', message: 'Channel names use letters, numbers, and hyphens.' })
      return
    }
    const [head, id, action] = rest
    if (req.method === 'GET' && head === 'status') return guarded(req, res, 'any', () => statusOf(res, channel))
    if (req.method === 'GET' && head === 'knowledge') return guarded(req, res, 'staff', () => knowledgeOf(res, channel))
    if (req.method === 'POST' && head === 'proposals' && !id) return guarded(req, res, 'admin', () => postProposal(req, res, channel))
    if (req.method === 'POST' && head === 'proposals' && id === 'file') return guarded(req, res, 'admin', () => postFile(req, res, channel))
    if (req.method === 'POST' && head === 'proposals' && id && action === 'promote') {
      return guarded(req, res, 'reviewer', () => promoteOne(req, res, channel, id))
    }
    if (req.method === 'POST' && head === 'proposals' && id && action === 'reject') {
      return guarded(req, res, 'reviewer', () => rejectOne(res, channel, id))
    }
    if (req.method === 'POST' && head === 'reapprove') return guarded(req, res, 'reviewer', () => reapproveOne(req, res, channel))
    if (req.method === 'POST' && head === 'reviewer') return guarded(req, res, 'admin', () => setReviewerRoute(req, res, channel))
    if (req.method === 'POST' && head === 'review-window') return guarded(req, res, 'admin', () => setWindowRoute(req, res, channel))
    if (req.method === 'POST' && head === 'assistant') return guarded(req, res, 'admin', () => setAssistantRoute(req, res, channel))
    if (req.method === 'POST' && head === 'ask') return guarded(req, res, 'ingest', () => ask(req, res, channel))
    if (req.method === 'POST' && head === 'audio') return guarded(req, res, 'ingest', () => audio(req, res, channel))
    if (req.method === 'GET' && head === 'sources') return guarded(req, res, 'admin', () => sourcesOf(res, channel))
    if (req.method === 'POST' && head === 'sources' && !id) return guarded(req, res, 'admin', () => addSourceRoute(req, res, channel))
    if (req.method === 'POST' && head === 'sources' && id && action === 'fetch') {
      return guarded(req, res, 'admin', () => fetchSource(res, channel, id))
    }
    send(res, 404, { error: 'not_found', message: 'No such channel route.' })
  }

  async function guarded(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    role: 'admin' | 'reviewer' | 'ingest' | 'staff' | 'any',
    fn: () => Promise<void>,
  ) {
    const header = req.headers.authorization
    const result =
      role === 'any'
        ? authorize(header, config.adminToken) === 'ok' ||
          authorize(header, config.reviewerToken) === 'ok' ||
          authorize(header, config.ingestToken) === 'ok'
          ? 'ok'
          : !config.adminToken && !config.reviewerToken && !config.ingestToken
            ? 'unconfigured'
            : 'unauthorized'
        : role === 'staff'
          ? authorize(header, config.adminToken) === 'ok' || authorize(header, config.reviewerToken) === 'ok'
            ? 'ok'
            : !config.adminToken && !config.reviewerToken
              ? 'unconfigured'
              : 'unauthorized'
          : authorize(header, role === 'admin' ? config.adminToken : role === 'reviewer' ? config.reviewerToken : config.ingestToken)
    const denied = authStatus(result)
    if (denied) {
      send(res, denied.status, { error: denied.error, message: denied.message })
      return
    }
    await fn()
  }

  async function statusOf(res: http.ServerResponse, channel: string) {
    send(res, 200, channelStatus(await store.read(channel), now()))
  }

  async function knowledgeOf(res: http.ServerResponse, channel: string) {
    const state = await store.read(channel)
    send(res, 200, {
      ...channelStatus(state, now()),
      text: state.active?.text ?? '',
      reviewerName: state.reviewerName,
      audit: state.audit,
      proposals: state.proposals.map((item) => proposalView(state, item)),
      sources: state.sources,
    })
  }

  async function postProposal(req: http.IncomingMessage, res: http.ServerResponse, channel: string) {
    const body = await jsonBody(req, res, config.kbMaxBytes)
    if (!body) return
    const value = await update(channel, (state) => {
      const result = ingestJson(state, body, new Date(now()).toISOString(), channel)
      return { save: result.save, value: result }
    })
    send(res, value.status, value.body)
  }

  async function postFile(req: http.IncomingMessage, res: http.ServerResponse, channel: string) {
    const raw = await readBody(req, config.kbMaxBytes)
    if (raw === 'too_large') {
      send(res, 413, { error: 'too_large', message: 'The file is over the size limit.' })
      return
    }
    const filename = String(req.headers['x-filename'] ?? 'reference.txt')
    const actor = String(req.headers['x-actor'] ?? 'administrator')
    const value = await update(channel, (state) => {
      const result = ingestFile(state, filename, raw.toString('utf8'), new Date(now()).toISOString(), actor)
      return { save: result.save, value: result }
    })
    send(res, value.status, value.body)
  }

  async function promoteOne(req: http.IncomingMessage, res: http.ServerResponse, channel: string, id: string) {
    const body = await jsonBody(req, res, 16_384)
    if (!body) return
    const interval = intervalError(body)
    if (interval) {
      send(res, 400, { error: 'interval', message: interval })
      return
    }
    const dates = datesFrom(body)
    if (typeof dates === 'object' && 'error' in dates) {
      send(res, 400, dates)
      return
    }
    const value = await update(channel, (state) => {
      const proposal = state.proposals.find((item) => item.id === id)
      const result = promote(state, {
        proposalId: id,
        nowIso: new Date(now()).toISOString(),
        sha256: sha256(proposal?.proposedText ?? ''),
        acknowledgeConflict: body.acknowledgeConflict === true,
        dates,
      })
      if ('error' in result) return { value: { status: result.error === 'conflict' ? 409 : 400, body: result } }
      return { save: result.state, value: { status: 200, body: channelStatus(result.state, now()) } }
    })
    send(res, value.status, value.body)
  }

  async function rejectOne(res: http.ServerResponse, channel: string, id: string) {
    const value = await update(channel, (state) => {
      const result = rejectProposal(state, id, new Date(now()).toISOString())
      if ('error' in result) return { value: { status: 404, body: result } }
      return { save: result.state, value: { status: 200, body: channelStatus(result.state, now()) } }
    })
    send(res, value.status, value.body)
  }

  async function reapproveOne(req: http.IncomingMessage, res: http.ServerResponse, channel: string) {
    const body = await jsonBody(req, res, 16_384)
    if (!body) return
    const interval = intervalError(body)
    if (interval) {
      send(res, 400, { error: 'interval', message: interval })
      return
    }
    const dates = datesFrom(body)
    if (typeof dates === 'object' && 'error' in dates) {
      send(res, 400, dates)
      return
    }
    const value = await update(channel, (state) => {
      const result = reapprove(state, {
        nowIso: new Date(now()).toISOString(),
        sha256: state.active?.sha256 ?? '',
        dates,
      })
      if ('error' in result) return { value: { status: 400, body: result } }
      return { save: result.state, value: { status: 200, body: channelStatus(result.state, now()) } }
    })
    send(res, value.status, value.body)
  }

  async function setReviewerRoute(req: http.IncomingMessage, res: http.ServerResponse, channel: string) {
    const body = await jsonBody(req, res, 4_096)
    if (!body) return
    const value = await update(channel, (state) => {
      const result = setReviewer(state, String(body.name ?? ''), new Date(now()).toISOString())
      if ('error' in result) return { value: { status: 400, body: result } }
      return { save: result.state, value: { status: 200, body: { reviewerName: result.state.reviewerName } } }
    })
    send(res, value.status, value.body)
  }

  async function setWindowRoute(req: http.IncomingMessage, res: http.ServerResponse, channel: string) {
    const body = await jsonBody(req, res, 8_192)
    if (!body) return
    const interval = intervalError(body)
    if (interval) {
      send(res, 400, { error: 'interval', message: interval })
      return
    }
    const dates = explicitDates(body)
    if ('error' in dates) {
      send(res, 400, dates)
      return
    }
    const value = await update(channel, (state) => {
      const next = setWindow(state, dates, new Date(now()).toISOString())
      return { save: next, value: { status: 200, body: { configuredWindow: next.window, activeUnchanged: true } } }
    })
    send(res, value.status, value.body)
  }

  async function setAssistantRoute(req: http.IncomingMessage, res: http.ServerResponse, channel: string) {
    const body = await jsonBody(req, res, 2_048)
    if (!body) return
    const value = await update(channel, (state) => {
      const next = setAssistant(state, body.enabled !== false, new Date(now()).toISOString())
      return { save: next, value: { status: 200, body: { assistant: next.assistant } } }
    })
    send(res, value.status, value.body)
  }

  async function ask(req: http.IncomingMessage, res: http.ServerResponse, channel: string) {
    const before = await store.read(channel)
    const body = await jsonBody(req, res, 16_384)
    if (!body) return
    const text = typeof body.text === 'string' ? body.text : ''
    const speaker = typeof body.speakerId === 'string' ? body.speakerId : 'unit'
    const topicRoot = typeof body.topicRoot === 'string' ? body.topicRoot : `sanket-ptt/v1/${channel}/`
    const decision = await assistant.answer(channel, speaker, text, topicRoot)
    const after = await store.read(channel)
    send(res, 200, { ...decision, proposals: after.proposals.length, activeSha: after.active?.sha256 ?? null, unchanged: before.active === after.active && before.proposals.length === after.proposals.length })
  }

  async function audio(req: http.IncomingMessage, res: http.ServerResponse, channel: string) {
    const before = (await store.read(channel)).proposals.length
    const wav = await readBody(req, config.audioMaxBytes)
    if (wav === 'too_large') {
      send(res, 413, { error: 'too_large', message: 'The audio is over the size limit.' })
      return
    }
    const hint = config.allowMock ? headerString(req, 'x-test-transcript') : null
    const language = headerString(req, 'x-language') ?? 'te'
    const result = await asr.transcribe(wav, language, hint)
    if ('error' in result) {
      send(res, result.error.endsWith('unconfigured') || result.error === 'asr_mock' ? 503 : 400, result)
      return
    }
    const decision = await assistant.answer(channel, headerString(req, 'x-speaker-id') ?? 'unit', result.text, `sanket-ptt/v1/${channel}/`)
    const after = (await store.read(channel)).proposals.length
    send(res, 200, { transcript: result.text, decision, proposals: after, drafted: after !== before })
  }

  async function sourcesOf(res: http.ServerResponse, channel: string) {
    send(res, 200, { sources: (await store.read(channel)).sources })
  }

  async function addSourceRoute(req: http.IncomingMessage, res: http.ServerResponse, channel: string) {
    const body = await jsonBody(req, res, 8_192)
    if (!body) return
    const urlValue = typeof body.url === 'string' ? body.url : ''
    const checked = await checkSourceUrl(urlValue, lookupImpl ?? resolveHost)
    if (!checked.ok) {
      send(res, 400, { error: 'source', message: checked.reason })
      return
    }
    const every = body.everyMinutes == null || body.everyMinutes === '' ? null : Number(body.everyMinutes)
    const source: SourceConfig = {
      id: crypto.randomUUID(),
      name: String(body.name ?? 'Source').slice(0, 60),
      url: checked.href,
      everyMinutes: every,
      apply: body.apply === 'replace' ? 'replace' : 'append',
      enabled: body.enabled !== false,
      lastFetchAt: null,
      lastError: null,
    }
    const value = await update(channel, (state) => {
      const result = addSource(state, source, new Date(now()).toISOString())
      if ('error' in result) return { value: { status: 400, body: result } }
      return { save: result.state, value: { status: 201, body: { id: source.id } } }
    })
    send(res, value.status, value.body)
  }

  async function fetchSource(res: http.ServerResponse, channel: string, id: string) {
    const value = await update(channel, async (state) => {
      const source = state.sources.find((item) => item.id === id)
      if (!source) return { value: { status: 404, body: { error: 'not_found', message: 'No such source.' } } }
      const pulled = await pullSource(source, { bearer: config.fetchBearer, fetchImpl, lookupImpl })
      if ('error' in pulled) {
        const save = markSource(state, id, { lastFetchAt: new Date(now()).toISOString(), lastError: pulled.error })
        return { save, value: { status: 502, body: { error: 'fetch', message: pulled.error } } }
      }
      const filed = ingestExternal(state, {
        origin: 'fetch',
        sourceLabel: source.name,
        text: pulled.text,
        eventAt: new Date(now()).toISOString(),
        externalId: null,
        actor: 'fetch',
        mode: source.apply,
        nowIso: new Date(now()).toISOString(),
      })
      const saved = markSource(filed.save ?? state, id, { lastFetchAt: new Date(now()).toISOString(), lastError: null })
      return { save: saved, value: { status: filed.status, body: filed.body } }
    })
    send(res, value.status, value.body)
  }

  async function transcribe(req: http.IncomingMessage, res: http.ServerResponse) {
    if (!allow(res, authorize(req.headers.authorization, config.ingestToken))) return
    const wav = await readBody(req, config.audioMaxBytes)
    if (wav === 'too_large') {
      send(res, 413, { error: 'too_large', message: 'The audio is over the size limit.' })
      return
    }
    const hint = config.allowMock ? headerString(req, 'x-test-transcript') : null
    const result = await asr.transcribe(wav, headerString(req, 'x-language') ?? 'te', hint)
    if ('error' in result) {
      send(res, 503, result)
      return
    }
    send(res, 200, { text: result.text, provider: asr.status() })
  }

  async function translate(req: http.IncomingMessage, res: http.ServerResponse) {
    if (!allow(res, authorize(req.headers.authorization, config.ingestToken))) return
    const body = await jsonBody(req, res, 20_000)
    if (!body) return
    const source = typeof body.source === 'string' ? body.source : 'te'
    const target = typeof body.target === 'string' ? body.target : 'en'
    const text = typeof body.text === 'string' ? body.text : ''
    const result = await translator.translate(text, source, target)
    if ('error' in result) {
      send(res, 503, result)
      return
    }
    send(res, 200, result)
  }

  async function webhook(req: http.IncomingMessage, res: http.ServerResponse) {
    if (!config.webhookSecret && !config.webhookToken) {
      send(res, 503, { error: 'auth_unconfigured', message: 'Set WEBHOOK_SECRET or WEBHOOK_TOKEN before accepting webhooks.' })
      return
    }
    const raw = await readBody(req, config.kbMaxBytes)
    if (raw === 'too_large') {
      send(res, 413, { error: 'too_large', message: 'The webhook body is over the size limit.' })
      return
    }
    const signature = headerString(req, 'x-sanket-signature')
    const signed = config.webhookSecret ? sameHmac(hmacSha256(config.webhookSecret, raw), signature ?? '') : false
    const tokenOk = authorize(req.headers.authorization, config.webhookToken) === 'ok'
    if (!signed && !tokenOk) {
      send(res, 401, { error: 'unauthorized', message: 'The webhook signature or token was not accepted.' })
      return
    }
    let body: Record<string, unknown>
    try {
      body = JSON.parse(raw.toString('utf8')) as Record<string, unknown>
    } catch {
      send(res, 400, { error: 'json', message: 'The webhook body must be JSON.' })
      return
    }
    if (body.sourceService === 'sanket-ptt') {
      send(res, 409, { status: 'duplicate', message: 'Ignored an event that came from this service.' })
      return
    }
    const channel = typeof body.channel === 'string' ? body.channel : ''
    if (!store.file(channel)) {
      send(res, 400, { error: 'channel', message: 'Channel names use letters, numbers, and hyphens.' })
      return
    }
    const text = typeof body.text === 'string' ? body.text : ''
    const eventAt = typeof body.eventAt === 'string' && !Number.isNaN(Date.parse(body.eventAt)) ? new Date(body.eventAt).toISOString() : null
    const value = await update(channel, (state) => {
      const result = ingestExternal(state, {
        origin: 'webhook',
        sourceLabel: typeof body.sourceLabel === 'string' ? body.sourceLabel.slice(0, 80) : 'Webhook',
        text,
        eventAt,
        externalId: typeof body.externalId === 'string' ? body.externalId.slice(0, 120) : null,
        actor: 'webhook',
        mode: 'append',
        nowIso: new Date(now()).toISOString(),
      })
      return { save: result.save, value: result }
    })
    send(res, value.status, value.body)
  }

  async function runDue(at = now()) {
    let names: string[] = []
    try {
      names = await readdir(config.dataDir)
    } catch {
      return
    }
    for (const name of names) {
      if (!name.endsWith('.json')) continue
      const channel = name.slice(0, -'.json'.length)
      if (!store.file(channel)) continue
      await store.change(channel, async (state) => {
        let save = state
        for (const source of dueSources(save.sources, at)) {
          const pulled = await pullSource(source, { bearer: config.fetchBearer, fetchImpl, lookupImpl })
          if ('error' in pulled) {
            save = markSource(save, source.id, { lastFetchAt: new Date(at).toISOString(), lastError: pulled.error })
            continue
          }
          const filed = ingestExternal(save, {
            origin: 'fetch',
            sourceLabel: source.name,
            text: pulled.text,
            eventAt: new Date(at).toISOString(),
            externalId: null,
            actor: 'schedule',
            mode: source.apply,
            nowIso: new Date(at).toISOString(),
          })
          save = markSource(filed.save ?? save, source.id, { lastFetchAt: new Date(at).toISOString(), lastError: null })
        }
        return { save, value: true }
      })
    }
  }

  function allow(res: http.ServerResponse, result: ReturnType<typeof authorize>): boolean {
    const denied = authStatus(result)
    if (!denied) return true
    send(res, denied.status, { error: denied.error, message: denied.message })
    return false
  }

  async function jsonBody(req: http.IncomingMessage, res: http.ServerResponse, limit: number) {
    const raw = await readBody(req, limit)
    if (raw === 'too_large') {
      send(res, 413, { error: 'too_large', message: 'The request is over the size limit.' })
      return null
    }
    try {
      const parsed = JSON.parse(raw.toString('utf8')) as unknown
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('json')
      return parsed as Record<string, unknown>
    } catch {
      send(res, 400, { error: 'json', message: 'The request body must be a JSON object.' })
      return null
    }
  }

  function datesFrom(body: Record<string, unknown>): ReviewWindow | 'configured' | { error: string; message: string } {
    if (!('reviewDue' in body) && !('validUntil' in body)) return 'configured'
    const due = parseOptionalTime(body.reviewDue)
    const until = parseOptionalTime(body.validUntil)
    if ('error' in due) return due
    if ('error' in until) return until
    return { reviewDue: due.value, validUntil: until.value }
  }

  function explicitDates(body: Record<string, unknown>): ReviewWindow | { error: string; message: string } {
    const due = parseOptionalTime(body.reviewDue)
    const until = parseOptionalTime(body.validUntil)
    if ('error' in due) return due
    if ('error' in until) return until
    return { reviewDue: due.value, validUntil: until.value }
  }

  async function serveStatic(res: http.ServerResponse, pathname: string) {
    const root = path.resolve(config.staticDir ?? '')
    const requested = pathname === '/' ? '/index.html' : pathname
    const file = path.resolve(root, `.${requested}`)
    const fallback = path.join(root, 'index.html')
    const target = file.startsWith(root + path.sep) && existsSync(file) && !file.endsWith(path.sep) ? file : fallback
    if (!target.startsWith(root + path.sep) || !existsSync(target)) {
      send(res, 404, { error: 'not_found', message: 'No such file.' })
      return
    }
    res.statusCode = 200
    res.setHeader('content-type', MIME[path.extname(target)] ?? 'application/octet-stream')
    res.setHeader('cache-control', 'no-cache')
    createReadStream(target).pipe(res)
  }

  return {
    server,
    relay,
    assistant,
    asr: asr.status(),
    runDue,
    listen(port = config.port, host = config.host) {
      return new Promise<void>((resolve) => server.listen(port, host, () => resolve()))
    },
    port() {
      const address = server.address()
      return typeof address === 'object' && address ? address.port : 0
    },
    close() {
      return new Promise<void>((resolve, reject) => {
        wss.close()
        server.close((error) => (error ? reject(error) : resolve()))
      })
    },
  }
}

function send(res: http.ServerResponse, status: number, body: unknown) {
  if (res.writableEnded) return
  const payload = JSON.stringify(body)
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.end(payload)
}

function pathOnly(req: http.IncomingMessage): string {
  return (req.url ?? '/').split('?')[0] ?? '/'
}

function headerString(req: http.IncomingMessage, name: string): string | null {
  const value = req.headers[name]
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function readFileSyncSafe(file: string): Buffer {
  return existsSync(file) ? readFileSync(file) : Buffer.from('')
}
