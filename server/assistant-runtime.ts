import { ASSISTANT_ID, ASSISTANT_NAME, decideAnswer, SpeechQueue, type AnswerDecision } from '../src/lib/assistant.ts'
import { questionKey } from '../src/lib/questions.ts'
import { encodeAudio, encodeNotice } from '../src/lib/packets.ts'
import { safeTopicRoot } from '../src/lib/net.ts'
import type { KbStore } from './store.ts'
import type { Relay } from './relay.ts'
import type { TtsProvider } from './providers.ts'

export class AssistantRuntime {
  private queues = new Map<string, SpeechQueue>()
  private recent = new Map<string, string[]>()
  private roots = new Map<string, string>()
  private citations = new Map<string, string | null>()
  private relay: Relay
  private store: KbStore
  private tts: TtsProvider
  private now: () => number

  constructor(relay: Relay, store: KbStore, tts: TtsProvider, now: () => number) {
    this.relay = relay
    this.store = store
    this.tts = tts
    this.now = now
    this.relay.tap = (topic, payload) => this.observe(topic, payload)
  }

  async answer(channel: string, speakerId: string, text: string, topicRoot: string): Promise<AnswerDecision & { channelDelivery: 'relay' | 'none' }> {
    const root = safeTopicRoot(topicRoot) ?? `sanket-ptt/v1/${channel}/`
    this.roots.set(channel, root)
    const state = await this.store.read(channel)
    const recent = this.recent.get(channel) ?? []
    const decision = decideAnswer({
      speakerId,
      text,
      assistant: state.assistant,
      active: state.active,
      pending: state.proposals.some((item) => item.state === 'open'),
      nowMs: this.now(),
      recent,
    })
    if (decision.action === 'ignore' || decision.action === 'silent') {
      return { ...decision, channelDelivery: 'none' }
    }
    const key = questionKey(text)
    if (decision.action === 'answer' && key) this.recent.set(channel, [...recent, key].slice(-20))
    const spoken = decision.action === 'answer' ? decision.text : decision.message
    const citation =
      decision.action === 'answer'
        ? `${state.active?.filename ?? 'reference'} version ${decision.version} lines ${decision.lines}, reviewed by ${decision.reviewer}`
        : null
    const id = key || crypto.randomUUID()
    this.citations.set(id, citation)
    this.queue(channel).push({ id, text: spoken })
    await this.pump(channel)
    return { ...decision, channelDelivery: 'relay' }
  }

  private queue(channel: string): SpeechQueue {
    let queue = this.queues.get(channel)
    if (!queue) {
      queue = new SpeechQueue(ASSISTANT_ID)
      this.queues.set(channel, queue)
    }
    return queue
  }

  private observe(topic: string, payload: Uint8Array) {
    if (!topic.endsWith('/floor')) return
    const root = topic.slice(0, -'floor'.length)
    let queue: SpeechQueue | undefined
    for (const [channel, known] of this.roots) {
      if (known === root) queue = this.queue(channel)
    }
    if (!queue) return
    try {
      const msg = JSON.parse(new TextDecoder().decode(payload)) as { t?: string; id?: string }
      if (msg.t === 'release' && queue.floorId === msg.id) queue.floorId = null
      else if ((msg.t === 'claim' || msg.t === 'hb') && msg.id) queue.floorId = msg.id
      const channel = this.channelFor(root)
      if (channel && queue.floorId === null) void this.pump(channel)
    } catch {
      return
    }
  }

  private channelFor(root: string): string | null {
    for (const [channel, known] of this.roots) if (known === root) return channel
    return null
  }

  private async pump(channel: string) {
    const queue = this.queue(channel)
    const job = queue.next()
    if (!job) return
    const text = job.text
    const citation = this.citations.get(job.id) ?? null
    const root = this.roots.get(channel) ?? `sanket-ptt/v1/${channel}/`
    const answerId = job.id
    const pcm = await this.tts.speak(text)
    if (pcm && pcm.length) {
      const ts = this.now()
      this.relay.publish(root + 'floor', JSON.stringify({ t: 'claim', id: ASSISTANT_ID, name: ASSISTANT_NAME, ts }))
      const frame = encodeAudio(ASSISTANT_ID, pcm)
      if (frame) this.relay.publish(root + 'audio', frame)
      this.relay.publish(root + 'floor', JSON.stringify({ t: 'release', id: ASSISTANT_ID, name: ASSISTANT_NAME, ts: this.now() }))
    }
    this.relay.publish(
      root + 'notice',
      encodeNotice({ id: ASSISTANT_ID, name: ASSISTANT_NAME, text, answerId, citation }),
    )
    queue.done()
    this.citations.delete(job.id)
    if (queue.floorId === null || queue.floorId === ASSISTANT_ID) await this.pump(channel)
  }
}
