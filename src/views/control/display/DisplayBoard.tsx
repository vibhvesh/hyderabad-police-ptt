import { useEffect, useRef, useState } from 'react'
import { boardKpis, emergencyHits, isEmergency, messagesTodayOnLine } from '@/lib/display-board'
import { formatIst } from '@/lib/ist'
import { latestProviderWarning } from '@/lib/voice-choice'
import { lineClients, secondsLeft, useWallData } from '@/views/control/useWallData'
import { AlertsPanel } from '@/views/control/display/AlertsPanel'
import { ConnectionMap } from '@/views/control/display/ConnectionMap'
import { KpiStrip } from '@/views/control/display/KpiStrip'
import { LineDetailPopover } from '@/views/control/display/LineDetailPopover'
import { LineRail } from '@/views/control/display/LineRail'
import { MessageTicker } from '@/views/control/display/MessageTicker'
import '@/views/control/display/radio-theme.css'

const ACK_KEY = 'sanket-display-acks'

function readAcks(): Set<string> {
  try {
    const parsed = JSON.parse(sessionStorage.getItem(ACK_KEY) || '[]') as unknown
    return new Set(Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [])
  } catch {
    return new Set()
  }
}

function beep() {
  const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!Ctx) return
  const ctx = new Ctx()
  const osc = ctx.createOscillator()
  const gain = ctx.createGain()
  osc.frequency.value = 880
  gain.gain.value = 0.05
  osc.connect(gain).connect(ctx.destination)
  osc.start()
  osc.stop(ctx.currentTime + 0.18)
  osc.onended = () => void ctx.close()
}

