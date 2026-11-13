import { useEffect, useRef, useState } from 'react'
import type { useAudioRoute } from '@/hooks/useAudioRoute'

type Route = ReturnType<typeof useAudioRoute>

export function AudioRouteBar({ route }: { route: Route }) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onPointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', onPointer)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const summary = `Mic ${route.micLabel}. Speaker ${route.speakerLabel}`
  return (
    <div ref={rootRef} className="relative flex w-full flex-col items-end">
      <button
        type="button"
        className="inline-flex h-9 items-center gap-1 rounded-full border bg-white px-2 text-[#0c3d82] shadow-sm"
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={route.bluetooth ? `Bluetooth audio. ${summary}` : `Audio route. ${summary}`}
        onClick={() => setOpen((value) => !value)}
      >
        <MicIcon />
        <SpeakerIcon />
        {route.bluetooth ? <BluetoothMark /> : null}
      </button>
      {route.toast ? (
        <p className="mt-2 flex w-full flex-wrap items-center gap-2 rounded-md bg-amber-50 px-2 py-2 text-left text-xs text-amber-950" role="status">
          <span>{route.toast.message}</span>
          {route.toast.undo ? <button type="button" className="font-semibold underline" onClick={route.undo}>Switch back</button> : null}
          <button type="button" className="ml-auto" onClick={route.dismiss}>Hide</button>
        </p>
      ) : null}
      {open ? (
        <div className="absolute top-11 right-0 z-20 w-72 rounded-xl border bg-white p-3 text-left text-sm shadow-lg" role="dialog" aria-label="Audio devices">
          {!route.labelsReady ? (
            <button type="button" className="mb-2 text-xs font-semibold text-[#0c3d82]" onClick={() => void route.enableLabels()}>
              Allow the microphone to name devices
            </button>
          ) : null}
          <label className="block font-semibold">Microphone
            <select className="mt-1 w-full rounded-md border bg-white px-2 py-2 text-base" value={route.inputId} onChange={(event) => route.choose('input', event.target.value)}>
              <option value="">System default</option>
              {route.inputs.filter((device) => device.deviceId).map((device) => (
                <option key={device.deviceId} value={device.deviceId}>{device.label || 'Microphone'}{device.bluetooth ? ' · Bluetooth' : ''}</option>
              ))}
            </select>
          </label>
          <label className="mt-2 block font-semibold">Speaker
            <select className="mt-1 w-full rounded-md border bg-white px-2 py-2 text-base" value={route.canSink ? route.outputId : ''} disabled={!route.canSink} onChange={(event) => route.choose('output', event.target.value)}>
              <option value="">System default</option>
              {route.outputs.filter((device) => device.deviceId).map((device) => (
                <option key={device.deviceId} value={device.deviceId}>{device.label || 'Speaker'}{device.bluetooth ? ' · Bluetooth' : ''}</option>
              ))}
            </select>
          </label>
          <p className="mt-2 text-xs text-slate-600">{summary}</p>
          {route.canSink ? null : (
            <p className="mt-1 text-xs text-slate-500">This browser plays through the system speaker. iOS Safari cannot choose a speaker inside the page.</p>
          )}
        </div>
      ) : null}
    </div>
  )
}

function MicIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
      <path fill="currentColor" d="M12 14a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v5a3 3 0 0 0 3 3zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.9V21h2v-3.1A7 7 0 0 0 19 11z" />
    </svg>
  )
}

function SpeakerIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
      <path fill="currentColor" d="M4 9v6h4l5 4V5L8 9zm11.5 3a3.5 3.5 0 0 0-1.5-2.9v5.8A3.5 3.5 0 0 0 15.5 12z" />
    </svg>
  )
}

function BluetoothMark() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" aria-label="Bluetooth" role="img">
      <path fill="currentColor" d="m12 3 6 5-4.5 4L18 16l-6 5v-7.2L8.4 17 7 15.6 11.2 12 7 8.4 8.4 7 12 10.2z" />
    </svg>
  )
}
