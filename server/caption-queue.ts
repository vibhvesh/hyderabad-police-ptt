export class CaptionQueue<T> {
  private pending: T[] = []
  private running = false
  private waiters: Array<() => void> = []
  private run: (job: T) => Promise<void>

  constructor(run: (job: T) => Promise<void>) {
    this.run = run
  }

  enqueue(job: T) {
    this.pending.push(job)
    void this.pump()
  }

  private async pump() {
    if (this.running) return
    this.running = true
    while (this.pending.length > 0) {
      const job = this.pending.shift()
      if (!job) break
      try {
        await this.run(job)
      } catch {
        /* the job handler records its own failure */
      }
    }
    this.running = false
    const waiting = this.waiters
    this.waiters = []
    for (const resume of waiting) resume()
    if (this.pending.length > 0) void this.pump()
  }

  drained(): Promise<void> {
    if (!this.running && this.pending.length === 0) return Promise.resolve()
    return new Promise((resolve) => this.waiters.push(resolve))
  }
}
