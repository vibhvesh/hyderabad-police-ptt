export function MessageTicker({ items }: { items: Array<{ id: string; when: string; title: string; text: string; emergency: boolean }> }) {
  const rows = items.length > 1 ? [...items, ...items] : items
  return (
    <section className="db-ticker" aria-label="Messages">
      <h2>Messages</h2>
      {items.length === 0 ? <p>Waiting for traffic.</p> : null}
      <ul>
        {rows.map((item, index) => (
          <li key={`${item.id}-${index}`} className={item.emergency ? 'emergency' : undefined}>
            <small>{item.when} · {item.title}</small>
            {item.text}
          </li>
        ))}
      </ul>
    </section>
  )
}
