import { describe, expect, it } from 'vitest'
import { decideAnswer, SpeechQueue } from '../src/lib/assistant.ts'
import { forwardBlock, voiceBlock } from '../src/lib/blocks.ts'
import { diffLines } from '../src/lib/diff.ts'
import { ground } from '../src/lib/ground.ts'
import { GUIDE } from '../src/lib/guide.ts'
import {
  addProposal,
  channelStatus,
  emptyChannel,
  intervalError,
  promote,
  reapprove,
  setReviewer,
  setWindow,
  usability,
} from '../src/lib/kb.ts'
import { isExplicitQuestion } from '../src/lib/questions.ts'

const NOW = Date.parse('2026-11-07T12:00:00Z')
const PHONE = '+91 40 2785 2210'
const FACT = `Help desk phone: ${PHONE}`

function approved() {
  let state = emptyChannel('sanket-1')
  state = setReviewer(state, 'Watch commander', new Date(NOW).toISOString()).state ?? state
  const draft = addProposal(state, {
    id: 'p1',
    nowIso: new Date(NOW).toISOString(),
    filename: 'reference.txt',
    mode: 'replace',
    block: FACT,
    provenance: provenance('admin-text'),
  })
  if (!('proposal' in draft)) throw new Error('draft')
  const promoted = promote(draft.state, {
    proposalId: 'p1',
    nowIso: new Date(NOW).toISOString(),
    sha256: 'hash-1',
    acknowledgeConflict: false,
    dates: { reviewDue: null, validUntil: new Date(NOW + 3_600_000).toISOString() },
  })
  if (!('approval' in promoted)) throw new Error('promote')
  return promoted.state
}

function provenance(origin: 'admin-text' | 'forward' | 'voice') {
  return {
    origin,
    sourceLabel: origin,
    actor: 'operator',
    receivedAt: new Date(NOW).toISOString(),
    eventAt: new Date(NOW).toISOString(),
    externalId: null as string | null,
    transcript: null as string | null,
    correctedTranscript: null as string | null,
    contentHash: `${origin}-hash`,
  }
}

describe('commander approval', () => {
  it('keeps a draft out of the active file until promotion', () => {
    const state = emptyChannel('sanket-1')
    const draft = addProposal(state, {
      id: 'p1',
      nowIso: new Date(NOW).toISOString(),
      filename: 'reference.txt',
      mode: 'replace',
      block: FACT,
      provenance: provenance('admin-text'),
    })
    if (!('proposal' in draft)) throw new Error('expected draft')
    expect(draft.state.active).toBeNull()
    expect(usability(draft.state.active, NOW, true).state).toBe('pending_review')
  })

  it('does not invent a review interval and does not let a draft move the expiry', () => {
    expect(intervalError({ reviewIntervalDays: 30 })).toMatch(/does not use a review interval/)
    const state = approved()
    const before = state.active
    const extra = addProposal(state, {
      id: 'p2',
      nowIso: new Date(NOW).toISOString(),
      filename: 'reference.txt',
      mode: 'append',
      block: 'North repeater frequency: 145.500 MHz',
      provenance: { ...provenance('admin-text'), contentHash: 'other', externalId: 'note-2' },
    })
    if (!('state' in extra)) throw new Error('draft')
    expect(extra.state.active).toBe(before)
    expect(setWindow(extra.state, { reviewDue: null, validUntil: null }, new Date(NOW).toISOString()).active).toBe(before)
  })

  it('stops answering after the configured valid-until without using the draft', () => {
    const state = approved()
    expect(usability(state.active, NOW + 3_600_001, true).state).toBe('expired')
    const decision = decideAnswer({
      speakerId: 'unit',
      text: 'what is the help desk phone?',
      assistant: true,
      active: state.active,
      pending: true,
      nowMs: NOW + 3_600_001,
      recent: [],
    })
    expect(decision.action).toBe('unavailable')
    if (decision.action === 'unavailable') expect(decision.message).not.toContain(PHONE)
  })

  it('quotes the approved passage and version after promotion', () => {
    const state = approved()
    const decision = decideAnswer({
      speakerId: 'unit',
      text: 'what is the help desk phone?',
      assistant: true,
      active: state.active,
      pending: false,
      nowMs: NOW,
      recent: [],
    })
    expect(decision.action).toBe('answer')
    if (decision.action !== 'answer') return
    expect(decision.text).toContain(PHONE)
    expect(decision.version).toBe(1)
    expect(decision.reviewer).toBe('Watch commander')
  })

  it('files a forwarded message as a draft and keeps the original transcript', () => {
    const state = approved()
    const transcript = 'Commander frequency is 154.725 MHz'
    const block = forwardBlock({ speaker: 'Unit-A', eventAt: new Date(NOW).toISOString(), channel: 'sanket-1', transcript })
    const filed = addProposal(state, {
      id: 'fwd',
      nowIso: new Date(NOW).toISOString(),
      filename: 'reference.txt',
      mode: 'append',
      block,
      provenance: { ...provenance('forward'), externalId: 'message-1', transcript, contentHash: 'fwd-hash' },
    })
    if (!('proposal' in filed)) throw new Error('forward')
    expect(filed.state.active).toBe(state.active)
    expect(filed.proposal.provenance.transcript).toBe(transcript)
    expect(filed.proposal.proposedText).toContain(transcript)
    const again = addProposal(filed.state, {
      id: 'fwd-2',
      nowIso: new Date(NOW).toISOString(),
      filename: 'reference.txt',
      mode: 'append',
      block,
      provenance: { ...provenance('forward'), externalId: 'message-1', transcript, contentHash: 'fwd-hash' },
    })
    expect(again).toMatchObject({ duplicate: true })
  })

  it('stores a voice correction without rewriting digits', () => {
    const asr = '154.725'
    const corrected = '15A.72S'
    const block = voiceBlock(corrected)
    expect(block).toContain(corrected)
    expect(block).not.toContain(asr)
    const state = approved()
    const filed = addProposal(state, {
      id: 'voice',
      nowIso: new Date(NOW).toISOString(),
      filename: 'reference.txt',
      mode: 'append',
      block,
      provenance: { ...provenance('voice'), transcript: asr, correctedTranscript: corrected, contentHash: 'voice-hash' },
    })
    if (!('proposal' in filed)) throw new Error('voice')
    expect(filed.proposal.provenance.transcript).toBe(asr)
    expect(filed.proposal.proposedText).toContain(corrected)
    expect(filed.state.active?.text).toBe(FACT)
  })

  it('replaces the old approval only when the commander promotes', () => {
    const state = approved()
    const filed = addProposal(state, {
      id: 'next',
      nowIso: new Date(NOW).toISOString(),
      filename: 'reference.txt',
      mode: 'replace',
      block: 'Backup phone: +91 40 1111 2222',
      provenance: { ...provenance('admin-text'), contentHash: 'next', externalId: 'next' },
    })
    if (!('proposal' in filed)) throw new Error('next')
    const promoted = promote(filed.state, {
      proposalId: 'next',
      nowIso: new Date(NOW + 1000).toISOString(),
      sha256: 'hash-2',
      acknowledgeConflict: false,
      dates: 'configured',
    })
    if (!('approval' in promoted)) throw new Error('promoted')
    expect(promoted.approval.text).toContain('+91 40 1111 2222')
    expect(promoted.approval.version).toBe(2)
    expect(promoted.approval.sha256).toBe('hash-2')
    expect(channelStatus(promoted.state, NOW).version).toBe(2)
  })

  it('requires another commander approval to extend an expired file', () => {
    const state = approved()
    const again = reapprove(state, {
      nowIso: new Date(NOW + 10_000).toISOString(),
      sha256: state.active?.sha256 ?? '',
      dates: { reviewDue: null, validUntil: new Date(NOW + 86_400_000).toISOString() },
    })
    if (!('approval' in again)) throw new Error('reapprove')
    expect(again.approval.text).toBe(FACT)
    expect(again.approval.version).toBe(2)
    expect(usability(again.approval, NOW + 10_000, false).state).toBe('approved')
  })
})

