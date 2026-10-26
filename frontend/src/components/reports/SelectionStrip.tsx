'use client'

import { X } from '@phosphor-icons/react'
import { labelOf } from './ReportFilters'
import { tokenLabel } from '@/lib/reports/format'
import { chipStyle, textActionStyle } from '@/lib/reports/styles'
import type { DashState } from '@/lib/reports/dashboard'
import type { FilterDef } from '@/lib/reports/types'

/** "Showing: Priority = Urgent x  Engineer = Rohit x": everything that is narrowing the page (slicers and chart clicks). */
export default function SelectionStrip({ defs, state, onRemoveSlicer, onRemoveSel, onClear, tour }: {
  defs: FilterDef[]
  state: DashState
  onRemoveSlicer: (key: string, value: string) => void
  onRemoveSel: (key: string, token: string) => void
  onClear: () => void
  tour?: string
}) {
  const nameOf = (k: string) => defs.find((d) => d.key === k)?.label || k.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase())
  const chips: { id: string; text: string; fromChart: boolean; remove: () => void }[] = []
  Object.entries(state.slicers).forEach(([k, vals]) => vals.forEach((v) => {
    const def = defs.find((d) => d.key === k)
    chips.push({ id: `s|${k}|${v}`, text: `${nameOf(k)} = ${labelOf(k, v, def?.options)}`, fromChart: false, remove: () => onRemoveSlicer(k, v) })
  }))
  Object.entries(state.sel).forEach(([k, s]) => s.tokens.forEach((t, i) => {
    chips.push({ id: `c|${k}|${t}`, text: `${nameOf(k)} = ${tokenLabel(s.labels[i] || t)}`, fromChart: true, remove: () => onRemoveSel(k, t) })
  }))
  if (!chips.length) return null
  return (
    <div data-tour={tour} style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }} aria-label="Active filters">
      <span style={{ fontSize: 12.5, fontWeight: 700, color: '#57534e' }}>Showing:</span>
      {chips.map((c) => (
        <span key={c.id} style={{ ...chipStyle, ...(c.fromChart ? { background: 'rgba(255,122,69,0.12)', borderColor: 'rgba(255,122,69,0.4)', color: '#9a3412' } : {}) }} title={c.fromChart ? 'Chosen by clicking a chart' : 'Chosen in a filter above'}>
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 280 }}>{c.text}</span>
          <button type="button" aria-label={`Remove ${c.text}`} onClick={c.remove}
            style={{ width: 20, height: 20, borderRadius: 10, border: 'none', background: 'transparent', color: 'inherit', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
            <X size={12} weight="bold" />
          </button>
        </span>
      ))}
      <button type="button" style={textActionStyle} onClick={onClear}>Clear all</button>
    </div>
  )
}
