import { diffLines, supersededFacts, type DiffLine } from './diff.ts'

export type ReviewWindow = { reviewDue: string | null; validUntil: string | null }

export type Provenance = {
  origin: 'admin-text' | 'upload' | 'email' | 'voice' | 'webhook' | 'fetch' | 'forward'
  sourceLabel: string
  actor: string
  receivedAt: string
  eventAt: string | null
  externalId: string | null
  transcript: string | null
  correctedTranscript: string | null
  contentHash: string
}

export type Proposal = {
  id: string
  baseSha256: string | null
  proposedText: string
  filename: string
  mode: 'replace' | 'append'
  createdAt: string
  provenance: Provenance
  state: 'open' | 'promoted' | 'rejected'
}

export type Approval = {
  version: number
  sha256: string
  text: string
  filename: string
  reviewer: string
  reviewedAt: string
  reviewDue: string | null
  validUntil: string | null
  proposalId: string | null
}

export type Audit = { at: string; type: string; detail: string }

export type SourceConfig = {
  id: string
  name: string
  url: string
  everyMinutes: number | null
  apply: 'append' | 'replace'
  enabled: boolean
  lastFetchAt: string | null
  lastError: string | null
}

export type ChannelState = {
  channel: string
  reviewerName: string | null
  window: ReviewWindow
  active: Approval | null
  proposals: Proposal[]
  seen: string[]
  assistant: boolean
  nextVersion: number
  audit: Audit[]
  sources: SourceConfig[]
}

export type KbError = { error: string; message: string }

const INTERVAL_KEYS = ['reviewIntervalDays', 'reviewInterval', 'intervalDays', 'everyDays', 'reviewEveryDays']

export function emptyChannel(channel: string): ChannelState {
  return {
    channel,
    reviewerName: null,
    window: { reviewDue: null, validUntil: null },
    active: null,
    proposals: [],
    seen: [],
    assistant: true,
    nextVersion: 1,
    audit: [],
    sources: [],
  }
}

export function intervalError(body: unknown): string | null {
  if (!body || typeof body !== 'object') return null
  const record = body as Record<string, unknown>
  for (const key of INTERVAL_KEYS) {
    if (key in record) {
      return 'Set an exact review due date or valid-until time, or leave both empty. This app does not use a review interval.'
    }
  }
  return null
}

export function parseOptionalTime(value: unknown): { ok: true; value: string | null } | KbError {
  if (value == null || value === '') return { ok: true, value: null }
  if (typeof value !== 'string') return { error: 'invalid_date', message: 'A review date must be empty or an ISO time.' }
  const ms = Date.parse(value)
  if (!Number.isFinite(ms)) return { error: 'invalid_date', message: 'A review date must be empty or an ISO time.' }
  return { ok: true, value: new Date(ms).toISOString() }
}

export function safeFilename(name: string): string {
  const base = name.split(/[/\\]/).pop() ?? 'reference.txt'
  const clean = base.replace(/[^A-Za-z0-9._ -]/g, '').slice(0, 80)
  if (!clean || clean === '.' || clean === '..') return 'reference.txt'
  return clean
}

export function normalizeForHash(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, ' ')
}

export function dedupeKey(provenance: Pick<Provenance, 'origin' | 'externalId' | 'contentHash'>): string {
  if (provenance.externalId) return `${provenance.origin}:${provenance.externalId}`
  return `${provenance.origin}:${provenance.contentHash}`
}

export type Usability =
  | { state: 'approved' }
  | { state: 'no_document'; message: string }
  | { state: 'pending_review'; message: string }
  | { state: 'expired'; because: 'review_due' | 'valid_until'; message: string }

function expiryMessage(because: 'review_due' | 'valid_until'): string {
  if (because === 'review_due') {
    return 'The approved reference file is past its review due date. It will not be used until the commander approves it again.'
  }
  return 'The approved reference file is past its valid-until time. It will not be used until the commander approves it again.'
}

export function usability(active: Approval | null, nowMs: number, pending: boolean): Usability {
  if (!active) {
    return pending
      ? {
          state: 'pending_review',
          message: 'A reference draft is waiting for the designated commander. It is not used for answers.',
        }
      : { state: 'no_document', message: 'No approved reference file is available for this channel.' }
  }
  const due = active.reviewDue ? Date.parse(active.reviewDue) : Number.NaN
  const until = active.validUntil ? Date.parse(active.validUntil) : Number.NaN
  const dueHit = Number.isFinite(due) && nowMs >= due
  const untilHit = Number.isFinite(until) && nowMs >= until
  if (dueHit && untilHit) {
    const because = due <= until ? 'review_due' : 'valid_until'
    return { state: 'expired', because, message: expiryMessage(because) }
  }
  if (dueHit) return { state: 'expired', because: 'review_due', message: expiryMessage('review_due') }
  if (untilHit) return { state: 'expired', because: 'valid_until', message: expiryMessage('valid_until') }
  return { state: 'approved' }
}

