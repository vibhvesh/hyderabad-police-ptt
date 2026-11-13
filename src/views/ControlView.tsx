import { useEffect, useState, type FormEvent } from 'react'
import { controlPage, type ControlPage } from '@/lib/control-page'
import type { VoiceChoice } from '@/lib/voice-choice'
import { Connections } from '@/views/control/Connections'
import { Dashboard } from '@/views/control/Dashboard'
import { LineVoiceFields } from '@/views/control/LineVoiceFields'
import QRCode from 'qrcode'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { controlFetch, saveControlToken } from '@/lib/control-api'
import { formatIst } from '@/lib/ist'
import type { LineLang } from '@/lib/lines'
import type { SttChoice } from '@/lib/stt'
import { SttPanel } from '@/views/control/SttPanel'

type Line = { id: string; name: string; enabled: boolean; sourceLang: LineLang; targetLang: LineLang; ttsProvider: VoiceChoice; asrProvider: SttChoice; topic: string }
type User = { lineId: string; id: string; name: string; lastSeen: number; location: string | null }
type Floor = { lineId: string; id: string; name: string; since: number }
type Activity = { at: string; lineId: string; text: string }
type Handset = {
  id: string
  lineId: string
  name: string
  revokedAt: string | null
  online: boolean
  lastSeen: number | null
  battery: number | null
  rssi: number | null
  voltage: number | null
  listenOnly?: boolean
}
type Clip = {
  id: string
  lineId: string
  lineName: string
  speakerId: string
  speakerName: string
  at: string
  transcript: string | null
  translation: string | null
  translationNote: string | null
  status: string
}
type Settings = {
  asrProvider: 'none' | 'transformers' | 'whisper-cli'
  translateProvider: 'none' | 'opus'
  elevenLabsFallback: boolean
  elevenLabsConfigured: boolean
  retentionDays: number
}

const LANGS: LineLang[] = ['te', 'en', 'hi']

