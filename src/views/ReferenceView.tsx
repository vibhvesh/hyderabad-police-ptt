import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { demoFetch } from '@/lib/api'
import { GUIDE } from '@/lib/guide'

type Status = {
  status?: string
  message?: string
  version?: number | null
  reviewer?: string | null
  designatedReviewer?: string | null
  reviewedAt?: string | null
  reviewDue?: string | null
  validUntil?: string | null
  pendingProposals?: number
}

type Proposal = {
  id: string
  state: string
  conflict?: boolean
  proposedText?: string
  supersededFacts?: string[]
  provenance?: { origin?: string; sourceLabel?: string; actor?: string; receivedAt?: string; eventAt?: string | null; transcript?: string | null }
  diff?: Array<{ op: string; text: string }>
  freshness?: { eventOlderThanApproval?: boolean }
}

function when(value: string | null | undefined): string {
  if (!value) return ''
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString()
}

export function ReferenceView() {
  const [channel, setChannel] = useState('sanket-1')
  const [code, setCode] = useState('')
  const [open, setOpen] = useState(false)
  const [note, setNote] = useState('Enter the shared demo code. It is checked by the server and is not saved in the page.')
  const [status, setStatus] = useState<Status | null>(null)
  const [text, setText] = useState('')
  const [proposals, setProposals] = useState<Proposal[]>([])
  const [reviewerName, setReviewerName] = useState('Shared demo')
  const [reviewDue, setReviewDue] = useState('')
  const [validUntil, setValidUntil] = useState('')

  async function load() {
    try {
      const response = await demoFetch(`/api/channels/${encodeURIComponent(channel)}/knowledge`)
      const body = (await response.json()) as Status & { proposals?: Proposal[]; message?: string }
      if (!response.ok) {
        setOpen(false)
        setNote(response.status === 401 ? 'Shared demo access is not on. The server did not accept this browser.' : (body.message ?? 'The reference could not be loaded.'))
        return
      }
      setOpen(true)
      setStatus(body)
      setProposals(body.proposals ?? [])
      setNote(body.message ?? 'Loaded. This is shared demo access, not a separate commander login.')
    } catch {
      setNote('The reference server could not be reached.')
    }
  }

  useEffect(() => {
    void demoFetch('/api/demo/session')
      .then((response) => response.json() as Promise<{ access?: string }>)
      .then((body) => {
        if (body.access === 'shared-demo') void load()
      })
      .catch(() => undefined)
    // The first check only runs when the page opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function unlock() {
    if (!code.trim()) {
      setNote('Enter the demo code. An empty field is not sent and does not sign you in.')
      return
    }
    try {
      const response = await demoFetch('/api/demo/unlock', { method: 'POST', body: JSON.stringify({ code: code.trim() }) })
      const body = (await response.json()) as { message?: string; access?: string }
      setCode('')
      if (response.status === 429) {
        setNote(body.message ?? 'Too many tries. Wait and try again.')
        return
      }
      if (!response.ok || body.access !== 'shared-demo') {
        setOpen(false)
        setNote(body.message ?? 'That demo code was not accepted.')
        return
      }
      setNote('Shared demo access is on for this browser. This is not a separate commander login.')
      await load()
    } catch {
      setNote('The reference server could not be reached. The code was not accepted.')
    }
  }

  async function send(path: string, body: Record<string, unknown>, okText: string) {
    try {
      const response = await demoFetch(path, { method: 'POST', body: JSON.stringify(body) })
      const payload = (await response.json()) as { message?: string }
      if (!response.ok) {
        setNote(payload.message ?? 'The server did not accept that.')
        return
      }
      setNote(payload.message ?? okText)
      await load()
    } catch {
      setNote('The reference server could not be reached.')
    }
  }

  return (
    <main className="flex flex-col gap-4 px-4 py-5">
      <section className="rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm leading-relaxed">
        <h2 className="font-semibold text-[#0c3d82]">How reference updates work</h2>
        <ul className="mt-2 list-disc pl-5">
          {GUIDE.map((line) => <li key={line}>{line}</li>)}
        </ul>
      </section>
      <section className="grid gap-3 rounded-xl bg-white p-4">
        <p className="text-sm text-slate-700">Shared demo access. One code opens the reference tools for everyone who has it. It is not a private commander account.</p>
        <label className="text-sm">Channel<Input value={channel} onChange={(event) => setChannel(event.target.value)} /></label>
        {!open ? (
          <label className="text-sm">Demo access code
            <Input type="password" value={code} autoComplete="off" onChange={(event) => setCode(event.target.value)} />
          </label>
        ) : null}
        <div className="flex flex-wrap gap-2">
          {!open ? <Button type="button" onClick={() => void unlock()}>Unlock</Button> : <Button type="button" variant="outline" onClick={() => void demoFetch('/api/demo/lock', { method: 'POST' }).then(() => { setOpen(false); setStatus(null); setProposals([]); setNote('Shared demo access is off in this browser.') })}>Lock</Button>}
          <Button type="button" variant="outline" onClick={() => void load()}>Reload</Button>
        </div>
      </section>
      <p className="text-sm" role="status">{note}</p>
      {status ? (
        <section className="rounded-xl border bg-white p-4 text-sm">
          <p className="font-semibold">Status: {status.status}</p>
          <p>{status.message}</p>
          <p>Version {status.version ?? 'none'} · Label {status.designatedReviewer ?? 'not set'} · Reviewed {status.reviewedAt ? new Date(status.reviewedAt).toLocaleString() : 'not yet'}</p>
          <p>Review due {status.reviewDue ? new Date(status.reviewDue).toLocaleString() : 'not set'} · Valid until {status.validUntil ? new Date(status.validUntil).toLocaleString() : 'not set'}</p>
          <p>Open drafts: {status.pendingProposals ?? 0}. A draft does not move either date.</p>
        </section>
      ) : null}
      {open ? (
        <>
          <section className="grid gap-3 rounded-xl bg-white p-4">
            <h2 className="font-semibold">File a draft</h2>
            <textarea className="min-h-28 rounded-md border p-2 text-sm" value={text} onChange={(event) => setText(event.target.value)} placeholder="Type a replacement reference, or paste an email." />
            <div className="flex flex-wrap gap-2">
              <Button type="button" onClick={() => void send(`/api/channels/${encodeURIComponent(channel)}/proposals`, { origin: 'admin-text', text, mode: 'replace' }, 'Draft filed. The approved reference was not changed.')}>File as replacement draft</Button>
              <Button type="button" variant="outline" onClick={() => void send(`/api/channels/${encodeURIComponent(channel)}/proposals`, { origin: 'admin-text', text, mode: 'append' }, 'Draft filed. The approved reference was not changed.')}>Add as note draft</Button>
            </div>
          </section>
          <section className="grid gap-3 rounded-xl bg-white p-4 md:grid-cols-2">
            <h2 className="font-semibold md:col-span-2">Approval label</h2>
            <p className="text-sm text-slate-600 md:col-span-2">This name is written on the approved version. Shared demo access is still not a separate person.</p>
            <label className="text-sm">Name on the approval
              <Input value={reviewerName} onChange={(event) => setReviewerName(event.target.value)} />
            </label>
            <div className="flex items-end"><Button type="button" variant="outline" onClick={() => void send(`/api/channels/${encodeURIComponent(channel)}/reviewer`, { name: reviewerName }, 'Label saved.')}>Save label</Button></div>
            <label className="text-sm">Review due<input className="mt-1 w-full rounded-md border px-2 py-2" type="datetime-local" value={reviewDue} onChange={(event) => setReviewDue(event.target.value)} /></label>
            <label className="text-sm">Valid until<input className="mt-1 w-full rounded-md border px-2 py-2" type="datetime-local" value={validUntil} onChange={(event) => setValidUntil(event.target.value)} /></label>
            <p className="text-xs text-slate-600 md:col-span-2">Leave both empty if this approval should not expire on its own. There is no built-in review interval.</p>
            <Button type="button" variant="outline" onClick={() => void send(`/api/channels/${encodeURIComponent(channel)}/review-window`, { reviewDue: reviewDue ? new Date(reviewDue).toISOString() : null, validUntil: validUntil ? new Date(validUntil).toISOString() : null }, 'Dates saved for the next approval.')}>Save dates for the next approval</Button>
          </section>
          <section className="flex flex-col gap-3">
            {proposals.filter((item) => item.state === 'open').map((proposal) => (
              <article key={proposal.id} className="rounded-xl border bg-white p-3 text-sm">
                <p className="font-semibold">{proposal.provenance?.origin} · {proposal.provenance?.sourceLabel} · {proposal.provenance?.actor}</p>
                <p className="text-xs text-slate-500">Received {when(proposal.provenance?.receivedAt)} · Event {when(proposal.provenance?.eventAt) || 'unspecified'}</p>
                {proposal.conflict ? <p className="text-amber-800">The approved file changed after this draft. Promoting replaces it with this exact text.</p> : null}
                <ul className="mt-2 font-mono text-xs">
                  {(proposal.diff ?? []).map((line, index) => (
                    <li key={`${proposal.id}-${index}`}>{line.op === '+' ? '+ ' : line.op === '-' ? '- ' : '  '}{line.text}</li>
                  ))}
                </ul>
                <Button type="button" className="mt-2" onClick={() => void send(`/api/channels/${encodeURIComponent(channel)}/proposals/${proposal.id}/promote`, { acknowledgeConflict: proposal.conflict === true, reviewDue: reviewDue ? new Date(reviewDue).toISOString() : null, validUntil: validUntil ? new Date(validUntil).toISOString() : null }, 'Exact draft promoted.')}>Promote this exact draft</Button>
              </article>
            ))}
          </section>
        </>
      ) : null}
    </main>
  )
}
