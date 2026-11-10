import type { useAudioRoute } from '@/hooks/useAudioRoute'

type Route = ReturnType<typeof useAudioRoute>

export function AudioRouteBar({ route }: { route: Route }) {
  return (
    <section className="w-full rounded-xl border bg-white p-3 text-sm" aria-label="Audio devices">
      {route.toast ? (
        <p className="mb-2 flex flex-wrap items-center gap-2 rounded-md bg-amber-50 px-2 py-2 text-amber-950" role="status">
          <span>{route.toast.message}</span>
          {route.toast.undo ? <button type="button" className="font-semibold underline" onClick={route.undo}>Switch back</button> : null}
          <button type="button" className="ml-auto text-xs" onClick={route.dismiss}>Hide</button>
        </p>
      ) : null}
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
      <p className="mt-2 flex items-center gap-2 text-xs text-slate-600">
        {route.bluetooth ? <BluetoothMark /> : null}
        <span>Mic {route.micLabel} · Speaker {route.speakerLabel}</span>
      </p>
      {route.canSink ? null : (
        <p className="mt-1 text-xs text-slate-500">This browser plays through the system speaker. iOS Safari cannot choose a speaker inside the page.</p>
      )}
    </section>
  )
}

function BluetoothMark() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" aria-label="Bluetooth" role="img">
      <path fill="#0c3d82" d="M7 6.5 17 16l-5 4V4l5 4L7 17.5" />
      <path fill="none" stroke="#0c3d82" strokeWidth="2" d="M12 4v16M12 12l5-4M12 12l5 4M12 12 7 8M12 12 7 16" />
    </svg>
  )
}
