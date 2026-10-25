'use client'

import { primaryBtnStyle, RowCount } from '@/components/shared/ui'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { salesApi } from '@/lib/api'
import { SalesDashboard } from '@/types'
import { TEXT } from '@/lib/theme'
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
            style={primaryBtnStyle}>
            + New Sales Order
          </button>
        )}
      </PageHeader>
      <ErrorBanner error={error} />

      <div data-tour="sales-dash-tiles" style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginBottom: 20 }}>
        {tiles.map((tile) => (
          <div key={tile.label} style={{ ...sectionStyle, marginBottom: 0, padding: 16, flex: '1 1 180px' }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: '#57534e', textTransform: 'uppercase' }}>{tile.label}</div>
            <div style={{ fontSize: 22, fontWeight: 700, color: tile.hex || TEXT.heading, marginTop: 6 }}>{tile.value}</div>
            <div style={{ fontSize: 12, color: '#57534e' }}>{tile.sub}</div>
          </div>
        ))}
      </div>

      <div data-tour="sales-dash-risk" style={sectionStyle}>
          <h2 style={h2Style}>Vehicles at risk or overdue</h2>
          {!data?.rows_at_risk.length ? <p style={{ fontSize: 13, color: '#57534e', margin: 0 }}>Every open vehicle is on track. Check the delivery dates on <Link href="/dashboard/sales/delivery" style={{ color: '#c2410c', fontWeight: 600 }}>Delivery</Link> to stay ahead.</p> : (
            <div style={{ overflow: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 720 }}>
                <thead><tr>{['Order', 'Vehicle', 'Due', 'Build', 'Stage', 'Risk', 'LD'].map((h, hi) => <th key={h} style={thStyle}>{h}{hi === 0 && <RowCount count={data.rows_at_risk.length} />}</th>)}</tr></thead>
                <tbody>
                  {data.rows_at_risk.map((r) => (
                    <tr key={r.id} onClick={() => router.push(`${recordPath('/dashboard/sales/orders', r, 'so_id')}?tab=schedule`)} style={{ cursor: 'pointer' }}>
                      <td style={{ ...tdStyle, fontWeight: 600, whiteSpace: 'nowrap' }}>{r.so_display}</td>
                      <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>L{r.line_number}/{r.sequence}</td>
                      <td style={tdStyle}>{formatDate(r.current_delivery_date)}</td>
                      <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>{r.build_number || <span style={{ color: TEXT.muted }}>none</span>}</td>
                      <td style={tdStyle}>{r.build_stage || ROW_STATUS_LABELS[r.status]}</td>
                      <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>{r.risk && <Pill label={r.risk === 'overdue' ? 'Overdue' : 'At risk'} hex={RISK_HEX[r.risk]} />}</td>
                      <td style={tdStyle}>{formatINR((r.ld_amount || 0) + (r.ld_forecast_amount || 0))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

      <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', alignItems: 'flex-start' }}>
        <div style={{ flex: '1 1 380px', minWidth: 0 }}>
        <div data-tour="sales-dash-approvals" style={sectionStyle}>
          <h2 style={h2Style}>Approvals waiting for me</h2>
          {!data?.approvals_waiting_for_me.length ? <p style={{ fontSize: 13, color: '#57534e', margin: 0 }}>Nothing is waiting for your approval. Orders you are asked to approve appear here; open <Link href="/dashboard/sales/orders" style={{ color: '#c2410c', fontWeight: 600 }}>Sales Orders</Link> to see all orders.</p> : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr>{['Order', 'Customer', 'Value', 'As'].map((h, hi) => <th key={h} style={thStyle}>{h}{hi === 0 && <RowCount count={data.approvals_waiting_for_me.length} />}</th>)}</tr></thead>
                <tbody>
                  {data.approvals_waiting_for_me.map((a) => (
                    <tr key={a.id} onClick={() => router.push(recordPath('/dashboard/sales/orders', a))} style={{ cursor: 'pointer' }}>
                      <td style={{ ...tdStyle, fontWeight: 600, whiteSpace: 'nowrap' }}>{a.display_number}</td>
                      <td style={tdStyle}>{a.customer_name}</td>
                      <td style={tdStyle}>{formatINR(a.grand_total)}</td>
                      <td style={tdStyle}>{a.stage || LEVEL_LABELS[a.level || ''] || a.level}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
        </div>
        <div style={{ flex: '1 1 380px', minWidth: 0 }}>
        <div data-tour="sales-dash-extensions" style={sectionStyle}>
          <h2 style={h2Style}>DP extensions waiting for the customer</h2>
          {!data?.extensions_pending.length ? <p style={{ fontSize: 13, color: '#57534e', margin: 0 }}>No delivery-date extensions are waiting. To ask for one, open an order and use its Schedule tab.</p> : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr>{['Order', 'Vehicles', 'Requested date', 'Reason'].map((h, hi) => <th key={h} style={thStyle}>{h}{hi === 0 && <RowCount count={data.extensions_pending.length} />}</th>)}</tr></thead>
                <tbody>
                  {data.extensions_pending.map((e) => (
                    <tr key={e.id} onClick={() => router.push(`${recordPath('/dashboard/sales/orders', e, 'so_id')}?tab=schedule`)} style={{ cursor: 'pointer' }}>
                      <td style={{ ...tdStyle, fontWeight: 600, whiteSpace: 'nowrap' }}>{e.so_display}</td>
                      <td style={tdStyle}>{e.vehicles}</td>
                      <td style={tdStyle}>{formatDate(e.requested_new_date)}</td>
                      <td style={tdStyle}>{EXTENSION_REASON_LABELS[e.reason_category] || e.reason_category}</td>
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
