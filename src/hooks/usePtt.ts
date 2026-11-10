import { useEffect, useRef, useState } from 'react'
import { PcmRing, buildWav, concatInt16, downsampleToPcm } from '../lib/audio.ts'
import { LivePlayout, pcmToContextFloat } from '../lib/playback.ts'
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
import { applyOutputSink } from '../lib/audio-route.ts'
import { micErrorMessage } from '../lib/media-errors.ts'
import { MqttWire } from '../lib/mqtt-transport.ts'
import { DEFAULT_TOPIC_ROOT, safeTopicRoot } from '../lib/net.ts'
import { phaseOf, type Phase } from '../lib/phase.ts'
import { Radio, type RadioView, type Speaker } from '../lib/radio.ts'
import { RelayWire } from '../lib/relay-transport.ts'
import type { NetSnapshot, Wire } from '../lib/transport.ts'
import { askChannel, backendBase } from '../lib/api.ts'
import { lineId as validLineId } from '../lib/lines.ts'
import type { ServerCaption } from '../lib/packets.ts'
import {
  clearStoredSpeechKey,
  loadBackend,
  loadName,
  loadTransport,
  saveName,
} from '../lib/storage.ts'
import type { ChatMessage } from '../lib/types.ts'

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

type PublicLine = { id: string; name: string; topic: string }

const LINE_STORE = 'sanket-talk-line'

function hashLine(): string {
  const hash = window.location.hash
  const query = hash.includes('?') ? hash.slice(hash.indexOf('?') + 1) : ''
  const id = new URLSearchParams(query).get('line') ?? ''
  const fromHash = validLineId(id)
  if (fromHash) return fromHash
  try {
    return validLineId(localStorage.getItem(LINE_STORE) ?? '') ?? ''
  } catch {
    return ''
  }
}

