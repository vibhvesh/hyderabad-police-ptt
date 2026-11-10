export type RailLine = {
  id: string
  name: string
  status: 'idle' | 'talking' | 'alert'
  speaker: string | null
  phones: number
  handsets: number
  level: number
}

export function LineRail({ lines, hotId, onHover, onLeave }: { lines: RailLine[]; hotId: string | null; onHover: (id: string) => void; onLeave: () => void }) {
  return (
    <aside className="db-rail" aria-label="Lines">
      <h2>Lines</h2>
      <ul>
        {lines.length === 0 ? <li>No lines yet.</li> : null}
        {lines.map((line) => (
          <li key={line.id}>
            <a
              className={hotId === line.id ? 'db-line is-hot' : 'db-line'}
              href={`#/control/connections/${encodeURIComponent(line.id)}`}
              onMouseEnter={() => onHover(line.id)}
              onFocus={() => onHover(line.id)}
              onMouseLeave={onLeave}
              onBlur={onLeave}
            >
              <i className={`db-light ${line.status}`} aria-label={line.status} />
              <span>
                <strong>{line.name}</strong>
                <small>{line.speaker ? line.speaker : 'Idle'} · {line.phones} phone · {line.handsets} handset</small>
              </span>
              <span className="db-vu" aria-hidden="true"><i style={{ width: `${Math.max(6, Math.min(100, line.level))}%` }} /></span>
            </a>
          </li>
        ))}
      </ul>
      <a className="db-gear" href="#/control/manage">
        <Gear />
        Settings
      </a>
    </aside>
  )
}

function Gear() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
      <path fill="currentColor" d="M19.1 12.9a7.4 7.4 0 0 0 .1-1.8 7.4 7.4 0 0 0-.1-1.8l2-1.6-2-3.4-2.4 1a7.6 7.6 0 0 0-3.1-1.8L13.2 1h-2.4L10.5 3.5A7.6 7.6 0 0 0 7.4 5.3l-2.4-1-2 3.4 2 1.6a7.4 7.4 0 0 0 0 3.6l-2 1.6 2 3.4 2.4-1a7.6 7.6 0 0 0 3.1 1.8L10.8 23h2.4l.3-2.5a7.6 7.6 0 0 0 3.1-1.8l2.4 1 2-3.4zM12 15.5A3.5 3.5 0 1 1 15.5 12 3.5 3.5 0 0 1 12 15.5z" />
    </svg>
  )
}
