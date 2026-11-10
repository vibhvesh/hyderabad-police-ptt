import { randomUUID } from 'node:crypto'
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
import { CaptionQueue } from './caption-queue.ts'
import { handleControl } from './control-routes.ts'
import { ConsoleSettingsStore, defaultConsoleSettings } from './console-settings.ts'
import { DemoGate, clearDemoCookie, codesMatch, demoCookie, readCookie } from './demo-access.ts'
import { isAdminApi, surfaceFromHeaders } from '../src/lib/host-surface.ts'
import { lineTopic } from '../src/lib/lines.ts'
import { DeviceStore } from './devices.ts'
import { LinesStore } from './lines-store.ts'
import { processRadioClip } from './radio-processor.ts'
import { RadioLog } from './radio-log.ts'
import { RadioMonitor, type ClosedClip } from './radio-monitor.ts'
import { liveScribe, scribeConfiguredDetail, type ScribeGateway } from './scribe.ts'
import { ScribeSessions, clearScribeCookie, clipDurationMs, publicScribeError, scribeCookie, SCRIBE_COOKIE, MAX_CLIP_MS } from './scribe-session.ts'

export type AppOptions = {
  config?: Config
  store?: KbStore
  now?: () => number
  fetchImpl?: FetchLike
  lookupImpl?: (host: string) => Promise<string[]>
  log?: (line: string) => void
  scribe?: ScribeGateway
  scribeFactory?: (apiKey: string) => ScribeGateway
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
  const gate = new DemoGate(now)
  const demoRequests = new Set<http.IncomingMessage>()
  const asr = createAsr(config)
  const translator = createTranslator(config, options.fetchImpl as typeof fetch | undefined)
  const scribeSessions = new ScribeSessions(now)
  const scribeHits = new Map<string, { count: number; start: number }>()
  let configuredKeyRejected = false

  function gatewayFor(apiKey: string): ScribeGateway {
    if (options.scribeFactory) return options.scribeFactory(apiKey)
    if (options.scribe) return options.scribe
    return liveScribe(apiKey)
  }
  const tts = createTts(config)
  const relay = new Relay()
  const assistant = new AssistantRuntime(relay, store, tts, now)
  const lines = new LinesStore(path.join(config.dataDir, 'console', 'lines.json'), () => new Date(now()).toISOString())
  const devices = new DeviceStore(path.join(config.dataDir, 'console', 'devices.json'), () => new Date(now()).toISOString())
  const consoleSettings = new ConsoleSettingsStore(path.join(config.dataDir, 'console', 'settings.json'), defaultConsoleSettings(config))
  const radioLog = new RadioLog(path.join(config.dataDir, 'radio'))
  const captions = new CaptionQueue<ClosedClip>(async (clip) => {
    const id = randomUUID()
    await radioLog.add({
      id,
      lineId: clip.line.id,
      lineName: clip.line.name,
      speakerId: clip.speakerId,
      speakerName: clip.speakerName,
      at: new Date(clip.startedAt).toISOString(),
      durationMs: clip.durationMs,
      wav: clip.wav,
    })
    const settings = consoleSettings.get()
    const result = await processRadioClip({
      wav: clip.wav,
      source: clip.line.sourceLang,
      target: clip.line.targetLang,
      settings,
      config,
      scribe: async (apiKey, wav, language) => gatewayFor(apiKey).convert(wav, language),
    })
    const saved = radioLog.finish(id, {
      transcript: result.transcript,
      translation: result.translation,
      translationNote: result.translationNote,
      status: result.status,
    })
    radioLog.retain(settings.retentionDays, now())
    monitor.note(clip.line.id, `${clip.speakerName}: ${result.transcript ?? result.translationNote ?? 'no transcript'}`)
    relay.publish(
      `${lineTopic(clip.line.id)}caption`,
      JSON.stringify({
        clipId: id,
        lineId: clip.line.id,
        speakerId: clip.speakerId,
        speakerName: clip.speakerName,
        at: saved?.at ?? new Date(clip.startedAt).toISOString(),
        transcript: result.transcript,
        translation: result.translation,
        translationNote: result.translationNote,
        status: result.status,
      }),
    )
  })
  const monitor = new RadioMonitor(lines, (clip) => captions.enqueue(clip))
  relay.tap = (topic, payload) => monitor.ingest(topic, payload, now())
  relay.authenticate = (id, token) => {
    const found = devices.verify(id, token)
    if (!found) return null
    const line = lines.get(found.lineId)
    if (!line || !line.enabled) return null
    return found
  }
  relay.stillAllowed = (id) => {
    if (!devices.active(id)) return false
    const found = devices.list().find((item) => item.id === id)
    const line = found ? lines.get(found.lineId) : null
    return !!line && line.enabled
  }
  relay.reserved = (id) => devices.reserved(id)
  relay.onLink = (id, online) => monitor.linkDevice(id, online, now())
  const sweepTimer = setInterval(() => monitor.sweep(now()), 400)
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
  wss.on('connection', (socket, request) => {
    if (currentSurface(request) === 'admin') {
      socket.close()
      return
    }
    relay.add(socket)
  })

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

  function applyCors(req: http.IncomingMessage, res: http.ServerResponse) {
    const origin = typeof req.headers.origin === 'string' ? req.headers.origin : ''
    if (origin && config.demoOrigins.includes(origin)) {
      res.setHeader('access-control-allow-origin', origin)
      res.setHeader('access-control-allow-credentials', 'true')
      res.setHeader('vary', 'Origin')
    } else if (!origin || urlIsPublic(req.url)) {
      res.setHeader('access-control-allow-origin', config.cors)
    }
    res.setHeader('access-control-allow-headers', 'authorization, content-type, x-sanket-signature, x-filename, x-actor, x-speaker-id, x-test-transcript')
    res.setHeader('access-control-allow-methods', 'GET, POST, PATCH, DELETE, OPTIONS')
  }

  async function route(req: http.IncomingMessage, res: http.ServerResponse) {
    applyCors(req, res)
    if (req.method === 'OPTIONS') {
      res.statusCode = 204
      res.end()
      return
    }
    const url = new URL(req.url ?? '/', 'http://localhost')
    const surface = currentSurface(req)
    if (req.method === 'GET' && url.pathname === '/api/site') {
      send(res, 200, { surface, talkOrigin: config.publicHost ? `https://${config.publicHost}` : null })
      return
    }
    if (req.method === 'GET' && url.pathname === '/api/lines') {
      send(res, 200, {
        lines: lines.list().filter((line) => line.enabled).map((line) => ({ id: line.id, name: line.name, topic: lineTopic(line.id) })),
      })
      return
    }
    if (surface === 'talk' && isAdminApi(url.pathname)) {
      send(res, 404, { error: 'not_found', message: 'No such route.' })
      return
    }
    if (await handleControl(req, res, {
      lines,
      devices,
      settings: consoleSettings,
      log: radioLog,
      monitor,
      relay,
      now,
      talkOrigin: config.publicHost ? `https://${config.publicHost}` : null,
      send,
      jsonBody,
      admin: (request, response) => allowAdmin(request, response),
    })) return
    const parts = url.pathname.split('/').filter(Boolean)
    if (req.method === 'GET' && (url.pathname === '/health' || url.pathname === '/api/health')) {
      send(res, 200, health())
      return
    }
    if (req.method === 'POST' && url.pathname === '/api/transcribe') return transcribe(req, res)
    if (req.method === 'POST' && url.pathname === '/api/translate') return translate(req, res)
    if (req.method === 'POST' && url.pathname === '/api/ingest/webhook') return webhook(req, res)
    if (req.method === 'GET' && url.pathname === '/api/demo/session') return demoSession(req, res)
    if (req.method === 'POST' && url.pathname === '/api/demo/unlock') return demoUnlock(req, res)
    if (req.method === 'POST' && url.pathname === '/api/demo/lock') return demoLock(res)
    if (req.method === 'GET' && url.pathname === '/api/speech/scribe-key') return scribeKeyStatus(req, res)
    if (req.method === 'POST' && url.pathname === '/api/speech/scribe-key') return saveScribeKey(req, res)
    if (req.method === 'DELETE' && url.pathname === '/api/speech/scribe-key') return forgetScribeKey(req, res)
    if (req.method === 'POST' && url.pathname === '/api/speech/scribe') return scribeClip(req, res)
    if (req.method === 'POST' && url.pathname === '/api/speech/scribe-token') return scribeToken(req, res)
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
        scribe: {
          id: 'elevenlabs',
          mode: scribeMode(),
          model: 'scribe_v2',
          realtimeModel: 'scribe_v2_realtime',
          detail: scribeConfiguredDetail(scribeMode()),
        },
        device: {
          asr: 'server',
          translate: 'server',
          detail: 'Talk clients only display captions produced on this server.',
        },
      },
      auth: {
        admin: config.adminToken ? 'required' : 'unconfigured',
        reviewer: config.reviewerToken ? 'required' : 'unconfigured',
        ingest: config.ingestToken ? 'required' : 'unconfigured',
        webhook: config.webhookSecret || config.webhookToken ? 'required' : 'unconfigured',
        demo: config.demoAccessCode ? 'configured' : 'unconfigured',
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

  function demoSession(req: http.IncomingMessage, res: http.ServerResponse) {
    const id = readCookie(req.headers.cookie, 'sanket_demo')
    send(res, 200, { access: gate.valid(id) ? 'shared-demo' : 'none' })
  }

  function demoLock(res: http.ServerResponse) {
    res.setHeader('set-cookie', clearDemoCookie())
    send(res, 200, { access: 'none' })
  }

  function scribeMode(): 'configured' | 'rejected' | 'unconfigured' {
    if (!config.elevenLabsApiKey) return 'unconfigured'
    return configuredKeyRejected ? 'rejected' : 'configured'
  }

  function currentSurface(req: http.IncomingMessage) {
    const forwarded = req.headers['x-forwarded-host']
    return surfaceFromHeaders(req.headers.host, typeof forwarded === 'string' ? forwarded : undefined, config.publicHost, config.adminHost)
  }

  function allowAdmin(req: http.IncomingMessage, res: http.ServerResponse): boolean {
    if (!originAllowed(req)) {
      send(res, 403, { error: 'origin', message: 'This origin cannot use the control room.' })
      return false
    }
    if (authorize(req.headers.authorization, config.adminToken) === 'ok') return true
    if (gate.valid(readCookie(req.headers.cookie, 'sanket_demo'))) return true
    if (!config.adminToken && !config.demoAccessCode) {
      send(res, 503, { error: 'auth_unconfigured', message: 'Set ADMIN_TOKEN or DEMO_ACCESS_CODE before opening the control room.' })
      return false
    }
    send(res, 401, { error: 'unauthorized', message: 'The control room needs the admin token or the shared demo code.' })
    return false
  }

  function originAllowed(req: http.IncomingMessage): boolean {
    const origin = typeof req.headers.origin === 'string' ? req.headers.origin : ''
    return !origin || config.demoOrigins.includes(origin)
  }

  function scribeLimited(ip: string): boolean {
    const at = now()
    const hit = scribeHits.get(ip)
    if (!hit || at - hit.start > 10 * 60 * 1000) {
      scribeHits.set(ip, { count: 1, start: at })
      return false
    }
    hit.count += 1
    return hit.count > 30
  }

  function keyChoice(req: http.IncomingMessage): { source: 'server' | 'session'; key: string } | { source: 'none' } {
    if (config.elevenLabsApiKey && !configuredKeyRejected) return { source: 'server', key: config.elevenLabsApiKey }
    const sessionKey = scribeSessions.read(readCookie(req.headers.cookie, SCRIBE_COOKIE))
    if (sessionKey) return { source: 'session', key: sessionKey }
    return { source: 'none' }
  }

  function scribeKeyStatus(req: http.IncomingMessage, res: http.ServerResponse) {
    if (!originAllowed(req)) {
      send(res, 403, { error: 'origin', message: 'This origin cannot use cloud transcription.' })
      return
    }
    const choice = keyChoice(req)
    send(res, 200, { source: choice.source, serverRejected: configuredKeyRejected })
  }

  async function saveScribeKey(req: http.IncomingMessage, res: http.ServerResponse) {
    if (!originAllowed(req)) {
      send(res, 403, { error: 'origin', message: 'This origin cannot store a cloud key.' })
      return
    }
    if ((req.url ?? '').includes('key=')) {
      send(res, 400, { error: 'key', message: 'Send the key in the request body, not the address.' })
      return
    }
    const body = await jsonBody(req, res, 4_096)
    if (!body) return
    const key = typeof body.key === 'string' ? body.key.trim() : ''
    if (key.length < 8 || key.length > 200) {
      send(res, 400, { error: 'key', message: 'That key was not saved.' })
      return
    }
    const id = scribeSessions.save(readCookie(req.headers.cookie, SCRIBE_COOKIE), key)
    res.setHeader('set-cookie', scribeCookie(id))
    send(res, 200, { source: 'session' })
  }

  function forgetScribeKey(req: http.IncomingMessage, res: http.ServerResponse) {
    if (!originAllowed(req)) {
      send(res, 403, { error: 'origin', message: 'This origin cannot clear a cloud key.' })
      return
    }
    scribeSessions.clear(readCookie(req.headers.cookie, SCRIBE_COOKIE))
    res.setHeader('set-cookie', clearScribeCookie())
    send(res, 200, { source: keyChoice(req).source === 'server' ? 'server' : 'none' })
  }

  async function scribeClip(req: http.IncomingMessage, res: http.ServerResponse) {
    if (req.headers['x-cloud-consent'] !== 'yes') {
      send(res, 400, { error: 'consent', message: 'Cloud transcription needs an explicit opt-in on this device.', translates: false, needsKey: false })
      return
    }
    if (!originAllowed(req)) {
      send(res, 403, { error: 'origin', message: 'This origin cannot use cloud transcription.', translates: false, needsKey: false })
      return
    }
    if (scribeLimited(clientIp(req))) {
      send(res, 429, { error: 'rate_limited', message: 'Too many cloud transcription requests. Wait about 10 minutes.', translates: false, needsKey: false })
      return
    }
    const choice = keyChoice(req)
    if (choice.source === 'none') {
      send(res, 409, {
        error: 'scribe_unconfigured',
        message: 'No key is saved for this session. Paste one for this visit, or skip and stay on this device.',
        translates: false,
        needsKey: true,
      })
      return
    }
    const wav = await readBody(req, Math.min(config.audioMaxBytes, 2_000_000))
    if (wav === 'too_large') {
      send(res, 413, { error: 'too_large', message: 'The audio is over the size limit.', translates: false, needsKey: false })
      return
    }
    const duration = clipDurationMs(wav)
    if (duration == null || duration < 200) {
      send(res, 400, { error: 'audio', message: 'The clip is too short to transcribe.', translates: false, needsKey: false })
      return
    }
    if (duration > MAX_CLIP_MS) {
      send(res, 413, { error: 'too_long', message: 'Cloud transcription accepts up to 60 seconds.', translates: false, needsKey: false })
      return
    }
    const language = headerString(req, 'x-language')
    const code = language === 'en' || language === 'hi' || language === 'te' ? language : 'te'
    try {
      const text = await gatewayFor(choice.key).convert(wav, code)
      send(res, 200, { text, provider: 'elevenlabs-scribe', model: 'scribe_v2', mode: 'live', translates: false, needsKey: false })
    } catch (error) {
      const failure = publicScribeError(error, choice.key)
      if (failure.auth && choice.source === 'server') configuredKeyRejected = true
      if (failure.auth && choice.source === 'session') scribeSessions.clear(readCookie(req.headers.cookie, SCRIBE_COOKIE))
      send(res, failure.auth ? 401 : 502, {
        error: failure.auth ? 'key_rejected' : 'scribe_failed',
        message: failure.auth && choice.source === 'server'
          ? 'The saved server key was rejected and will not be used again.'
          : failure.message,
        translates: false,
        needsKey: failure.auth,
      })
    }
  }

  async function scribeToken(req: http.IncomingMessage, res: http.ServerResponse) {
    if (req.headers['x-cloud-consent'] !== 'yes') {
      send(res, 400, { error: 'consent', message: 'A realtime token needs an explicit cloud opt-in.', translates: false, needsKey: false })
      return
    }
    if (!originAllowed(req)) {
      send(res, 403, { error: 'origin', message: 'This origin cannot use cloud transcription.', translates: false, needsKey: false })
      return
    }
    const choice = keyChoice(req)
    if (choice.source === 'none') {
      send(res, 409, { error: 'scribe_unconfigured', message: 'No key is saved for this session.', translates: false, needsKey: true })
      return
    }
    try {
      const token = await gatewayFor(choice.key).realtimeToken()
      send(res, 200, { token, modelId: 'scribe_v2_realtime', expires: '15m', translates: false, needsKey: false })
    } catch (error) {
      const failure = publicScribeError(error, choice.key)
      if (failure.auth && choice.source === 'server') configuredKeyRejected = true
      if (failure.auth && choice.source === 'session') scribeSessions.clear(readCookie(req.headers.cookie, SCRIBE_COOKIE))
      send(res, failure.auth ? 401 : 502, {
        error: failure.auth ? 'key_rejected' : 'scribe_failed',
        message: failure.message,
        translates: false,
        needsKey: failure.auth,
      })
    }
  }

  async function demoUnlock(req: http.IncomingMessage, res: http.ServerResponse) {
    const ip = clientIp(req)
    if (gate.blocked(ip)) {
      send(res, 429, { error: 'rate_limited', message: 'Too many tries. Wait about 10 minutes and try again.' })
      return
    }
    const body = await jsonBody(req, res, 2_000)
    if (!body) return
    const code = typeof body.code === 'string' ? body.code.trim() : ''
    const verdict = codesMatch(code, config.demoAccessCode)
    if (verdict === 'unconfigured') {
      send(res, 503, { error: 'auth_unconfigured', message: 'Demo access is not configured on this server.' })
      return
    }
    if (verdict !== 'ok') {
      gate.fail(ip)
      send(res, 401, { error: 'unauthorized', message: 'That demo code was not accepted.' })
      return
    }
    gate.clear(ip)
    res.setHeader('set-cookie', demoCookie(gate.open(), currentSurface(req) === 'admin' ? 'Lax' : 'None'))
    send(res, 200, { access: 'shared-demo' })
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
    const demo = gate.valid(readCookie(req.headers.cookie, 'sanket_demo'))
    const origin = typeof req.headers.origin === 'string' ? req.headers.origin : ''
    const demoAllowed = demo && role !== 'ingest' && (!origin || config.demoOrigins.includes(origin))
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
    if (result !== 'ok' && demoAllowed) {
      demoRequests.add(req)
      await fn()
      return
    }
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
    if (demoRequests.has(req)) body.actor = 'shared demo'
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
    const actor = demoRequests.has(req) ? 'shared demo' : String(req.headers['x-actor'] ?? 'administrator')
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
      clearInterval(sweepTimer)
      return new Promise<void>((resolve, reject) => {
        wss.close()
        server.close((error) => (error ? reject(error) : resolve()))
      })
    },
  }
}

function urlIsPublic(url: string | undefined): boolean {
  const path = (url ?? '/').split('?')[0] ?? '/'
  return path === '/' || path === '/health' || path === '/api/health' || path.startsWith('/assets/') || path === '/favicon.svg'
}

function clientIp(req: http.IncomingMessage): string {
  const forwarded = req.headers['x-forwarded-for']
  const raw = typeof forwarded === 'string' ? forwarded.split(',')[0] : req.socket.remoteAddress
  return (raw ?? 'unknown').trim().slice(0, 80)
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
