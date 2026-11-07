import { useState } from 'react'
import { Settings } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { DEFAULT_TOPIC_ROOT, LEGACY_TOPIC_ROOT } from '@/lib/net'
import { loadBackend, loadTopic, loadTransport, saveBackend, saveTopic, saveTransport, type TransportMode } from '@/lib/storage'

type Props = {
  name: string
  cloudFallback: boolean
  onName: (value: string) => void
  onCloudFallback: (value: boolean) => void
}

export function SettingsDialog({ name, cloudFallback, onName, onCloudFallback }: Props) {
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
          No login. Your unit name is only a label on this channel. Speech recognition runs on this device.
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
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              checked={cloudFallback}
              onChange={(event) => onCloudFallback(event.target.checked)}
            />
            <span>
              If on-device Whisper fails, send that finished clip to ElevenLabs Scribe v2 through this server.
              This can spend paid credits. Scribe only transcribes. Translation still runs on this device.
              The API key stays on the server. Shared demo access has to be unlocked before a cloud clip is accepted.
            </span>
          </label>
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
