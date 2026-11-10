import { randomBytes } from 'node:crypto'
import { lineId } from '../src/lib/lines.ts'
import { hashMatches, sha256 } from './hash.ts'
import { readJsonFile, writeJsonFile } from './json-file.ts'

export type DeviceRecord = {
  id: string
  lineId: string
  name: string
  tokenHash: string
  createdAt: string
  revokedAt: string | null
}

export type PublicDevice = {
  id: string
  lineId: string
  name: string
  createdAt: string
  revokedAt: string | null
}

type Created = { device: PublicDevice; token: string }

export class DeviceStore {
  private devices: DeviceRecord[]
  private file: string
  private nowIso: () => string

  constructor(file: string, nowIso: () => string = () => new Date().toISOString()) {
    this.file = file
    this.nowIso = nowIso
    const loaded = readJsonFile<DeviceRecord[]>(file, () => [])
    this.devices = Array.isArray(loaded) ? loaded.map(normalize).filter((item): item is DeviceRecord => item !== null) : []
  }

  list(): PublicDevice[] {
    return this.devices.map(publish)
  }

  create(lineIdRaw: string, nameRaw: string): Created | { error: string } {
    const line = lineId(lineIdRaw)
    if (!line) return { error: 'Line ids use letters, numbers, and hyphens.' }
    const name = cleanName(nameRaw)
    const id = this.freshId()
    const token = `sdt_${randomBytes(24).toString('base64url')}`
    const now = this.nowIso()
    const record: DeviceRecord = { id, lineId: line, name, tokenHash: sha256(token), createdAt: now, revokedAt: null }
    this.devices = [...this.devices, record]
    this.save()
    return { device: publish(record), token }
  }

  revoke(id: string): { ok: true } | { error: string } {
    const current = this.devices.find((item) => item.id === id)
    if (!current) return { error: 'No such handset.' }
    if (!current.revokedAt) {
      current.revokedAt = this.nowIso()
      this.devices = this.devices.map((item) => (item.id === id ? current : item))
      this.save()
    }
    return { ok: true }
  }

  revokeLine(line: string): string[] {
    const ids = this.devices.filter((item) => item.lineId === line && !item.revokedAt).map((item) => item.id)
    if (ids.length === 0) return []
    const now = this.nowIso()
    this.devices = this.devices.map((item) => (item.lineId === line && !item.revokedAt ? { ...item, revokedAt: now } : item))
    this.save()
    return ids
  }

  /** A non-revoked handset id. Browsers may not publish as this id. */
  reserved(id: string): boolean {
    return this.devices.some((item) => item.id === id)
  }

  active(id: string): boolean {
    const found = this.devices.find((item) => item.id === id)
    return !!found && !found.revokedAt
  }

  verify(id: string, token: string): { id: string; lineId: string; name: string } | null {
    const found = this.devices.find((item) => item.id === id)
    if (!found || found.revokedAt) return null
    if (!hashMatches(found.tokenHash, token)) return null
    return { id: found.id, lineId: found.lineId, name: found.name }
  }

  private freshId(): string {
    for (let i = 0; i < 5; i++) {
      const id = `hs${randomBytes(3).toString('hex')}`
      if (!this.devices.some((item) => item.id === id)) return id
    }
    return `hs${randomBytes(4).toString('hex')}`
  }

  private save() {
    writeJsonFile(this.file, this.devices)
  }
}

function publish(record: DeviceRecord): PublicDevice {
  return { id: record.id, lineId: record.lineId, name: record.name, createdAt: record.createdAt, revokedAt: record.revokedAt }
}

function cleanName(value: string): string {
  const name = value.replace(/\s+/g, ' ').trim().slice(0, 40)
  return name || 'Handset'
}

function normalize(value: unknown): DeviceRecord | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Partial<DeviceRecord>
  const id = typeof raw.id === 'string' ? raw.id.trim() : ''
  const line = typeof raw.lineId === 'string' ? lineId(raw.lineId) : null
  if (!/^hs[a-f0-9]{6,8}$/.test(id) || !line) return null
  if (typeof raw.tokenHash !== 'string' || !/^[a-f0-9]{64}$/.test(raw.tokenHash)) return null
  return {
    id,
    lineId: line,
    name: typeof raw.name === 'string' ? cleanName(raw.name) : 'Handset',
    tokenHash: raw.tokenHash,
    createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : new Date().toISOString(),
    revokedAt: typeof raw.revokedAt === 'string' ? raw.revokedAt : null,
  }
}
