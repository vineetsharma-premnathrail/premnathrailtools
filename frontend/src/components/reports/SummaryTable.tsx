'use client'

import { Fragment, useState } from 'react'
import { CaretDown, CaretRight } from '@phosphor-icons/react'
import { RowCount, TableScroll, thStyle, tdStyle } from '@/components/shared/ui'
import { betterDirection, fmtDelta, fmtNumber, isNumeric } from '@/lib/reports/format'
import type { Drill, SummaryResult, SummaryRow } from '@/lib/reports/types'

const numBtn: React.CSSProperties = {
  background: 'none', border: 'none', color: '#c2410c', fontWeight: 600, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit',
  textDecoration: 'underline', textDecorationStyle: 'dotted', textUnderlineOffset: 3, fontVariantNumeric: 'tabular-nums', textAlign: 'right',
}

const flat = (n: unknown) => (typeof n === 'number' ? n : n === null || n === undefined || n === '' ? null : Number(n))

/** The grouped summary: one row per group (and per sub-group), measure columns, totals last. Every number opens the records behind it. */
export default function SummaryTable({ result, groupHeader, loading, onDrill, tour }: {
  result: SummaryResult
  groupHeader: string
  loading?: boolean
  /** drills are merged in order; title names the cell for the popup heading. */
  onDrill: (drills: (Drill | undefined)[], title: string) => void
  tour?: string
}) {
  const [folded, setFolded] = useState<Set<string>>(new Set())
  const m = result.measures
  const compareOn = !!result.period.compare
  const toggle = (k: string) => setFolded((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n })
  const gKey = (r: SummaryRow) => Object.values(r.key || {}).join('|') || r.label?.[result.group_by || ''] || ''

  const cell = (values: SummaryRow['values'], compare: SummaryRow['compare'], delta: SummaryRow['delta_pct'], mi: number, drills: (Drill | undefined)[] | null, title: string) => {
    const meta = m[mi]
    const raw = values?.[meta.key]
    const num = isNumeric(meta.type)
    const text = num ? fmtNumber(meta.type, raw) : raw === null || raw === undefined ? '—' : String(raw)
    const n = flat(raw)
    const clickable = !!drills && n !== null && n !== 0 && !Number.isNaN(n as number)
    const d = delta?.[meta.key]
    const prev = compare?.[meta.key]
    const good = d == null || d === 0 ? null : (d > 0) === (betterDirection(meta.type, meta.better) === 'up')
    return (
      <td key={meta.key} style={{ ...tdStyle, textAlign: 'right', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
        {clickable
          ? <button type="button" style={numBtn} title={`Show the records behind ${text}`} onClick={() => onDrill(drills!, `${meta.label}${title ? ` · ${title}` : ''}`)}>{text}</button>
          : <span style={{ color: n === 0 ? '#a8a29e' : undefined }}>{text}</span>}
        {compareOn && prev !== undefined && (
          <div style={{ fontSize: 11, color: '#78716c', marginTop: 1 }}>
            was {num ? fmtNumber(meta.type, prev) : String(prev ?? '—')}
            {d != null && <span style={{ marginLeft: 6, fontWeight: 700, color: good === null ? '#78716c' : good ? '#15803d' : '#b91c1c' }}>{fmtDelta(d)}</span>}
          </div>
        )}
      </td>
    )
  }

  const renderRow = (r: SummaryRow, level: number, parent: SummaryRow | null) => {
    const label = Object.values(r.label || {}).slice(-1)[0] ?? ''
    const parentLabel = parent ? Object.values(parent.label || {})[0] : ''
    const title = [parentLabel, label].filter(Boolean).join(' · ')
    const k = `${parent ? gKey(parent) + '>' : ''}${gKey(r)}`
    const kids = r.children || []
    const open = !folded.has(k)
    // measure_drill[key] is the complete drill of that cell (null = 0 records); without one the row's own drill applies.
    const cellDrill = (key: string): (Drill | undefined)[] | null => {
      const md = r.measure_drill
      if (md && key in md) return md[key] ? [md[key] as Drill] : null
      return [parent?.drill, r.drill]
    }
    const base = () => [parent?.drill, r.drill]
    return (
      <Fragment key={k}>
        <tr style={{ background: level ? 'rgba(15,23,42,0.025)' : undefined }}>
          <td style={{ ...tdStyle, paddingLeft: 12 + level * 22, fontWeight: level ? 500 : 600, whiteSpace: 'nowrap' }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              {kids.length > 0 ? (
                <button type="button" aria-label={open ? `Fold ${label}` : `Unfold ${label}`} aria-expanded={open} onClick={() => toggle(k)}
                  style={{ width: 20, height: 20, border: 'none', background: 'transparent', color: '#64748b', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
                  {open ? <CaretDown size={12} weight="bold" /> : <CaretRight size={12} weight="bold" />}
                </button>
              ) : level === 0 ? <span style={{ width: 20 }} /> : null}
              {r.drill && Object.keys(r.drill).length ? (
                <button type="button" style={{ ...numBtn, color: '#1f1108', textDecoration: 'none', textAlign: 'left' }} title={`Show every record in ${label}`} onClick={() => onDrill(base(), title || label)}>{label || '—'}</button>
              ) : <span>{label || '—'}</span>}
            </span>
          </td>
          {m.map((_, mi) => cell(r.values, r.compare, r.delta_pct, mi, cellDrill(m[mi].key), title))}
        </tr>
        {open && kids.map((c) => renderRow(c, level + 1, r))}
      </Fragment>
    )
  }

  const totals = result.totals

  return (
    <TableScroll maxHeight="calc(100vh - 260px)" style={{ opacity: loading ? 0.55 : 1, transition: 'opacity .15s' }}>
      <table data-tour={tour} style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            <th data-fit-min={60} data-fit-cut style={{ ...thStyle, whiteSpace: 'nowrap' }}>{groupHeader}<RowCount count={result.rows.length} /></th>
            {m.map((x) => (
              <th key={x.key} data-fit-min={60} style={{ ...thStyle, whiteSpace: 'nowrap', textAlign: isNumeric(x.type) ? 'right' : 'left' }}>{x.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {result.rows.map((r) => renderRow(r, 0, null))}
          {result.rows.length === 0 && (
            <tr><td colSpan={m.length + 1} style={{ ...tdStyle, textAlign: 'center', color: '#78716c' }}>Nothing to group.</td></tr>
          )}
          <tr style={{ background: '#fdf1e6' }}>
            <td style={{ ...tdStyle, fontWeight: 700, borderTop: '2px solid rgba(0,0,0,0.12)' }}>Total</td>
            {m.map((x, mi) => {
              const c = cell(totals?.values, totals?.compare, totals?.delta_pct, mi, null, 'All')
              return <Fragment key={x.key}>{c}</Fragment>
            })}
          </tr>
        </tbody>
      </table>
    </TableScroll>
  )
}
