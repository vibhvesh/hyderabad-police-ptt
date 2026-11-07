import { useState } from 'react'
import { Settings } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { DEFAULT_TOPIC_ROOT, LEGACY_TOPIC_ROOT } from '@/lib/net'
import { loadBackend, loadTopic, loadTransport, saveBackend, saveTopic, saveTransport, type TransportMode } from '@/lib/storage'
import type { EngineId } from '@/lib/types'

type Props = {
  name: string
  engine: EngineId
  apiKey: string
  onName: (value: string) => void
  onEngine: (value: EngineId) => void
  onApiKey: (value: string) => void
}

export function SettingsDialog({ name, engine, apiKey, onName, onEngine, onApiKey }: Props) {
  const [transport, setTransport] = useState<TransportMode>(loadTransport)
  const [backend, setBackend] = useState(loadBackend)
  const [topic, setTopic] = useState(loadTopic() || DEFAULT_TOPIC_ROOT)
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" size="icon" aria-label="Settings">
          <Settings className="h-5 w-5" />
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogTitle>Settings</DialogTitle>
        <DialogDescription>
          No login. Your unit name is only a label on this channel. The speech key stays in this browser.
        </DialogDescription>
        <div className="mt-4 flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="unit-name">Unit name</Label>
            <Input
              id="unit-name"
              value={name}
              maxLength={40}
              autoComplete="off"
              onChange={(event) => onName(event.target.value)}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label>Transcription</Label>
            <div className="grid grid-cols-2 gap-2">
              <Button
                type="button"
                variant={engine === 'whisper' ? 'default' : 'outline'}
                aria-pressed={engine === 'whisper'}
                onClick={() => onEngine('whisper')}
              >
                On-device Whisper
              </Button>
              <Button
                type="button"
                variant={engine === 'elevenlabs' ? 'default' : 'outline'}
                aria-pressed={engine === 'elevenlabs'}
                onClick={() => onEngine('elevenlabs')}
              >
                ElevenLabs Scribe
              </Button>
            </div>
            <p className="text-xs leading-relaxed text-slate-600">
              Whisper base runs in the browser, downloads once, and is cached on this device. Scribe sends the clip to
              ElevenLabs only when that option is selected.
            </p>
          </div>
          {engine === 'elevenlabs' ? (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="eleven-key">ElevenLabs API key</Label>
              <Input
                id="eleven-key"
                type="password"
                value={apiKey}
                autoComplete="off"
                placeholder="xi-…"
                onChange={(event) => onApiKey(event.target.value)}
              />
            </div>
          ) : null}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="relay-mode">Relay</Label>
            <select
              id="relay-mode"
              className="h-10 rounded-md border px-2"
              value={transport}
              onChange={(event) => {
                const value = event.target.value as TransportMode
                setTransport(value)
                saveTransport(value)
              }}
            >
              <option value="auto">Automatic</option>
              <option value="mqtt">Public MQTT</option>
              <option value="server">Configured server</option>
            </select>
            <Input
              value={backend}
              placeholder="https://server.example"
              autoComplete="off"
              onChange={(event) => {
                setBackend(event.target.value)
                saveBackend(event.target.value)
              }}
            />
            <Input
              value={topic}
              autoComplete="off"
              onChange={(event) => {
                setTopic(event.target.value)
                saveTopic(event.target.value)
              }}
            />
            <Button type="button" variant="outline" onClick={() => { setTopic(LEGACY_TOPIC_ROOT); saveTopic(LEGACY_TOPIC_ROOT) }}>
              Use legacy demo topic
            </Button>
            <p className="text-xs text-slate-600">Reload the page after changing the relay or topic. The legacy topic is the previous public demo, not a private channel.</p>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
