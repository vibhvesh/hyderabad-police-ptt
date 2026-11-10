import { DisplayBoard } from '@/views/control/display/DisplayBoard'
import type { WallHandset, WallUser } from '@/views/control/useWallData'

export function Dashboard() {
  return <DisplayBoard />
}

export function connectionRows(users: WallUser[], devices: WallHandset[], lineId: string) {
  const phones = users.filter((user) => user.lineId === lineId && user.kind !== 'handset')
  const handsets = devices.filter((device) => device.lineId === lineId)
  return { phones, handsets }
}
