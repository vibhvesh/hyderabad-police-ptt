import { useEffect, useState } from 'react'

export type MapNode = {
  id: string
  name: string
  status: 'idle' | 'talking' | 'alert'
  level: number
  devices: Array<{ id: string; name: string }>
}

export function ConnectionMap({ nodes, hotId, onHover, onLeave, reduce }: { nodes: MapNode[]; hotId: string | null; onHover: (id: string) => void; onLeave: () => void; reduce: boolean }) {
  const [phase, setPhase] = useState(0)
  useEffect(() => {
    if (reduce) return
    const timer = window.setInterval(() => setPhase(Date.now()), 120)
    return () => window.clearInterval(timer)
  }, [reduce])
  const width = 1000
  const height = 640
  const cx = 500
  const cy = 330
  return (
    <section className="db-map" aria-label="Connection map">
      <Dial nodes={nodes} />
      <svg className="db-net" viewBox={`0 0 ${width} ${height}`} role="img">
        <title>Lines linked to the radio net</title>
        <circle className="db-hub-ring" cx={cx} cy={cy} r={reduce ? 46 : 28 + ((phase / 80) % 40)} />
        <circle className="db-hub" cx={cx} cy={cy} r="26" />
        <text x={cx} y={cy + 4} textAnchor="middle" fill="#ffbf47" fontSize="11">NET</text>
        {nodes.map((node, index) => {
          const angle = -Math.PI / 2 + (index / Math.max(1, nodes.length)) * Math.PI * 2
          const radius = nodes.length === 1 ? 0 : 230
          const x = cx + Math.cos(angle) * radius
          const y = cy + Math.sin(angle) * radius * 0.78
          const live = node.status !== 'idle'
          const vu = node.status === 'talking' && !reduce ? node.level * (0.65 + 0.35 * Math.abs(Math.sin(phase / 180 + index))) : node.level
          return (
            <g key={node.id} className="db-node" onMouseEnter={() => onHover(node.id)} onMouseLeave={onLeave} onClick={() => { window.location.hash = `#/control/connections/${encodeURIComponent(node.id)}` }}>
              <line className={live && !reduce ? 'db-link live' : 'db-link'} x1={cx} y1={cy} x2={x} y2={y} style={{ strokeWidth: 1.5 + vu / 25 }} />
              <circle cx={x} cy={y} r={18 + vu / 18} fill={node.status === 'alert' ? '#ff4d3a' : node.status === 'talking' ? '#3dffb0' : '#d7b56d'} opacity={hotId === node.id ? 1 : 0.9} />
              <text x={x} y={y + 36} textAnchor="middle">{node.name}</text>
              {node.devices.slice(0, 5).map((device, deviceIndex) => {
                const spread = (deviceIndex - (Math.min(5, node.devices.length) - 1) / 2) * 18
                return <circle key={device.id} cx={x + spread} cy={y - 34} r="4" fill="#f6ecd8"><title>{device.name}</title></circle>
              })}
            </g>
          )
        })}
      </svg>
    </section>
  )
}

function Dial({ nodes }: { nodes: MapNode[] }) {
  const active = Math.max(0, nodes.findIndex((node) => node.status === 'talking'))
  const angle = nodes.length < 2 ? 0 : -50 + (active / (nodes.length - 1)) * 100
  return (
    <svg className="db-dial" viewBox="0 0 600 46" aria-hidden="true">
      {Array.from({ length: 21 }, (_, index) => (
        <line key={index} x1={30 + index * 27} y1={index % 5 === 0 ? 8 : 16} x2={30 + index * 27} y2="28" stroke="#d7b56d" strokeWidth={index % 5 === 0 ? 2 : 1} />
      ))}
      <g transform={`rotate(${angle} 300 40)`}>
        <polygon points="300,8 296,34 304,34" fill="#ff4d3a" />
      </g>
    </svg>
  )
}
