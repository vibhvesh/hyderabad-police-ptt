import { countPhrase } from '@/lib/control-page'
import { formatIst } from '@/lib/ist'
import { LevelMeter, Sparkline } from '@/views/control/Meters'
import { lineClients, secondsLeft, useWallData, type WallClip, type WallFloor, type WallHandset, type WallLine, type WallUser } from '@/views/control/useWallData'

function todayCount(clips: WallClip[]): number {
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
  return clips.filter((clip) => istDay(clip.at) === day).length
}

function istDay(iso: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso))
}

export function Dashboard() {
  const wall = useWallData()
  const now = Date.now()
  const handsetsOnline = wall.devices.filter((device) => device.online && !device.revokedAt).length
  const handsetsOffline = wall.devices.filter((device) => !device.online && !device.revokedAt).length
  const phones = wall.users.filter((user) => user.kind !== 'handset').length
  const connected = wall.users.length
  return (
    <main className="flex flex-col gap-4 px-5 py-4">
      <header className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <Stat label="Lines" value={String(wall.lines.length)} />
        <Stat label="Connected PTT clients" value={String(connected)} detail={`${countPhrase(phones, 'phone')} · ${countPhrase(connected - phones, 'handset')}`} />
        <Stat label="Handsets" value={`${handsetsOnline} online`} detail={`${handsetsOffline} offline`} />
        <Stat label="Active talkers" value={String(wall.floors.length)} />
        <Stat label="Transmissions today" value={String(todayCount(wall.clips))} />
      </header>
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.7fr)_minmax(320px,0.8fr)]">
        <section className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
          {wall.lines.length === 0 ? <p className="text-sm text-slate-500">No lines yet. Open Settings to create one.</p> : null}
          {wall.lines.map((line) => (
            <LineTile
              key={line.id}
              line={line}
              users={wall.users.filter((user) => user.lineId === line.id)}
              floor={wall.floors.find((item) => item.lineId === line.id) ?? null}
              history={wall.history[line.id] ?? [0]}
              left={secondsLeft(wall.talkStart, line.id, now)}
              caption={wall.clips.find((clip) => clip.lineId === line.id) ?? null}
            />
          ))}
        </section>
        <aside className="flex max-h-[70vh] flex-col gap-3 overflow-hidden rounded-xl bg-white p-4">
          <h2 className="font-semibold">Live feed</h2>
          <ul className="flex flex-1 flex-col gap-2 overflow-auto text-sm">
            {wall.activity.length === 0 && wall.clips.length === 0 ? <li className="text-slate-500">Waiting for traffic.</li> : null}
            {wall.activity.slice(0, 12).map((item, index) => (
              <li key={`${item.at}-${index}`} className="border-t py-1">{formatIst(item.at)} IST · {item.lineId} · {item.text}</li>
            ))}
            {wall.clips.slice(0, 8).map((clip) => (
              <li key={clip.id} className="rounded-lg bg-slate-50 px-2 py-2">
                <p className="text-xs text-slate-500">{formatIst(clip.at)} IST · {clip.lineName} · {clip.speakerName}</p>
                <p>{clip.transcript ?? `(${clip.status})`}</p>
                {clip.translation ? <p className="text-emerald-900">{clip.translation}</p> : null}
              </li>
            ))}
          </ul>
        </aside>
      </div>
    </main>
  )
}

function Stat({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <div className="rounded-xl bg-white px-4 py-3">
      <p className="text-xs font-semibold tracking-wide text-slate-500 uppercase">{label}</p>
      <p className="text-2xl font-semibold text-[#0c3d82]">{value}</p>
      {detail ? <p className="text-xs text-slate-500">{detail}</p> : null}
    </div>
  )
}

function LineTile({ line, users, floor, history, left, caption }: { line: WallLine; users: WallUser[]; floor: WallFloor | null; history: number[]; left: number | null; caption: WallClip | null }) {
  const counts = lineClients(users, line.id)
  const level = Math.round((history.reduce((sum, value) => sum + value, 0) / Math.max(1, history.length)) * 100)
  return (
    <article className="flex flex-col gap-3 rounded-xl bg-white p-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold">{line.name}</h2>
          <p className="text-xs text-slate-500">{line.id} · {line.enabled ? 'on' : 'off'} · {line.sourceLang} to {line.targetLang}</p>
        </div>
        <p className={floor ? 'rounded-full bg-emerald-100 px-2 py-1 text-xs font-semibold text-emerald-900' : 'rounded-full bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-600'}>
          {floor ? 'Talking' : 'Idle'}
        </p>
      </div>
      <p className="min-h-6 text-sm">
        {floor ? `${floor.name} holds the floor${left == null ? '' : ` · ${left}s left`}` : 'Nobody is talking'}
      </p>
      <LevelMeter active={!!floor} level={floor ? 80 : level} />
      <Sparkline values={history} label={`${line.name} activity over the last few minutes`} />
      <a className="text-sm font-semibold text-[#0c3d82]" href={`#/control/connections/${encodeURIComponent(line.id)}`}>
        {countPhrase(counts.phones, 'phone')} · {countPhrase(counts.handsets, 'handset')}
      </a>
      {caption ? <p className="line-clamp-2 text-xs text-slate-600">{caption.speakerName}: {caption.transcript ?? caption.status}</p> : null}
    </article>
  )
}

export function connectionRows(users: WallUser[], devices: WallHandset[], lineId: string) {
  const phones = users.filter((user) => user.lineId === lineId && user.kind !== 'handset')
  const handsets = devices.filter((device) => device.lineId === lineId)
  return { phones, handsets }
}
