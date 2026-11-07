import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { apiFetch, ADMIN_TOKEN_KEY, INGEST_TOKEN_KEY, REVIEWER_TOKEN_KEY } from '@/lib/api'
import { loadSession, saveSession } from '@/lib/storage'
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
  configuredWindow?: { reviewDue: string | null; validUntil: string | null }
}

function when(value: string | null | undefined): string {
  if (!value) return ''
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString()
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

export function ReferenceView() {
  const [channel, setChannel] = useState('sanket-1')
  const [admin, setAdmin] = useState(loadSession(ADMIN_TOKEN_KEY))
  const [reviewerToken, setReviewerToken] = useState(loadSession(REVIEWER_TOKEN_KEY))
  const [ingest, setIngest] = useState(loadSession(INGEST_TOKEN_KEY))
  const [note, setNote] = useState('Tokens stay in this tab only. They are not saved in the page.')
  const [status, setStatus] = useState<Status | null>(null)
  const [text, setText] = useState('')
  const [proposals, setProposals] = useState<Proposal[]>([])
  const [reviewerName, setReviewerName] = useState('')
  const [reviewDue, setReviewDue] = useState('')
  const [validUntil, setValidUntil] = useState('')
  const [sourceUrl, setSourceUrl] = useState('')

  function saveTokens() {
    saveSession(ADMIN_TOKEN_KEY, admin)
    saveSession(REVIEWER_TOKEN_KEY, reviewerToken)
    saveSession(INGEST_TOKEN_KEY, ingest)
    setNote('Tokens saved for this tab.')
  }

  async function load() {
    const response = await apiFetch(`/api/channels/${channel}/knowledge`, admin || reviewerToken)
    const body = (await response.json()) as Status & { proposals?: Proposal[]; message?: string }
    if (!response.ok) {
      setNote(body.message ?? 'Could not load the reference.')
      return
    }
    setStatus(body)
    setProposals(body.proposals ?? [])
    setText('')
    setNote(body.message ?? 'Loaded.')
  }

  async function submit(body: Record<string, unknown>) {
    const response = await apiFetch(`/api/channels/${channel}/proposals`, admin, { method: 'POST', body: JSON.stringify(body) })
    const payload = (await response.json()) as { message?: string }
    setNote(payload.message ?? (response.ok ? 'Draft filed. The approved reference was not changed.' : 'The draft was not filed.'))
    if (response.ok || response.status === 409) await load()
  }

  return (
    <main className="flex flex-col gap-4 px-4 py-5">
      <section className="rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm leading-relaxed">
        <h2 className="font-semibold text-[#0c3d82]">How reference updates work</h2>
        <ul className="mt-2 list-disc pl-5">
          {GUIDE.map((line) => <li key={line}>{line}</li>)}
        </ul>
      </section>
      <section className="grid gap-3 rounded-xl bg-white p-4 md:grid-cols-3">
        <label className="text-sm">Channel<Input value={channel} onChange={(event) => setChannel(event.target.value)} /></label>
        <label className="text-sm">Administrator token<Input type="password" value={admin} onChange={(event) => setAdmin(event.target.value)} autoComplete="off" /></label>
        <label className="text-sm">Commander token<Input type="password" value={reviewerToken} onChange={(event) => setReviewerToken(event.target.value)} autoComplete="off" /></label>
        <label className="text-sm md:col-span-2">Ingest token<Input type="password" value={ingest} onChange={(event) => setIngest(event.target.value)} autoComplete="off" /></label>
        <div className="flex items-end gap-2">
          <Button type="button" onClick={saveTokens}>Save tokens</Button>
          <Button type="button" variant="outline" onClick={() => void load()}>Reload</Button>
        </div>
      </section>
      <p className="text-sm" role="status">{note}</p>
      {status ? (
        <section className="rounded-xl border bg-white p-4 text-sm">
          <p className="font-semibold">Status: {status.status}</p>
          <p>{status.message}</p>
          <p>Version {status.version ?? 'none'} · Commander {status.designatedReviewer ?? 'not designated'} · Reviewed {status.reviewedAt ? new Date(status.reviewedAt).toLocaleString() : 'not yet'}</p>
          <p>Review due {status.reviewDue ? new Date(status.reviewDue).toLocaleString() : 'not set'} · Valid until {status.validUntil ? new Date(status.validUntil).toLocaleString() : 'not set'}</p>
          <p>Open drafts: {status.pendingProposals ?? 0}. A draft does not move either date.</p>
        </section>
      ) : null}
      <section className="grid gap-3 rounded-xl bg-white p-4">
        <h2 className="font-semibold">File a draft</h2>
        <textarea className="min-h-28 rounded-md border p-2 text-sm" value={text} onChange={(event) => setText(event.target.value)} placeholder="Type a replacement reference, or paste an email." />
        <div className="flex flex-wrap gap-2">
          <Button type="button" onClick={() => void submit({ origin: 'admin-text', text, mode: 'replace', actor: 'administrator' })}>File as replacement draft</Button>
          <Button type="button" variant="outline" onClick={() => void submit({ origin: 'admin-text', text, mode: 'append', actor: 'administrator' })}>Add as note draft</Button>
          <Button type="button" variant="outline" onClick={() => void submit({ origin: 'email', raw: text, actor: 'administrator' })}>File pasted email</Button>
        </div>
        <label className="text-sm">Upload .txt, .md, .csv, or .eml
          <input className="mt-1 block" type="file" accept=".txt,.md,.csv,.eml,text/plain,message/rfc822" onChange={(event) => {
            const file = event.target.files?.[0]
            if (!file) return
            void file.text().then((raw) => apiFetch(`/api/channels/${channel}/proposals/file`, admin, {
              method: 'POST',
              headers: { 'content-type': 'text/plain', 'x-filename': file.name, 'x-actor': 'administrator' },
              body: raw,
            }).then(async (response) => {
              const body = (await response.json()) as { message?: string }
              setNote(body.message ?? 'Upload finished.')
              if (response.ok) await load()
            }))
          }} />
        </label>
      </section>
      <section className="grid gap-3 rounded-xl bg-white p-4 md:grid-cols-2">
        <h2 className="font-semibold md:col-span-2">Commander</h2>
        <label className="text-sm">Designated commander
          <Input value={reviewerName} onChange={(event) => setReviewerName(event.target.value)} />
        </label>
        <div className="flex items-end"><Button type="button" variant="outline" onClick={() => void apiFetch(`/api/channels/${channel}/reviewer`, admin, { method: 'POST', body: JSON.stringify({ name: reviewerName }) }).then(() => load())}>Save commander</Button></div>
        <label className="text-sm">Review due<input className="mt-1 w-full rounded-md border px-2 py-2" type="datetime-local" value={reviewDue} onChange={(event) => setReviewDue(event.target.value)} /></label>
        <label className="text-sm">Valid until<input className="mt-1 w-full rounded-md border px-2 py-2" type="datetime-local" value={validUntil} onChange={(event) => setValidUntil(event.target.value)} /></label>
        <p className="text-xs text-slate-600 md:col-span-2">Leave both empty if this approval should not expire on its own. There is no built-in review interval.</p>
        <Button type="button" variant="outline" onClick={() => void apiFetch(`/api/channels/${channel}/review-window`, admin, { method: 'POST', body: JSON.stringify({ reviewDue: reviewDue ? new Date(reviewDue).toISOString() : null, validUntil: validUntil ? new Date(validUntil).toISOString() : null }) }).then(() => load())}>Save dates for the next approval</Button>
      </section>
      <section className="flex flex-col gap-3">
        {proposals.filter((item) => item.state === 'open').map((proposal) => (
          <article key={proposal.id} className="rounded-xl border bg-white p-3 text-sm">
            <p className="font-semibold">{proposal.provenance?.origin} · {proposal.provenance?.sourceLabel} · {proposal.provenance?.actor}</p>
            <p className="text-xs text-slate-500">Received {when(proposal.provenance?.receivedAt)} · Event {when(proposal.provenance?.eventAt) || 'unspecified'}{proposal.freshness?.eventOlderThanApproval ? ' · older than the current approval' : ''}</p>
            {proposal.conflict ? <p className="text-amber-800">The approved file changed after this draft. Promoting replaces it with this exact text.</p> : null}
            {proposal.provenance?.transcript ? <p className="mt-2 whitespace-pre-wrap">Original transcript: {proposal.provenance.transcript}</p> : null}
            {proposal.supersededFacts?.length ? <p className="mt-2">Facts this draft would remove: {proposal.supersededFacts.join(' | ')}</p> : null}
            <ul className="mt-2 font-mono text-xs">
              {(proposal.diff ?? []).map((line, index) => (
                <li key={`${proposal.id}-${index}`}>{line.op === '+' ? '+ ' : line.op === '-' ? '- ' : '  '}{line.text}</li>
              ))}
            </ul>
            <Button type="button" className="mt-2" onClick={() => void apiFetch(`/api/channels/${channel}/proposals/${proposal.id}/promote`, reviewerToken, { method: 'POST', body: JSON.stringify({ acknowledgeConflict: proposal.conflict === true, reviewDue: reviewDue ? new Date(reviewDue).toISOString() : null, validUntil: validUntil ? new Date(validUntil).toISOString() : null }) }).then(async (response) => { const body = (await response.json()) as { message?: string }; setNote(body.message ?? 'Promotion finished.'); await load() })}>Commander promotes this exact draft</Button>
          </article>
        ))}
      </section>
      <section className="rounded-xl bg-white p-4 text-sm">
        <h2 className="font-semibold">Approved web source</h2>
        <p className="mt-1 text-slate-600">Nothing is fetched until you add a public https URL. Private and internal addresses are rejected. No mailbox is connected.</p>
        <div className="mt-2 flex flex-wrap gap-2">
          <Input value={sourceUrl} onChange={(event) => setSourceUrl(event.target.value)} placeholder="https://example.com/facts.txt" />
          <Button type="button" variant="outline" onClick={() => void apiFetch(`/api/channels/${channel}/sources`, admin, { method: 'POST', body: JSON.stringify({ name: 'Configured source', url: sourceUrl, everyMinutes: null, apply: 'append' }) }).then(async (response) => { const body = (await response.json()) as { message?: string }; setNote(body.message ?? 'Source saved.'); })}>Save source</Button>
        </div>
      </section>
    </main>
  )
}
