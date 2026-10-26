'use client'

import { Lock, X } from '@phosphor-icons/react'
import { tokenLabel } from '@/lib/reports/format'
import { chipStyle, textActionStyle } from '@/lib/reports/styles'
import type { AppliedFilter, FilterDef } from '@/lib/reports/types'

/** Everything that narrows the numbers, always visible: date field + period, then one chip per filter, then the search. */
export default function ActiveFiltersStrip({ defs, filters, applied, locked, periodText, q, onRemove, onClearQ, onClearAll, tour }: {
  defs: FilterDef[]
  filters: Record<string, string[]>
  applied?: AppliedFilter[]
  locked: Record<string, string>
  periodText: string
  q?: string
  /** Omit to show the chips read-only. */
  onRemove?: (key: string) => void
  onClearQ?: () => void
  onClearAll?: () => void
  tour?: string
}) {
  const items = Object.entries(filters).filter(([, v]) => v.length).map(([key, vals]) => {
    const def = defs.find((d) => d.key === key)
    const server = applied?.find((a) => a.key === key)
    const options = def?.options || []
    const text = server?.value || vals.map((v) => options.find((o) => o.value === v)?.label || tokenLabel(v)).join(', ')
    return { key, label: server?.label || def?.label || key, text, locked: key in locked || !!server?.locked }
  })
  const removable = items.filter((i) => !i.locked).length + (q ? 1 : 0)
  return (
    <div data-tour={tour} style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }} aria-label="Applied conditions">
      <span style={{ ...chipStyle, paddingRight: 12, background: 'rgba(255,122,69,0.10)', borderColor: 'rgba(255,122,69,0.35)', color: '#9a3412' }}>{periodText}</span>
      {items.map((i) => (
        <span key={i.key} style={{ ...chipStyle, paddingRight: i.locked ? 12 : 6 }} title={`${i.label}: ${i.text}`}>
          {i.locked && <Lock size={12} aria-label="Fixed for this report" />}
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 300 }}>{i.label}: {i.text}</span>
          {!i.locked && onRemove && (
            <button type="button" aria-label={`Remove filter ${i.label}`} onClick={() => onRemove(i.key)}
              style={{ width: 20, height: 20, borderRadius: 10, border: 'none', background: 'transparent', color: '#64748b', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
              <X size={12} weight="bold" />
            </button>
          )}
        </span>
      ))}
      {q && (
        <span style={chipStyle}>
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 240 }}>Search: {q}</span>
          {onClearQ && (
            <button type="button" aria-label="Clear search" onClick={onClearQ}
              style={{ width: 20, height: 20, borderRadius: 10, border: 'none', background: 'transparent', color: '#64748b', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
              <X size={12} weight="bold" />
            </button>
          )}
        </span>
      )}
      {removable > 1 && onClearAll && <button type="button" style={textActionStyle} onClick={onClearAll}>Clear all</button>}
      {items.length + (q ? 1 : 0) > 1 && <span style={{ fontSize: 12, color: '#64748b' }}>All conditions must match</span>}
    </div>
  )
}
