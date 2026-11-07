/** 12 kHz 16-bit PCM keeps each MQTT packet small on public brokers. */
export const SAMPLE_RATE = 12_000

/** Audio kept before the button press so the first syllable is not cut off. */
export const PRE_ROLL_MS = 450

/** Audio kept after release so the last syllable is not cut off. */
export const TAIL_MS = 350

/** How long two claim messages may race before the earlier one wins. */
export const CLAIM_GRACE_MS = 450

export const FLOOR_TIMEOUT_MS = 2_500
export const PRESENCE_BEAT_MS = 5_000
export const PRESENCE_EXPIRE_MS = 15_000
export const CLIP_GAP_MS = 1_200
export const MAX_CLIP_MS = 60_000

export const CHANNEL_LABEL = 'SANKET-1'
export const TOPIC_ROOT = 'sanket-ptt/v1/sanket-1/'
export const PRODUCT = 'Sanket PTT'
export const TRANSCRIBE_PRODUCT = 'Sanket Transcribe'
export const DISCLAIMER = 'Demo only, not for professional use'

export { DEFAULT_BROKERS as BROKERS, DEFAULT_TOPIC_ROOT, LEGACY_TOPIC_ROOT } from './net.ts'

/** Tiny quantized Whisper fits a phone. Larger Whisper models are not downloaded. */
export const WHISPER_MODEL = 'onnx-community/whisper-tiny'
export const SCRIBE_BATCH_MODEL = 'scribe_v2'
export const SCRIBE_REALTIME_MODEL = 'scribe_v2_realtime'
