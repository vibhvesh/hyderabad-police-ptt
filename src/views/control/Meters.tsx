export function Sparkline({ values, label }: { values: number[]; label: string }) {
  const width = 220
  const height = 42
  const max = Math.max(1, ...values)
  const step = values.length > 1 ? width / (values.length - 1) : width
  const points = values.map((value, index) => `${index * step},${height - (value / max) * (height - 4) - 2}`).join(' ')
  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="h-12 w-full" role="img" aria-label={label}>
      <polyline fill="none" stroke="#0c3d82" strokeWidth="2" points={points || `0,${height} ${width},${height}`} />
    </svg>
  )
}

export function LevelMeter({ active, level }: { active: boolean; level: number }) {
  const width = active ? Math.max(35, Math.min(100, level)) : Math.max(4, level)
  return (
    <div className="h-2 overflow-hidden rounded-full bg-slate-200" aria-hidden="true">
      <div className={active ? 'h-full rounded-full bg-[#0e8a4a]' : 'h-full rounded-full bg-[#0c3d82]'} style={{ width: `${width}%` }} />
    </div>
  )
}