describe('retrieval and questions', () => {
  it('refuses an ambiguous frequency and ignores statements', () => {
    const document = 'North repeater frequency: 145.500 MHz\n\nSouth repeater frequency: 146.700 MHz'
    const hit = ground('what is the frequency?', document)
    expect(hit.status).toBe('ambiguous')
    if (hit.status === 'ambiguous') {
      expect(hit.message).not.toContain('145.500')
      expect(hit.message).not.toContain('146.700')
    }
    expect(ground('what is the practice next action?', 'The practice desk code is 0000.').status).toBe('not_found')
    expect(isExplicitQuestion('The commander is on the way.')).toBe(false)
    expect(isExplicitQuestion('what is the help desk phone?')).toBe(true)
  })

  it('does not answer the assistant or a repeated question', () => {
    const state = approved()
    expect(decideAnswer({ speakerId: 'sanket-assistant', text: 'what is the help desk phone?', assistant: true, active: state.active, pending: false, nowMs: NOW, recent: [] }).action).toBe('ignore')
    const first = decideAnswer({ speakerId: 'unit', text: 'what is the help desk phone?', assistant: true, active: state.active, pending: false, nowMs: NOW, recent: [] })
    expect(first.action).toBe('answer')
    const second = decideAnswer({ speakerId: 'unit', text: 'what is the help desk phone?', assistant: true, active: state.active, pending: false, nowMs: NOW, recent: ['what is the help desk phone'] })
    expect(second.action).toBe('ignore')
  })

  it('holds speech while the channel is busy', () => {
    const queue = new SpeechQueue('sanket-assistant')
    queue.floorId = 'someone-else'
    expect(queue.push({ id: '1', text: 'answer' })).toBe('queued')
    expect(queue.next()).toBeNull()
    queue.floorId = null
    expect(queue.next()?.text).toBe('answer')
  })

  it('shows removed numbered facts in the diff', () => {
    const diff = diffLines(FACT, 'Help desk phone: +91 40 0000 0000')
    expect(diff.some((line) => line.op === '-' && line.text.includes(PHONE))).toBe(true)
  })
})

describe('guide', () => {
  it('explains drafts, forwards, and empty review dates', () => {
    const text = GUIDE.join(' ')
    expect(text).toMatch(/Forward to knowledge/)
    expect(text).toMatch(/Leave review due and valid until empty/)
    expect(text).toMatch(/Digits are not inferred/)
    expect(text).not.toMatch(/every \d+ days/i)
  })
})
