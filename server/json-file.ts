import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import path from 'node:path'

export function readJsonFile<T>(file: string, fallback: () => T): T {
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as T
  } catch {
    const value = fallback()
    writeJsonFile(file, value)
    return value
  }
}

export function writeJsonFile(file: string, value: unknown) {
  mkdirSync(path.dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.tmp`
  writeFileSync(tmp, JSON.stringify(value, null, 2))
  renameSync(tmp, file)
}
