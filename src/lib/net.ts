/** Public WebSocket brokers. Mosquitto's WSS port currently hangs up, so it is not in the default list. */
export const DEFAULT_BROKERS = [
  'wss://broker.hivemq.com:8884/mqtt',
  'wss://broker.emqx.io:8084/mqtt',
  'wss://public.cloud.shiftr.io',
] as const

/** Shiftr publishes this username and password for its public demo namespace. */
export const SHIFTR_PUBLIC_USER = 'public'
export const SHIFTR_PUBLIC_PASSWORD = 'public'

export const DEFAULT_TOPIC_ROOT = 'sanket-ptt/v1/sanket-1/'
export const LEGACY_TOPIC_ROOT = 'hyd-police-ptt/demo1/hyd-1/'
export const TOPIC_PREFIXES = ['sanket-ptt/v1/', 'hyd-police-ptt/demo1/']

export function retryDelayMs(attempt: number): number {
  const exp = Math.min(6, Math.max(0, attempt))
  return Math.min(15_000, 500 * 2 ** exp)
}

/** A short session rotates to the next broker. A session that stayed up retries the same one. */
export function nextBrokerIndex(current: number, count: number, sessionMs: number): number {
  if (count <= 1) return 0
  const index = ((current % count) + count) % count
  if (sessionMs >= 20_000) return index
  return (index + 1) % count
}

export function redactUrl(raw: string): string {
  try {
    const normalized = raw.replace(/^[a-z0-9+.-]+:\/\//i, (scheme) => {
      if (scheme === 'wss://' || scheme === 'mqtts://') return 'https://'
      if (scheme === 'ws://' || scheme === 'mqtt://') return 'http://'
      return scheme
    })
    const url = new URL(normalized)
    const secure = raw.startsWith('wss:') || raw.startsWith('mqtts:') || raw.startsWith('https:')
    const proto = secure ? 'wss' : 'ws'
    return `${proto}://${url.host}${url.pathname}`
  } catch {
    return 'relay'
  }
}

export function publicHost(raw: string): string {
  const safe = redactUrl(raw)
  try {
    return new URL(safe.replace(/^wss:/, 'https:').replace(/^ws:/, 'http:')).host
  } catch {
    return 'relay'
  }
}

export type MqttTarget =
  | { ok: true; url: string; username?: string; password?: string }
  | { ok: false; error: string }

/** Browsers reject userinfo in a WebSocket URL, so credentials move to the MQTT CONNECT packet. */
export function mqttTarget(raw: string): MqttTarget {
  const trimmed = raw.trim()
  if (!/^wss:\/\//i.test(trimmed)) return { ok: false, error: 'Broker URL must start with wss://' }
  let url: URL
  try {
    url = new URL(trimmed)
  } catch {
    return { ok: false, error: 'Broker URL is not valid' }
  }
  const username = url.username ? decodeURIComponent(url.username) : undefined
  const password = url.password ? decodeURIComponent(url.password) : undefined
  url.username = ''
  url.password = ''
  const target: MqttTarget = { ok: true, url: url.toString() }
  if (!target.ok) return target
  if (username) target.username = username
  if (password) target.password = password
  if (url.host === 'public.cloud.shiftr.io' && !target.username) {
    target.username = SHIFTR_PUBLIC_USER
    target.password = SHIFTR_PUBLIC_PASSWORD
  }
  return target
}

function hasControlChar(value: string): boolean {
  for (let i = 0; i < value.length; i++) if (value.charCodeAt(i) === 0) return true
  return false
}

export function topicAllowed(topic: string, prefixes = TOPIC_PREFIXES): boolean {
  if (topic.length < 3 || topic.length > 180) return false
  if (topic.includes('#') || topic.includes('+') || hasControlChar(topic)) return false
  if (topic.includes('..')) return false
  return prefixes.some((prefix) => topic.startsWith(prefix))
}

export function safeTopicRoot(value: string): string | null {
  const root = value.trim()
  if (!/^[a-z0-9][a-z0-9/_-]{0,100}\/$/.test(root)) return null
  if (root.includes('..') || root.includes('+') || root.includes('#')) return null
  return root
}
