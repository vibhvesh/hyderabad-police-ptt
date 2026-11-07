import { describe, expect, it } from 'vitest'
import { acceptCaption, CaptionQueue, type CaptionJob } from '../src/lib/caption-queue.ts'
import { scribeRequest } from '../src/lib/scribe-client.ts'
import { translationPlan } from '../src/lib/translation-plan.ts'
import { applyLanguagePrefix } from '../src/lib/marian-prefix.ts'

function speech(samples = 4_000): Int16Array {
  const pcm = new Int16Array(samples)
  pcm.fill(8_000)
  return pcm
}

function job(overrides: Partial<CaptionJob> = {}): CaptionJob {
  return {
    messageId: 'msg-1',
    direction: 'tx',
    speakerId: 'self',
    selfId: 'self',
    sourceLang: 'te',
    targetLang: 'en',
    pcm: speech(),
    ...overrides,
  }
}

describe('live caption queue', () => {
  it('transcribes outgoing and incoming clips into original text plus a translation', async () => {
    const updates: Array<{ id: string; phase: string; transcript: string | null; translation: string | null }> = []
    const seen: string[] = []
    const queue = new CaptionQueue({
      transcribe: async (item) => {
        seen.push(`${item.direction}:${item.messageId}:${item.sourceLang}`)
        return { text: item.direction === 'tx' ? 'నమస్కారం' : 'hello desk', via: 'device' }
      },
      translate: async (text, source, target) => {
        seen.push(`mt:${source}:${target}:${text}`)
        return { text: `${text} -> ${target}`, note: 'device', state: 'translated' }
      },
      onUpdate: (id, patch) => updates.push({ id, phase: patch.phase, transcript: patch.transcript, translation: patch.translation }),
    })
    queue.enqueue(job())
    queue.enqueue(job({ messageId: 'msg-2', direction: 'rx', speakerId: 'other', sourceLang: 'hi', targetLang: 'te' }))
    await viWait()
    expect(seen).toEqual(['tx:msg-1:te', 'mt:te:en:నమస్కారం', 'rx:msg-2:hi', 'mt:hi:te:hello desk'])
    expect(updates.filter((item) => item.phase === 'done')).toEqual([
      { id: 'msg-1', phase: 'done', transcript: 'నమస్కారం', translation: 'నమస్కారం -> en' },
      { id: 'msg-2', phase: 'done', transcript: 'hello desk', translation: 'hello desk -> te' },
    ])
  })

  it('does not transcribe an echo of the outgoing clip or the same message twice', async () => {
    let calls = 0
    const notes: string[] = []
    const queue = new CaptionQueue({
      transcribe: async () => {
        calls += 1
        return { text: 'once', via: 'device' }
      },
      translate: async () => ({ text: 'translated', note: 'device', state: 'translated' }),
      onUpdate: (_id, patch) => {
        if (patch.translationNote) notes.push(patch.translationNote)
      },
    })
    queue.enqueue(job({ messageId: 'echo', direction: 'rx', speakerId: 'self', selfId: 'self' }))
    queue.enqueue(job({ messageId: 'keep' }))
    queue.enqueue(job({ messageId: 'keep' }))
    await viWait()
    expect(calls).toBe(1)
    expect(notes.some((note) => note.includes('returning copy'))).toBe(true)
    expect(acceptCaption(job({ direction: 'rx', speakerId: 'self' }), new Set()).ok).toBe(false)
  })

  it('keeps the next clip moving when one transcription fails', async () => {
    const done: string[] = []
    const queue = new CaptionQueue({
      transcribe: async (item) => {
        if (item.messageId === 'bad') throw new Error('model failed')
        return { text: 'second', via: 'device' }
      },
      translate: async (text) => ({ text, note: 'same', state: 'same' }),
      onUpdate: (id, patch) => {
        if (patch.phase === 'done' || patch.phase === 'error') done.push(`${id}:${patch.phase}:${patch.error ?? patch.transcript}`)
      },
    })
    queue.enqueue(job({ messageId: 'bad' }))
    queue.enqueue(job({ messageId: 'good' }))
    await viWait()
    expect(done).toEqual(['bad:error:model failed', 'good:done:second'])
  })
})

describe('translation routes', () => {
  it('names a real on-device model for every Telugu, Hindi, and English pair', () => {
    const pairs = ['te', 'en', 'hi'] as const
    for (const source of pairs) {
      for (const target of pairs) {
        const plan = translationPlan(source, target)
        if (source === target) expect(plan.kind).toBe('same')
        else {
          expect(plan.kind).toBe('translate')
          expect(plan.hops.length).toBeGreaterThan(0)
          expect(plan.hops.every((hop) => hop.model.startsWith('Xenova/opus-mt-'))).toBe(true)
          expect(plan.note.toLowerCase()).toContain('device')
        }
      }
    }
    expect(translationPlan('en', 'te').hops[0]?.prefix).toBe('>>tel<<')
    expect(translationPlan('hi', 'te').note).toContain('through English')
  })
})

describe('marian language token', () => {
  it('keeps the Telugu language marker as one token id', () => {
    const encoded: string[] = []
    const tokenizer = {
      convert_tokens_to_ids: (token: string) => (token === '>>tel<<' ? 851 : null),
      _encode_plus: (text: string) => {
        encoded.push(text)
        return { input_ids: [5, 0], attention_mask: [1, 1] }
      },
    }
    applyLanguagePrefix(tokenizer)
    const result = tokenizer._encode_plus('>>tel<< The desk is down the hall.')
    expect(encoded).toEqual(['The desk is down the hall.'])
    expect(result.input_ids).toEqual([851, 5, 0])
  })
})

describe('scribe client request', () => {
  it('sends the clip to this server and does not attach an API key', () => {
    const request = scribeRequest('batch', new ArrayBuffer(8), 'hi')
    const headers = request.init.headers as Record<string, string>
    expect(request.url).toBe('/api/speech/scribe')
    expect(headers['xi-api-key']).toBeUndefined()
    expect(headers.authorization).toBeUndefined()
    expect(headers['x-cloud-consent']).toBe('yes')
    expect(JSON.stringify(request).includes('sk_')).toBe(false)
    const realtime = scribeRequest('realtime')
    expect(realtime.url).toBe('/api/speech/scribe-token')
    expect(String(realtime.init.body)).toContain('scribe_v2_realtime')
  })
})

function viWait() {
  return new Promise((resolve) => setTimeout(resolve, 0))
}
