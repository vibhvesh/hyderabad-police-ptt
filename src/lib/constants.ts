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

export const CHANNEL_LABEL = 'HYD-1'
export const TOPIC_ROOT = 'hyd-police-ptt/demo1/hyd-1/'

export const BROKERS = [
  'wss://broker.hivemq.com:8884/mqtt',
  'wss://broker.emqx.io:8084/mqtt',
  'wss://test.mosquitto.org:8081',
  'wss://public:public@public.cloud.shiftr.io',
]

export const WHISPER_MODEL = 'onnx-community/whisper-base'
export const ELEVEN_MODEL = 'scribe_v1'
