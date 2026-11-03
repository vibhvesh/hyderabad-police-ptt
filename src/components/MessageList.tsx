import { useEffect, useRef, useState } from 'react'
import { Play, Square } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { formatClock, formatDur, formatLoc } from '@/lib/format'
import type { ChatMessage } from '@/lib/types'

export function MessageList({ messages }: { messages: ChatMessage[] }) {
  const player = useRef<HTMLAudioElement>(new Audio())
  const [playing, setPlaying] = useState<string | null>(null)

  useEffect(() => {
    const audio = player.current
    return () => audio.pause()
  }, [])

  function toggle(message: ChatMessage) {
    const audio = player.current
    if (playing === message.key) {
      audio.pause()
      setPlaying(null)
      return
    }
    audio.pause()
    audio.src = message.url
    audio.onended = () => setPlaying(null)
    void audio.play().catch(() => setPlaying(null))
    setPlaying(message.key)
  }

  if (messages.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-center text-sm text-slate-600">
        No transmissions yet. Hold the button to talk. Anyone with this link is already on the channel.
      </p>
    )
  }

  return (
    <ul className="flex flex-col gap-3">
      {messages.map((message) => (
        <li key={message.key} className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
          <div className="flex items-center gap-3">
            <Button
              type="button"
              size="icon"
              variant={playing === message.key ? 'secondary' : 'default'}
              className="shrink-0 rounded-full"
              aria-label={playing === message.key ? `Stop ${message.name}` : `Play ${message.name}`}
              onClick={() => toggle(message)}
            >
              {playing === message.key ? <Square className="h-4 w-4" /> : <Play className="h-4 w-4" />}
            </Button>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-slate-900">
                {message.name}
                {message.mine ? ' · you' : ''}
              </p>
              <p className="text-xs text-slate-500">
                {formatClock(message.t0)} · {formatDur(message.dur)}
              </p>
            </div>
          </div>
          <p className="mt-2 text-sm leading-snug text-slate-800">
            {message.pending ? (
              <span className="text-slate-500">Transcribing…</span>
            ) : message.error ? (
              <span className="text-red-700">{message.error}</span>
            ) : (
              message.transcript
            )}
          </p>
          <p className="mt-1 text-xs text-slate-500">{formatLoc(message.loc)}</p>
        </li>
      ))}
    </ul>
  )
}
