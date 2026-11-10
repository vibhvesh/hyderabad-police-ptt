export type RouteKind = 'audioinput' | 'audiooutput'

export type RouteDevice = {
  deviceId: string
  kind: RouteKind
  label: string
  groupId: string
}

export type RouteChoice = {
  inputId: string
  outputId: string
}

const INPUT_KEY = 'sanket-audio-input'
const OUTPUT_KEY = 'sanket-audio-output'

const BLUETOOTH = /\b(bluetooth|bt|hands-?free|airpods?|headset|headphones|buds)\b/i

export function isBluetoothLabel(label: string): boolean {
  return BLUETOOTH.test(label)
}

export function markBluetooth<T extends { label: string }>(device: T): T & { bluetooth: boolean } {
  return { ...device, bluetooth: isBluetoothLabel(device.label) }
}

export function sinkSupported(target: { setSinkId?: unknown } | null | undefined): boolean {
  return typeof target?.setSinkId === 'function'
}

export async function applyOutputSink(target: { setSinkId?: (sinkId: string) => Promise<void> }, deviceId: string): Promise<boolean> {
  if (!sinkSupported(target)) return false
  try {
    await target.setSinkId?.(deviceId)
    return true
  } catch {
    return false
  }
}

type Store = Pick<Storage, 'getItem' | 'setItem'>

export function loadRoute(storage?: Store): RouteChoice {
  try {
    const store = storage ?? globalThis.localStorage
    return {
      inputId: store.getItem(INPUT_KEY) ?? '',
      outputId: store.getItem(OUTPUT_KEY) ?? '',
    }
  } catch {
    return { inputId: '', outputId: '' }
  }
}

export function saveRoute(choice: RouteChoice, storage?: Store) {
  try {
    const store = storage ?? globalThis.localStorage
    store.setItem(INPUT_KEY, choice.inputId)
    store.setItem(OUTPUT_KEY, choice.outputId)
  } catch {
    /* private mode */
  }
}

export function nextRoute(input: {
  previousInputs: Array<{ deviceId: string }>
  inputs: RouteDevice[]
  outputs: RouteDevice[]
  selected: RouteChoice
}): { selected: RouteChoice; switchedTo: { inputLabel: string; outputLabel: string | null } | null; fellBack: boolean } {
  const known = new Set(input.previousInputs.map((device) => device.deviceId))
  const arrived = known.size === 0
    ? []
    : input.inputs.filter((device) => device.deviceId && !known.has(device.deviceId) && isBluetoothLabel(device.label))
  let selected = { ...input.selected }
  let switchedTo: { inputLabel: string; outputLabel: string | null } | null = null
  if (arrived.length > 0) {
    const mic = arrived[arrived.length - 1]!
    const sameGroup = input.outputs.filter((device) => device.groupId && device.groupId === mic.groupId)
    const speaker = sameGroup.find((device) => isBluetoothLabel(device.label)) ?? sameGroup[0] ?? null
    selected = { inputId: mic.deviceId, outputId: speaker ? speaker.deviceId : selected.outputId }
    switchedTo = { inputLabel: mic.label || 'Bluetooth microphone', outputLabel: speaker?.label ?? null }
  }
  let fellBack = false
  const inputIds = new Set(input.inputs.map((device) => device.deviceId))
  const outputIds = new Set(input.outputs.map((device) => device.deviceId))
  if (selected.inputId && input.inputs.length > 0 && !inputIds.has(selected.inputId)) {
    selected = { ...selected, inputId: '' }
    fellBack = true
  }
  if (selected.outputId && input.outputs.length > 0 && !outputIds.has(selected.outputId)) {
    selected = { ...selected, outputId: '' }
    fellBack = true
  }
  return { selected, switchedTo, fellBack }
}
