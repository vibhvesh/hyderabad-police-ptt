export function AlertsPanel({
  alerts,
  fresh,
  onAck,
}: {
  alerts: Array<{ id: string; title: string; text: string; at: string }>
  fresh: ReadonlySet<string>
  onAck: (id: string) => void
}) {
  return (
    <section className="db-alerts" aria-live="assertive" aria-label="Alerts">
      <h2>Alerts</h2>
      {alerts.length === 0 ? <p>No open alerts.</p> : null}
      {alerts.map((alert) => (
        <article key={alert.id} className={fresh.has(alert.id) ? 'db-alert is-new' : 'db-alert'}>
          <strong>{alert.title}</strong>
          <span>{alert.text}</span>
          <button type="button" onClick={() => onAck(alert.id)}>Acknowledge</button>
        </article>
      ))}
    </section>
  )
}
