import { describe, expect, it } from 'vitest'
import { applyOutputSink, isBluetoothLabel, loadRoute, nextRoute, saveRoute, type RouteDevice } from '../src/lib/audio-route.ts'

function device(partial: Partial<RouteDevice> & Pick<RouteDevice, 'deviceId' | 'kind'>): RouteDevice {
  return { label: '', groupId: '', ...partial }
}

function memory() {
  const values = new Map<string, string>()
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  }
}

describe('talk audio route', () => {
  it('recognises bluetooth headset labels and ignores ordinary mics', () => {
    expect(isBluetoothLabel('Bluetooth Headset')).toBe(true)
    expect(isBluetoothLabel('BT-HFP')).toBe(true)
    expect(isBluetoothLabel('Hands-Free AG')).toBe(true)
    expect(isBluetoothLabel('Vibhav AirPods')).toBe(true)
    expect(isBluetoothLabel('USB Headset')).toBe(true)
    expect(isBluetoothLabel('Galaxy Buds')).toBe(true)
    expect(isBluetoothLabel('Built-in Microphone')).toBe(false)
    expect(isBluetoothLabel('Subtle internal mic')).toBe(false)
    expect(isBluetoothLabel('')).toBe(false)
  })

  it('follows a newly connected bluetooth mic and its speaker, then returns to the default when it leaves', () => {
    const phone = device({ deviceId: 'mic-phone', kind: 'audioinput', label: 'Phone mic', groupId: 'phone' })
    const buds = device({ deviceId: 'mic-buds', kind: 'audioinput', label: 'AirPods', groupId: 'buds' })
    const budsOut = device({ deviceId: 'spk-buds', kind: 'audiooutput', label: 'AirPods', groupId: 'buds' })
    const phoneOut = device({ deviceId: 'spk-phone', kind: 'audiooutput', label: 'Phone speaker', groupId: 'phone' })
    const switched = nextRoute({
      previousInputs: [phone],
      inputs: [phone, buds],
      outputs: [phoneOut, budsOut],
      selected: { inputId: 'mic-phone', outputId: 'spk-phone' },
    })
    expect(switched.switchedTo).toEqual({ inputLabel: 'AirPods', outputLabel: 'AirPods' })
    expect(switched.selected).toEqual({ inputId: 'mic-buds', outputId: 'spk-buds' })
    expect(switched.fellBack).toBe(false)

    const gone = nextRoute({
      previousInputs: [phone, buds],
      inputs: [phone],
      outputs: [phoneOut],
      selected: switched.selected,
    })
    expect(gone.switchedTo).toBeNull()
    expect(gone.fellBack).toBe(true)
    expect(gone.selected).toEqual({ inputId: '', outputId: '' })

    const quietBrowser = nextRoute({
      previousInputs: [phone],
      inputs: [phone],
      outputs: [],
      selected: { inputId: 'mic-phone', outputId: 'spk-buds' },
    })
    expect(quietBrowser.fellBack).toBe(false)
    expect(quietBrowser.selected.outputId).toBe('spk-buds')

    const firstLook = nextRoute({
      previousInputs: [],
      inputs: [buds],
      outputs: [budsOut],
      selected: { inputId: '', outputId: '' },
    })
    expect(firstLook.switchedTo).toBeNull()
    expect(firstLook.selected).toEqual({ inputId: '', outputId: '' })
  })

  it('remembers the choice and reports when a speaker switch is unavailable', async () => {
    const store = memory()
    saveRoute({ inputId: 'mic-buds', outputId: 'spk-buds' }, store)
    expect(loadRoute(store)).toEqual({ inputId: 'mic-buds', outputId: 'spk-buds' })
    const target = { setSinkId: async () => { throw new Error('gone') } }
    expect(await applyOutputSink(target, 'spk-buds')).toBe(false)
    expect(await applyOutputSink({}, '')).toBe(false)
    let seen = ''
    expect(await applyOutputSink({ setSinkId: async (id) => { seen = id } }, 'spk-buds')).toBe(true)
    expect(seen).toBe('spk-buds')
  })
})
