import { useEffect, useState, type FormEvent } from 'react'
import QRCode from 'qrcode'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { controlFetch, saveControlToken } from '@/lib/control-api'
import { formatIst } from '@/lib/ist'
import type { LineLang } from '@/lib/lines'

type Line = { id: string; name: string; enabled: boolean; sourceLang: LineLang; targetLang: LineLang; topic: string }
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
  const [draft, setDraft] = useState({ id: '', name: '', sourceLang: 'te' as LineLang, targetLang: 'en' as LineLang })
  const [code, setCode] = useState('')
  const [token, setToken] = useState('')
  const [keyDraft, setKeyDraft] = useState('')
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
    if (response.ok) setDraft({ id: '', name: '', sourceLang: 'te', targetLang: 'en' })
    await loadAll()
  }

  async function saveSettings(event: FormEvent) {
    event.preventDefault()
    if (!settings) return
    const body: Record<string, unknown> = { ...settings }
    if (keyDraft.trim()) body.elevenLabsApiKey = keyDraft.trim()
    const response = await controlFetch('/api/control/settings', { method: 'PUT', body: JSON.stringify(body) })
    const payload = (await response.json()) as Settings & { message?: string }
    if (!response.ok) {
      setNote(payload.message ?? 'Settings were not saved.')
      return
    }
    setSettings(payload)
    setKeyDraft('')
    setNote(payload.elevenLabsConfigured ? 'Settings saved. A cloud key is stored on the server.' : 'Settings saved.')
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
    <main className="flex flex-col gap-6 px-4 py-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-[#0c3d82]">Control room</h1>
          <p className="text-sm text-slate-600">Lines, live floor, handsets, and the server transcript log. Talking stays on the phone app and on enrolled handsets.</p>
        </div>
        <a className="rounded-full border px-3 py-1 text-sm font-semibold text-[#0c3d82]" href="#/reference">Reference review</a>
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
        <form className="mt-3 grid gap-2 md:grid-cols-5" onSubmit={(event) => void createLine(event)}>
          <Input placeholder="id" value={draft.id} onChange={(event) => setDraft({ ...draft, id: event.target.value })} required />
          <Input placeholder="Name" value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} required />
          <LangSelect value={draft.sourceLang} onChange={(sourceLang) => setDraft({ ...draft, sourceLang })} />
          <LangSelect value={draft.targetLang} onChange={(targetLang) => setDraft({ ...draft, targetLang })} />
          <Button type="submit">Create line</Button>
        </form>
        <ul className="mt-4 flex flex-col gap-3">
          {lines.map((line) => (
            <LineRow key={line.id} line={line} talkOrigin={talkOrigin} onChange={() => void loadAll()} onNote={setNote} onIssued={setIssued} />
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
      {settings ? (
        <section className="rounded-xl bg-white p-4">
          <h2 className="font-semibold">Processing</h2>
          <p className="mt-1 text-sm text-slate-600">These settings apply to every line. Phones cannot change them. Scribe is optional and only runs if the local recognizer fails.</p>
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
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={settings.elevenLabsFallback} onChange={(event) => setSettings({ ...settings, elevenLabsFallback: event.target.checked })} />
              If local recognition fails, send the clip to ElevenLabs Scribe. This can incur charges. Scribe does not translate.
            </label>
            <label className="text-sm md:col-span-2">Scribe key {settings.elevenLabsConfigured ? '(one is already stored)' : '(none stored)'}
              <Input type="password" autoComplete="off" value={keyDraft} placeholder="Paste a new key to replace the stored one" onChange={(event) => setKeyDraft(event.target.value)} />
            </label>
            <Button type="submit">Save processing</Button>
          </form>
        </section>
      ) : null}
    </main>
  )
}

function LangSelect({ value, onChange }: { value: LineLang; onChange: (value: LineLang) => void }) {
  return (
    <select className="rounded-md border px-2 py-2 text-sm" value={value} onChange={(event) => onChange(event.target.value as LineLang)}>
      {LANGS.map((lang) => <option key={lang} value={lang}>{lang}</option>)}
    </select>
  )
}

function LineRow({ line, talkOrigin, onChange, onNote, onIssued }: { line: Line; talkOrigin: string | null; onChange: () => void; onNote: (value: string) => void; onIssued: (value: { name: string; id: string; token: string }) => void }) {
  const [name, setName] = useState(line.name)
  const [deviceName, setDeviceName] = useState('')
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
    const response = await controlFetch(`/api/control/lines/${line.id}/devices`, { method: 'POST', body: JSON.stringify({ name: deviceName }) })
    const body = (await response.json()) as { token?: string; name?: string; id?: string; message?: string }
    if (!response.ok || !body.token || !body.id) {
      onNote(body.message ?? 'The handset was not added.')
      return
    }
    onIssued({ name: body.name ?? deviceName, id: body.id, token: body.token })
    setDeviceName('')
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
        <form className="flex flex-wrap gap-2" onSubmit={(event) => void addDevice(event)}>
          <Input placeholder="Handset name" value={deviceName} onChange={(event) => setDeviceName(event.target.value)} required />
          <Button type="submit" variant="outline">Add device</Button>
        </form>
        <p className="break-all text-xs text-slate-500">{link}</p>
      </div>
      {qr ? <img src={qr} alt={`QR code to join ${line.name}`} className="h-28 w-28" /> : null}
    </li>
  )
}
