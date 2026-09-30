'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { productionApi } from '@/lib/api'
import { ProductionReport } from '@/types'
import { TEXT, GLASS, SHADOWS, BORDER } from '@/lib/theme'
import { secondaryBtnStyle } from '@/components/shared/ui'
import DateField from '@/components/erp/DateField'
import ProductionNav from '@/components/production/ProductionNav'
import { extractErrorMessages } from '@/lib/validation'
import { formatDate } from '@/lib/format'

const sectionStyle: React.CSSProperties = {
  borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur,
  border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), padding: 20, marginBottom: 20,
}
const sectionTitle: React.CSSProperties = { fontSize: 12, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.secondary, margin: 0 }
const labelStyle: React.CSSProperties = { fontSize: 12, fontWeight: 600, color: TEXT.secondary, marginBottom: 6, display: 'block' }
const thStyle: React.CSSProperties = { textAlign: 'left', padding: '8px 12px', fontSize: 11, fontWeight: 600, letterSpacing: '.03em', textTransform: 'uppercase', color: TEXT.muted, background: '#fdf1e6' }
const tdStyle: React.CSSProperties = { padding: '9px 12px', fontSize: 13, color: TEXT.body, borderTop: `1px solid ${BORDER.light}` }
const inr = (n: number) => `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`
const isoDaysAgo = (days: number) => new Date(Date.now() - days * 86400000).toISOString().slice(0, 10)

