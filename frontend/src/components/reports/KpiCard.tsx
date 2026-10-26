'use client'

import { ArrowDown, ArrowUp } from '@phosphor-icons/react'
import { pillStyle } from '@/components/shared/ui'
import { betterDirection, fmtDelta, fmtWithUnit } from '@/lib/reports/format'
import type { VisualResult, VisualSpec } from '@/lib/reports/dashboard'

/** One big number with its label and, when comparing, the change against the previous period. Click it to see the records. */
export default function KpiCard({ spec, result, compare, onShow }: { spec: VisualSpec; result?: VisualResult; compare: boolean; onShow?: () => void }) {
  const type = spec.type || result?.type || 'int'
  const v = result?.value
  const d = result?.delta_pct
  const good = d == null || d === 0 ? null : (d > 0) === (betterDirection(type, spec.better) === 'up')
  const clickable = !!onShow && v !== null && v !== undefined && v !== 0 && v !== '0'
  const body = (
    <>
      <span style={{ display: 'block', fontSize: 11, fontWeight: 700, letterSpacing: '.05em', textTransform: 'uppercase', color: '#78716c', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{spec.title}</span>
      <span style={{ display: 'block', fontSize: 26, fontWeight: 700, color: '#1f1108', lineHeight: '34px', fontVariantNumeric: 'tabular-nums' }}>{result ? fmtWithUnit(type, v) : '…'}</span>
      <span style={{ display: 'block', minHeight: 20, fontSize: 11.5, color: '#78716c' }}>
        {compare && result && result.compare !== null && result.compare !== undefined && (
          <>
            {d != null && d !== 0 && (
              <span style={{ ...pillStyle(good ? '#16a34a' : '#dc2626'), gap: 2, padding: '0 6px', marginRight: 6 }}>
                {d > 0 ? <ArrowUp size={11} weight="bold" /> : <ArrowDown size={11} weight="bold" />}
                {fmtDelta(Math.abs(d)).replace('+', '')}
              </span>
            )}
            was {fmtWithUnit(type, result.compare)}
          </>
        )}
      </span>
    </>
  )
  const box: React.CSSProperties = { textAlign: 'left', padding: '12px 14px', borderRadius: 14, background: '#fff', border: '1px solid rgba(0,0,0,0.06)', minWidth: 0, fontFamily: 'inherit', boxShadow: '0 2px 8px rgba(15,23,42,0.04)' }
  return clickable
    ? <button type="button" title={spec.hint ? `${spec.hint} Click to see the records.` : 'Click to see the records.'} onClick={onShow} style={{ ...box, cursor: 'pointer' }}>{body}</button>
    : <div title={spec.hint} style={box}>{body}</div>
}
