import { CLAIM_GRACE_MS, FLOOR_TIMEOUT_MS } from './constants.ts'
import { cleanLoc, type GeoFix } from './format.ts'

export type Floor = {
  id: string
  name: string
  ts: number
  seen: number
  got: number
  loc: GeoFix | null
}

export type FloorMsg = {
  t: 'claim' | 'hb' | 'release'
  id: string
  name: string
  ts: number
  loc?: GeoFix | null
}

/** Earlier claim wins. Equal timestamps fall back to name + id so every client agrees. */
export function beats(
  a: { ts: number; name: string; id: string },
  b: { ts: number; name: string; id: string },
): boolean {
  return a.ts < b.ts || (a.ts === b.ts && a.name + a.id < b.name + b.id)
}

function pickLoc(msg: FloorMsg, floor: Floor | null, same: boolean): GeoFix | null {
  if (msg.loc === undefined) return same && floor ? floor.loc : null
  return cleanLoc(msg.loc)
}

export function reduceFloor(floor: Floor | null, msg: FloorMsg, now: number): Floor | null {
  if (msg.t === 'release') {
    if (floor && floor.id === msg.id) return null
    return floor
  }
  const same = !!floor && floor.id === msg.id
  const loc = pickLoc(msg, floor, same)
  const withinGrace = !!floor && now - floor.got < CLAIM_GRACE_MS * 3
  if (!floor || same || (msg.t === 'claim' && withinGrace && beats(msg, floor))) {
    return {
      id: msg.id,
      name: msg.name,
      ts: msg.ts,
      seen: now,
      got: same && floor ? floor.got : now,
      loc,
    }
  }
  if (msg.t === 'hb' && floor && beats(msg, floor)) {
    return { id: msg.id, name: msg.name, ts: msg.ts, seen: now, got: now, loc }
  }
  return floor
}

export function expireFloor(floor: Floor | null, now: number): Floor | null {
  if (floor && now - floor.seen > FLOOR_TIMEOUT_MS) return null
  return floor
}
