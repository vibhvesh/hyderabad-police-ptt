import { useEffect, useRef, useState } from 'react'
import { PcmRing, buildWav, concatInt16, downsampleToPcm, toWhisperAudio } from '../lib/audio.ts'
import {
  CLIP_GAP_MS,
  MAX_CLIP_MS,
  PRE_ROLL_MS,
  SAMPLE_RATE,
  TAIL_MS,
} from '../lib/constants.ts'
import { type GeoFix } from '../lib/format.ts'
import { ASSISTANT_ID } from '../lib/assistant.ts'
import { isExplicitQuestion } from '../lib/questions.ts'
import { micErrorMessage } from '../lib/media-errors.ts'
import { MqttWire } from '../lib/mqtt-transport.ts'
import { DEFAULT_TOPIC_ROOT, safeTopicRoot } from '../lib/net.ts'
import { phaseOf, type Phase } from '../lib/phase.ts'
import { Radio, type RadioView, type Speaker } from '../lib/radio.ts'
import { RelayWire } from '../lib/relay-transport.ts'
import type { NetSnapshot, Wire } from '../lib/transport.ts'
import { askChannel } from '../lib/api.ts'
import { CaptionQueue, type CaptionJob } from '../lib/caption-queue.ts'
import { speechRuntime } from '../lib/device-speech.ts'
import { readableTranscript } from '../lib/format.ts'
import {
  clearStoredSpeechKey,
  loadBackend,
  loadCloudFallback,
  loadLang,
  loadName,
  loadTarget,
  loadTopic,
  loadTransport,
  saveCloudFallback,
  saveLang,
  saveName,
  saveTarget,
} from '../lib/storage.ts'
import { transcribeScribe } from '../lib/scribe-client.ts'
import { ensureModel, transcribeLocal, watchModel, type ModelStatus } from '../lib/transcribe.ts'
import { ensureTranslation, translateLocal, watchTranslation, type TranslateStatus } from '../lib/translate-local.ts'
import { LANGUAGES, type ChatMessage, type LangId } from '../lib/types.ts'

export type { Phase }

async function chooseWire(): Promise<Wire> {
  const mode = loadTransport()
  let backend = loadBackend().replace(/\/$/, '')
  if (!backend && mode !== 'mqtt') {
    try {
      const response = await fetch('/health', { cache: 'no-store' })
      const body = (await response.json()) as { service?: string }
      if (body.service === 'sanket-ptt') backend = window.location.origin
    } catch {
      backend = ''
    }
  }
  if (mode === 'mqtt' || !backend) return new MqttWire()
  return new RelayWire(backend)
}

type OpenClip = {
  id: string
  name: string
  loc: GeoFix | null
  t0: number
  last: number
  chunks: Int16Array[]
  samples: number
  mine: boolean
}

const EMPTY_RADIO: RadioView = { users: [], floor: null, me: '', online: false }

function langOption(id: LangId) {
  return LANGUAGES.find((item) => item.id === id) ?? LANGUAGES[0]
}

