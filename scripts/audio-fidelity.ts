import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { buildWav, downsampleToPcm } from '../src/lib/audio.ts'
import { SAMPLE_RATE } from '../src/lib/constants.ts'
import { chirp, legacyPlayAt, measurePlaced, moderateArrivalTimes, silenceRuns, type ScheduledChunk } from '../src/lib/playback.ts'
import { Radio } from '../src/lib/radio.ts'
import { RelayWire } from '../src/lib/relay-transport.ts'
import { createApp } from '../server/app.ts'
import { loadConfig } from '../server/config.ts'

function split(pcm: Int16Array, size: number): Int16Array[] {
  const out: Int16Array[] = []
  for (let i = 0; i < pcm.length; i += size) out.push(pcm.subarray(i, Math.min(pcm.length, i + size)))
  return out
}

function legacyPlace(chunks: Int16Array[], times: number[], rate: number) {
  let playAt = 0
  const placed: ScheduledChunk[] = []
  for (let i = 0; i < chunks.length; i++) {
    const now = times[i] ?? 0
    const pcm = chunks[i]!
    playAt = legacyPlayAt(playAt, now)
    const duration = pcm.length / rate
    placed.push({ pcm, start: playAt, duration })
    playAt += duration
  }
  return measurePlaced(chunks, placed, rate)
}

function capture48k(seconds: number): Float32Array {
  const rate = 48_000
  const n = Math.round(seconds * rate)
  const out = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const t = i / rate
    const f = 220 + 900 * (t / seconds)
    out[i] = Math.sin(2 * Math.PI * (220 * t + (900 * t * t) / (2 * seconds))) * 0.6
    void f
  }
  return out
}

function browserChunks(input: Float32Array, inRate: number): Int16Array[] {
  const out: Int16Array[] = []
  for (let i = 0; i < input.length; i += 4096) {
    const pcm = downsampleToPcm(input.subarray(i, Math.min(input.length, i + 4096)), inRate)
    if (pcm.length) out.push(pcm)
  }
  return out
}

async function relayRoundTrip(base: string, chunks: Int16Array[], root: string): Promise<Int16Array[]> {
  const got: Int16Array[] = []
  let senderOnline = false
  let receiverOnline = false
  const sender = new Radio(new RelayWire(base), root, {
    state: () => undefined,
    audio: () => undefined,
    boundary: () => undefined,
    net: (state) => {
      senderOnline = state.state === 'online'
    },
    lost: () => undefined,
    notice: () => undefined,
  }, 'send01')
  const receiver = new Radio(new RelayWire(base), root, {
    state: () => undefined,
    audio: (pcm) => got.push(new Int16Array(pcm)),
    boundary: () => undefined,
    net: (state) => {
      receiverOnline = state.state === 'online'
    },
    lost: () => undefined,
    notice: () => undefined,
  }, 'recv01')
  sender.start('Sender')
  receiver.start('Receiver')
  const deadline = Date.now() + 8_000
  while ((!senderOnline || !receiverOnline) && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 30))
  if (!senderOnline || !receiverOnline) throw new Error('relay did not connect')
  const claimed = await new Promise<boolean>((resolve) => sender.claim(resolve))
  if (!claimed) throw new Error('floor was not claimed')
  const chunkDur = (chunks[0]?.length ?? 960) / SAMPLE_RATE
  const times = moderateArrivalTimes(chunks.length, chunkDur)
  const started = Date.now()
  for (let i = 0; i < chunks.length; i++) {
    const wait = started + (times[i] ?? 0) * 1000 - Date.now()
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait))
    sender.sendAudio(chunks[i]!)
  }
  const end = Date.now() + 2_000
  while (got.length < chunks.length && Date.now() < end) await new Promise((resolve) => setTimeout(resolve, 20))
  sender.stop()
  receiver.stop()
  return got
}

function concat(chunks: Int16Array[]): Int16Array {
  let n = 0
  for (const chunk of chunks) n += chunk.length
  const out = new Int16Array(n)
  let offset = 0
  for (const chunk of chunks) {
    out.set(chunk, offset)
    offset += chunk.length
  }
  return out
}

const outDir = '/opt/cursor/artifacts'
const seconds = 10
const sent = chirp(seconds)
const chunks = split(sent, 960)
const times = moderateArrivalTimes(chunks.length, 960 / SAMPLE_RATE)
const before = legacyPlace(chunks, times, SAMPLE_RATE)
const beforeQuiet = silenceRuns(before.received, SAMPLE_RATE)
const captured = browserChunks(capture48k(seconds), 48_000)
const capturedSamples = captured.reduce((sum, chunk) => sum + chunk.length, 0)
const sourceSamples = Math.round(seconds * SAMPLE_RATE)

const dir = await mkdtemp(path.join(tmpdir(), 'sanket-fidelity-'))
const app = createApp({
  config: loadConfig({ DATA_DIR: dir, HOST: '127.0.0.1', ADMIN_TOKEN: 'a', REVIEWER_TOKEN: 'b', INGEST_TOKEN: 'c' }),
  log: () => undefined,
})
await app.listen(0, '127.0.0.1')
const base = `http://127.0.0.1:${app.port()}`
const receivedChunks = await relayRoundTrip(base, chunks, 'sanket-ptt/v1/fidelity-local/')
await app.close()
const received = concat(receivedChunks)
const afterQuiet = silenceRuns(received, SAMPLE_RATE)

await writeFile(path.join(outDir, 'sender-chirp.wav'), Buffer.from(buildWav([sent], SAMPLE_RATE)))
await writeFile(path.join(outDir, 'receiver-chirp.wav'), Buffer.from(buildWav([received.length ? received : new Int16Array([0])], SAMPLE_RATE)))
await writeFile(path.join(outDir, 'sender-48k-downsampled.wav'), Buffer.from(buildWav(captured, SAMPLE_RATE)))

let speechNote = 'espeak not used'
const speech = spawnSync('espeak-ng', ['-v', 'en-us', '-w', path.join(outDir, 'sender-speech.wav'), 'The practice desk is down the hall and the line stays open.'])
if (speech.status === 0) speechNote = 'espeak wav written'

let live = 'not run'
try {
  const liveGot = await relayRoundTrip('https://ptt.bowlinger.net', chunks.slice(0, 20), `sanket-ptt/v1/fidelity-${Date.now().toString(36)}/`)
  live = `connected, received ${liveGot.length} of 20 chunks, samples ${concat(liveGot).length}`
} catch (error) {
  live = error instanceof Error ? error.message : 'live relay failed'
}

const report = {
  before: { ratio: before.ratio, gapCount: before.gapCount, gapMs: before.gapMs, maxGapMs: before.maxGapMs, silenceMaxMs: beforeQuiet.maxMs },
  afterRelay: {
    sentSamples: sent.length,
    receivedSamples: received.length,
    ratio: received.length / sent.length,
    chunks: receivedChunks.length,
    silence: afterQuiet,
  },
  capture48k: { sourceSamples, capturedSamples, ratio: capturedSamples / sourceSamples },
  speechNote,
  live,
}
console.log(JSON.stringify(report, null, 2))

const py = spawnSync('python3', ['/tmp/wave-compare.py'], { encoding: 'utf8' })
console.log(py.stdout)
if (py.stderr) console.log(py.stderr)
