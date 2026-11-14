'use client'

import { ArrowDown, ArrowUp } from '@phosphor-icons/react'
import { pillStyle } from '@/components/shared/ui'
import { betterDirection, fmtDelta, fmtWithUnit } from '@/lib/reports/format'
import type { VisualResult, VisualSpec } from '@/lib/reports/dashboard'
import InfoTip from './InfoTip'

/** One big number with its label and, when comparing, the change against the previous period. Click it to see the records; the (i) says what it means. */
export default function KpiCard({ spec, result, compare, onShow }: { spec: VisualSpec; result?: VisualResult; compare: boolean; onShow?: () => void }) {
  const type = spec.type || result?.type || 'int'
  const v = result?.value
  const d = result?.delta_pct
  const better = betterDirection(type, spec.better)
  const good = d == null || d === 0 ? null : (d > 0) === (better === 'up')
  const clickable = !!onShow && v !== null && v !== undefined && v !== 0 && v !== '0'
  const hasCompare = compare && !!result && result.compare !== null && result.compare !== undefined
  const was = hasCompare ? fmtWithUnit(type, result!.compare) : ''
  const pct = d != null ? fmtDelta(Math.abs(d)).replace('+', '') : ''
  const change = !hasCompare ? ''
    : d == null ? `Last period it was ${was}. No % change is shown because it was 0 then.`
      : d === 0 ? `Last period it was also ${was}: no change.`
        : `Last period it was ${was}. It went ${d > 0 ? 'up' : 'down'} by ${pct}, which is ${good ? 'better (green)' : 'worse (red)'}.`
  const lines = [
    spec.hint || '',
    hasCompare ? `"was" = the same number for the previous period of the same length, just before the dates chosen.` : '',
    change,
    better === 'down' ? 'Lower is better here.' : 'Higher is better here.',
    clickable ? 'Click the card to see the records behind this number.' : '',
  ]
  const body = (
    <>
      <span style={{ display: 'block', paddingRight: 22, fontSize: 11, fontWeight: 700, letterSpacing: '.05em', textTransform: 'uppercase', color: '#78716c', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{spec.title}</span>
      <span style={{ display: 'block', fontSize: 26, fontWeight: 700, color: '#1f1108', lineHeight: '34px', fontVariantNumeric: 'tabular-nums' }}>{result ? fmtWithUnit(type, v) : '…'}</span>
      <span style={{ display: 'block', minHeight: 20, fontSize: 11.5, color: '#78716c' }}>
        {hasCompare && (
          <>
            {d != null && d !== 0 && (
              <span title={change} style={{ ...pillStyle(good ? '#16a34a' : '#dc2626'), gap: 2, padding: '0 6px', marginRight: 6 }}>
                {d > 0 ? <ArrowUp size={11} weight="bold" /> : <ArrowDown size={11} weight="bold" />}
                {pct}
              </span>
            )}
            was {was}
          </>
        )}
      </span>
    </>
  )
  const box: React.CSSProperties = { width: '100%', height: '100%', textAlign: 'left', padding: '12px 14px', borderRadius: 14, background: '#fff', border: '1px solid rgba(0,0,0,0.06)', minWidth: 0, fontFamily: 'inherit', boxShadow: '0 2px 8px rgba(15,23,42,0.04)' }
  return (
    <div style={{ position: 'relative', minWidth: 0 }}>
      {clickable
        ? <button type="button" title="Click to see the records." onClick={onShow} style={{ ...box, cursor: 'pointer' }}>{body}</button>
        : <div style={box}>{body}</div>}
      <span style={{ position: 'absolute', top: 8, right: 8 }}>
        <InfoTip title={spec.title} lines={lines} />
      </span>
    </div>
  )
}
