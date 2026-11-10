import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { formatIst } from '../src/lib/ist.ts'
import { readJsonFile, writeJsonFile } from './json-file.ts'

export type ClipRecord = {
  id: string
  lineId: string
  lineName: string
  speakerId: string
  speakerName: string
  at: string
  durationMs: number
  transcript: string | null
  translation: string | null
  translationNote: string | null
  status: 'queued' | 'ready' | 'unconfigured' | 'failed'
  audioFile: string
}

export type ClipQuery = {
  lineId?: string
  sender?: string
  from?: string
  to?: string
  q?: string
}

export class RadioLog {
  private records: ClipRecord[]
  private dir: string

  constructor(dir: string) {
    this.dir = dir
    mkdirSync(path.join(dir, 'audio'), { recursive: true })
    const loaded = readJsonFile<ClipRecord[]>(path.join(dir, 'index.json'), () => [])
    this.records = Array.isArray(loaded) ? loaded : []
  }

  async add(input: Omit<ClipRecord, 'audioFile' | 'status' | 'transcript' | 'translation' | 'translationNote'> & { wav: Buffer; status?: ClipRecord['status'] }): Promise<ClipRecord> {
    const audioFile = path.join('audio', `${input.id}.wav`)
    writeFileSync(path.join(this.dir, audioFile), input.wav)
    const record: ClipRecord = {
      id: input.id,
      lineId: input.lineId,
      lineName: input.lineName,
      speakerId: input.speakerId,
      speakerName: input.speakerName,
      at: input.at,
      durationMs: input.durationMs,
      transcript: null,
      translation: null,
      translationNote: null,
      status: input.status ?? 'queued',
      audioFile,
    }
    this.records = [record, ...this.records].slice(0, 2000)
    this.save()
    return record
  }

  finish(id: string, patch: Pick<ClipRecord, 'transcript' | 'translation' | 'translationNote' | 'status'>): ClipRecord | null {
    const current = this.records.find((item) => item.id === id)
    if (!current) return null
    const next = { ...current, ...patch }
    this.records = this.records.map((item) => (item.id === id ? next : item))
    this.save()
    return next
  }

  query(filter: ClipQuery = {}): ClipRecord[] {
    return this.records.filter((item) => matches(item, filter))
  }

  get(id: string): ClipRecord | null {
    return this.records.find((item) => item.id === id) ?? null
  }

  readAudio(id: string): Buffer | null {
    const record = this.get(id)
    if (!record || record.audioFile.includes('..')) return null
    try {
      return readFileSync(path.join(this.dir, record.audioFile))
    } catch {
      return null
    }
  }

  retain(days: number, now = Date.now()) {
    const cutoff = now - days * 24 * 60 * 60 * 1000
    const keep: ClipRecord[] = []
    for (const item of this.records) {
      const at = Date.parse(item.at)
      if (Number.isFinite(at) && at < cutoff) {
        rmSync(path.join(this.dir, item.audioFile), { force: true })
      } else keep.push(item)
    }
    this.records = keep
    this.save()
  }

  toCsv(filter: ClipQuery = {}): string {
    const rows = [['time_utc', 'time_ist', 'line', 'sender', 'sender_id', 'transcript', 'translation', 'note']]
    for (const item of this.query(filter)) {
      rows.push([item.at, formatIst(item.at), item.lineName, item.speakerName, item.speakerId, item.transcript ?? '', item.translation ?? '', item.translationNote ?? ''])
    }
    return rows.map((row) => row.map(csvCell).join(',')).join('\n')
  }

  toTxt(filter: ClipQuery = {}): string {
    return this.query(filter)
      .map((item) => `${formatIst(item.at)} IST  ${item.lineName}  ${item.speakerName}\n${item.transcript ?? '(no transcript)'}\n${item.translation ?? item.translationNote ?? ''}`)
      .join('\n\n')
  }

  private save() {
    writeJsonFile(path.join(this.dir, 'index.json'), this.records)
  }
}

function matches(item: ClipRecord, filter: ClipQuery): boolean {
  if (filter.lineId && item.lineId !== filter.lineId) return false
  if (filter.sender) {
    const needle = filter.sender.toLowerCase()
    if (!item.speakerName.toLowerCase().includes(needle) && !item.speakerId.toLowerCase().includes(needle)) return false
  }
  if (filter.from && item.at < filter.from) return false
  if (filter.to && item.at > filter.to) return false
  if (filter.q) {
    const blob = `${item.transcript ?? ''} ${item.translation ?? ''}`.toLowerCase()
    if (!blob.includes(filter.q.toLowerCase())) return false
  }
  return true
}

function csvCell(value: string): string {
  if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`
  return value
}