export function ControlView({ talkOrigin }: { talkOrigin: string | null }) {
  const [page, setPage] = useState<ControlPage>(() => controlPage(window.location.hash))
  const [authed, setAuthed] = useState<boolean | null>(null)
  const [note, setNote] = useState('')
  const [lines, setLines] = useState<Line[]>([])
  const [users, setUsers] = useState<User[]>([])
  const [devices, setDevices] = useState<Handset[]>([])
  const [issued, setIssued] = useState<{ name: string; id: string; token: string } | null>(null)
  const [floors, setFloors] = useState<Floor[]>([])
  const [activity, setActivity] = useState<Activity[]>([])
  const [clips, setClips] = useState<Clip[]>([])
  const [settings, setSettings] = useState<Settings | null>(null)
  const [filterLine, setFilterLine] = useState('')
  const [filterSender, setFilterSender] = useState('')
  const [filterFrom, setFilterFrom] = useState('')
  const [filterTo, setFilterTo] = useState('')
  const [filterQ, setFilterQ] = useState('')
  const [draft, setDraft] = useState({ id: '', name: '', sourceLang: 'te' as LineLang, targetLang: 'en' as LineLang, ttsProvider: 'free' as VoiceChoice, asrProvider: 'free' as SttChoice })
  const [code, setCode] = useState('')
  const [token, setToken] = useState('')
  const [audioUrl, setAudioUrl] = useState<string | null>(null)

  async function loadAll() {
    const [lineRes, liveRes, logRes, settingsRes] = await Promise.all([
      controlFetch('/api/control/lines'),
      controlFetch('/api/control/live'),
      controlFetch(`/api/control/log?${queryString()}`),
      controlFetch('/api/control/settings'),
    ])
    if ([lineRes, liveRes, logRes, settingsRes].some((response) => response.status === 401 || response.status === 503)) {
      setAuthed(false)
      return
    }
    setAuthed(true)
    const lineBody = (await lineRes.json()) as { lines?: Line[] }
    const liveBody = (await liveRes.json()) as { users?: User[]; floors?: Floor[]; activity?: Activity[]; devices?: Handset[] }
    const logBody = (await logRes.json()) as { clips?: Clip[] }
    setLines(lineBody.lines ?? [])
    setUsers(liveBody.users ?? [])
    setDevices(liveBody.devices ?? [])
    setFloors(liveBody.floors ?? [])
    setActivity(liveBody.activity ?? [])
    setClips(logBody.clips ?? [])
    if (settingsRes.ok) setSettings((await settingsRes.json()) as Settings)
  }

  async function refreshLive() {
    const liveRes = await controlFetch('/api/control/live')
    if (liveRes.status === 401 || liveRes.status === 503) {
      setAuthed(false)
      return
    }
    const liveBody = (await liveRes.json()) as { users?: User[]; floors?: Floor[]; activity?: Activity[]; devices?: Handset[] }
    setUsers(liveBody.users ?? [])
    setDevices(liveBody.devices ?? [])
    setFloors(liveBody.floors ?? [])
    setActivity(liveBody.activity ?? [])
  }

  async function download(kind: 'csv' | 'txt') {
    const response = await controlFetch(`/api/control/log.${kind}?${queryString()}`)
    if (!response.ok) {
      setNote('The export was not available.')
      return
    }
    const url = URL.createObjectURL(await response.blob())
    const link = document.createElement('a')
    link.href = url
    link.download = kind === 'csv' ? 'sanket-log.csv' : 'sanket-log.txt'
    link.click()
    URL.revokeObjectURL(url)
  }

  function queryString() {
    const params = new URLSearchParams()
    if (filterLine) params.set('line', filterLine)
    if (filterSender) params.set('sender', filterSender)
    if (filterFrom) params.set('from', new Date(filterFrom).toISOString())
    if (filterTo) params.set('to', new Date(filterTo).toISOString())
    if (filterQ) params.set('q', filterQ)
    return params.toString()
  }

  useEffect(() => {
    const sync = () => setPage(controlPage(window.location.hash))
    window.addEventListener('hashchange', sync)
    return () => window.removeEventListener('hashchange', sync)
  }, [])

  useEffect(() => {
    void loadAll()
    const timer = window.setInterval(() => void refreshLive(), 2000)
    return () => window.clearInterval(timer)
    // Filters are applied when the operator presses Search.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function unlock(event: FormEvent) {
    event.preventDefault()
    setNote('')
    if (token.trim()) saveControlToken(token)
    if (code.trim()) {
      const response = await controlFetch('/api/demo/unlock', { method: 'POST', body: JSON.stringify({ code }) })
      const body = (await response.json()) as { message?: string }
      if (!response.ok) {
        setNote(body.message ?? 'The demo code was not accepted.')
        return
      }
    }
    setCode('')
    setToken('')
    await loadAll()
  }

  async function createLine(event: FormEvent) {
    event.preventDefault()
    const response = await controlFetch('/api/control/lines', { method: 'POST', body: JSON.stringify(draft) })
    const body = (await response.json()) as { message?: string }
    setNote(response.ok ? 'Line created.' : (body.message ?? 'The line was not created.'))
    if (response.ok) setDraft({ id: '', name: '', sourceLang: 'te', targetLang: 'en', ttsProvider: 'free', asrProvider: 'free' })
    await loadAll()
  }

  async function saveSettings(event: FormEvent) {
    event.preventDefault()
    if (!settings) return
    const response = await controlFetch('/api/control/settings', { method: 'PUT', body: JSON.stringify(settings) })
    const payload = (await response.json()) as Settings & { message?: string }
    if (!response.ok) {
      setNote(payload.message ?? 'Settings were not saved.')
      return
    }
    setSettings(payload)
    setNote('Settings saved.')
  }

  async function testServerKey() {
    const response = await controlFetch('/api/control/elevenlabs/test', { method: 'POST' })
    const body = (await response.json()) as { ok?: boolean; message?: string }
    setNote(body.ok ? 'Server ElevenLabs key is ok.' : (body.message ?? 'The server key was not accepted.'))
  }

  async function revokeDevice(id: string) {
    const response = await controlFetch(`/api/control/devices/${id}`, { method: 'DELETE' })
    const body = (await response.json()) as { message?: string }
    setNote(response.ok ? 'Handset revoked.' : (body.message ?? 'The handset was not revoked.'))
    await loadAll()
  }

  async function play(id: string) {
    const response = await controlFetch(`/api/control/clips/${id}/audio`)
    if (!response.ok) {
      setNote('The clip audio is not available.')
      return
    }
    const url = URL.createObjectURL(await response.blob())
    setAudioUrl((current) => {
      if (current) URL.revokeObjectURL(current)
      return url
    })
  }

  if (authed !== true) {
    if (authed === null) return <main className="px-4 py-8 text-sm text-slate-600">Checking access…</main>
    return (
      <main className="mx-auto flex w-full max-w-md flex-col gap-4 px-4 py-8">
        <h1 className="text-xl font-semibold text-[#0c3d82]">Control room</h1>
        <p className="text-sm text-slate-600">Sign in with the admin token or the shared demo code. This screen has no push-to-talk button.</p>
        <form className="grid gap-3 rounded-xl bg-white p-4" onSubmit={(event) => void unlock(event)}>
          <label className="text-sm">Admin token
            <Input type="password" autoComplete="off" value={token} onChange={(event) => setToken(event.target.value)} />
          </label>
          <label className="text-sm">Demo code
            <Input type="password" autoComplete="off" value={code} onChange={(event) => setCode(event.target.value)} />
          </label>
          <Button type="submit">Open control room</Button>
        </form>
        {note ? <p className="text-sm text-red-700">{note}</p> : null}
      </main>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <nav className="flex flex-wrap gap-2 px-5 pt-4 text-sm md:hidden" aria-label="Control room">
        <a className={page.name === 'dashboard' ? 'rounded-full bg-[#0c3d82] px-3 py-1 font-semibold text-white' : 'rounded-full border px-3 py-1 font-semibold text-[#0c3d82]'} href="#/control/display">Display Board</a>
        <a className={page.name === 'manage' ? 'rounded-full bg-[#0c3d82] px-3 py-1 font-semibold text-white' : 'rounded-full border px-3 py-1 font-semibold text-[#0c3d82]'} href="#/control/manage">Settings</a>
        <a className="rounded-full border px-3 py-1 font-semibold text-[#0c3d82]" href="#/reference">Reference</a>
      </nav>
      {page.name === 'dashboard' ? <Dashboard /> : null}
      {page.name === 'connections' ? <Connections lineId={page.lineId} /> : null}
      {page.name === 'manage' ? (
    <main className="flex flex-col gap-6 px-4 py-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-[#0c3d82]">Settings</h1>
          <p className="text-sm text-slate-600">Lines, handsets, the transcript log, and processing. The wall stays the first screen.</p>
        </div>
      </div>
      {note ? <p className="text-sm" role="status">{note}</p> : null}
      {issued ? (
        <section className="rounded-xl border border-amber-300 bg-amber-50 p-4">
          <h2 className="font-semibold">Handset token for {issued.name}</h2>
          <p className="mt-1 text-sm text-slate-700">Type the id and the token into the handset setup page. The server stores only a hash, so this token is not shown again.</p>
          <p className="mt-2 text-sm">Device id <span className="font-mono">{issued.id}</span></p>
          <p className="mt-1 break-all font-mono text-sm">{issued.token}</p>
          <Button type="button" variant="outline" className="mt-3" onClick={() => setIssued(null)}>Hide token</Button>
        </section>
      ) : null}
      <section className="rounded-xl bg-white p-4">
        <h2 className="font-semibold">Lines</h2>
        <form className="mt-3 grid gap-3" onSubmit={(event) => void createLine(event)}>
          <div className="grid gap-2 md:grid-cols-5">
            <Input placeholder="id" value={draft.id} onChange={(event) => setDraft({ ...draft, id: event.target.value })} required />
            <Input placeholder="Name" value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} required />
            <LangSelect value={draft.sourceLang} onChange={(sourceLang) => setDraft({ ...draft, sourceLang })} />
            <LangSelect value={draft.targetLang} onChange={(targetLang) => setDraft({ ...draft, targetLang })} />
            <Button type="submit">Create line</Button>
          </div>
          <LineVoiceFields
            tts={draft.ttsProvider}
            asr={draft.asrProvider}
            configured={settings?.elevenLabsConfigured === true}
            onTts={(ttsProvider) => setDraft({ ...draft, ttsProvider })}
            onAsr={(asrProvider) => setDraft({ ...draft, asrProvider })}
          />
        </form>
        <ul className="mt-4 flex flex-col gap-3">
          {lines.map((line) => (
            <LineRow key={line.id} line={line} talkOrigin={talkOrigin} configured={settings?.elevenLabsConfigured === true} onChange={() => void loadAll()} onNote={setNote} onIssued={setIssued} />
          ))}
        </ul>
      </section>
      <section className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-xl bg-white p-4">
          <h2 className="font-semibold">Online</h2>
          <ul className="mt-2 text-sm">
            {users.length === 0 ? <li className="text-slate-500">Nobody is on a line.</li> : null}
            {users.map((user) => (
              <li key={`${user.lineId}:${user.id}`} className="border-t py-2">
                <span className="font-semibold">{user.name}</span> · {user.lineId} · {user.id}
                <span className="block text-xs text-slate-500">Last seen {formatIst(new Date(user.lastSeen).toISOString())} IST {user.location ? `· ${user.location}` : ''}</span>
              </li>
            ))}
          </ul>
          <h3 className="mt-4 text-sm font-semibold">Floor</h3>
          <ul className="text-sm">
            {floors.length === 0 ? <li className="text-slate-500">No line is talking.</li> : null}
            {floors.map((floor) => <li key={floor.lineId}>{floor.lineId}: {floor.name} since {formatIst(new Date(floor.since).toISOString())} IST</li>)}
          </ul>
        </div>
        <div className="rounded-xl bg-white p-4">
          <h2 className="font-semibold">Activity</h2>
          <ul className="mt-2 max-h-64 overflow-auto text-sm">
            {activity.map((item, index) => <li key={`${item.at}-${index}`} className="border-t py-1">{formatIst(item.at)} IST · {item.lineId} · {item.text}</li>)}
          </ul>
        </div>
      </section>
      <section className="rounded-xl bg-white p-4">
        <h2 className="font-semibold">Handsets</h2>
        <p className="mt-1 text-sm text-slate-600">A handset plays the line out loud and talks with one button. A listen-only device only plays. Add it on the line, then type the token into the setup page.</p>
        <ul className="mt-3 text-sm">
          {devices.length === 0 ? <li className="text-slate-500">No handsets yet.</li> : null}
          {devices.map((device) => (
            <li key={device.id} className="flex flex-wrap items-center justify-between gap-2 border-t py-2">
              <span>
                <span className="font-semibold">{device.name}</span> · {device.lineId} · {device.id}
                <span className="block text-xs text-slate-500">
                  {device.revokedAt ? 'Revoked' : device.online ? 'Online' : 'Offline'}
                  {device.listenOnly ? ' · listen-only' : ''}
                  {device.battery != null ? ` · battery ${device.battery}%` : ''}
                  {device.voltage != null ? ` (${device.voltage} V)` : ''}
                  {device.rssi != null ? ` · ${device.rssi} dBm` : ''}
                  {device.lastSeen ? ` · last seen ${formatIst(new Date(device.lastSeen).toISOString())} IST` : ''}
                </span>
              </span>
              {device.revokedAt ? null : (
                <Button type="button" variant="outline" onClick={() => void revokeDevice(device.id)}>Revoke</Button>
              )}
            </li>
          ))}
        </ul>
      </section>
      <section className="rounded-xl bg-white p-4">
        <h2 className="font-semibold">Communication log</h2>
        <form className="mt-3 grid gap-2 md:grid-cols-5" onSubmit={(event) => { event.preventDefault(); void loadAll() }}>
          <Input placeholder="Line id" value={filterLine} onChange={(event) => setFilterLine(event.target.value)} />
          <Input placeholder="Sender" value={filterSender} onChange={(event) => setFilterSender(event.target.value)} />
          <Input type="datetime-local" value={filterFrom} onChange={(event) => setFilterFrom(event.target.value)} />
          <Input type="datetime-local" value={filterTo} onChange={(event) => setFilterTo(event.target.value)} />
          <Input placeholder="Search transcript" value={filterQ} onChange={(event) => setFilterQ(event.target.value)} />
          <Button type="submit">Search</Button>
          <Button type="button" variant="outline" onClick={() => void download('csv')}>Export CSV</Button>
          <Button type="button" variant="outline" onClick={() => void download('txt')}>Export TXT</Button>
        </form>
        {audioUrl ? <audio className="mt-3 w-full" controls src={audioUrl} /> : null}
        <ul className="mt-3 flex flex-col gap-2">
          {clips.map((clip) => (
            <li key={clip.id} className="rounded-lg border p-3 text-sm">
              <p className="text-xs text-slate-500">{formatIst(clip.at)} IST · {clip.lineName} · {clip.speakerName}</p>
              <p className="mt-1">{clip.transcript ?? `(${clip.status})`}</p>
              <p className="text-emerald-900">{clip.translation ?? clip.translationNote}</p>
              <Button type="button" variant="outline" size="sm" className="mt-2" onClick={() => void play(clip.id)}>Play clip</Button>
            </li>
          ))}
        </ul>
      </section>
      <SttPanel />
      {settings ? (
        <section className="rounded-xl bg-white p-4">
          <h2 className="font-semibold">Processing</h2>
          <p className="mt-1 text-sm text-slate-600">Speech and translation apply to every line. Each line picks Free or ElevenLabs above. The ElevenLabs key is only the server environment variable, and this page never asks for it.</p>
          <p className="mt-2 text-sm">{settings.elevenLabsConfigured ? 'Server ElevenLabs key: configured.' : 'Server ElevenLabs key not configured.'}</p>
          <Button type="button" variant="outline" className="mt-2" onClick={() => void testServerKey()}>Test server key</Button>
          <form className="mt-3 grid gap-3 md:grid-cols-2" onSubmit={(event) => void saveSettings(event)}>
            <label className="text-sm">Speech recognition
              <select className="mt-1 w-full rounded-md border px-2 py-2" value={settings.asrProvider} onChange={(event) => setSettings({ ...settings, asrProvider: event.target.value as Settings['asrProvider'] })}>
                <option value="none">Off</option>
                <option value="transformers">Local Whisper</option>
                <option value="whisper-cli">whisper-cli</option>
              </select>
            </label>
            <label className="text-sm">Translation
              <select className="mt-1 w-full rounded-md border px-2 py-2" value={settings.translateProvider} onChange={(event) => setSettings({ ...settings, translateProvider: event.target.value as Settings['translateProvider'] })}>
                <option value="none">Off</option>
                <option value="opus">English and Hindi</option>
              </select>
            </label>
            <label className="text-sm">Keep clips (days)
              <Input type="number" min={1} max={365} value={settings.retentionDays} onChange={(event) => setSettings({ ...settings, retentionDays: Number(event.target.value) })} />
            </label>
            <label className="flex items-center gap-2 text-sm md:col-span-2">
              <input type="checkbox" checked={settings.elevenLabsFallback} disabled={!settings.elevenLabsConfigured} onChange={(event) => setSettings({ ...settings, elevenLabsFallback: event.target.checked })} />
              If local recognition fails on a Free line, try ElevenLabs Scribe with the server key. This can incur charges. Scribe does not translate.
            </label>
            <Button type="submit">Save processing</Button>
          </form>
        </section>
      ) : null}
    </main>
      ) : null}
    </div>
  )
}

function LangSelect({ value, onChange }: { value: LineLang; onChange: (value: LineLang) => void }) {
  return (
    <select className="rounded-md border px-2 py-2 text-sm" value={value} onChange={(event) => onChange(event.target.value as LineLang)}>
      {LANGS.map((lang) => <option key={lang} value={lang}>{lang}</option>)}
    </select>
  )
}

function LineRow({ line, talkOrigin, configured, onChange, onNote, onIssued }: { line: Line; talkOrigin: string | null; configured: boolean; onChange: () => void; onNote: (value: string) => void; onIssued: (value: { name: string; id: string; token: string }) => void }) {
  const [name, setName] = useState(line.name)
  const [deviceName, setDeviceName] = useState('')
  const [listenOnly, setListenOnly] = useState(false)
  const [qr, setQr] = useState('')
  const origin = talkOrigin || window.location.origin
  const link = `${origin}/#/?line=${line.id}`
  useEffect(() => {
    void QRCode.toDataURL(link, { margin: 1, width: 160 }).then(setQr)
  }, [link])
  async function patch(body: Record<string, unknown>) {
    const response = await controlFetch(`/api/control/lines/${line.id}`, { method: 'PATCH', body: JSON.stringify(body) })
    const payload = (await response.json()) as { message?: string }
    onNote(response.ok ? 'Line updated.' : (payload.message ?? 'The line was not updated.'))
    onChange()
  }
  async function addDevice(event: FormEvent) {
    event.preventDefault()
    const response = await controlFetch(`/api/control/lines/${line.id}/devices`, { method: 'POST', body: JSON.stringify({ name: deviceName, listenOnly }) })
    const body = (await response.json()) as { token?: string; name?: string; id?: string; message?: string }
    if (!response.ok || !body.token || !body.id) {
      onNote(body.message ?? 'The handset was not added.')
      return
    }
    onIssued({ name: body.name ?? deviceName, id: body.id, token: body.token })
    setDeviceName('')
    setListenOnly(false)
    onNote('Handset added. Copy the token now.')
    onChange()
  }
  return (
    <li className="grid gap-3 rounded-lg border p-3 md:grid-cols-[1fr_auto]">
      <div className="grid gap-2">
        <p className="text-sm font-semibold">{line.name} <span className="font-normal text-slate-500">{line.id} · {line.enabled ? 'on' : 'off'} · {line.sourceLang} to {line.targetLang}</span></p>
        <div className="flex flex-wrap gap-2">
          <Input value={name} onChange={(event) => setName(event.target.value)} />
          <Button type="button" variant="outline" onClick={() => void patch({ name })}>Rename</Button>
          <Button type="button" variant="outline" onClick={() => void patch({ enabled: !line.enabled })}>{line.enabled ? 'Disable' : 'Enable'}</Button>
          <Button type="button" variant="outline" onClick={() => void controlFetch(`/api/control/lines/${line.id}`, { method: 'DELETE' }).then(() => onChange())}>Delete</Button>
        </div>
        <LineVoiceFields
          tts={line.ttsProvider ?? 'free'}
          asr={line.asrProvider ?? 'free'}
          configured={configured}
          onTts={(ttsProvider) => void patch({ ttsProvider })}
          onAsr={(asrProvider) => void patch({ asrProvider })}
        />
        <form className="flex flex-wrap items-center gap-2" onSubmit={(event) => void addDevice(event)}>
          <Input placeholder="Handset name" value={deviceName} onChange={(event) => setDeviceName(event.target.value)} required />
          <label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={listenOnly} onChange={(event) => setListenOnly(event.target.checked)} /> Listen only</label>
          <Button type="submit" variant="outline">Add device</Button>
        </form>
        <p className="break-all text-xs text-slate-500">{link}</p>
      </div>
      {qr ? <img src={qr} alt={`QR code to join ${line.name}`} className="h-28 w-28" /> : null}
    </li>
  )
}