export function hasConflict(activeSha: string | null, baseSha: string | null): boolean {
  return activeSha !== baseSha
}

function withAudit(state: ChannelState, at: string, type: string, detail: string): Audit[] {
  return [...state.audit, { at, type, detail: detail.slice(0, 180) }].slice(-40)
}

export function addProposal(
  state: ChannelState,
  input: {
    id: string
    nowIso: string
    filename: string
    mode: 'replace' | 'append'
    block: string
    provenance: Provenance
  },
): { state: ChannelState; proposal: Proposal } | { duplicate: true; id: string } | KbError {
  const block = input.block.trim()
  if (!block) return { error: 'empty', message: 'The draft has no text.' }
  if (block.length > 200_000) return { error: 'too_large', message: 'The draft is over the 200000 character limit.' }
  const key = dedupeKey(input.provenance)
  if (state.seen.includes(key)) {
    const existing = state.proposals.find((item) => dedupeKey(item.provenance) === key)
    return { duplicate: true, id: existing?.id ?? key }
  }
  const open = state.proposals.filter((item) => item.state === 'open')
  if (open.length >= 25) {
    return { error: 'too_many_proposals', message: 'This channel already has 25 open drafts. Review or reject one first.' }
  }
  const activeText = state.active?.text ?? ''
  const proposedText = input.mode === 'replace' || !activeText.trim() ? block : `${activeText.replace(/\s+$/, '')}\n\n${block}\n`
  const proposal: Proposal = {
    id: input.id,
    baseSha256: state.active?.sha256 ?? null,
    proposedText,
    filename: safeFilename(input.filename),
    mode: input.mode,
    createdAt: input.nowIso,
    provenance: input.provenance,
    state: 'open',
  }
  const closed = state.proposals.filter((item) => item.state !== 'open').slice(-20)
  return {
    proposal,
    state: {
      ...state,
      proposals: [...closed, ...open, proposal],
      seen: [...state.seen, key].slice(-500),
      audit: withAudit(state, input.nowIso, 'proposal', `${input.provenance.origin} ${proposal.id}`),
    },
  }
}

function datesOf(state: ChannelState, dates: ReviewWindow | 'configured'): ReviewWindow {
  return dates === 'configured' ? state.window : dates
}

export function promote(
  state: ChannelState,
  input: {
    proposalId: string
    nowIso: string
    sha256: string
    acknowledgeConflict: boolean
    dates: ReviewWindow | 'configured'
  },
): { state: ChannelState; approval: Approval } | KbError {
  if (!state.reviewerName) return { error: 'reviewer_required', message: 'Designate the commander before approving a draft.' }
  const proposal = state.proposals.find((item) => item.id === input.proposalId)
  if (!proposal || proposal.state !== 'open') return { error: 'not_found', message: 'That draft is not open.' }
  if (hasConflict(state.active?.sha256 ?? null, proposal.baseSha256) && !input.acknowledgeConflict) {
    return {
      error: 'conflict',
      message: 'The approved file changed after this draft was filed. Review the diff and confirm the exact text.',
    }
  }
  const dates = datesOf(state, input.dates)
  const approval: Approval = {
    version: state.nextVersion,
    sha256: input.sha256,
    text: proposal.proposedText,
    filename: proposal.mode === 'append' && state.active ? state.active.filename : proposal.filename,
    reviewer: state.reviewerName,
    reviewedAt: input.nowIso,
    reviewDue: dates.reviewDue,
    validUntil: dates.validUntil,
    proposalId: proposal.id,
  }
  return {
    approval,
    state: {
      ...state,
      nextVersion: state.nextVersion + 1,
      active: approval,
      proposals: state.proposals.map((item) => (item.id === proposal.id ? { ...item, state: 'promoted' as const } : item)),
      audit: withAudit(state, input.nowIso, 'promote', `version ${approval.version} by ${state.reviewerName}`),
    },
  }
}

export function reapprove(
  state: ChannelState,
  input: { nowIso: string; sha256: string; dates: ReviewWindow | 'configured' },
): { state: ChannelState; approval: Approval } | KbError {
  if (!state.reviewerName) return { error: 'reviewer_required', message: 'Designate the commander before approving again.' }
  if (!state.active) return { error: 'no_document', message: 'There is no approved text to approve again.' }
  if (input.sha256 !== state.active.sha256) {
    return { error: 'stale', message: 'The approved text changed. Approve the current exact version.' }
  }
  const dates = datesOf(state, input.dates)
  const approval: Approval = {
    ...state.active,
    version: state.nextVersion,
    reviewer: state.reviewerName,
    reviewedAt: input.nowIso,
    reviewDue: dates.reviewDue,
    validUntil: dates.validUntil,
    proposalId: null,
  }
  return {
    approval,
    state: {
      ...state,
      nextVersion: state.nextVersion + 1,
      active: approval,
      audit: withAudit(state, input.nowIso, 'reapprove', `version ${approval.version}`),
    },
  }
}

