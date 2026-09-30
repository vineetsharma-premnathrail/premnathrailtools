'use client'

import { HydCalcResultRow } from '@/types'
import { TEXT, BORDER } from '@/lib/theme'

// Presentational only — every figure comes from the server-side engine
// (backend/app/modules/hydraulic/calculations.py); nothing is computed here.

/** One result value as displayed: numbers in en-IN grouping, text as-is, null as a dash. */
export function formatCalcValue(value: number | string | null | undefined): string {
  if (value == null || value === '') return '—'
  if (typeof value === 'number') return value.toLocaleString('en-IN', { maximumFractionDigits: 4 })
  return String(value)
}

/** "Label: value unit" for the first primary result — the list page's key result. */
export function keyResultText(rows?: HydCalcResultRow[] | null): string {
  const row = rows?.find((r) => r.primary) || rows?.[0]
  if (!row) return '—'
  return `${row.label}: ${formatCalcValue(row.value)}${row.unit && row.value != null ? ` ${row.unit}` : ''}`
}

const cellStyle: React.CSSProperties = { padding: '8px 12px', fontSize: 13, color: TEXT.body, borderTop: `1px solid ${BORDER.light}` }

export default function CalcResults({
  results,
  warnings = [],
  error,
  computing = false,
  emptyNote = 'Fill in the inputs to see results.',
}: {
  results: HydCalcResultRow[]
  warnings?: string[]
  /** A bad-input message from the engine — shown in place of the results. */
  error?: string | string[] | null
  computing?: boolean
  emptyNote?: string
}) {
  const errorText = Array.isArray(error) ? error.join(' ') : error
  const primary = results.filter((r) => r.primary)
  const rest = results.filter((r) => !r.primary)

  return (
    <div style={{ opacity: computing ? 0.6 : 1, transition: 'opacity .15s' }}>
      {errorText ? (
        <div style={{ padding: '12px 14px', borderRadius: 12, background: 'rgba(220,38,38,0.06)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
          <strong style={{ fontWeight: 700 }}>Can&apos;t calculate yet:</strong> {errorText}
        </div>
      ) : results.length === 0 ? (
        <p style={{ fontSize: 13, color: TEXT.muted, margin: 0 }}>{computing ? 'Calculating…' : emptyNote}</p>
      ) : (
        <>
          {primary.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: rest.length ? 16 : 0 }}>
              {primary.map((r) => (
                <div key={r.key} style={{
                  flex: '1 1 170px', maxWidth: 260, padding: '14px 16px', borderRadius: 14,
                  background: 'rgba(255,122,69,0.08)', border: '1px solid rgba(255,122,69,0.25)',
                }}>
                  <p style={{ fontSize: 11.5, fontWeight: 600, color: TEXT.secondary, margin: '0 0 6px' }}>{r.label}</p>
                  <p style={{ margin: 0, color: TEXT.heading, lineHeight: 1.1 }}>
                    <span style={{ fontSize: 26, fontWeight: 700 }}>{formatCalcValue(r.value)}</span>
                    {r.unit && r.value != null && <span style={{ fontSize: 13, fontWeight: 600, color: TEXT.muted, marginLeft: 6 }}>{r.unit}</span>}
                  </p>
                </div>
              ))}
            </div>
          )}
          {rest.length > 0 && (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <tbody>
                {rest.map((r) => (
                  <tr key={r.key}>
                    <td style={{ ...cellStyle, color: TEXT.secondary }}>{r.label}</td>
                    <td style={{ ...cellStyle, textAlign: 'right', fontWeight: 600, color: TEXT.heading, whiteSpace: 'nowrap' }}>{formatCalcValue(r.value)}</td>
                    <td style={{ ...cellStyle, color: TEXT.muted, whiteSpace: 'nowrap', width: 90 }}>{r.value != null ? r.unit || '' : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}

      {!errorText && warnings.length > 0 && (
        <div style={{ marginTop: 14, padding: '10px 14px', borderRadius: 10, background: 'rgba(245,158,11,0.10)', border: '1px solid rgba(245,158,11,0.35)', color: '#92400E', fontSize: 13 }}>
          <p style={{ fontWeight: 700, margin: '0 0 4px' }}>Check these</p>
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {warnings.map((w, i) => <li key={i} style={{ marginTop: i ? 4 : 0 }}>{w}</li>)}
          </ul>
        </div>
      )}
    </div>
  )
}
