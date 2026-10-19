'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { salesApi } from '@/lib/api'
import { SalesDashboard } from '@/types'
import { TEXT, GRADIENTS, SHADOWS } from '@/lib/theme'
import { extractErrorMessages } from '@/lib/validation'
import { formatDate } from '@/lib/format'
import SalesNav from '@/components/sales/SalesNav'
import { sectionStyle, h2Style, thStyle, tdStyle, Pill, ErrorBanner, PageHeader } from '@/components/sales/SalesUi'
import { formatINR, LEVEL_LABELS, ROW_STATUS_LABELS, EXTENSION_REASON_LABELS } from '@/components/sales/labels'
import { recordPath } from '@/lib/recordRef'
import { useCan } from '@/lib/permissions'

const RISK_HEX: Record<string, string> = { at_risk: '#F59E0B', overdue: '#DC2626' }

export default function SalesDashboardPage() {
  const { isAuthorized, isLoading } = useRequireApp('sales')
  const { can } = useCan()
  const router = useRouter()
  const [data, setData] = useState<SalesDashboard | null>(null)
  const [error, setError] = useState<string | string[]>('')

  useEffect(() => {
    if (!isAuthorized) return
    salesApi.dashboard().then(setData).catch((err) => setError(extractErrorMessages(err, 'Failed to load the sales dashboard.')))
  }, [isAuthorized])

  if (isLoading || !isAuthorized) return null

  const t = data?.tiles
  const tiles = t ? [
    { label: 'Open order value', value: formatINR(t.open_order_value), sub: `${t.open_orders} order(s)` },
    { label: 'Units due this month', value: String(t.units_due_this_month), sub: 'by current delivery date' },
    { label: 'Overdue units', value: String(t.units_overdue), sub: `${t.units_at_risk} more at risk`, hex: t.units_overdue ? '#DC2626' : undefined },
    { label: 'LD accrued', value: formatINR(t.ld_accrued), sub: `forecast ${formatINR(t.ld_forecast)}`, hex: t.ld_accrued ? '#DC2626' : undefined },
    { label: 'Pending approval', value: String(t.pending_approval), sub: 'orders' },
  ] : []

  return (
    <div>
      <SalesNav />
      <PageHeader title="Sales Dashboard" subtitle="Order book, delivery backlog and LD exposure.">
        {can('sales', 'orders', 'create') && (
          <button data-tour="sales-dash-new" onClick={() => router.push('/dashboard/sales/orders/new')}
            style={{ padding: '12px 22px', borderRadius: 12, border: 'none', cursor: 'pointer', background: GRADIENTS.primary, color: '#fff', fontSize: 14, fontWeight: 600, boxShadow: `0 8px 20px ${SHADOWS.glowOrange}` }}>
            + New Sales Order
          </button>
        )}
      </PageHeader>
      <ErrorBanner error={error} />

      <div data-tour="sales-dash-tiles" style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginBottom: 20 }}>
        {tiles.map((tile) => (
          <div key={tile.label} style={{ ...sectionStyle, marginBottom: 0, padding: 16, flex: '1 1 180px' }}>
            <div style={{ fontSize: 11.5, fontWeight: 700, color: TEXT.muted, textTransform: 'uppercase' }}>{tile.label}</div>
            <div style={{ fontSize: 22, fontWeight: 700, color: tile.hex || TEXT.heading, marginTop: 6 }}>{tile.value}</div>
            <div style={{ fontSize: 12, color: TEXT.muted }}>{tile.sub}</div>
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', alignItems: 'flex-start' }}>
        <div style={{ flex: '1 1 420px', minWidth: 0, display: 'flex', flexDirection: 'column' }}>
          <div data-tour="sales-dash-approvals" style={sectionStyle}>
            <h2 style={h2Style}>Approvals waiting for me</h2>
            {!data?.approvals_waiting_for_me.length ? <p style={{ fontSize: 13, color: TEXT.muted, margin: 0 }}>Nothing waiting for your approval.</p> : (
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr>{['Order', 'Customer', 'Value', 'As'].map((h) => <th key={h} style={thStyle}>{h}</th>)}</tr></thead>
                <tbody>
                  {data.approvals_waiting_for_me.map((a) => (
                    <tr key={a.id} onClick={() => router.push(recordPath('/dashboard/sales/orders', a))} style={{ cursor: 'pointer' }}>
                      <td style={{ ...tdStyle, fontWeight: 600 }}>{a.display_number}</td>
                      <td style={tdStyle}>{a.customer_name}</td>
                      <td style={tdStyle}>{formatINR(a.grand_total)}</td>
                      <td style={tdStyle}>{a.stage || LEVEL_LABELS[a.level || ''] || a.level}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
          <div data-tour="sales-dash-extensions" style={sectionStyle}>
            <h2 style={h2Style}>DP extensions waiting for the customer</h2>
            {!data?.extensions_pending.length ? <p style={{ fontSize: 13, color: TEXT.muted, margin: 0 }}>No open DP extension requests.</p> : (
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr>{['Order', 'Vehicles', 'Requested date', 'Reason'].map((h) => <th key={h} style={thStyle}>{h}</th>)}</tr></thead>
                <tbody>
                  {data.extensions_pending.map((e) => (
                    <tr key={e.id} onClick={() => router.push(`${recordPath('/dashboard/sales/orders', e, 'so_id')}?tab=schedule`)} style={{ cursor: 'pointer' }}>
                      <td style={{ ...tdStyle, fontWeight: 600 }}>{e.so_display}</td>
                      <td style={tdStyle}>{e.vehicles}</td>
                      <td style={tdStyle}>{formatDate(e.requested_new_date)}</td>
                      <td style={tdStyle}>{EXTENSION_REASON_LABELS[e.reason_category] || e.reason_category}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
        <div style={{ flex: '1 1 520px', minWidth: 0 }}>
          <div data-tour="sales-dash-risk" style={sectionStyle}>
            <h2 style={h2Style}>Vehicles at risk or overdue</h2>
            {!data?.rows_at_risk.length ? <p style={{ fontSize: 13, color: TEXT.muted, margin: 0 }}>Every open vehicle is on track.</p> : (
              <div style={{ overflow: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 620 }}>
                  <thead><tr>{['Order', 'Vehicle', 'Due', 'Build', 'Stage', 'Risk', 'LD'].map((h) => <th key={h} style={thStyle}>{h}</th>)}</tr></thead>
                  <tbody>
                    {data.rows_at_risk.map((r) => (
                      <tr key={r.id} onClick={() => router.push(`${recordPath('/dashboard/sales/orders', r, 'so_id')}?tab=schedule`)} style={{ cursor: 'pointer' }}>
                        <td style={{ ...tdStyle, fontWeight: 600 }}>{r.so_display}</td>
                        <td style={tdStyle}>L{r.line_number}/{r.sequence}</td>
                        <td style={tdStyle}>{formatDate(r.current_delivery_date)}</td>
                        <td style={tdStyle}>{r.build_number || <span style={{ color: TEXT.muted }}>none</span>}</td>
                        <td style={tdStyle}>{r.build_stage || ROW_STATUS_LABELS[r.status]}</td>
                        <td style={tdStyle}>{r.risk && <Pill label={r.risk === 'overdue' ? 'Overdue' : 'At risk'} hex={RISK_HEX[r.risk]} />}</td>
                        <td style={tdStyle}>{formatINR((r.ld_amount || 0) + (r.ld_forecast_amount || 0))}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