export function usePtt() {
  const [name, setNameState] = useState(loadName)
  const [lang, setLangState] = useState<LangId>(loadLang)
  const [target, setTargetState] = useState<LangId>(loadTarget)
  const [cloudFallback, setCloudFallbackState] = useState(loadCloudFallback)
  const [model, setModel] = useState<ModelStatus>({ state: 'idle' })
  const [translationModel, setTranslationModel] = useState<TranslateStatus>({ state: 'idle' })
  const [runtimeNote] = useState(() => speechRuntime().note)
  const [radioState, setRadioState] = useState<RadioView>(EMPTY_RADIO)
  const [net, setNet] = useState<NetSnapshot>({
    state: 'connecting',
    detail: 'Connecting',
    attempt: 0,
    broker: null,
    error: null,
    nextRetryMs: null,
    transport: 'mqtt',
  })
  const [holding, setHolding] = useState(false)
  const [granted, setGranted] = useState(false)
  const [denied, setDenied] = useState(false)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [logEpoch, setLogEpoch] = useState(0)
  const [micError, setMicError] = useState<string | null>(null)
  const [geoNote, setGeoNote] = useState('Location not requested yet')
  const [loc, setLoc] = useState<GeoFix | null>(null)
  const [soundOn, setSoundOn] = useState(false)
  const [tick, setTick] = useState(0)

  const nameRef = useRef(name)
  const langRef = useRef(lang)
  const targetRef = useRef(target)
  const cloudRef = useRef(cloudFallback)
  const locRef = useRef<GeoFix | null>(null)
  const radioRef = useRef<Radio | null>(null)
  const floorRef = useRef<RadioView['floor']>(null)
  const meRef = useRef('')
  const topicRef = useRef(DEFAULT_TOPIC_ROOT)
  const holdingRef = useRef(false)
  const grantedRef = useRef(false)
  const liveRef = useRef(false)
  const tailUntilRef = useRef(0)
  const txRef = useRef<OpenClip | null>(null)
  const rxRef = useRef<OpenClip | null>(null)
  const lastRxRef = useRef(0)
  const ringRef = useRef(new PcmRing(Math.round((PRE_ROLL_MS / 1000) * SAMPLE_RATE)))
  const queueRef = useRef<CaptionQueue | null>(null)
  const acRef = useRef<AudioContext | null>(null)
  const playAtRef = useRef(0)
  const streamRef = useRef<MediaStream | null>(null)
  const geoWatchRef = useRef<number | null>(null)
  const onPcmRef = useRef<(input: Float32Array, sampleRate: number) => void>(() => {})

  nameRef.current = name
  langRef.current = lang
  targetRef.current = target
  cloudRef.current = cloudFallback
  locRef.current = loc

  function patchMessage(key: string, patch: Partial<ChatMessage>) {
    setMessages((prev) => prev.map((item) => (item.key === key ? { ...item, ...patch } : item)))
  }

  function queue(): CaptionQueue {
    if (!queueRef.current) {
      queueRef.current = new CaptionQueue({
        transcribe: async (job) => {
          const option = langOption(job.sourceLang)
          try {
            const text = readableTranscript(await transcribeLocal(toWhisperAudio(job.pcm), option.whisper))
            return { text, via: 'device' as const }
          } catch (error) {
            if (!cloudRef.current || !job.wav) throw error
            const text = readableTranscript(await transcribeScribe(job.wav, option.eleven))
            return { text, via: 'scribe' as const }
          }
        },
        translate: (text, source, targetLang) => translateLocal(text, source, targetLang),
        onUpdate: (messageId, patch, job) => {
          patchMessage(messageId, patch)
          if (job.direction === 'tx' && patch.phase === 'done' && patch.transcript && isExplicitQuestion(patch.transcript) && patch.transcript !== 'No speech detected') {
            void askChannel(patch.transcript, meRef.current, topicRef.current)
          }
        },
      })
    }
    return queueRef.current
  }

  function enqueue(job: CaptionJob) {
    queue().enqueue(job)
  }

  function publishClip(clip: OpenClip) {
    if (clip.samples < SAMPLE_RATE * 0.25) return
    const pcm = concatInt16(clip.chunks)
    const wav = buildWav(clip.chunks, SAMPLE_RATE)
    const url = URL.createObjectURL(new Blob([wav], { type: 'audio/wav' }))
    const message: ChatMessage = {
      key: crypto.randomUUID(),
      name: clip.name,
      mine: clip.mine,
      direction: clip.mine ? 'tx' : 'rx',
      sourceLang: langRef.current,
      targetLang: targetRef.current,
      t0: clip.t0,
      dur: pcm.length / SAMPLE_RATE,
      url,
      loc: clip.loc,
      transcript: null,
      translation: null,
      translationNote: null,
      error: null,
      pending: true,
      phase: 'transcribing',
    }
    setMessages((prev) => {
      const next = [message, ...prev].slice(0, 40)
      const keep = new Set(next.map((item) => item.key))
      for (const old of prev) {
        if (!keep.has(old.key)) URL.revokeObjectURL(old.url)
      }
      return next
    })
    enqueue({
      messageId: message.key,
      direction: message.direction ?? 'rx',
      speakerId: clip.id,
      selfId: meRef.current,
      sourceLang: langRef.current,
      targetLang: targetRef.current,
      pcm,
      wav,
    })
  }

  function finishTx() {
    const clip = txRef.current
    txRef.current = null
    if (clip) publishClip(clip)
  }

  function closeRx() {
    const clip = rxRef.current
    rxRef.current = null
    if (clip) publishClip(clip)
  }

  function beginTx() {
    txRef.current = {
      id: meRef.current,
      name: nameRef.current,
      loc: locRef.current,
      t0: Date.now(),
      last: Date.now(),
      chunks: [],
      samples: 0,
      mine: true,
    }
  }

  function sendChunk(pcm: Int16Array) {
    const copy = new Int16Array(pcm)
    if (!txRef.current) beginTx()
    const clip = txRef.current
    if (!clip) return
    clip.chunks.push(copy)
    clip.samples += copy.length
    clip.last = Date.now()
    radioRef.current?.sendAudio(copy)
  }

  onPcmRef.current = (input, sampleRate) => {
    const pcm = downsampleToPcm(input, sampleRate)
    if (pcm.length === 0) return
    if (!liveRef.current) {
      ringRef.current.push(pcm)
      return
    }
    const clip = txRef.current
    if (clip && clip.samples > (MAX_CLIP_MS / 1000) * SAMPLE_RATE) {
      holdingRef.current = false
      tailUntilRef.current = 0
    }
    if (!holdingRef.current && performance.now() > tailUntilRef.current) {
      liveRef.current = false
      grantedRef.current = false
      setHolding(false)
      setGranted(false)
      radioRef.current?.release()
      finishTx()
      ringRef.current.clear()
      return
    }
    sendChunk(pcm)
  }

  function playPcm(pcm: Int16Array) {
    const ac = acRef.current
    if (!ac || ac.state !== 'running' || pcm.length === 0) return
    const buffer = ac.createBuffer(1, pcm.length, SAMPLE_RATE)
    const channel = buffer.getChannelData(0)
    for (let i = 0; i < pcm.length; i++) channel[i] = (pcm[i] ?? 0) / 32768
    const source = ac.createBufferSource()
    source.buffer = buffer
    source.connect(ac.destination)
    const now = ac.currentTime
    if (playAtRef.current < now || playAtRef.current > now + 0.8) playAtRef.current = now + 0.12
    source.start(playAtRef.current)
    playAtRef.current += buffer.duration
  }

  function unlock() {
    const AudioCtx = window.AudioContext || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!AudioCtx) return
    if (!acRef.current) acRef.current = new AudioCtx()
    const ac = acRef.current
    void ac.resume().then(() => {
      if (ac.state === 'running') setSoundOn(true)
    })
    const buffer = ac.createBuffer(1, 1, 22050)
    const source = ac.createBufferSource()
    source.buffer = buffer
    source.connect(ac.destination)
    source.start()
    if (ac.state === 'running') setSoundOn(true)
  }

  function startGeo() {
    if (geoWatchRef.current != null || !navigator.geolocation) {
      if (!navigator.geolocation) setGeoNote('Location unavailable')
      return
    }
    setGeoNote('Waiting for location permission')
    geoWatchRef.current = navigator.geolocation.watchPosition(
      (position) => {
        const next: GeoFix = {
          lat: Math.round(position.coords.latitude * 1e5) / 1e5,
          lon: Math.round(position.coords.longitude * 1e5) / 1e5,
          acc: Number.isFinite(position.coords.accuracy) ? Math.round(position.coords.accuracy) : null,
        }
        locRef.current = next
        setLoc(next)
        radioRef.current?.setLoc(next)
        setGeoNote('Location on')
      },
      (error) => {
        setGeoNote(error.code === 1 ? 'Location permission denied' : 'Location unavailable')
      },
      { enableHighAccuracy: true, maximumAge: 5_000, timeout: 20_000 },
    )
  }

  async function ensureMic() {
    unlock()
    if (streamRef.current) return true
    if (!window.isSecureContext) {
      setMicError(micErrorMessage(null, false))
      return false
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      setMicError('This browser has no microphone API.')
      return false
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 },
        video: false,
      })
      streamRef.current = stream
      const ac = acRef.current
      if (!ac) return false
      const source = ac.createMediaStreamSource(stream)
      const processor = ac.createScriptProcessor(4096, 1, 1)
      const mute = ac.createGain()
      mute.gain.value = 0
      source.connect(processor)
      processor.connect(mute)
      mute.connect(ac.destination)
      processor.onaudioprocess = (event) => {
        onPcmRef.current(event.inputBuffer.getChannelData(0), event.inputBuffer.sampleRate)
      }
      setMicError(null)
      return true
    } catch (error) {
      setMicError(micErrorMessage(error, window.isSecureContext))
      return false
    }
  }

  async function down() {
    unlock()
    startGeo()
    if (holdingRef.current || liveRef.current) return
    holdingRef.current = true
    setHolding(true)
    setDenied(false)
    const radio = radioRef.current
    const floor = floorRef.current
    if (!radio?.online) return
    if (floor && floor.id !== meRef.current) return
    const micOk = await ensureMic()
    if (!holdingRef.current) return
    if (!micOk) {
      holdingRef.current = false
      setHolding(false)
      return
    }
    radio.setLoc(locRef.current)
    radio.claim((ok) => {
      if (!holdingRef.current || !ok) {
        if (ok) radio.release()
        if (!ok && holdingRef.current) setDenied(true)
        return
      }
      grantedRef.current = true
      setGranted(true)
      setDenied(false)
      beginTx()
      const pre = ringRef.current.snapshot()
      ringRef.current.clear()
      if (pre.length) sendChunk(pre)
      liveRef.current = true
      tailUntilRef.current = Number.POSITIVE_INFINITY
    })
  }

  function up() {
    if (!holdingRef.current && !grantedRef.current) return
    holdingRef.current = false
    setHolding(false)
    setDenied(false)
    if (!liveRef.current) {
      grantedRef.current = false
      setGranted(false)
      return
    }
    tailUntilRef.current = performance.now() + TAIL_MS
  }

  useEffect(() => {
    clearStoredSpeechKey()
    watchModel(setModel)
    watchTranslation(setTranslationModel)
    const runtime = speechRuntime()
    if (runtime.worker && runtime.wasm) ensureModel()
  }, [])

  useEffect(() => {
    let radio: Radio | null = null
    let cancelled = false
    void (async () => {
      const wire = await chooseWire()
      if (cancelled) {
        wire.stop()
        return
      }
      const root = safeTopicRoot(loadTopic()) ?? DEFAULT_TOPIC_ROOT
      topicRef.current = root
      radio = new Radio(wire, root, {
        state: (view) => {
          floorRef.current = view.floor
          meRef.current = view.me
          setRadioState(view)
        },
        net: setNet,
        boundary: () => closeRx(),
        lost: () => {
          liveRef.current = false
          grantedRef.current = false
          holdingRef.current = false
          setHolding(false)
          setGranted(false)
          finishTx()
          ringRef.current.clear()
        },
        notice: (notice) => {
          const wav = buildWav([new Int16Array(Math.round(SAMPLE_RATE / 10))], SAMPLE_RATE)
          const url = URL.createObjectURL(new Blob([wav], { type: 'audio/wav' }))
          setMessages((prev) => [
            {
              key: notice.answerId,
              name: notice.name,
              mine: false,
              t0: Date.now(),
              dur: 0.1,
              url,
              loc: null,
              transcript: notice.text,
              translation: null,
              translationNote: null,
              error: null,
              pending: false,
              phase: 'done' as const,
              role: 'assistant' as const,
              citation: notice.citation,
            },
            ...prev,
          ].slice(0, 40))
        },
        audio: (pcm, from: Speaker) => {
          lastRxRef.current = Date.now()
          playPcm(pcm)
          if (from.id === ASSISTANT_ID) return
          const now = Date.now()
          const open = rxRef.current
          if (open && (open.id !== from.id || now - open.last > CLIP_GAP_MS)) closeRx()
          let clip = rxRef.current
          if (!clip || clip.id !== from.id) {
            clip = { id: from.id, name: from.name, loc: from.loc, t0: now, last: now, chunks: [], samples: 0, mine: false }
            rxRef.current = clip
          }
          if (from.loc) clip.loc = from.loc
          clip.name = from.name
          clip.chunks.push(pcm)
          clip.samples += pcm.length
          clip.last = now
        },
      })
      radioRef.current = radio
      radio.setLoc(locRef.current)
      radio.start(nameRef.current)
    })()
    startGeo()
    const gapTimer = window.setInterval(() => {
      const clip = rxRef.current
      if (clip && Date.now() - clip.last > CLIP_GAP_MS) closeRx()
    }, 400)
    const phaseTimer = window.setInterval(() => setTick((value) => value + 1), 250)
    const onPointer = () => {
      unlock()
      startGeo()
    }
    window.addEventListener('pointerdown', onPointer)
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.code !== 'Space' || event.repeat) return
      const target = event.target
      if (target instanceof HTMLElement) {
        const tag = target.tagName
        if (tag === 'INPUT' || tag === 'TEXTAREA' || target.isContentEditable) return
      }
      event.preventDefault()
      void down()
    }
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.code !== 'Space') return
      event.preventDefault()
      up()
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    const leave = () => radio?.stop()
    window.addEventListener('pagehide', leave)
    return () => {
      window.clearInterval(gapTimer)
      window.clearInterval(phaseTimer)
      window.removeEventListener('pointerdown', onPointer)
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('pagehide', leave)
      if (geoWatchRef.current != null) {
        navigator.geolocation.clearWatch(geoWatchRef.current)
        geoWatchRef.current = null
      }
      streamRef.current?.getTracks().forEach((track) => track.stop())
      streamRef.current = null
      cancelled = true
      radio?.stop()
    }
    // The radio session lives for the whole page. Handlers read refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (speechRuntime().worker) ensureTranslation(lang, target)
  }, [lang, target])

  const floor = radioState.floor
  const me = radioState.me
  const phase = phaseOf({
    online: net.state === 'online',
    holding,
    granted,
    denied,
    floorId: floor?.id ?? null,
    me,
    recentRx: Date.now() - lastRxRef.current < 700,
  })

  // `tick` forces the receiving/busy colour to follow incoming audio.
  void tick

  const talker = floor && floor.id !== me ? floor.name : null
  const talkerId = floor && floor.id !== me ? floor.id : null

  function setName(value: string) {
    const next = value.slice(0, 40)
    setNameState(next)
    saveName(next.trim() || nameRef.current)
    if (next.trim()) radioRef.current?.rename(next.trim())
  }

  function setLang(value: LangId) {
    setLangState(value)
    saveLang(value)
  }

  function setTarget(value: LangId) {
    setTargetState(value)
    saveTarget(value)
  }

  function setCloudFallback(value: boolean) {
    setCloudFallbackState(value)
    saveCloudFallback(value)
  }

  function clearMessages() {
    setMessages((prev) => {
      for (const item of prev) URL.revokeObjectURL(item.url)
      return []
    })
    setLogEpoch((value) => value + 1)
  }

  return {
    name,
    setName,
    lang,
    setLang,
    target,
    setTarget,
    cloudFallback,
    setCloudFallback,
    model,
    translationModel,
    runtimeNote,
    phase,
    net,
    users: radioState.users,
    me,
    talker,
    talkerId,
    messages,
    logEpoch,
    clearMessages,
    micError,
    geoNote,
    loc,
    soundOn,
    unlock,
    down,
    up,
  }
}
