import { useEffect, useRef, useState } from 'react'
import {
  isBluetoothLabel,
  loadRoute,
  nextRoute,
  saveRoute,
  sinkSupported,
  type RouteChoice,
  type RouteDevice,
} from '@/lib/audio-route'

export type ListedDevice = RouteDevice & { bluetooth: boolean }

export type RouteToast = { message: string; undo: boolean }

function listFrom(devices: MediaDeviceInfo[]): ListedDevice[] {
  return devices
    .filter((device) => device.kind === 'audioinput' || device.kind === 'audiooutput')
    .map((device) => ({
      deviceId: device.deviceId,
      kind: device.kind as RouteDevice['kind'],
      label: device.label,
      groupId: device.groupId,
      bluetooth: isBluetoothLabel(device.label),
    }))
}

export function useAudioRoute() {
  const [inputs, setInputs] = useState<ListedDevice[]>([])
  const [outputs, setOutputs] = useState<ListedDevice[]>([])
  const [choice, setChoice] = useState<RouteChoice>(() => loadRoute())
  const [canSink, setCanSink] = useState(false)
  const [labelsReady, setLabelsReady] = useState(false)
  const [toast, setToast] = useState<RouteToast | null>(null)
  const previous = useRef<ListedDevice[]>([])
  const primed = useRef(false)
  const choiceRef = useRef(choice)
  const undoRef = useRef<RouteChoice | null>(null)
  choiceRef.current = choice

  function commit(next: RouteChoice, notice: RouteToast | null, rememberUndo: boolean) {
    if (rememberUndo) undoRef.current = choiceRef.current
    choiceRef.current = next
    setChoice(next)
    saveRoute(next)
    if (notice) setToast(notice)
  }

  async function refresh() {
    if (!navigator.mediaDevices?.enumerateDevices) return
    const listed = listFrom(await navigator.mediaDevices.enumerateDevices())
    const ins = listed.filter((device) => device.kind === 'audioinput')
    const outs = listed.filter((device) => device.kind === 'audiooutput')
    setInputs(ins)
    setOutputs(outs)
    setLabelsReady(listed.some((device) => device.label))
    const prior = primed.current ? previous.current : []
    primed.current = true
    previous.current = ins
    const result = nextRoute({ previousInputs: prior, inputs: ins, outputs: outs, selected: choiceRef.current })
    const changed = result.selected.inputId !== choiceRef.current.inputId || result.selected.outputId !== choiceRef.current.outputId
    if (result.switchedTo) {
      const speaker = result.switchedTo.outputLabel ? ` and ${result.switchedTo.outputLabel}` : ''
      commit(result.selected, { message: `Bluetooth connected: ${result.switchedTo.inputLabel}${speaker}`, undo: true }, true)
      return
    }
    if (changed) {
      commit(result.selected, result.fellBack ? { message: 'Selected device disconnected. Using the system default.', undo: false } : null, false)
    }
  }

  useEffect(() => {
    const audio = document.createElement('audio') as HTMLAudioElement & { setSinkId?: unknown }
    const contextSink = typeof AudioContext !== 'undefined' && sinkSupported(AudioContext.prototype as { setSinkId?: unknown })
    setCanSink(contextSink || sinkSupported(audio))
    void refresh()
    const onChange = () => void refresh()
    navigator.mediaDevices?.addEventListener('devicechange', onChange)
    return () => navigator.mediaDevices?.removeEventListener('devicechange', onChange)
    // The refresh reads refs so the listener stays stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function enableLabels() {
    if (!navigator.mediaDevices?.getUserMedia) return
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false })
    stream.getTracks().forEach((track) => track.stop())
    await refresh()
  }

  function choose(kind: 'input' | 'output', deviceId: string) {
    const next = kind === 'input' ? { ...choiceRef.current, inputId: deviceId } : { ...choiceRef.current, outputId: deviceId }
    undoRef.current = null
    commit(next, null, false)
    setToast(null)
  }

  function undo() {
    const prior = undoRef.current
    if (!prior) {
      setToast(null)
      return
    }
    undoRef.current = null
    commit(prior, null, false)
    setToast(null)
  }

  const mic = inputs.find((device) => device.deviceId === choice.inputId) ?? null
  const speaker = outputs.find((device) => device.deviceId === choice.outputId) ?? null

  return {
    inputs,
    outputs,
    inputId: choice.inputId,
    outputId: choice.outputId,
    canSink,
    labelsReady,
    toast,
    micLabel: mic?.label || 'System default',
    speakerLabel: canSink ? (speaker?.label || 'System default') : 'System default',
    bluetooth: Boolean(mic?.bluetooth || speaker?.bluetooth),
    choose,
    undo,
    dismiss: () => setToast(null),
    enableLabels,
  }
}
