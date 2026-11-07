import { createApp } from './app.ts'
import { loadConfig } from './config.ts'

const config = loadConfig()
const app = createApp({ config })
const timer = setInterval(() => {
  void app.runDue()
}, 60_000)
timer.unref?.()

await app.listen(config.port, config.host)
console.log(`sanket-ptt listening on ${config.host}:${config.port}`)

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    clearInterval(timer)
    void app.close().then(() => process.exit(0))
  })
}
