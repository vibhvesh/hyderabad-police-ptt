import { useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { concatInt16, downsampleToPcm, toWhisperAudio } from '@/lib/audio'
import { apiFetch, INGEST_TOKEN_KEY } from '@/lib/api'
import { voiceBlock } from '@/lib/blocks'
import { loadSession } from '@/lib/storage'
import { transcribeLocal } from '@/lib/transcribe'
import { translateText, type Translation } from '@/lib/translate-client'
import { LANGUAGES, type LangId } from '@/lib/types'

type Segment = { id: string; original: string; translation: Translation | null; source: string }

export function TranscribeView() {
  const [source, setSource] = useState<LangId>('te')
  const [target, setTarget] = useState<LangId>('en')
  const [status, setStatus] = useState('Ready. Telugu is the default recognition language.')
  const [segments, setSegments] = useState<Segment[]>([])
  const [listening, setListening] = useState(false)
  const [referenceMode, setReferenceMode] = useState(false)
  const [draft, setDraft] = useState('')
  const [asr, setAsr] = useState('')
  const [confirmed, setConfirmed] = useState(false)
  const chunks = useRef<Int16Array[]>([])
  const stream = useRef<MediaStream | null>(null)

  async function finish(pcm: Int16Array, label: string) {
    setStatus('Transcribing on this device…')
    const option = LANGUAGES.find((item) => item.id === source) ?? LANGUAGES[0]
    try {
      const text = (await transcribeLocal(toWhisperAudio(pcm), option?.whisper ?? 'telugu')).trim()
      const translation = await translateText(text, source, target)
      setSegments((prev) => [{ id: crypto.randomUUID(), original: text || 'No speech detected', translation, source: label }, ...prev])
      setAsr(text)
      setDraft(text)
      setConfirmed(false)
      setStatus(translation.state === 'translated' ? 'Transcript ready.' : translation.note)
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Transcription failed.')
    }
  }

  async function start() {
    if (!window.isSecureContext) {
      setStatus('The microphone needs HTTPS or localhost. A phone on plain http:// cannot use the mic.')
      return
    }
    const media = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1 }, video: false })
    stream.current = media
    chunks.current = []
    const audio = new AudioContext()
    const node = audio.createScriptProcessor(4096, 1, 1)
    const mute = audio.createGain()
    mute.gain.value = 0
    audio.createMediaStreamSource(media).connect(node)
    node.connect(mute)
    mute.connect(audio.destination)
    node.onaudioprocess = (event) => {
      chunks.current.push(downsampleToPcm(event.inputBuffer.getChannelData(0), event.inputBuffer.sampleRate))
    }
    setListening(true)
    setStatus(referenceMode ? 'Recording an administrator reference update. Ordinary radio traffic is not recorded here.' : 'Listening…')
  }

  async function stop() {
    stream.current?.getTracks().forEach((track) => track.stop())
    setListening(false)
    await finish(concatInt16(chunks.current), referenceMode ? 'Administrator microphone' : 'Microphone')
  }

  async function onFile(file: File) {
    const audio = new AudioContext()
    const decoded = await audio.decodeAudioData(await file.arrayBuffer())
    const mixed = decoded.getChannelData(0)
    await finish(downsampleToPcm(mixed, decoded.sampleRate), file.name)
  }

  async function serverFallback(file: File) {
    setStatus('Sending audio to the configured server…')
    const response = await apiFetch('/api/transcribe', loadSession(INGEST_TOKEN_KEY), {
      method: 'POST',
      headers: { 'x-language': source },
      body: await file.arrayBuffer(),
    })
    const body = (await response.json()) as { text?: string; message?: string }
    setStatus(response.ok ? `Server transcript: ${body.text}` : (body.message ?? 'Server transcription is not configured.'))
  }

  async function fileVoiceDraft() {
    const token = loadSession('sanket-admin-token')
    const response = await apiFetch('/api/channels/sanket-1/proposals', token, {
      method: 'POST',
      body: JSON.stringify({
        origin: 'voice',
        asrTranscript: asr,
        text: draft,
        transcriptConfirmed: confirmed,
        actor: 'administrator',
      }),
    })
    const body = (await response.json()) as { message?: string }
    setStatus(body.message ?? (response.ok ? 'Voice draft filed. The approved reference was not changed.' : 'The draft was not filed.'))
  }

  function download() {
    const lines = ['Sanket Transcribe', `Source: ${source}`, `Translation: ${target}`, '']
    for (const segment of [...segments].reverse()) {
      lines.push(segment.original, segment.translation?.text || segment.translation?.note || '', '')
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8' })
    const link = document.createElement('a')
    link.href = URL.createObjectURL(blob)
    link.download = 'sanket-transcribe.txt'
    link.click()
  }

  return (
    <main className="flex flex-col gap-4 px-4 py-5">
      <p className="text-sm text-slate-600">Separate recorder for a file or a microphone take. Live radio messages are transcribed on the Talk page. Recognition stays on this device unless you explicitly send a file to a configured server.</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-sm">Recognition
          <select className="mt-1 w-full rounded-md border px-2 py-2" value={source} onChange={(event) => setSource(event.target.value as LangId)}>
            {LANGUAGES.map((language) => <option key={language.id} value={language.id}>{language.label}</option>)}
          </select>
        </label>
        <label className="text-sm">Translation
          <select className="mt-1 w-full rounded-md border px-2 py-2" value={target} onChange={(event) => setTarget(event.target.value as LangId)}>
            {LANGUAGES.map((language) => <option key={language.id} value={language.id}>{language.label}</option>)}
          </select>
        </label>
      </div>
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" checked={referenceMode} onChange={(event) => setReferenceMode(event.target.checked)} />
        Administrator reference update. This is separate from push-to-talk and only files a draft after you confirm the transcript.
      </label>
      <div className="flex flex-wrap gap-2">
        {listening ? <Button type="button" onClick={() => void stop()}>Stop</Button> : <Button type="button" onClick={() => void start()}>Start microphone</Button>}
        <label className="inline-flex cursor-pointer items-center rounded-md border px-3 py-2 text-sm">
          Upload audio
          <input className="sr-only" type="file" accept="audio/*" onChange={(event) => { const file = event.target.files?.[0]; if (file) void onFile(file) }} />
        </label>
        <label className="inline-flex cursor-pointer items-center rounded-md border px-3 py-2 text-sm">
          Server fallback
          <input className="sr-only" type="file" accept="audio/*" onChange={(event) => { const file = event.target.files?.[0]; if (file) void serverFallback(file) }} />
        </label>
        <Button type="button" variant="outline" onClick={download} disabled={segments.length === 0}>Download TXT</Button>
      </div>
      <p className="text-sm" role="status">{status}</p>
      {referenceMode ? (
        <section className="rounded-xl border bg-white p-3">
          <h2 className="text-sm font-semibold">Check the transcript before filing</h2>
          <p className="mt-1 text-xs text-amber-800">Speech recognition can mishear numbers and frequencies. Digits are not inferred or corrected. Edit them here, then confirm.</p>
          <p className="mt-2 text-xs text-slate-500">Recognizer output</p>
          <pre className="text-sm whitespace-pre-wrap">{asr || 'No transcript yet.'}</pre>
          <label className="mt-2 block text-sm">Corrected text
            <textarea className="mt-1 w-full rounded-md border p-2" rows={4} value={draft} onChange={(event) => { setDraft(event.target.value); setConfirmed(false) }} />
          </label>
          <label className="mt-2 flex items-start gap-2 text-sm">
            <input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />
            I checked the numbers and frequencies against what was said.
          </label>
          <Button type="button" className="mt-2" disabled={!confirmed || !draft.trim()} onClick={() => void fileVoiceDraft()}>File voice draft</Button>
          <p className="mt-2 text-xs text-slate-500">{voiceBlock(draft || '…')}</p>
        </section>
      ) : null}
      <ul className="flex flex-col gap-3">
        {segments.map((segment) => (
          <li key={segment.id} className="rounded-xl border bg-white p-3">
            <p className="text-xs text-slate-500">{segment.source}</p>
            <p className="mt-1 text-sm">{segment.original}</p>
            <p className="mt-2 text-sm text-emerald-900">{segment.translation?.text || segment.translation?.note}</p>
          </li>
        ))}
      </ul>
    </main>
  )
}