export function rejectProposal(state: ChannelState, proposalId: string, nowIso: string): { state: ChannelState } | KbError {
  const proposal = state.proposals.find((item) => item.id === proposalId && item.state === 'open')
  if (!proposal) return { error: 'not_found', message: 'That draft is not open.' }
  return {
    state: {
      ...state,
      proposals: state.proposals.map((item) => (item.id === proposalId ? { ...item, state: 'rejected' as const } : item)),
      audit: withAudit(state, nowIso, 'reject', proposalId),
    },
  }
}

function hasControl(value: string): boolean {
  for (let i = 0; i < value.length; i++) if (value.charCodeAt(i) <= 31) return true
  return false
}

export function setReviewer(state: ChannelState, name: string, nowIso: string): { state: ChannelState } | KbError {
  const trimmed = name.trim()
  if (trimmed.length < 2 || trimmed.length > 60 || hasControl(trimmed)) {
    return { error: 'invalid_name', message: 'The commander name must be 2 to 60 characters.' }
  }
  return { state: { ...state, reviewerName: trimmed, audit: withAudit(state, nowIso, 'reviewer', trimmed) } }
}

export function setWindow(state: ChannelState, window: ReviewWindow, nowIso: string): ChannelState {
  return {
    ...state,
    window,
    audit: withAudit(state, nowIso, 'window', `due ${window.reviewDue ?? 'empty'}, until ${window.validUntil ?? 'empty'}`),
  }
}

export function setAssistant(state: ChannelState, enabled: boolean, nowIso: string): ChannelState {
  return { ...state, assistant: enabled, audit: withAudit(state, nowIso, 'assistant', enabled ? 'on' : 'off') }
}

export function addSource(
  state: ChannelState,
  source: SourceConfig,
  nowIso: string,
): { state: ChannelState } | KbError {
  if (state.sources.length >= 8) return { error: 'too_many_sources', message: 'This channel already has 8 sources.' }
  if (source.everyMinutes != null && (source.everyMinutes < 15 || source.everyMinutes > 10_080)) {
    return { error: 'invalid_schedule', message: 'Leave the schedule empty, or set it between 15 minutes and 7 days.' }
  }
  return {
    state: {
      ...state,
      sources: [...state.sources, source],
      audit: withAudit(state, nowIso, 'source', source.name),
    },
  }
}

export function markSource(state: ChannelState, id: string, patch: { lastFetchAt: string; lastError: string | null }): ChannelState {
  return {
    ...state,
    sources: state.sources.map((source) => (source.id === id ? { ...source, ...patch } : source)),
  }
}

export function dueSources(sources: readonly SourceConfig[], nowMs: number): SourceConfig[] {
  return sources.filter((source) => {
    if (!source.enabled || source.everyMinutes == null) return false
    if (!source.lastFetchAt) return true
    return nowMs - Date.parse(source.lastFetchAt) >= source.everyMinutes * 60_000
  })
}

export type ProposalView = Proposal & {
  conflict: boolean
  diff: DiffLine[]
  supersededFacts: string[]
  freshness: {
    eventAt: string | null
    receivedAt: string
    approvedAt: string | null
    eventOlderThanApproval: boolean
  }
}

export function proposalView(state: ChannelState, proposal: Proposal): ProposalView {
  const diff = diffLines(state.active?.text ?? '', proposal.proposedText)
  return {
    ...proposal,
    conflict: hasConflict(state.active?.sha256 ?? null, proposal.baseSha256),
    diff,
    supersededFacts: supersededFacts(diff),
    freshness: {
      eventAt: proposal.provenance.eventAt,
      receivedAt: proposal.provenance.receivedAt,
      approvedAt: state.active?.reviewedAt ?? null,
      eventOlderThanApproval: Boolean(
        proposal.provenance.eventAt &&
          state.active?.reviewedAt &&
          Date.parse(proposal.provenance.eventAt) < Date.parse(state.active.reviewedAt),
      ),
    },
  }
}

export function channelStatus(state: ChannelState, nowMs: number) {
  const pending = state.proposals.some((item) => item.state === 'open')
  const use = usability(state.active, nowMs, pending)
  return {
    channel: state.channel,
    status: use.state,
    because: use.state === 'expired' ? use.because : null,
    message: use.state === 'approved' ? 'The commander-approved reference is in use.' : use.message,
    version: state.active?.version ?? null,
    sha256: state.active?.sha256 ?? null,
    filename: state.active?.filename ?? null,
    reviewer: state.active?.reviewer ?? null,
    designatedReviewer: state.reviewerName,
    reviewedAt: state.active?.reviewedAt ?? null,
    reviewDue: state.active?.reviewDue ?? null,
    validUntil: state.active?.validUntil ?? null,
    configuredWindow: state.window,
    pendingProposals: state.proposals.filter((item) => item.state === 'open').length,
    assistant: state.assistant,
  }
}
