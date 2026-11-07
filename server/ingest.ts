import { emailBlock, externalBlock, forwardBlock, isOwnLoop, voiceBlock } from '../src/lib/blocks.ts'
import { parseEml } from '../src/lib/eml.ts'
import {
  addProposal,
  normalizeForHash,
  safeFilename,
  type ChannelState,
  type Provenance,
} from '../src/lib/kb.ts'
import { sha256 } from './hash.ts'

export type IngestResult = { status: number; body: Record<string, unknown>; save?: ChannelState }

function actorOf(value: unknown, fallback: string): string {
  const text = typeof value === 'string' && value.trim() ? value.trim() : fallback
  return [...text.slice(0, 40)].filter((char) => char.charCodeAt(0) > 31).join('')
}

function finish(result: ReturnType<typeof addProposal>): IngestResult {
  if ('error' in result) return { status: 400, body: { error: result.error, message: result.message } }
  if ('duplicate' in result) return { status: 409, body: { status: 'duplicate', id: result.id, message: 'That update is already filed.' } }
  return { status: 201, body: { status: 'created', id: result.proposal.id }, save: result.state }
}

function baseProvenance(partial: Omit<Provenance, 'contentHash'> & { material: string }): Provenance {
  const { material, ...rest } = partial
  return { ...rest, contentHash: sha256(normalizeForHash(material)) }
}

export function ingestJson(state: ChannelState, body: Record<string, unknown>, nowIso: string, channel: string): IngestResult {
  if (isOwnLoop(body.sourceService)) {
    return { status: 409, body: { status: 'duplicate', message: 'Ignored an event that came from this service.' } }
  }
  const origin = body.origin
  const actor = actorOf(body.actor, 'administrator')
  if (origin === 'admin-text') {
    const text = typeof body.text === 'string' ? body.text : ''
    const mode = body.mode === 'append' ? 'append' : 'replace'
    return finish(addProposal(state, {
        id: crypto.randomUUID(),
        nowIso,
        filename: safeFilename(typeof body.filename === 'string' ? body.filename : 'reference.txt'),
        mode,
        block: text,
        provenance: baseProvenance({
          origin: 'admin-text',
          sourceLabel: 'Administrator text',
          actor,
          receivedAt: nowIso,
          eventAt: null,
          externalId: null,
          transcript: null,
          correctedTranscript: null,
          material: text,
        }),
      }),
    )
  }
  if (origin === 'voice') {
    if (body.autofix === true || body.inferDigits === true) {
      return { status: 400, body: { error: 'digits', message: 'Digits are not inferred or corrected automatically.' } }
    }
    if (body.transcriptConfirmed !== true) {
      return {
        status: 400,
        body: { error: 'confirm_transcript', message: 'Confirm that you checked numbers and frequencies before filing the voice draft.' },
      }
    }
    const asr = typeof body.asrTranscript === 'string' ? body.asrTranscript : ''
    const corrected = typeof body.text === 'string' ? body.text : ''
    if (!corrected.trim()) return { status: 400, body: { error: 'empty', message: 'Correct the transcript before filing a draft.' } }
    return finish(addProposal(state, {
        id: crypto.randomUUID(),
        nowIso,
        filename: state.active?.filename ?? 'reference.txt',
        mode: 'append',
        block: voiceBlock(corrected),
        provenance: baseProvenance({
          origin: 'voice',
          sourceLabel: 'Administrator voice',
          actor,
          receivedAt: nowIso,
          eventAt: nowIso,
          externalId: null,
          transcript: asr,
          correctedTranscript: corrected,
          material: corrected,
        }),
      }),
    )
  }
  if (origin === 'forward') {
    const transcript = typeof body.transcript === 'string' ? body.transcript : ''
    const messageKey = typeof body.messageKey === 'string' ? body.messageKey.trim() : ''
    const speaker = typeof body.speaker === 'string' ? body.speaker.trim().slice(0, 40) : ''
    const eventAt = typeof body.eventAt === 'string' ? body.eventAt : ''
    if (!messageKey || !speaker || !transcript.trim() || Number.isNaN(Date.parse(eventAt))) {
      return { status: 400, body: { error: 'invalid_forward', message: 'A forward needs the message, speaker, transcript, and time.' } }
    }
    const block = forwardBlock({ speaker, eventAt: new Date(eventAt).toISOString(), channel, transcript })
    return finish(addProposal(state, {
        id: crypto.randomUUID(),
        nowIso,
        filename: state.active?.filename ?? 'reference.txt',
        mode: 'append',
        block,
        provenance: baseProvenance({
          origin: 'forward',
          sourceLabel: `PTT ${speaker}`,
          actor: actorOf(body.actor, 'operator'),
          receivedAt: nowIso,
          eventAt: new Date(eventAt).toISOString(),
          externalId: messageKey.slice(0, 80),
          transcript,
          correctedTranscript: null,
          material: transcript,
        }),
      }),
    )
  }
  if (origin === 'email') {
    const raw = typeof body.raw === 'string' ? body.raw : ''
    const parsed = parseEml(raw)
    if ('error' in parsed) return { status: 400, body: { error: 'email', message: parsed.error } }
    const block = emailBlock(parsed)
    return finish(addProposal(state, {
        id: crypto.randomUUID(),
        nowIso,
        filename: 'email.txt',
        mode: 'append',
        block,
        provenance: baseProvenance({
          origin: 'email',
          sourceLabel: parsed.from,
          actor,
          receivedAt: nowIso,
          eventAt: parsed.date && !Number.isNaN(Date.parse(parsed.date)) ? new Date(parsed.date).toISOString() : null,
          externalId: parsed.messageId,
          transcript: null,
          correctedTranscript: null,
          material: parsed.body,
        }),
      }),
    )
  }
  return { status: 400, body: { error: 'origin', message: 'The draft origin is not supported.' } }
}

