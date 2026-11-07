import { SAMPLE_RATE } from './constants.ts'
import { rms } from './audio.ts'
import type { LangId } from './types.ts'

export type CaptionDirection = 'tx' | 'rx'

export type CaptionJob = {
  messageId: string
  direction: CaptionDirection
  speakerId: string
  selfId: string
  sourceLang: LangId
  targetLang: LangId
  pcm: Int16Array
  wav?: ArrayBuffer
}

export type CaptionPatch = {
  phase: 'transcribing' | 'translating' | 'done' | 'error'
  pending: boolean
  transcript: string | null
  translation: string | null
  translationNote: string | null
  error: string | null
  via?: 'device' | 'scribe'
}

export type TranscriptResult = { text: string; via: 'device' | 'scribe' }

export type TranslationResult = {
  text: string
  note: string
  state: 'translated' | 'same' | 'error'
}

type RejectReason = 'echo' | 'duplicate' | 'short' | 'silence'

export function acceptCaption(job: Pick<CaptionJob, 'messageId' | 'direction' | 'speakerId' | 'selfId' | 'pcm'>, seen: ReadonlySet<string>): { ok: true } | { ok: false; reason: RejectReason } {
  if (seen.has(job.messageId)) return { ok: false, reason: 'duplicate' }
  if (job.direction === 'rx' && job.speakerId && job.speakerId === job.selfId) return { ok: false, reason: 'echo' }
  if (job.pcm.length < SAMPLE_RATE * 0.25) return { ok: false, reason: 'short' }
  if (rms(job.pcm) < 0.01) return { ok: false, reason: 'silence' }
  return { ok: true }
}

export class CaptionQueue {
  private seen = new Set<string>()
  private pending: CaptionJob[] = []
  private running = false
  private handlers: {
    transcribe: (job: CaptionJob) => Promise<TranscriptResult>
    translate: (text: string, source: LangId, target: LangId) => Promise<TranslationResult>
    onUpdate: (messageId: string, patch: CaptionPatch, job: CaptionJob) => void
  }

  constructor(handlers: {
    transcribe: (job: CaptionJob) => Promise<TranscriptResult>
    translate: (text: string, source: LangId, target: LangId) => Promise<TranslationResult>
    onUpdate: (messageId: string, patch: CaptionPatch, job: CaptionJob) => void
  }) {
    this.handlers = handlers
  }

  enqueue(job: CaptionJob) {
    const decision = acceptCaption(job, this.seen)
    if (!decision.ok) {
      if (decision.reason === 'duplicate') return
      const note =
        decision.reason === 'echo'
          ? 'Skipped. This device already transcribes outgoing audio, so the returning copy is not transcribed again.'
          : 'No speech detected'
      this.handlers.onUpdate(job.messageId, {
        phase: 'done',
        pending: false,
        transcript: decision.reason === 'echo' ? null : 'No speech detected',
        translation: null,
        translationNote: note,
        error: null,
      }, job)
      return
    }
    this.seen.add(job.messageId)
    this.pending.push({ ...job, pcm: new Int16Array(job.pcm) })
    void this.pump()
  }

  private async pump() {
    if (this.running) return
    this.running = true
    while (this.pending.length > 0) {
      const job = this.pending.shift()
      if (!job) break
      await this.run(job)
    }
    this.running = false
  }

  private async run(job: CaptionJob) {
    this.handlers.onUpdate(job.messageId, empty('transcribing', true), job)
    let transcript: TranscriptResult
    try {
      transcript = await this.handlers.transcribe(job)
    } catch (error) {
      this.handlers.onUpdate(job.messageId, {
        phase: 'error',
        pending: false,
        transcript: null,
        translation: null,
        translationNote: null,
        error: error instanceof Error ? error.message : 'Transcription failed',
      }, job)
      return
    }
    this.handlers.onUpdate(job.messageId, {
      ...empty('translating', true),
      transcript: transcript.text,
      via: transcript.via,
    }, job)
    try {
      const translated = await this.handlers.translate(transcript.text, job.sourceLang, job.targetLang)
      this.handlers.onUpdate(job.messageId, {
        phase: 'done',
        pending: false,
        transcript: transcript.text,
        translation: translated.state === 'translated' ? translated.text : null,
        translationNote: translated.note,
        error: translated.state === 'error' ? translated.note : null,
        via: transcript.via,
      }, job)
    } catch (error) {
      this.handlers.onUpdate(job.messageId, {
        phase: 'done',
        pending: false,
        transcript: transcript.text,
        translation: null,
        translationNote: error instanceof Error ? error.message : 'Translation failed',
        error: null,
        via: transcript.via,
      }, job)
    }
  }
}

function empty(phase: CaptionPatch['phase'], pending: boolean): CaptionPatch {
  return { phase, pending, transcript: null, translation: null, translationNote: null, error: null }
}
