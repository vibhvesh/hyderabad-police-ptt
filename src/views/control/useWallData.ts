import { useEffect, useState } from 'react'
import { controlFetch } from '@/lib/control-api'
import { splitClients, talkSecondsLeft } from '@/lib/control-page'
import type { VoiceChoice } from '@/lib/voice-choice'
import type { LineLang } from '@/lib/lines'

export type WallLine = { id: string; name: string; enabled: boolean; sourceLang: LineLang; targetLang: LineLang; ttsProvider?: VoiceChoice; asrProvider?: VoiceChoice }
export type WallUser = { lineId: string; id: string; name: string; lastSeen: number; location: string | null; kind?: 'phone' | 'handset'; battery?: number | null; rssi?: number | null }
export type WallFloor = { lineId: string; id: string; name: string; since: number }
export type WallActivity = { at: string; lineId: string; text: string }
export type WallHandset = {
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
export type WallClip = {
  id: string
  lineId: string
  lineName: string
  speakerName: string
  at: string
  transcript: string | null
  translation: string | null
  status: string
}

export function useWallData() {
  const [lines, setLines] = useState<WallLine[]>([])
  const [users, setUsers] = useState<WallUser[]>([])
  const [floors, setFloors] = useState<WallFloor[]>([])
  const [activity, setActivity] = useState<WallActivity[]>([])
  const [devices, setDevices] = useState<WallHandset[]>([])
  const [clips, setClips] = useState<WallClip[]>([])
  const [history, setHistory] = useState<Record<string, number[]>>({})
  const [talkStart, setTalkStart] = useState<Record<string, { id: string; at: number }>>({})
  const [ready, setReady] = useState(false)

  useEffect(() => {
    let stop = false
    async function pull() {
      const [lineRes, liveRes, logRes] = await Promise.all([
        controlFetch('/api/control/lines'),
        controlFetch('/api/control/live'),
        controlFetch('/api/control/log'),
      ])
      if (stop) return
      if ([lineRes, liveRes].some((response) => response.status === 401 || response.status === 503)) return
      const lineBody = (await lineRes.json()) as { lines?: WallLine[] }
      const liveBody = (await liveRes.json()) as { users?: WallUser[]; floors?: WallFloor[]; activity?: WallActivity[]; devices?: WallHandset[] }
      const logBody = logRes.ok ? ((await logRes.json()) as { clips?: WallClip[] }) : { clips: [] }
      const nextLines = lineBody.lines ?? []
      const nextFloors = liveBody.floors ?? []
      setLines(nextLines)
      setUsers(liveBody.users ?? [])
      setFloors(nextFloors)
      setActivity(liveBody.activity ?? [])
      setDevices(liveBody.devices ?? [])
      setClips(logBody.clips ?? [])
      setTalkStart((prev) => {
        const next = { ...prev }
        for (const floor of nextFloors) {
          if (next[floor.lineId]?.id !== floor.id) next[floor.lineId] = { id: floor.id, at: Date.now() }
        }
        for (const id of Object.keys(next)) {
          if (!nextFloors.some((floor) => floor.lineId === id)) delete next[id]
        }
        return next
      })
      setHistory((prev) => {
        const next = { ...prev }
        for (const line of nextLines) {
          const talking = nextFloors.some((floor) => floor.lineId === line.id) ? 1 : 0
          next[line.id] = [...(prev[line.id] ?? []), talking].slice(-90)
        }
        return next
      })
      setReady(true)
    }
    void pull()
    const timer = window.setInterval(() => void pull(), 2000)
    return () => {
      stop = true
      window.clearInterval(timer)
    }
  }, [])

  return { lines, users, floors, activity, devices, clips, history, talkStart, ready }
}

export function secondsLeft(talkStart: Record<string, { id: string; at: number }>, lineId: string, now = Date.now()): number | null {
  const started = talkStart[lineId]
  if (!started) return null
  return talkSecondsLeft(started.at, now)
}

export function lineClients(users: WallUser[], lineId: string) {
  return splitClients(users.filter((user) => user.lineId === lineId))
}
