import { Button } from '@/components/ui/button'
import { countPhrase } from '@/lib/control-page'
import { controlFetch } from '@/lib/control-api'
import { formatIst } from '@/lib/ist'
import { connectionRows } from '@/views/control/Dashboard'
import { useWallData } from '@/views/control/useWallData'

export function Connections({ lineId }: { lineId: string }) {
  const wall = useWallData()
  const { phones, handsets } = connectionRows(wall.users, wall.devices, lineId)
  const line = wall.lines.find((item) => item.id === lineId)
  return (
    <main className="flex flex-col gap-4 px-5 py-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-[#0c3d82]">{line?.name ?? lineId}</h1>
          <p className="text-sm text-slate-600">{countPhrase(phones.length, 'phone')} · {countPhrase(handsets.length, 'handset')}</p>
        </div>
        <a className="rounded-full border px-3 py-1 text-sm font-semibold text-[#0c3d82]" href="#/control">Back to the wall</a>
      </div>
      <section className="rounded-xl bg-white p-4">
        <h2 className="font-semibold">Phones</h2>
        <ul className="mt-2 text-sm">
          {phones.length === 0 ? <li className="text-slate-500">No phone is on this line.</li> : null}
          {phones.map((phone) => (
            <li key={phone.id} className="border-t py-2">
              <span className="font-semibold">{phone.name}</span> · phone · {phone.id}
              <span className="block text-xs text-slate-500">Last seen {formatIst(new Date(phone.lastSeen).toISOString())} IST {phone.location ? `· ${phone.location}` : ''}</span>
            </li>
          ))}
        </ul>
      </section>
      <section className="rounded-xl bg-white p-4">
        <h2 className="font-semibold">Handsets</h2>
        <ul className="mt-2 text-sm">
          {handsets.length === 0 ? <li className="text-slate-500">No handset is enrolled on this line.</li> : null}
          {handsets.map((device) => (
            <li key={device.id} className="flex flex-wrap items-center justify-between gap-2 border-t py-2">
              <span>
                <span className="font-semibold">{device.name}</span> · handset · {device.id}
                <span className="block text-xs text-slate-500">
                  {device.revokedAt ? 'Revoked' : device.online ? 'Online' : 'Offline'}
                  {device.listenOnly ? ' · listen-only' : ''}
                  {device.battery != null ? ` · battery ${device.battery}%` : ''}
                  {device.rssi != null ? ` · ${device.rssi} dBm` : ''}
                  {device.lastSeen ? ` · last seen ${formatIst(new Date(device.lastSeen).toISOString())} IST` : ''}
                </span>
              </span>
              {device.revokedAt ? null : (
                <Button type="button" variant="outline" onClick={() => void controlFetch(`/api/control/devices/${device.id}`, { method: 'DELETE' }).then(() => window.location.reload())}>Revoke</Button>
              )}
            </li>
          ))}
        </ul>
      </section>
    </main>
  )
}
