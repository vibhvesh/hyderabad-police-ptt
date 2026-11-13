import { STT_IDS, STT_LABELS, type SttChoice } from '@/lib/stt'
import { elevenLabsSelectable, type VoiceChoice } from '@/lib/voice-choice'

export function LineVoiceFields({
  tts,
  asr,
  configured,
  onTts,
  onAsr,
}: {
  tts: VoiceChoice
  asr: SttChoice
  configured: boolean
  onTts: (value: VoiceChoice) => void
  onAsr: (value: SttChoice) => void
}) {
  const cloud = elevenLabsSelectable(configured)
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      <label className="text-sm">Voice
        <select className="mt-1 w-full rounded-md border px-2 py-2" value={tts} onChange={(event) => onTts(event.target.value as VoiceChoice)}>
          <option value="free">Free (built-in espeak / local)</option>
          <option value="elevenlabs" disabled={cloud.disabled}>ElevenLabs</option>
        </select>
      </label>
      <label className="text-sm">Recognition
        <select className="mt-1 w-full rounded-md border px-2 py-2" value={asr} onChange={(event) => onAsr(event.target.value as SttChoice)}>
          <option value="inherit">Use the server default</option>
          {STT_IDS.map((id) => <option key={id} value={id}>{STT_LABELS[id]}</option>)}
        </select>
      </label>
      {cloud.hint ? <p className="text-xs text-slate-500 sm:col-span-2">{cloud.hint}</p> : null}
    </div>
  )
}
