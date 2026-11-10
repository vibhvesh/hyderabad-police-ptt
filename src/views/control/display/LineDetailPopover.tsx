import { voiceBadge, type VoiceChoice } from '@/lib/voice-choice'

export function LineDetailPopover({
  id,
  name,
  speaker,
  left,
  phones,
  handsets,
  devices,
  messages,
  today,
  lastActivity,
  tts,
  warning,
  onEnter,
  onLeave,
}: {
  id: string
  name: string
  speaker: string | null
  left: number | null
  phones: string[]
  handsets: string[]
  devices: string[]
  messages: Array<{ id: string; speaker: string; transcript: string | null; translation: string | null }>
  today: number
  lastActivity: string | null
  tts?: VoiceChoice
  warning: string | null
  onEnter: () => void
  onLeave: () => void
}) {
  return (
    <aside className="db-popover" role="dialog" aria-label={`${name} detail`} onMouseEnter={onEnter} onMouseLeave={onLeave}>
      <h3>{name}</h3>
      <p>Channel {id}</p>
      <p>{speaker ? `${speaker} holds the floor${left == null ? '' : ` · ${left}s left`}` : 'Nobody is talking'}</p>
      <p>{phones.length} phones{phones.length ? `: ${phones.join(', ')}` : ''}</p>
      <p>{handsets.length} handsets{handsets.length ? `: ${handsets.join(', ')}` : ''}</p>
      {devices.length ? <p>Enrolled: {devices.join(', ')}</p> : null}
      <p>{today} messages today{lastActivity ? ` · last ${lastActivity}` : ''}</p>
      <p><span className="db-badge">{voiceBadge(tts)}</span></p>
      {warning ? <p className="db-warn">{warning}</p> : null}
      <ul>
        {messages.length === 0 ? <li>No messages yet.</li> : null}
        {messages.map((message) => (
          <li key={message.id}>
            <strong>{message.speaker}: </strong>
            {message.transcript ?? 'No transcript'}
            {message.translation ? ` — ${message.translation}` : ''}
          </li>
        ))}
      </ul>
      <a href={`#/control/connections/${encodeURIComponent(id)}`}>Open connections</a>
    </aside>
  )
}
