import { useEffect, useState, type FormEvent } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { controlFetch } from '@/lib/control-api'
import { STT_IDS, STT_LABELS, type SttProviderId } from '@/lib/stt'

type Provider = { id: SttProviderId; label: string; needsKey: boolean; configured: boolean }
type View = { defaultProvider: SttProviderId; localEngine: boolean; providers: Provider[] }

export function SttPanel() {
  const [view, setView] = useState<View | null>(null)
  const [provider, setProvider] = useState<SttProviderId>('free')
  const [key, setKey] = useState('')
  const [region, setRegion] = useState('')
  const [note, setNote] = useState('')

  async function load() {
    const response = await controlFetch('/api/control/stt')
    if (!response.ok) return
    const body = (await response.json()) as View
    setView(body)
    setProvider(body.defaultProvider)
  }

  useEffect(() => {
    void load()
  }, [])

  async function save(event: FormEvent) {
    event.preventDefault()
    const response = await controlFetch('/api/control/stt', {
      method: 'PUT',
      body: JSON.stringify({ defaultProvider: provider, provider, key, region }),
    })
    const body = (await response.json()) as View & { message?: string }
    if (!response.ok) {
      setNote(body.message ?? 'Speech settings were not saved.')
      return
    }
    setView(body)
    setKey('')
    setRegion('')
    setNote('Speech settings saved. Keys stay on the server.')
  }

  if (!view) return null
  const selected = view.providers.find((item) => item.id === provider)
  return (
    <section className="rounded-xl border border-[#d9c7a3] bg-white p-4" aria-label="Speech to text">
      <h2 className="font-semibold text-[#0f4c81]">Speech to text</h2>
      <p className="mt-1 text-sm text-slate-600">Pick the provider for lines that follow the server default. Keys are stored encrypted on this server and are not sent back to the browser.</p>
      {!view.localEngine ? <p className="mt-2 text-sm text-[#8c7348]">Local Whisper is off on this machine. A cloud provider is the lighter choice, especially on a Raspberry Pi.</p> : null}
      <form className="mt-3 grid gap-3" onSubmit={(event) => void save(event)}>
        <label className="text-sm">Default provider
          <select className="mt-1 w-full rounded-md border px-2 py-2" value={provider} onChange={(event) => setProvider(event.target.value as SttProviderId)}>
            {STT_IDS.map((id) => <option key={id} value={id}>{STT_LABELS[id]}{view.providers.find((item) => item.id === id)?.configured ? ' · configured' : ''}</option>)}
          </select>
        </label>
        {selected?.needsKey ? (
          <label className="text-sm">{STT_LABELS[provider]} key {selected.configured ? '(one is already stored)' : '(none stored)'}
            <Input type="password" autoComplete="off" value={key} placeholder="Paste a key to store it" onChange={(event) => setKey(event.target.value)} />
          </label>
        ) : null}
        {provider === 'azure' ? (
          <label className="text-sm">Azure region
            <Input value={region} placeholder="eastus" onChange={(event) => setRegion(event.target.value)} />
          </label>
        ) : null}
        <Button type="submit">Save speech provider</Button>
      </form>
      {note ? <p className="mt-2 text-sm" role="status">{note}</p> : null}
    </section>
  )
}
