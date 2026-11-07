export type Phase = 'offline' | 'idle' | 'claiming' | 'talking' | 'receiving' | 'busy'

export function phaseOf(input: {
  online: boolean
  holding: boolean
  granted: boolean
  denied: boolean
  floorId: string | null
  me: string
  recentRx: boolean
}): Phase {
  if (!input.online) return 'offline'
  if (input.granted) return 'talking'
  if (input.holding && (input.denied || (input.floorId !== null && input.floorId !== input.me))) return 'busy'
  if (input.floorId !== null && input.floorId !== input.me) return input.recentRx ? 'receiving' : 'busy'
  if (input.holding) return 'claiming'
  return 'idle'
}

export const PHASE_CLASS: Record<Phase, string> = {
  offline: 'ptt-off',
  idle: 'ptt-idle',
  claiming: 'ptt-idle',
  talking: 'ptt-tx',
  receiving: 'ptt-rx',
  busy: 'ptt-busy',
}

export const PHASE_LABEL: Record<Phase, string> = {
  offline: 'OFFLINE',
  idle: 'HOLD TO TALK',
  claiming: 'CLAIMING',
  talking: 'ON AIR',
  receiving: 'HEARING',
  busy: 'BUSY',
}
