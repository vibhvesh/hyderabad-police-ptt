import { useState } from 'react'
import { MessageList } from '@/components/MessageList'
import { SettingsDialog } from '@/components/SettingsDialog'
import { Button } from '@/components/ui/button'
import { usePtt, type Phase } from '@/hooks/usePtt'
import { forwardMessage } from '@/lib/api'
import { CHANNEL_LABEL } from '@/lib/constants'
import { formatLoc } from '@/lib/format'
import { PHASE_CLASS, PHASE_LABEL } from '@/lib/phase'
import { LANGUAGES, type LangId } from '@/lib/types'
import { cn } from '@/lib/utils'

function detailFor(phase: Phase, talker: string | null, netDetail: string) {
  if (phase === 'offline') return netDetail
  if (phase === 'talking') return 'You are transmitting'
  if (phase === 'claiming') return 'Asking for the channel'
  if (phase === 'receiving') return `${talker ?? 'Someone'} is talking`
  if (phase === 'busy') return talker ? `Channel taken by ${talker}` : 'Channel taken'
  return `Channel ${CHANNEL_LABEL} is clear`
}

export function PttView() {
  const ptt = usePtt()
  const [forwardNote, setForwardNote] = useState<string | null>(null)
  const label = PHASE_LABEL[ptt.phase]
  return (
    <main className="grid flex-1 gap-6 px-4 py-5 lg:grid-cols-[320px_1fr]">
      <section className="flex flex-col items-center gap-3">
        {!ptt.soundOn ? (
          <Button type="button" variant="secondary" className="w-full" onClick={ptt.unlock}>
            Tap to enable sound
          </Button>
        ) : null}
        <button
          type="button"
          className={cn('ptt', PHASE_CLASS[ptt.phase])}
          aria-pressed={ptt.phase === 'talking'}
          aria-label={label}
          onPointerDown={(event) => {
            event.preventDefault()
            event.currentTarget.setPointerCapture(event.pointerId)
            void ptt.down()
          }}
          onPointerUp={(event) => {
            event.preventDefault()
            ptt.up()
          }}
          onPointerCancel={() => ptt.up()}
          onContextMenu={(event) => event.preventDefault()}
        >
          {label}
        </button>
        <p className="text-center text-sm font-medium" aria-live="polite">{detailFor(ptt.phase, ptt.talker, ptt.net.detail)}</p>
        <p className="text-center text-xs text-slate-500">Hold the button, or hold Space. One speaker at a time.</p>
        {ptt.micError ? <p className="text-center text-sm text-red-700">{ptt.micError}</p> : null}
        <div className="grid w-full grid-cols-3 gap-2" role="group" aria-label="Transcription language">
          {LANGUAGES.map((language) => (
            <Button key={language.id} type="button" variant={ptt.lang === language.id ? 'default' : 'outline'} aria-pressed={ptt.lang === language.id} onClick={() => ptt.setLang(language.id as LangId)}>
              {language.label}
            </Button>
          ))}
        </div>
        <p className="text-xs text-slate-500">{ptt.model.state === 'ready' ? 'On-device speech model ready' : ptt.model.state === 'loading' ? `Downloading speech model · ${ptt.model.progress}%` : ptt.model.state === 'error' ? ptt.model.message : 'Speech model downloads on first use'}</p>
        <div className="w-full rounded-xl bg-white px-3 py-3 text-sm">
          <p className="text-xs font-semibold tracking-wide text-slate-500 uppercase">This unit</p>
          <p>{ptt.name}</p>
          <p className="text-xs text-slate-500">{ptt.loc ? formatLoc(ptt.loc) : ptt.geoNote}</p>
        </div>
        <SettingsDialog name={ptt.name} engine={ptt.engine} apiKey={ptt.apiKey} onName={ptt.setName} onEngine={ptt.setEngine} onApiKey={ptt.setApiKey} />
      </section>
      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 className="text-xs font-semibold tracking-wide text-slate-500 uppercase">Messages</h2>
          <Button type="button" variant="ghost" size="sm" onClick={ptt.clearMessages} disabled={ptt.messages.length === 0}>Clear</Button>
        </div>
        <MessageList
          messages={ptt.messages}
          onForward={(message) => {
            if (!message.transcript || message.pending) return
            void forwardMessage({
              channel: 'sanket-1',
              messageKey: message.key,
              speaker: message.name,
              eventAt: new Date(message.t0).toISOString(),
              transcript: message.transcript,
            }).then((result) => setForwardNote(result.message))
          }}
        />
        {forwardNote ? <p className="text-sm text-slate-700" role="status">{forwardNote}</p> : null}
        <p className="text-center text-[11px] text-slate-500">{ptt.net.detail}</p>
      </section>
    </main>
  )
}