export function ingestFile(state: ChannelState, filename: string, raw: string, nowIso: string, actorName: string): IngestResult {
  const safe = safeFilename(filename)
  if (safe.toLowerCase().endsWith('.eml')) return ingestJson(state, { origin: 'email', raw, actor: actorName }, nowIso, state.channel)
  if (!/\.(txt|md|csv|log)$/i.test(safe)) {
    return { status: 415, body: { error: 'unsupported', message: 'Upload plain text, Markdown, CSV, or a .eml file. PDF and Word are not parsed.' } }
  }
  return finish(addProposal(state, {
      id: crypto.randomUUID(),
      nowIso,
      filename: safe,
      mode: 'replace',
      block: raw,
      provenance: baseProvenance({
        origin: 'upload',
        sourceLabel: safe,
        actor: actorName,
        receivedAt: nowIso,
        eventAt: null,
        externalId: null,
        transcript: null,
        correctedTranscript: null,
        material: raw,
      }),
    }),
  )
}

export function ingestExternal(
  state: ChannelState,
  input: { origin: 'webhook' | 'fetch'; sourceLabel: string; text: string; eventAt: string | null; externalId: string | null; actor: string; mode: 'append' | 'replace'; nowIso: string },
): IngestResult {
  const block = externalBlock({ sourceLabel: input.sourceLabel, eventAt: input.eventAt, text: input.text })
  return finish(addProposal(state, {
      id: crypto.randomUUID(),
      nowIso: input.nowIso,
      filename: state.active?.filename ?? 'reference.txt',
      mode: input.mode,
      block,
      provenance: baseProvenance({
        origin: input.origin,
        sourceLabel: input.sourceLabel,
        actor: input.actor,
        receivedAt: input.nowIso,
        eventAt: input.eventAt,
        externalId: input.externalId,
        transcript: null,
        correctedTranscript: null,
        material: input.text,
      }),
    }),
  )
}