function downloadCsv(filename: string, header: string[], rows: (string | number | null | undefined)[][]) {
  const esc = (v: string | number | null | undefined) => {
    const s = v == null ? '' : String(v)
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const csv = [header, ...rows].map((r) => r.map(esc).join(',')).join('\n')
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

export default function ProductionReportsPage() {
  const { isAuthorized, isLoading } = useRequireApp('production')
  const router = useRouter()
  const [dateFrom, setDateFrom] = useState(isoDaysAgo(29))
  const [dateTo, setDateTo] = useState(isoDaysAgo(0))
  const [report, setReport] = useState<ProductionReport | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | string[]>('')

  useEffect(() => {
    if (!isAuthorized || !dateFrom || !dateTo) return
    productionApi.getReport({ date_from: dateFrom, date_to: dateTo })
      .then((data) => { setReport(data); setError('') })
      .catch((err) => setError(extractErrorMessages(err, 'Failed to load production report.')))
      .finally(() => setLoading(false))
  }, [isAuthorized, dateFrom, dateTo])

  if (isLoading || !isAuthorized) return null

  const range = report ? `${report.date_from}_to_${report.date_to}` : ''
  const totals = report ? report.costs.reduce((acc, c) => ({ est: acc.est + c.estimated_total_cost, act: acc.act + c.actual_total_cost }), { est: 0, act: 0 }) : { est: 0, act: 0 }

  return (
    <div>
      <ProductionNav />

      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16, marginBottom: 20, flexWrap: 'wrap' }}>
        <div>
          <p style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 4px' }}>
            Production Module
          </p>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: TEXT.heading, margin: 0 }}>Production Reports</h1>
        </div>
        <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div style={{ width: 170 }}>
            <label style={labelStyle}>From</label>
            <DateField value={dateFrom} onChange={setDateFrom} />
          </div>
          <div style={{ width: 170 }}>
            <label style={labelStyle}>To</label>
            <DateField value={dateTo} onChange={setDateTo} />
          </div>
        </div>
      </div>

      {error && (
        <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
          {Array.isArray(error) ? error.join(' ') : error}
        </div>
      )}
      {loading && <p style={{ fontSize: 13, color: TEXT.muted }}>Loading…</p>}

      {report && !loading && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 14, marginBottom: 20 }}>
            {[
              ['Output', String(report.total_output), `${formatDate(report.date_from)} – ${formatDate(report.date_to)}`],
              ['Scrap', String(report.total_scrap), report.scrap_rate_percent != null ? `${report.scrap_rate_percent}% scrap rate` : 'No bookings'],
              ['Orders Finished', String(report.costs.length), 'Completed or closed in range'],
              ['Cost Variance', totals.est ? `${totals.act - totals.est >= 0 ? '+' : ''}${inr(totals.act - totals.est)}` : '—', totals.est ? `${inr(totals.act)} actual vs ${inr(totals.est)} estimated` : 'No finished orders'],
            ].map(([label, value, sub]) => (
              <div key={label} style={{ ...sectionStyle, marginBottom: 0, padding: 16 }}>
                <p style={{ fontSize: 11, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 6px' }}>{label}</p>
                <p style={{ fontSize: 24, fontWeight: 700, margin: 0, color: TEXT.heading }}>{value}</p>
                <p style={{ fontSize: 12, color: TEXT.muted, margin: '4px 0 0' }}>{sub}</p>
              </div>
            ))}
          </div>

          <div style={sectionStyle}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <p style={sectionTitle}>Finished Goods Output</p>
              <button type="button" style={secondaryBtnStyle} disabled={!report.output.length}
                onClick={() => downloadCsv(`production_output_${range}.csv`, ['Item Code', 'Item', 'UOM', 'Quantity', 'Work Orders'],
                  report.output.map((r) => [r.item_code, r.item_name, r.uom, r.quantity, r.work_orders]))}>Export CSV</button>
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 600 }}>
                <thead><tr>{['Item', 'UOM', 'Quantity Received', 'Work Orders'].map((h) => <th key={h} style={thStyle}>{h}</th>)}</tr></thead>
                <tbody>
                  {report.output.length === 0 ? (
                    <tr><td colSpan={4} style={{ ...tdStyle, textAlign: 'center', color: TEXT.muted }}>No finished goods were received in this range.</td></tr>
                  ) : report.output.map((r) => (
                    <tr key={r.item_id}>
                      <td style={{ ...tdStyle, fontWeight: 600, color: TEXT.heading }}>{r.item_code} — {r.item_name}</td>
                      <td style={tdStyle}>{r.uom || '—'}</td>
                      <td style={{ ...tdStyle, fontWeight: 600 }}>{r.quantity}</td>
                      <td style={tdStyle}>{r.work_orders}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div style={sectionStyle}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <p style={sectionTitle}>Work Order Cost — Estimated vs Actual</p>
              <button type="button" style={secondaryBtnStyle} disabled={!report.costs.length}
                onClick={() => downloadCsv(`production_cost_${range}.csv`,
                  ['WO Number', 'Product', 'Planned', 'Completed', 'Scrapped', 'Estimated Cost', 'Actual Cost', 'Variance', 'Variance %', 'Cost per Unit'],
                  report.costs.map((c) => [c.wo_number, c.product_name, c.quantity_planned, c.quantity_completed, c.quantity_scrapped, c.estimated_total_cost, c.actual_total_cost, c.variance, c.variance_percent, c.cost_per_unit]))}>Export CSV</button>
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 900 }}>
                <thead><tr>{['WO Number', 'Product', 'Built / Planned', 'Scrap', 'Estimated', 'Actual', 'Variance', 'Cost / Unit'].map((h) => <th key={h} style={thStyle}>{h}</th>)}</tr></thead>
                <tbody>
                  {report.costs.length === 0 ? (
                    <tr><td colSpan={8} style={{ ...tdStyle, textAlign: 'center', color: TEXT.muted }}>No work orders were completed in this range.</td></tr>
                  ) : report.costs.map((c) => (
                    <tr key={c.work_order_id} onClick={() => router.push(`/dashboard/production/work-orders/${c.work_order_id}`)} style={{ cursor: 'pointer' }}>
                      <td style={{ ...tdStyle, fontWeight: 600, color: TEXT.heading }}>{c.wo_number}</td>
                      <td style={tdStyle}>{c.product_name || '—'}</td>
                      <td style={tdStyle}>{c.quantity_completed} / {c.quantity_planned}</td>
                      <td style={tdStyle}>{c.quantity_scrapped}</td>
                      <td style={tdStyle}>{inr(c.estimated_total_cost)}</td>
                      <td style={tdStyle}>{inr(c.actual_total_cost)}</td>
                      <td style={{ ...tdStyle, fontWeight: 600, color: c.variance > 0 ? '#DC2626' : '#16A34A' }}>
                        {c.variance >= 0 ? '+' : ''}{inr(c.variance)}{c.variance_percent != null ? ` (${c.variance_percent}%)` : ''}
                      </td>
                      <td style={tdStyle}>{c.cost_per_unit != null ? inr(c.cost_per_unit) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div style={sectionStyle}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <p style={sectionTitle}>Workstation Utilization</p>
              <button type="button" style={secondaryBtnStyle} disabled={!report.utilization.length}
                onClick={() => downloadCsv(`production_utilization_${range}.csv`, ['Workstation', 'Hours Logged', 'Capacity Hours', 'Utilization %', 'Good Qty', 'Scrap Qty'],
                  report.utilization.map((u) => [u.workstation_name, u.hours_logged, u.capacity_hours, u.utilization_percent, u.qty_good, u.qty_scrap]))}>Export CSV</button>
            </div>
            <p style={{ fontSize: 12, color: TEXT.muted, margin: '0 0 12px' }}>Hours booked ÷ (daily capacity × working days, Monday–Saturday).</p>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 760 }}>
                <thead><tr>{['Workstation', 'Hours Logged', 'Capacity', 'Utilization', 'Good', 'Scrap'].map((h) => <th key={h} style={thStyle}>{h}</th>)}</tr></thead>
                <tbody>
                  {report.utilization.length === 0 ? (
                    <tr><td colSpan={6} style={{ ...tdStyle, textAlign: 'center', color: TEXT.muted }}>No workstations or time bookings in this range.</td></tr>
                  ) : report.utilization.map((u) => (
                    <tr key={u.workstation_id ?? 'none'}>
                      <td style={{ ...tdStyle, fontWeight: 600, color: TEXT.heading }}>{u.workstation_name}</td>
                      <td style={tdStyle}>{u.hours_logged}</td>
                      <td style={tdStyle}>{u.capacity_hours}</td>
                      <td style={{ ...tdStyle, minWidth: 160 }}>
                        {u.utilization_percent != null ? (
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <div style={{ flex: 1, height: 6, borderRadius: 9999, background: 'rgba(0,0,0,0.08)', overflow: 'hidden' }}>
                              <div style={{ width: `${Math.min(u.utilization_percent, 100)}%`, height: '100%', background: u.utilization_percent > 100 ? '#DC2626' : '#2563EB' }} />
                            </div>
                            <span style={{ fontSize: 12 }}>{u.utilization_percent}%</span>
                          </div>
                        ) : '—'}
                      </td>
                      <td style={tdStyle}>{u.qty_good}</td>
                      <td style={{ ...tdStyle, color: u.qty_scrap ? '#DC2626' : TEXT.body }}>{u.qty_scrap}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
