'use client'

/** Small clickable charts shared by the ERP dashboard (service tickets) and
 * Project Management › All Projects (projects by stage). A bar row or a
 * legend row works as a filter toggle for the table under it. */

const rowButtonReset: React.CSSProperties = { background: 'none', border: 'none', padding: 0, font: 'inherit', textAlign: 'left', cursor: 'pointer' }

type ChartProps = {
  data: [string, number][]
  colorMap: Record<string, string>
  onSelect: (label: string) => void
  isActive: (label: string) => boolean
  /** Display text per key (default: the key with underscores as spaces). */
  labelOf?: (key: string) => string
  /** What a row filters, for the hover title: "tickets" (default), "projects"... */
  noun?: string
}

const defaultLabel = (key: string) => key.replace(/_/g, ' ')

export function BarChart({ data, colorMap, onSelect, isActive, labelOf = defaultLabel, noun = 'tickets' }: ChartProps) {
  const max = Math.max(...data.map(([, v]) => v), 1)
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {data.map(([key, value]) => (
        // ui-audit-ignore-next-line custom-button — chart row used as a filter toggle
        <button type="button" key={key} onClick={() => onSelect(key)} aria-pressed={isActive(key)} title={isActive(key) ? `Click to show all ${noun}` : `Show ${labelOf(key)} ${noun}`}
          style={{ ...rowButtonReset, display: 'flex', alignItems: 'center', gap: 10, width: '100%', borderRadius: 6, background: isActive(key) ? 'rgba(234,88,12,0.08)' : 'none' }}>
          <span style={{ fontSize: 11.5, color: '#57534e', width: 130, flexShrink: 0, textTransform: 'capitalize', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {labelOf(key)}
          </span>
          <div style={{ flex: 1, height: 10, borderRadius: 6, background: 'rgba(0,0,0,0.05)', overflow: 'hidden' }}>
            <div style={{ width: `${(value / max) * 100}%`, height: '100%', background: colorMap[key] || '#FF7A45', borderRadius: 6 }} />
          </div>
          <span style={{ fontSize: 12, fontWeight: 600, color: '#1f1108', width: 24, textAlign: 'right' }}>{value}</span>
        </button>
      ))}
    </div>
  )
}

export function PieChart({ data, colorMap, onSelect, isActive, labelOf = defaultLabel, noun = 'tickets' }: ChartProps) {
  const total = data.reduce((sum, [, v]) => sum + v, 0) || 1
  const radius = 15.9155
  const circumference = 2 * Math.PI * radius
  // Each slice starts where the previous one ended (fraction of the circle before it).
  const starts: number[] = []
  data.reduce((acc, [, v]) => { starts.push(acc); return acc + v / total }, 0)

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
      <svg width="120" height="120" viewBox="0 0 36 36">
        <circle cx="18" cy="18" r={radius} fill="none" stroke="rgba(0,0,0,0.05)" strokeWidth="4" />
        {data.map(([key, value], i) => {
          const fraction = value / total
          const dash = fraction * circumference
          const offset = -starts[i] * circumference
          return (
            <circle
              key={key}
              cx="18"
              cy="18"
              r={radius}
              fill="none"
              stroke={colorMap[key] || '#a8a29e'}
              strokeWidth="4"
              strokeDasharray={`${dash} ${circumference - dash}`}
              strokeDashoffset={offset}
              transform="rotate(-90 18 18)"
            />
          )
        })}
      </svg>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {data.map(([key, value]) => (
          // ui-audit-ignore-next-line custom-button — legend row used as a filter toggle
          <button type="button" key={key} onClick={() => onSelect(key)} aria-pressed={isActive(key)} title={isActive(key) ? `Click to show all ${noun}` : `Show active ${labelOf(key)} ${noun}`}
            style={{ ...rowButtonReset, display: 'flex', alignItems: 'center', gap: 6, borderRadius: 6, background: isActive(key) ? 'rgba(234,88,12,0.08)' : 'none' }}>
            <span style={{ width: 9, height: 9, borderRadius: '50%', background: colorMap[key] || '#a8a29e', flexShrink: 0 }} />
            <span style={{ fontSize: 12, color: '#57534e', textTransform: 'capitalize' }}>{labelOf(key)}</span>
            <span style={{ fontSize: 12, fontWeight: 600, color: '#1f1108' }}>{value}</span>
          </button>
        ))}
      </div>
    </div>
  )
}
