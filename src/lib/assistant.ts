import { ground } from './ground.ts'
import { usability, type Approval } from './kb.ts'
import { isExplicitQuestion, questionKey } from './questions.ts'

export const ASSISTANT_ID = 'sanket-assistant'
export const ASSISTANT_NAME = 'Sanket Assistant'

export type AnswerDecision =
  | { action: 'ignore'; reason: 'assistant' | 'not_question' | 'duplicate' | 'assistant_off' }
  | { action: 'unavailable'; message: string }
  | { action: 'silent'; reason: 'not_found' | 'ambiguous'; message: string }
  | { action: 'answer'; text: string; lines: string; version: number; sha256: string; reviewer: string; reviewedAt: string }

export function decideAnswer(input: {
  speakerId: string
  text: string
  assistant: boolean
  active: Approval | null
  pending: boolean
  nowMs: number
  recent: readonly string[]
}): AnswerDecision {
  if (input.speakerId === ASSISTANT_ID) return { action: 'ignore', reason: 'assistant' }
  if (!isExplicitQuestion(input.text)) return { action: 'ignore', reason: 'not_question' }
  const key = questionKey(input.text)
  if (key && input.recent.includes(key)) return { action: 'ignore', reason: 'duplicate' }
  if (!input.assistant) return { action: 'ignore', reason: 'assistant_off' }
  const use = usability(input.active, input.nowMs, input.pending)
  if (use.state !== 'approved' || !input.active) {
    const message = use.state === 'approved' ? 'No approved reference file is available for this channel.' : use.message
    return { action: 'unavailable', message }
  }
  const hit = ground(input.text, input.active.text)
  if (hit.status === 'answer') {
    return {
      action: 'answer',
      text: hit.text,
      lines: hit.lines,
      version: input.active.version,
      sha256: input.active.sha256,
      reviewer: input.active.reviewer,
      reviewedAt: input.active.reviewedAt,
    }
  }
  return { action: 'silent', reason: hit.status, message: hit.message }
}

export type SpeechJob = { id: string; text: string }

export class SpeechQueue {
  floorId: string | null = null
  speaking = false
  private jobs: SpeechJob[] = []

  private selfId: string
  private max: number

  constructor(selfId: string, max = 4) {
    this.selfId = selfId
    this.max = max
  }

  push(job: SpeechJob): 'queued' | 'full' {
    if (this.jobs.some((item) => item.id === job.id)) return 'queued'
    if (this.jobs.length >= this.max) return 'full'
    this.jobs.push(job)
    return 'queued'
  }

  next(): SpeechJob | null {
    const floorFree = this.floorId === null || this.floorId === this.selfId
    if (this.speaking || !floorFree || this.jobs.length === 0) return null
    this.speaking = true
    return this.jobs.shift() ?? null
  }

  done() {
    this.speaking = false
  }
}