export function DisplayBoard() {
  const wall = useWallData()
  const now = Date.now()
  const rootRef = useRef<HTMLElement>(null)
  const seen = useRef<Set<string> | null>(null)
  const [hotId, setHotId] = useState<string | null>(null)
  const [acks, setAcks] = useState<Set<string>>(readAcks)
  const [fresh, setFresh] = useState<Set<string>>(new Set())
  const [muted, setMuted] = useState(true)
  const [full, setFull] = useState(false)
  const [entered, setEntered] = useState(false)
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  const leaveTimer = useRef(0)

  useEffect(() => {
    const hash = window.location.hash
    if (hash === '' || hash === '#/' || hash === '#/control' || hash === '#/control/wall' || hash === '#/control/dashboard') {
      history.replaceState(null, '', '#/control/display')
    }
    const frame = window.requestAnimationFrame(() => setEntered(true))
    const onFull = () => setFull(document.fullscreenElement === rootRef.current)
    document.addEventListener('fullscreenchange', onFull)
    return () => {
      window.cancelAnimationFrame(frame)
      document.removeEventListener('fullscreenchange', onFull)
    }
  }, [])

  const hits = emergencyHits(wall.clips, wall.activity).filter((hit) => !acks.has(hit.id))
  const alertKey = hits.map((hit) => hit.id).join('|')
  useEffect(() => {
    const ids = alertKey ? alertKey.split('|') : []
    if (seen.current === null) {
      seen.current = new Set(ids)
      return
    }
    const born = ids.filter((id) => !seen.current?.has(id))
    for (const id of ids) seen.current.add(id)
    if (born.length === 0) return
    setFresh((current) => new Set([...current, ...born]))
    if (!muted) beep()
    const timer = window.setTimeout(() => {
      setFresh((current) => {
        const next = new Set(current)
        for (const id of born) next.delete(id)
        return next
      })
    }, 4000)
    return () => window.clearTimeout(timer)
  }, [alertKey, muted])

  const kpis = boardKpis({
    lines: wall.lines,
    users: wall.users,
    floors: wall.floors,
    clips: wall.clips,
    activity: wall.activity,
    acked: acks,
    now,
  })
  const names = new Map(wall.lines.map((line) => [line.id, line.name]))
  const rail = wall.lines.map((line) => {
    const counts = lineClients(wall.users, line.id)
    const floor = wall.floors.find((item) => item.lineId === line.id) ?? null
    const alert = hits.some((hit) => hit.lineId === line.id)
    const history = wall.history[line.id] ?? []
    const level = history.length ? Math.round((history.reduce((sum, value) => sum + value, 0) / history.length) * 100) : floor ? 70 : 8
    return {
      id: line.id,
      name: line.name,
      status: alert ? 'alert' as const : floor ? 'talking' as const : 'idle' as const,
      speaker: floor?.name ?? null,
      phones: counts.phones,
      handsets: counts.handsets,
      level,
    }
  })
  const nodes = rail.map((line) => ({
    id: line.id,
    name: line.name,
    status: line.status,
    level: line.level,
    devices: wall.users.filter((user) => user.lineId === line.id).map((user) => ({ id: user.id, name: user.name })),
  }))
  const hot = wall.lines.find((line) => line.id === hotId) ?? null
  const hotFloor = hot ? wall.floors.find((item) => item.lineId === hot.id) ?? null : null
  const hotUsers = hot ? wall.users.filter((user) => user.lineId === hot.id) : []
  const ticker = [
    ...wall.clips.slice(0, 12).map((clip) => ({
      id: clip.id,
      when: formatIst(clip.at),
      title: `${clip.lineName} · ${clip.speakerName}`,
      text: [clip.transcript, clip.translation].filter(Boolean).join(' — ') || clip.status,
      emergency: isEmergency(`${clip.transcript ?? ''} ${clip.translation ?? ''}`),
    })),
    ...wall.activity.slice(0, 8).map((item, index) => ({
      id: `live-${item.at}-${index}`,
      when: formatIst(item.at),
      title: names.get(item.lineId) ?? item.lineId,
      text: item.text,
      emergency: isEmergency(item.text),
    })),
  ]

  function hold(id: string) {
    window.clearTimeout(leaveTimer.current)
    setHotId(id)
  }
  function release() {
    leaveTimer.current = window.setTimeout(() => setHotId(null), 180)
  }
  function acknowledge(id: string) {
    const next = new Set(acks)
    next.add(id)
    setAcks(next)
    sessionStorage.setItem(ACK_KEY, JSON.stringify([...next]))
  }
  async function toggleFull() {
    if (document.fullscreenElement) await document.exitFullscreen()
    else await rootRef.current?.requestFullscreen()
  }

  return (
    <section ref={rootRef} className={entered && !reduce ? 'display-board db-enter' : 'display-board'} aria-label="Display Board">
      <header className="db-top">
        <div className="db-brand">
          <i className={kpis.talkers > 0 ? 'db-lamp on' : 'db-lamp'} />
          <div>
            <h1>Display Board</h1>
            <p>{formatIst(new Date().toISOString())} IST</p>
          </div>
        </div>
        <div className="db-knobs">
          <button type="button" className="db-knob" aria-pressed={!muted} onClick={() => setMuted((value) => !value)}>{muted ? 'Muted' : 'Sound'}</button>
          <button type="button" className="db-knob" aria-pressed={full} onClick={() => void toggleFull()}>{full ? 'Exit' : 'Full'}</button>
        </div>
      </header>
      <KpiStrip {...kpis} />
      <div className="db-body">
        <LineRail lines={rail} hotId={hotId} onHover={hold} onLeave={release} />
        <div className="db-map-wrap">
          <ConnectionMap nodes={nodes} hotId={hotId} onHover={hold} onLeave={release} reduce={reduce} />
          {hot ? (
            <LineDetailPopover
              id={hot.id}
              name={hot.name}
              speaker={hotFloor?.name ?? null}
              left={secondsLeft(wall.talkStart, hot.id, now)}
              phones={hotUsers.filter((user) => user.kind !== 'handset').map((user) => user.name)}
              handsets={hotUsers.filter((user) => user.kind === 'handset').map((user) => user.name)}
              devices={wall.devices.filter((device) => device.lineId === hot.id && !device.revokedAt).map((device) => device.name)}
              messages={wall.clips.filter((clip) => clip.lineId === hot.id).slice(0, 3).map((clip) => ({ id: clip.id, speaker: clip.speakerName, transcript: clip.transcript, translation: clip.translation }))}
              today={messagesTodayOnLine(wall.clips, hot.id, now)}
              lastActivity={formatIst((wall.activity.find((item) => item.lineId === hot.id)?.at) || wall.clips.find((clip) => clip.lineId === hot.id)?.at || '') || null}
              tts={hot.ttsProvider}
              warning={latestProviderWarning(wall.activity, hot.id)}
              onEnter={() => hold(hot.id)}
              onLeave={release}
            />
          ) : null}
        </div>
        <div className="db-side">
          <AlertsPanel
            alerts={hits.map((hit) => ({ id: hit.id, title: names.get(hit.lineId) ?? hit.lineId, text: hit.text, at: hit.at }))}
            fresh={fresh}
            onAck={acknowledge}
          />
          <MessageTicker items={ticker} />
        </div>
      </div>
    </section>
  )
}
