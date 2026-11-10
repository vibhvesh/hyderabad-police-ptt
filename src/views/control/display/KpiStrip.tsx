export function KpiStrip({
  linesActive,
  linesTotal,
  devicesOnline,
  messagesToday,
  messagesLastHour,
  talkers,
  openAlerts,
  perMinute,
}: {
  linesActive: number
  linesTotal: number
  devicesOnline: number
  messagesToday: number
  messagesLastHour: number
  talkers: number
  openAlerts: number
  perMinute: number[]
}) {
  return (
    <section className="db-kpis" aria-label="Totals">
      <Stat label="Lines" value={`${linesActive}/${linesTotal}`} />
      <Stat label="Devices online" value={String(devicesOnline)} />
      <Stat label="Messages today" value={String(messagesToday)} />
      <Stat label="Last hour" value={String(messagesLastHour)} />
      <Stat label="Talkers now" value={String(talkers)} />
      <Stat label="Open alerts" value={String(openAlerts)} hot={openAlerts > 0} />
      <div className="db-kpi">
        <span>Messages / min</span>
        <Spark values={perMinute} />
      </div>
    </section>
  )
}

function Stat({ label, value, hot }: { label: string; value: string; hot?: boolean }) {
  const [main, rest] = value.split('/')
  return (
    <div className="db-kpi">
      <span>{label}</span>
      <strong style={hot ? { color: 'var(--alert)' } : undefined}>{main}{rest ? <em>/{rest}</em> : null}</strong>
    </div>
  )
}

function Spark({ values }: { values: number[] }) {
  const width = 160
  const height = 36
  const max = Math.max(1, ...values)
  const step = values.length > 1 ? width / (values.length - 1) : width
  const points = values.map((value, index) => `${index * step},${height - (value / max) * (height - 6) - 2}`).join(' ')
  return (
    <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Messages per minute">
      <polyline fill="none" stroke="#ffbf47" strokeWidth="2" points={points || `0,${height} ${width},${height}`} />
    </svg>
  )
}
