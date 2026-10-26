'use client'

import { ArrowDown, ArrowUp } from '@phosphor-icons/react'
import { pillStyle } from '@/components/shared/ui'
import { betterDirection, fmtDelta, fmtWithUnit } from '@/lib/reports/format'
import type { Drill, KpiOut } from '@/lib/reports/types'

/** Small figure chips (value, previous value, change). A chip with records behind it opens them. */
export default function KpiChips({ kpis, onDrill, tour }: { kpis: KpiOut[]; onDrill: (k: KpiOut, drill: Drill) => void; tour?: string }) {
  if (!kpis.length) return null
  return (
    <div data-tour={tour} style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
      {kpis.map((k) => {
        const dir = betterDirection(k.type, k.better)
        const delta = k.delta_pct
        const good = delta == null || delta === 0 ? null : (delta > 0) === (dir === 'up')
        const clickable = !!k.drill && k.value !== null && k.value !== 0 && k.value !== '0'
        const body = (
          <>
            <span style={{ fontSize: 15, fontWeight: 700, color: '#1f1108' }}>{fmtWithUnit(k.type, k.value)}</span>
            <span>{k.label}</span>
            {k.compare !== undefined && k.compare !== null && (
              <span style={{ fontSize: 11.5, fontWeight: 600, color: '#78716c' }}>was {fmtWithUnit(k.type, k.compare)}</span>
            )}
            {delta != null && delta !== 0 && (
              <span style={{ ...pillStyle(good ? '#16a34a' : '#dc2626'), gap: 2, padding: '0 6px' }}>
                {delta > 0 ? <ArrowUp size={11} weight="bold" /> : <ArrowDown size={11} weight="bold" />}
                {fmtDelta(Math.abs(delta)).replace('+', '')}
              </span>
            )}
          </>
        )
        const base: React.CSSProperties = { ...pillStyle('#57534e'), gap: 8, fontSize: 12, fontWeight: 600, minHeight: 30, background: 'rgba(255,255,255,.7)', border: '1px solid rgba(0,0,0,0.08)', fontFamily: 'inherit' }
        return clickable ? (
          <button key={k.key} type="button" onClick={() => onDrill(k, k.drill!)} title={`Show the records behind ${k.label}`} style={{ ...base, cursor: 'pointer' }}>{body}</button>
        ) : (
          <span key={k.key} style={base}>{body}</span>
        )
      })}
    </div>
  )
}
