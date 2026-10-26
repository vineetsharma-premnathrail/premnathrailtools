'use client'

import Select from '@/components/shared/Select'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { salesApi } from '@/lib/api'
import { SalesOrderSchedule, SalesExtension } from '@/types'
import { TEXT, GLASS, SHADOWS } from '@/lib/theme'
import { extractErrorMessages } from '@/lib/validation'
import { formatDate } from '@/lib/format'
import SalesNav from '@/components/sales/SalesNav'
import { sectionStyle, h2Style, inputStyle, thStyle, tdStyle, Pill, ErrorBanner, PageHeader } from '@/components/sales/SalesUi'
import { ROW_STATUS_LABELS, ROW_STATUS_HEX, EXTENSION_REASON_LABELS, formatINR } from '@/components/sales/labels'
import { recordPath } from '@/lib/recordRef'
import { RowCount } from '@/components/shared/ui'

export default function SalesDeliveryPage() {
  const { isAuthorized, isLoading } = useRequireApp('sales')
  const router = useRouter()
  const [rows, setRows] = useState<SalesOrderSchedule[]>([])
  const [exts, setExts] = useState<SalesExtension[]>([])
  const [extError, setExtError] = useState<string | string[]>('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | string[]>('')
  const [risk, setRisk] = useState('')
  const [status, setStatus] = useState('')
  const [month, setMonth] = useState('')

  useEffect(() => {
    if (!isAuthorized) return
    const params: Record<string, unknown> = {}
    if (risk) params.risk = risk
    if (status) params.status = status
    if (/^\d{4}-\d{2}$/.test(month)) params.month = month
    salesApi.schedule(params).then((d) => { setRows(d); setError('') })
      .catch((err) => setError(extractErrorMessages(err, 'Failed to load the delivery schedule.')))
      .finally(() => setLoading(false))
  }, [isAuthorized, risk, status, month])

  useEffect(() => {
    if (!isAuthorized) return
    salesApi.listAllExtensions({ status: 'requested' })
      .then((d) => { setExts(d); setExtError('') })
      .catch((err) => { setExts([]); setExtError(extractErrorMessages(err, 'Could not load the open DP extension requests — reload the page; if it keeps failing, check your connection.')) })
  }, [isAuthorized])

  if (isLoading || !isAuthorized) return null

  // Group by due month for the board view.
  const groups: Record<string, SalesOrderSchedule[]> = {}
  rows.forEach((r) => { const k = r.current_delivery_date ? r.current_delivery_date.slice(0, 7) : 'Undated'; (groups[k] = groups[k] || []).push(r) })

  return (
    <div>
      <SalesNav />
      <PageHeader title="Delivery Schedule" subtitle="Every open vehicle across confirmed orders, by due month — with its build stage, risk and LD." />
      <ErrorBanner error={error} />

      <div data-tour="sales-delivery-filters" style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
        <Select style={{ ...inputStyle, width: 180 }} value={risk} onChange={(e) => setRisk(e.target.value)}>
          <option value="">All vehicles</option>
          <option value="any">At risk or overdue</option>
          <option value="at_risk">At risk</option>
          <option value="overdue">Overdue</option>
        </Select>
        <Select style={{ ...inputStyle, width: 180 }} value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All stages</option>
          {['open', 'build_planned', 'in_production', 'ready', 'dispatched'].map((s) => <option key={s} value={s}>{ROW_STATUS_LABELS[s]}</option>)}
        </Select>
        <input style={{ ...inputStyle, width: 160 }} placeholder="Month YYYY-MM" value={month} onChange={(e) => setMonth(e.target.value)} />
      </div>

      <div data-tour="sales-delivery-board" style={{ borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur, border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), overflow: 'auto', maxHeight: 'calc(100vh - 360px)', marginBottom: 20 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 1100 }}>
          <thead><tr>{['Due', 'Order', 'Customer', 'Vehicle', 'Consignee', 'Build', 'Stage', 'Status', 'Risk', 'LD accrued', 'LD forecast'].map((h, hi) => <th key={h} style={thStyle}>{h}{hi === 0 && <RowCount count={rows.length} />}</th>)}</tr></thead>
          <tbody>
            {loading ? <tr><td colSpan={11} style={{ padding: 20, textAlign: 'center', color: TEXT.muted, fontSize: 13 }}>Loading…</td></tr>
              : rows.length === 0 ? <tr><td colSpan={11} style={{ padding: 20, textAlign: 'center', color: TEXT.muted, fontSize: 13 }}>No open vehicles match.</td></tr>
                : Object.entries(groups).map(([m, list]) => [
                  <tr key={`h-${m}`}><td colSpan={11} style={{ ...tdStyle, background: 'rgba(0,0,0,.03)', fontWeight: 700 }}>{m} · {list.length} vehicle(s)</td></tr>,
                  ...list.map((r) => (
                    <tr key={r.id} onClick={() => router.push(`${recordPath('/dashboard/sales/orders', r, 'so_id')}?tab=schedule`)} style={{ cursor: 'pointer' }}>
                      <td style={tdStyle}>{formatDate(r.current_delivery_date)}</td>
                      <td style={{ ...tdStyle, fontWeight: 600 }}>{r.so_display}</td>
                      <td style={tdStyle}>{r.customer_name}</td>
                      <td style={tdStyle}>L{r.line_number}/{r.sequence} {r.rrv_model ? <span style={{ color: TEXT.muted }}>{r.rrv_model}</span> : null}</td>
                      <td style={tdStyle}>{r.consignee_name || '—'}</td>
                      <td style={tdStyle}>{r.build_number || <span style={{ color: TEXT.muted }}>not linked</span>}</td>
                      <td style={tdStyle}>{r.build_stage || '—'}</td>
                      <td style={tdStyle}><Pill label={ROW_STATUS_LABELS[r.status] || r.status} hex={ROW_STATUS_HEX[r.status] || '#78716c'} /></td>
                      <td style={tdStyle}>{r.risk ? <Pill label={r.risk === 'overdue' ? 'Overdue' : 'At risk'} hex={r.risk === 'overdue' ? '#DC2626' : '#F59E0B'} /> : '—'}</td>
                      <td style={tdStyle}>{r.ld_amount ? formatINR(r.ld_amount) : '—'}</td>
                      <td style={tdStyle}>{r.ld_forecast_amount ? formatINR(r.ld_forecast_amount) : '—'}</td>
                    </tr>
                  )),
                ])}
          </tbody>
        </table>
      </div>

      <div data-tour="sales-delivery-extensions" style={sectionStyle}>
        <h2 style={h2Style}>DP extensions waiting for the customer</h2>
        <ErrorBanner error={extError} />
        {extError ? null : exts.length === 0 ? <p style={{ fontSize: 13, color: TEXT.muted, margin: 0 }}>None open. Request an extension from the order&apos;s Delivery Schedule tab.</p> : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr>{['Order', 'Customer', 'Vehicles', 'Requested date', 'Reason'].map((h, hi) => <th key={h} style={thStyle}>{h}{hi === 0 && <RowCount count={exts.length} />}</th>)}</tr></thead>
              <tbody>{exts.map((e) => (
                <tr key={e.id} onClick={() => router.push(`${recordPath('/dashboard/sales/orders', e, 'so_id')}?tab=schedule`)} style={{ cursor: 'pointer' }}>
                  <td style={{ ...tdStyle, fontWeight: 600 }}>{e.so_display}</td><td style={tdStyle}>{e.customer_name}</td><td style={tdStyle}>{e.vehicles.join(', ')}</td>
                  <td style={tdStyle}>{formatDate(e.requested_new_date)}</td><td style={tdStyle}>{EXTENSION_REASON_LABELS[e.reason_category]}: {e.reason}</td>
                </tr>))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
