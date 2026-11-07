import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { emptyChannel, type ChannelState } from '../src/lib/kb.ts'

export class KbStore {
  private tails = new Map<string, Promise<void>>()

  private dir: string

  constructor(dir: string) {
    this.dir = dir
  }

  file(channel: string): string | null {
    if (!/^[a-z0-9][a-z0-9-]{0,31}$/.test(channel)) return null
    const root = path.resolve(this.dir)
    const file = path.resolve(root, `${channel}.json`)
    if (!file.startsWith(root + path.sep)) return null
    return file
  }

  async read(channel: string): Promise<ChannelState> {
    const file = this.file(channel)
    if (!file) return emptyChannel(channel)
    try {
      const parsed = JSON.parse(await readFile(file, 'utf8')) as ChannelState
      if (!parsed || parsed.channel !== channel || !parsed.window) return emptyChannel(channel)
      return parsed
    } catch {
      return emptyChannel(channel)
    }
  }

  async change<T>(
    channel: string,
    fn: (state: ChannelState) => { save?: ChannelState; value: T } | Promise<{ save?: ChannelState; value: T }>,
  ): Promise<T> {
    const prev = this.tails.get(channel) ?? Promise.resolve()
    const run = prev.then(async () => {
      const state = await this.read(channel)
      const result = await fn(state)
      if (result.save) await this.write(channel, result.save)
      return result.value
    })
    this.tails.set(
      channel,
      run.then(
        () => undefined,
        () => undefined,
      ),
    )
    return run
  }

  private async write(channel: string, state: ChannelState) {
    const file = this.file(channel)
    if (!file) throw new Error('invalid channel')
    await mkdir(path.dirname(file), { recursive: true })
    const tmp = `${file}.${process.pid}.tmp`
    await writeFile(tmp, JSON.stringify(state), 'utf8')
    await rename(tmp, file)
  }
}