export function usePtt(route: { inputId?: string; outputId?: string } = {}) {
  const inputId = route.inputId ?? ''
  const outputId = route.outputId ?? ''
  const [name, setNameState] = useState(loadName)
  const [lineId, setLineId] = useState(hashLine)
  const [lines, setLines] = useState<PublicLine[]>([])
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
  const txStartRef = useRef<number | null>(null)
  const rxRef = useRef<OpenClip | null>(null)
  const lastRxRef = useRef(0)
  const ringRef = useRef(new PcmRing(Math.round((PRE_ROLL_MS / 1000) * SAMPLE_RATE)))
  const acRef = useRef<AudioContext | null>(null)
  const playoutRef = useRef<LivePlayout | null>(null)
  const playSpeakerRef = useRef('')
  const streamRef = useRef<MediaStream | null>(null)
  const requestedInputRef = useRef<string | null>(null)
  const inputIdRef = useRef(inputId)
  const outputIdRef = useRef(outputId)
  const graphRef = useRef<{ source: MediaStreamAudioSourceNode; processor: ScriptProcessorNode; mute: GainNode } | null>(null)
  const geoWatchRef = useRef<number | null>(null)
  const onPcmRef = useRef<(input: Float32Array, sampleRate: number) => void>(() => {})

  nameRef.current = name
  locRef.current = loc
  inputIdRef.current = inputId
  outputIdRef.current = outputId

  function applyCaption(caption: ServerCaption) {
    setMessages((prev) => {
      const index = prev.findIndex((item) => item.speakerId === caption.speakerId && item.pending)
      const patch: Partial<ChatMessage> = {
        transcript: caption.transcript,
        translation: caption.translation,
        translationNote: caption.translationNote,
        pending: false,
        phase: 'done',
        error: caption.status === 'failed' ? caption.translationNote : null,
      }
      if (index === -1) {
        return [{
          key: caption.clipId,
          name: caption.speakerName,
          mine: caption.speakerId === meRef.current,
          speakerId: caption.speakerId,
          t0: Date.parse(caption.at) || Date.now(),
          dur: 0,
          url: '',
          loc: null,
          transcript: caption.transcript,
          translation: caption.translation,
          translationNote: caption.translationNote,
          error: caption.status === 'failed' ? caption.translationNote : null,
          pending: false,
          phase: 'done' as const,
        }, ...prev].slice(0, 40)
      }
      const next = [...prev]
      const current = next[index]
      if (!current) return prev
      next[index] = { ...current, ...patch }
      if (current.mine && caption.transcript && isExplicitQuestion(caption.transcript)) {
        void askChannel(caption.transcript, meRef.current, topicRef.current)
      }
      return next
    })
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
      speakerId: clip.id,
      t0: clip.t0,
      dur: pcm.length / SAMPLE_RATE,
      url,
      loc: clip.loc,
      transcript: null,
      translation: null,
      translationNote: 'Waiting for the server transcript.',
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
  }

  function finishTx() {
    const clip = txRef.current
    txRef.current = null
    txStartRef.current = null
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

  function playPcm(pcm: Int16Array, seq: number | null, speakerId: string) {
    const ac = acRef.current
    if (!ac || ac.state !== 'running' || pcm.length === 0) return
    if (!playoutRef.current || playSpeakerRef.current !== speakerId) {
      playoutRef.current = new LivePlayout(SAMPLE_RATE, () => ac.currentTime)
      playSpeakerRef.current = speakerId
    }
    playoutRef.current.push(seq, pcm, (chunk, when) => {
      const floats = pcmToContextFloat(chunk, SAMPLE_RATE, ac.sampleRate)
      const buffer = ac.createBuffer(1, floats.length, ac.sampleRate)
      buffer.getChannelData(0).set(floats)
      const source = ac.createBufferSource()
      source.buffer = buffer
      source.connect(ac.destination)
      source.start(Math.max(when, ac.currentTime))
    })
  }

  function routeOutput(ac: AudioContext) {
    const sink = ac as AudioContext & { setSinkId?: (sinkId: string) => Promise<void> }
    void applyOutputSink(sink, outputIdRef.current)
  }

  function unlock() {
    const AudioCtx = window.AudioContext || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!AudioCtx) return
    if (!acRef.current) acRef.current = new AudioCtx()
    const ac = acRef.current
    routeOutput(ac)
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

  function closeMicGraph() {
    const graph = graphRef.current
    graphRef.current = null
    if (!graph) return
    graph.processor.onaudioprocess = null
    graph.source.disconnect()
    graph.processor.disconnect()
    graph.mute.disconnect()
  }

  async function openMic(deviceId: string) {
    unlock()
    if (streamRef.current && requestedInputRef.current === deviceId) return true
    if (!window.isSecureContext) {
      setMicError(micErrorMessage(null, false))
      return false
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      setMicError('This browser has no microphone API.')
      return false
    }
    requestedInputRef.current = deviceId
    const audio: MediaTrackConstraints = { echoCancellation: true, noiseSuppression: true, channelCount: 1 }
    if (deviceId) audio.deviceId = { exact: deviceId }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio, video: false })
      if (requestedInputRef.current !== deviceId) {
        stream.getTracks().forEach((track) => track.stop())
        return false
      }
      streamRef.current?.getTracks().forEach((track) => track.stop())
      closeMicGraph()
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
      graphRef.current = { source, processor, mute }
      setMicError(null)
      return true
    } catch (error) {
      if (requestedInputRef.current === deviceId) requestedInputRef.current = null
      setMicError(micErrorMessage(error, window.isSecureContext))
      return false
    }
  }

  const openMicRef = useRef(openMic)
  openMicRef.current = openMic

  async function ensureMic() {
    return openMic(inputIdRef.current)
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
      txStartRef.current = Date.now()
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
    let cancel = false
    void fetch(`${backendBase()}/api/lines`, { cache: 'no-store' })
      .then((response) => response.json())
      .then((body: { lines?: PublicLine[] }) => {
        if (cancel) return
        const list = body.lines ?? []
        setLines(list)
        setLineId((current) => {
          const next = current || list[0]?.id || 'sanket-1'
          try {
            if (next) localStorage.setItem(LINE_STORE, next)
          } catch {
            /* private mode */
          }
          return next
        })
      })
      .catch(() => setLineId((current) => current || 'sanket-1'))
    const onHash = () => {
      const id = hashLine()
      if (id) setLineId(id)
    }
    window.addEventListener('hashchange', onHash)
    return () => {
      cancel = true
      window.removeEventListener('hashchange', onHash)
    }
  }, [])

  useEffect(() => {
    if (!lineId) return
    let radio: Radio | null = null
    let cancelled = false
    void (async () => {
      const wire = await chooseWire()
      if (cancelled) {
        wire.stop()
        return
      }
      const root = safeTopicRoot(`sanket-ptt/v1/${lineId}/`) ?? DEFAULT_TOPIC_ROOT
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
        caption: (caption) => applyCaption(caption),
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
        audio: (pcm, from: Speaker, seq) => {
          lastRxRef.current = Date.now()
          playPcm(pcm, seq, from.id)
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
      closeMicGraph()
      streamRef.current = null
      cancelled = true
      radio?.stop()
    }
    // Restart the radio when the selected line changes. Handlers read refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lineId])

  useEffect(() => {
    const ac = acRef.current
    if (!ac) return
    const sink = ac as AudioContext & { setSinkId?: (sinkId: string) => Promise<void> }
    void applyOutputSink(sink, outputId)
  }, [outputId])

  useEffect(() => {
    if (!streamRef.current || requestedInputRef.current === inputId) return
    void openMicRef.current(inputId)
  }, [inputId])

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
  const holdLeft = granted && txStartRef.current != null
    ? Math.max(0, Math.ceil((MAX_CLIP_MS - (Date.now() - txStartRef.current)) / 1000))
    : null

  function setName(value: string) {
    const next = value.slice(0, 40)
    setNameState(next)
    saveName(next.trim() || nameRef.current)
    if (next.trim()) radioRef.current?.rename(next.trim())
  }

  function chooseLine(id: string) {
    const next = validLineId(id)
    if (!next) return
    try {
      localStorage.setItem(LINE_STORE, next)
    } catch {
      /* private mode */
    }
    setLineId(next)
    const base = window.location.hash.startsWith('#/transcribe') || window.location.hash.startsWith('#/reference') || window.location.hash.startsWith('#/control')
      ? '#/'
      : '#/'
    window.location.hash = `${base}?line=${next}`
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
    lineId,
    lines,
    chooseLine,
    phase,
    net,
    users: radioState.users,
    me,
    talker,
    talkerId,
    holdLeft,
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
