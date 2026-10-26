'use client'

// Work in progress at a date (SAP KKAX): actual cost issued to / booked on
// work orders (incl. RRV builds) not yet delivered into stock. Finance adds
// this figure to Store stock in the period-end closing-stock valuation.

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { productionApi } from '@/lib/api'
import { ProductionWipReport } from '@/types'
import { TEXT, GLASS, SHADOWS, BORDER } from '@/lib/theme'
import DateField from '@/components/erp/DateField'
import { extractErrorMessages } from '@/lib/validation'
import { recordPath } from '@/lib/recordRef'
import { RowCount, Pill } from '@/components/shared/ui'

const sectionStyle: React.CSSProperties = {
  borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur,
  border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), padding: 20, marginBottom: 20,
}
const sectionTitle: React.CSSProperties = { fontSize: 12, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.secondary, margin: '0 0 4px' }
const labelStyle: React.CSSProperties = { fontSize: 12, fontWeight: 600, color: TEXT.secondary, marginBottom: 6, display: 'block' }
const thStyle: React.CSSProperties = { textAlign: 'left', padding: '8px 12px', fontSize: 11, fontWeight: 600, letterSpacing: '.03em', whiteSpace: 'nowrap', textTransform: 'uppercase', color: TEXT.muted, position: 'sticky', top: 0, background: '#fdf1e6', zIndex: 1 }
const tdStyle: React.CSSProperties = { padding: '9px 12px', fontSize: 13, color: TEXT.body, borderTop: `1px solid ${BORDER.light}` }
const inr = (n: number) => `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`
const STATUS_LABELS: Record<string, string> = { released: 'Released', in_progress: 'In Progress', completed: 'Completed', closed: 'Closed', draft: 'Draft' }
const STATUS_HEX: Record<string, string> = { released: '#2563EB', in_progress: '#F59E0B', completed: '#16A34A', closed: '#78716c', draft: '#78716c' }

export default function WipReportSection() {
  const router = useRouter()
  const [asOf, setAsOf] = useState(new Date().toISOString().slice(0, 10))
  const [report, setReport] = useState<ProductionWipReport | null>(null)
  const [error, setError] = useState<string | string[]>('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!asOf) return
    setLoading(true)
    productionApi.getWipReport({ as_of: asOf })
      .then((data) => { setReport(data); setError('') })
      .catch((err) => setError(extractErrorMessages(err, 'Failed to load the WIP report.')))
      .finally(() => setLoading(false))
  }, [asOf])

  return (
    <div data-tour="production-rpt-wip" style={sectionStyle}>
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 14 }}>
        <div>
          <p style={sectionTitle}>Work in Progress {report ? `· ${inr(report.total_wip)}` : ''}</p>
          <p style={{ fontSize: 12.5, color: TEXT.muted, margin: 0, maxWidth: 680 }}>
            Material issued (net of returns) + labour booked − cost already received into stock, for every work order not yet delivered on the date.
            Finance adds this to Store stock as closing stock at period end; it clears when the order delivers its last unit.
          </p>
        </div>
        <div style={{ width: 170 }}>
          <label style={labelStyle}>As of</label>
          <DateField value={asOf} onChange={setAsOf} />
        </div>
      </div>

      {error && (
        <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
          {Array.isArray(error) ? error.join(' ') : error}
        </div>
      )}

      {report && report.by_rrv_build.length > 0 && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
          {report.by_rrv_build.map((b) => (
            <span key={b.rrv_build_id} style={{ fontSize: 12, padding: '6px 10px', borderRadius: 10, background: 'rgba(37,99,235,0.08)', color: '#1d4ed8' }}>
              RRV {b.rrv_build_number}: {inr(b.wip_value)} ({b.orders} order{b.orders === 1 ? '' : 's'})
            </span>
          ))}
        </div>
      )}

      <div style={{ overflow: 'auto', maxHeight: 420 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 980 }}>
          <thead><tr>{['Work Order', 'Product', 'RRV Build', 'Built / Planned', 'Material', 'Labour', 'Received to Stock', 'WIP', 'Status'].map((h, i) => <th key={h} style={thStyle}>{h}{i === 0 && <RowCount count={report?.rows.length ?? 0} />}</th>)}</tr></thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={9} style={{ ...tdStyle, textAlign: 'center', color: TEXT.muted }}>Loading…</td></tr>
            ) : !report || report.rows.length === 0 ? (
              <tr><td colSpan={9} style={{ ...tdStyle, textAlign: 'center', color: TEXT.muted }}>No work in progress on this date.</td></tr>
            ) : report.rows.map((r) => (
              <tr key={r.work_order_id} onClick={() => router.push(recordPath('/dashboard/production/work-orders', r, 'work_order_id'))} style={{ cursor: 'pointer' }}>
                <td style={{ ...tdStyle, fontWeight: 600, color: TEXT.heading }}>{r.wo_number}</td>
                <td style={tdStyle}>{r.product_code} — {r.product_name}</td>
                <td style={tdStyle}>{r.rrv_build_number || '—'}</td>
                <td style={tdStyle}>{r.quantity_completed} / {r.quantity_planned}</td>
                <td style={tdStyle}>{inr(r.material_cost)}</td>
                <td style={tdStyle}>{inr(r.labour_cost)}</td>
                <td style={tdStyle}>{inr(r.cost_relieved)}</td>
                <td style={{ ...tdStyle, fontWeight: 700, color: TEXT.heading }}>{inr(r.wip_value)}</td>
                <td style={tdStyle}>
                  <Pill label={STATUS_LABELS[r.status] || r.status} hex={STATUS_HEX[r.status] || '#78716c'} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
