import { useEffect, useState } from 'react'
import { DISCLAIMER, PRODUCT, TRANSCRIBE_PRODUCT } from '@/lib/constants'
import { backendBase } from '@/lib/api'
import { ControlView } from '@/views/ControlView'
import { PttView } from '@/views/PttView'
import { ReferenceView } from '@/views/ReferenceView'
import { TranscribeView } from '@/views/TranscribeView'

type Route = 'talk' | 'transcribe' | 'reference' | 'control'
type Surface = 'talk' | 'admin' | 'combined'

function routeFromHash(): Route {
  const hash = window.location.hash.replace(/^#\/?/, '')
  if (hash.startsWith('transcribe')) return 'transcribe'
  if (hash.startsWith('reference')) return 'reference'
  if (hash.startsWith('control')) return 'control'
  return 'talk'
}

export default function App() {
  const [route, setRoute] = useState<Route>(routeFromHash)
  const [surface, setSurface] = useState<Surface>('combined')
  const [talkOrigin, setTalkOrigin] = useState<string | null>(null)
  useEffect(() => {
    const sync = () => setRoute(routeFromHash())
    window.addEventListener('hashchange', sync)
    return () => window.removeEventListener('hashchange', sync)
  }, [])
  useEffect(() => {
    void fetch(`${backendBase()}/api/site`, { cache: 'no-store' })
      .then((response) => response.json())
      .then((body: { surface?: Surface; talkOrigin?: string | null }) => {
        if (body.surface === 'talk' || body.surface === 'admin' || body.surface === 'combined') setSurface(body.surface)
        setTalkOrigin(body.talkOrigin ?? null)
      })
      .catch(() => undefined)
  }, [])
  const showTalk = surface !== 'admin' && route === 'talk'
  const showTranscribe = surface !== 'admin' && route === 'transcribe'
  const showReference = surface !== 'talk' && route === 'reference'
  const showControl = surface === 'admin' ? route !== 'reference' : surface === 'combined' && route === 'control'
  useEffect(() => {
    document.title = showControl ? `${PRODUCT} control` : showTranscribe ? TRANSCRIBE_PRODUCT : showReference ? `${PRODUCT} reference` : PRODUCT
  }, [showControl, showTranscribe, showReference])

  return (
    <div className={showControl ? 'flex min-h-dvh w-full flex-col' : 'mx-auto flex min-h-dvh w-full max-w-5xl flex-col'}>
      <header className="sticky top-0 z-10">
        <div className="flex flex-col gap-2 bg-[#0c3d82] px-4 py-3 text-white sm:flex-row sm:flex-wrap sm:items-center sm:gap-3">
          <div className="min-w-0 sm:flex-1">
            <p className="text-base leading-tight font-bold tracking-wide">{showControl ? 'Control room' : showTranscribe ? TRANSCRIBE_PRODUCT : PRODUCT}</p>
            <p className="text-xs text-blue-100">{showControl ? 'Wall display' : 'Push to talk'}</p>
          </div>
          <nav className="flex flex-wrap gap-2 text-sm" aria-label="Sections">
            {surface !== 'admin' ? <NavLink href="#/" current={route === 'talk'}>Talk</NavLink> : null}
            {surface !== 'admin' ? <NavLink href="#/transcribe" current={route === 'transcribe'}>Transcribe</NavLink> : null}
            {surface !== 'talk' ? <NavLink href="#/control" current={showControl}>Control</NavLink> : null}
            {surface !== 'talk' ? <NavLink href="#/reference" current={route === 'reference'}>Reference</NavLink> : null}
          </nav>
        </div>
        <p className="bg-[#0e8a4a] px-4 py-2 text-center text-sm font-semibold tracking-wide text-white" role="note">
          {DISCLAIMER}
        </p>
      </header>
      {showTalk ? <PttView /> : null}
      {showTranscribe ? <TranscribeView /> : null}
      {showReference ? <ReferenceView /> : null}
      {showControl ? <ControlView talkOrigin={talkOrigin} /> : null}
      {surface === 'talk' && route === 'control' ? (
        <main className="px-4 py-8 text-sm text-slate-700">The control room is not on this address.</main>
      ) : null}
    </div>
  )
}

function NavLink({ href, current, children }: { href: string; current: boolean; children: string }) {
  return (
    <a href={href} aria-current={current ? 'page' : undefined} className={current ? 'rounded-full bg-white px-3 py-1 font-semibold text-[#0c3d82]' : 'rounded-full px-3 py-1 text-blue-100'}>
      {children}
    </a>
  )
}
