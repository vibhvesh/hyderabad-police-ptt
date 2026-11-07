import { useEffect, useState } from 'react'
import { DISCLAIMER, PRODUCT, TRANSCRIBE_PRODUCT } from '@/lib/constants'
import { PttView } from '@/views/PttView'
import { ReferenceView } from '@/views/ReferenceView'
import { TranscribeView } from '@/views/TranscribeView'

type Route = 'talk' | 'transcribe' | 'reference'

function routeFromHash(): Route {
  const hash = window.location.hash.replace(/^#\/?/, '')
  if (hash.startsWith('transcribe')) return 'transcribe'
  if (hash.startsWith('reference')) return 'reference'
  return 'talk'
}

export default function App() {
  const [route, setRoute] = useState<Route>(routeFromHash)
  useEffect(() => {
    const sync = () => setRoute(routeFromHash())
    window.addEventListener('hashchange', sync)
    return () => window.removeEventListener('hashchange', sync)
  }, [])
  useEffect(() => {
    document.title = route === 'transcribe' ? TRANSCRIBE_PRODUCT : route === 'reference' ? `${PRODUCT} reference` : PRODUCT
  }, [route])

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-5xl flex-col">
      <header className="sticky top-0 z-10">
        <div className="flex flex-wrap items-center gap-3 bg-[#0c3d82] px-4 py-3 text-white">
          <div className="min-w-0 flex-1">
            <p className="text-base leading-tight font-bold tracking-wide">{route === 'transcribe' ? TRANSCRIBE_PRODUCT : PRODUCT}</p>
            <p className="text-xs text-blue-100">Push-to-talk and transcription</p>
          </div>
          <nav className="flex gap-2 text-sm" aria-label="Sections">
            <NavLink href="#/" current={route === 'talk'}>Talk</NavLink>
            <NavLink href="#/transcribe" current={route === 'transcribe'}>Transcribe</NavLink>
            <NavLink href="#/reference" current={route === 'reference'}>Reference</NavLink>
          </nav>
        </div>
        <p className="bg-[#0e8a4a] px-4 py-2 text-center text-sm font-semibold tracking-wide text-white" role="note">
          {DISCLAIMER}
        </p>
      </header>
      {route === 'talk' ? <PttView /> : null}
      {route === 'transcribe' ? <TranscribeView /> : null}
      {route === 'reference' ? <ReferenceView /> : null}
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
