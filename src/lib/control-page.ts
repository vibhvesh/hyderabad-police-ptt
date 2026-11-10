export type ControlPage =
  | { name: 'dashboard' }
  | { name: 'manage' }
  | { name: 'connections'; lineId: string }

export function controlPage(hash: string): ControlPage {
  const path = hash.replace(/^#\/?/, '').split('?')[0] ?? ''
  const parts = path.split('/').filter(Boolean)
  if (parts[0] === 'control' && parts[1] === 'manage') return { name: 'manage' }
  if (parts[0] === 'control' && parts[1] === 'connections' && parts[2]) return { name: 'connections', lineId: decodeURIComponent(parts[2]) }
  return { name: 'dashboard' }
}

export const TALK_LIMIT_S = 60

export function talkSecondsLeft(startedAt: number, now: number): number {
  return Math.max(0, TALK_LIMIT_S - Math.floor((now - startedAt) / 1000))
}

export function splitClients(users: Array<{ kind?: string }>): { phones: number; handsets: number } {
  let handsets = 0
  for (const user of users) if (user.kind === 'handset') handsets += 1
  return { phones: users.length - handsets, handsets }
}

export function countPhrase(count: number, singular: string): string {
  return `${count} ${count === 1 ? singular : `${singular}s`}`
}
