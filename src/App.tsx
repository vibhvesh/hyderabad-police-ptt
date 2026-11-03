import { Button } from '@/components/ui/button'
import { MessageList } from '@/components/MessageList'
import { SettingsDialog } from '@/components/SettingsDialog'
import { usePtt, type Phase } from '@/hooks/usePtt'
import { CHANNEL_LABEL } from '@/lib/constants'
import { formatLoc } from '@/lib/format'
import { cn } from '@/lib/utils'
import { LANGUAGES, type LangId } from '@/lib/types'

const PHASE_CLASS: Record<Phase, string> = {
  offline: 'ptt-off',
  idle: 'ptt-idle',
  claiming: 'ptt-idle',
  talking: 'ptt-tx',
  receiving: 'ptt-rx',
  busy: 'ptt-busy',
}

const PHASE_LABEL: Record<Phase, string> = {
  offline: 'OFFLINE',
  idle: 'HOLD TO TALK',
  claiming: 'CLAIMING',
  talking: 'ON AIR',
  receiving: 'HEARING',
  busy: 'BUSY',
}

function detailFor(phase: Phase, talker: string | null, netDetail: string) {
  if (phase === 'offline') return netDetail
  if (phase === 'talking') return 'You are transmitting'
  if (phase === 'claiming') return 'Asking for the channel'
  if (phase === 'receiving') return `${talker ?? 'Someone'} is talking`
  if (phase === 'busy') return talker ? `Channel taken by ${talker}` : 'Channel taken'
  return `Channel ${CHANNEL_LABEL} is clear`
}

function modelLine(model: ReturnType<typeof usePtt>['model'], engine: ReturnType<typeof usePtt>['engine'], apiKey: string) {
  if (engine === 'elevenlabs') {
    return apiKey.trim() ? 'Transcription: ElevenLabs Scribe' : 'Add an ElevenLabs API key in settings'
  }
  if (model.state === 'ready') return 'Speech model ready · cached on this device'
  if (model.state === 'loading') return `Downloading speech model · ${model.progress}%`
  if (model.state === 'error') return model.message
  return 'Speech model will download on first use'
}

export default function App() {
  const ptt = usePtt()
  const label = PHASE_LABEL[ptt.phase]
  const detail = detailFor(ptt.phase, ptt.talker, ptt.net.detail)

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col bg-white text-slate-900 shadow-xl">
      <header className="sticky top-0 z-10">
        <div className="flex items-center gap-3 bg-[#0c3d82] px-4 py-3 text-white">
          <Shield />
          <div className="min-w-0 flex-1">
            <p className="text-base leading-tight font-bold tracking-wide">Hyderabad Police</p>
            <p className="text-xs text-blue-100">Push-to-talk · Channel {CHANNEL_LABEL}</p>
          </div>
          <SettingsDialog
            name={ptt.name}
            engine={ptt.engine}
            apiKey={ptt.apiKey}
            onName={ptt.setName}
            onEngine={ptt.setEngine}
            onApiKey={ptt.setApiKey}
          />
        </div>
        <p className="bg-[#0e8a4a] px-4 py-2 text-center text-sm font-semibold tracking-wide text-white" role="note">
          Demo only, not for professional use
        </p>
      </header>

      <main className="flex flex-1 flex-col gap-5 px-4 py-5">
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
          <p className="text-center text-sm font-medium text-slate-800" aria-live="polite">
            {detail}
          </p>
          <p className="text-center text-xs text-slate-500">Hold the button, or hold Space. One speaker at a time.</p>
          {ptt.micError ? <p className="text-center text-sm text-red-700">{ptt.micError}</p> : null}
        </section>

        <section className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <h2 className="text-xs font-semibold tracking-wide text-slate-500 uppercase">Transcription language</h2>
          </div>
          <div className="grid grid-cols-3 gap-2" role="group" aria-label="Transcription language">
            {LANGUAGES.map((language) => (
              <Button
                key={language.id}
                type="button"
                variant={ptt.lang === language.id ? 'default' : 'outline'}
                aria-pressed={ptt.lang === language.id}
                onClick={() => ptt.setLang(language.id as LangId)}
              >
                {language.label}
              </Button>
            ))}
          </div>
          <p className="text-xs text-slate-500">{modelLine(ptt.model, ptt.engine, ptt.apiKey)}</p>
        </section>

        <section className="rounded-xl bg-slate-50 px-3 py-3">
          <p className="text-xs font-semibold tracking-wide text-slate-500 uppercase">This unit</p>
          <p className="mt-1 text-sm text-slate-800">{ptt.name}</p>
          <p className="mt-1 text-xs text-slate-500">{ptt.loc ? formatLoc(ptt.loc) : ptt.geoNote}</p>
        </section>

        <section>
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-xs font-semibold tracking-wide text-slate-500 uppercase">
              On channel · {ptt.users.length}
            </h2>
          </div>
          <ul className="flex flex-wrap gap-2">
            {ptt.users.length === 0 ? (
              <li className="text-sm text-slate-500">Waiting for the relay…</li>
            ) : (
              ptt.users.map((user) => {
                const talking = user.id === ptt.talkerId
                const mine = user.id === ptt.me
                return (
                  <li
                    key={user.id}
                    className={cn(
                      'rounded-full px-3 py-1 text-xs font-medium',
                      talking ? 'bg-emerald-100 text-emerald-900' : mine ? 'bg-blue-100 text-blue-900' : 'bg-slate-100 text-slate-700',
                    )}
                  >
                    {user.name}
                    {mine ? ' · you' : ''}
                    {talking ? ' · talking' : ''}
                  </li>
                )
              })
            )}
          </ul>
        </section>

        <section className="flex flex-col gap-2 pb-6">
          <div className="flex items-center justify-between">
            <h2 className="text-xs font-semibold tracking-wide text-slate-500 uppercase">Messages</h2>
            <Button type="button" variant="ghost" size="sm" onClick={ptt.clearMessages} disabled={ptt.messages.length === 0}>
              Clear
            </Button>
          </div>
          <MessageList key={ptt.logEpoch} messages={ptt.messages} />
          <p className="text-center text-[11px] text-slate-400">{ptt.net.detail}</p>
        </section>
      </main>
    </div>
  )
}

function Shield() {
  return (
    <svg viewBox="0 0 48 48" className="h-10 w-10 shrink-0" aria-hidden="true">
      <path d="M24 3 42 10v14c0 10.5-7.2 18.4-18 21C13.2 42.4 6 34.5 6 24V10L24 3Z" fill="#e8f1ff" />
      <path d="M24 10 36 14.5V24c0 7-4.6 12.2-12 13.8C16.6 36.2 12 31 12 24v-9.5L24 10Z" fill="#128a4e" />
      <text x="24" y="29" textAnchor="middle" fill="#ffffff" fontSize="12" fontWeight="700" fontFamily="sans-serif">
        HP
      </text>
    </svg>
  )
}
