import { readJsonFile, writeJsonFile } from '../json-file.ts'
import { openSecret, sealSecret, type Sealed } from '../secret-box.ts'
import { STT_IDS, type SttProviderId } from '../../src/lib/stt.ts'

type FileShape = Partial<Record<SttProviderId, Sealed>>

export class SttSecrets {
  private file: string
  private secret: string
  private items: FileShape

  constructor(file: string, secret: string) {
    this.file = file
    this.secret = secret || 'sanket-unconfigured'
    this.items = readJsonFile<FileShape>(file, () => ({}))
  }

  configured(): SttProviderId[] {
    return STT_IDS.filter((id) => id !== 'free' && this.items[id])
  }

  get(id: SttProviderId): string | null {
    const sealed = this.items[id]
    if (!sealed) return null
    try {
      const plain = openSecret(sealed, this.secret)
      return plain.trim() || null
    } catch {
      return null
    }
  }

  set(id: SttProviderId, plain: string) {
    const value = plain.trim()
    if (!value || id === 'free') return
    this.items = { ...this.items, [id]: sealSecret(value, this.secret) }
    writeJsonFile(this.file, this.items)
  }
}
