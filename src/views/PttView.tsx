import { useState } from 'react'
import { MessageList } from '@/components/MessageList'
import { Button } from '@/components/ui/button'
import { useAudioRoute } from '@/hooks/useAudioRoute'
import { usePtt, type Phase } from '@/hooks/usePtt'
import { shouldEndHold } from '@/lib/hold'
import { PHASE_CLASS, PHASE_LABEL } from '@/lib/phase'
import { cn } from '@/lib/utils'
import { AudioRouteBar } from '@/views/talk/AudioRouteBar'

function detailFor(phase: Phase, talker: string | null, holdLeft: number | null) {
  if (phase === 'talking') return holdLeft == null ? 'You are transmitting' : `You are transmitting · ${holdLeft}s left`
  if (phase === 'claiming') return 'Asking for the channel'
  if (phase === 'receiving') return `${talker ?? 'Someone'} is talking`
  if (phase === 'busy') return talker ? `${talker} has the channel` : 'Channel taken'
  if (phase === 'offline') return 'Connecting'
  return 'The line is clear'
}

export function PttView() {
  const route = useAudioRoute()
  const ptt = usePtt({ inputId: route.inputId, outputId: route.outputId })
  const [nameOpen, setNameOpen] = useState(false)
  const label = PHASE_LABEL[ptt.phase]
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col items-center gap-4 px-4 py-6">
      {!ptt.soundOn ? (
        <Button type="button" variant="secondary" className="w-full" onClick={ptt.unlock}>
          Tap to enable sound
        </Button>
      ) : null}
      <label className="w-full text-sm font-semibold">Line
        <select className="mt-1 w-full rounded-md border bg-white px-2 py-3 text-base" value={ptt.lineId} onChange={(event) => ptt.chooseLine(event.target.value)}>
          {ptt.lines.length === 0 ? <option value={ptt.lineId || 'sanket-1'}>{ptt.lineId || 'sanket-1'}</option> : null}
          {ptt.lines.map((line) => <option key={line.id} value={line.id}>{line.name}</option>)}
        </select>
      </label>
      <AudioRouteBar route={route} />
      <button
        type="button"
        className={cn('ptt', PHASE_CLASS[ptt.phase])}
        aria-pressed={ptt.phase === 'talking'}
        aria-label={label}
        onPointerDown={(event) => {
          event.preventDefault()
          try {
            event.currentTarget.setPointerCapture(event.pointerId)
          } catch {
            /* capture is optional; the hold still starts */
          }
          void ptt.down()
        }}
        onPointerUp={(event) => {
          event.preventDefault()
          if (shouldEndHold('pointerup')) ptt.up()
        }}
        onTouchEnd={(event) => {
          event.preventDefault()
          if (shouldEndHold('touchend')) ptt.up()
        }}
        onPointerCancel={(event) => event.preventDefault()}
        onPointerLeave={() => undefined}
        onContextMenu={(event) => event.preventDefault()}
      >
        {label}
      </button>
      <p className="text-center text-base font-medium" aria-live="polite">{detailFor(ptt.phase, ptt.talker, ptt.holdLeft)}</p>
      {ptt.micError ? <p className="text-center text-sm text-red-700">{ptt.micError}</p> : null}
      <section className="w-full">
        <h2 className="mb-2 text-xs font-semibold tracking-wide text-slate-500 uppercase">Captions</h2>
        <MessageList messages={ptt.messages} />
      </section>
      {nameOpen ? (
        <label className="w-full text-sm">Callsign
          <input className="mt-1 w-full rounded-md border px-2 py-2" value={ptt.name} onChange={(event) => ptt.setName(event.target.value)} />
        </label>
      ) : (
        <button type="button" className="text-xs text-slate-500" onClick={() => setNameOpen(true)}>{ptt.name}</button>
      )}
    </main>
  )
}
