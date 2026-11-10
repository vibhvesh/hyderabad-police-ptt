import { defaultLine, lineId, lineLang, type LineRecord } from '../src/lib/lines.ts'
import { readJsonFile, writeJsonFile } from './json-file.ts'

export class LinesStore {
  private lines: LineRecord[]
  private file: string
  private nowIso: () => string

  constructor(file: string, nowIso: () => string = () => new Date().toISOString()) {
    this.file = file
    this.nowIso = nowIso
    const loaded = readJsonFile<LineRecord[]>(file, () => [defaultLine(this.nowIso())])
    this.lines = Array.isArray(loaded) && loaded.length > 0 ? loaded.map(normalize).filter((line): line is LineRecord => line !== null) : [defaultLine(this.nowIso())]
    if (this.lines.length === 0) this.lines = [defaultLine(this.nowIso())]
  }

  list(): LineRecord[] {
    return this.lines.map((line) => ({ ...line }))
  }

  get(id: string): LineRecord | null {
    return this.lines.find((line) => line.id === id) ?? null
  }

  create(input: { id: string; name: string; sourceLang?: unknown; targetLang?: unknown }): LineRecord | { error: string } {
    const id = lineId(input.id)
    if (!id) return { error: 'Line ids use letters, numbers, and hyphens.' }
    if (this.get(id)) return { error: 'That line already exists.' }
    const name = cleanName(input.name, id)
    const now = this.nowIso()
    const line: LineRecord = {
      id,
      name,
      enabled: true,
      sourceLang: lineLang(input.sourceLang, 'te'),
      targetLang: lineLang(input.targetLang, 'en'),
      createdAt: now,
      updatedAt: now,
    }
    this.lines = [...this.lines, line]
    this.save()
    return line
  }

  update(id: string, patch: { name?: unknown; enabled?: unknown; sourceLang?: unknown; targetLang?: unknown }): LineRecord | { error: string } {
    const current = this.get(id)
    if (!current) return { error: 'No such line.' }
    const next: LineRecord = {
      ...current,
      name: typeof patch.name === 'string' ? cleanName(patch.name, current.name) : current.name,
      enabled: typeof patch.enabled === 'boolean' ? patch.enabled : current.enabled,
      sourceLang: patch.sourceLang === undefined ? current.sourceLang : lineLang(patch.sourceLang, current.sourceLang),
      targetLang: patch.targetLang === undefined ? current.targetLang : lineLang(patch.targetLang, current.targetLang),
      updatedAt: this.nowIso(),
    }
    this.lines = this.lines.map((line) => (line.id === id ? next : line))
    this.save()
    return next
  }

  remove(id: string): { error: string } | { ok: true } {
    if (!this.get(id)) return { error: 'No such line.' }
    this.lines = this.lines.filter((line) => line.id !== id)
    this.save()
    return { ok: true }
  }

  private save() {
    writeJsonFile(this.file, this.lines)
  }
}

function cleanName(value: string, fallback: string): string {
  const name = value.replace(/\s+/g, ' ').trim().slice(0, 40)
  return name || fallback
}

function normalize(value: unknown): LineRecord | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Partial<LineRecord>
  const id = typeof raw.id === 'string' ? lineId(raw.id) : null
  if (!id) return null
  const now = new Date().toISOString()
  return {
    id,
    name: typeof raw.name === 'string' ? cleanName(raw.name, id) : id,
    enabled: raw.enabled !== false,
    sourceLang: lineLang(raw.sourceLang, 'te'),
    targetLang: lineLang(raw.targetLang, 'en'),
    createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : now,
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : now,
  }
}
