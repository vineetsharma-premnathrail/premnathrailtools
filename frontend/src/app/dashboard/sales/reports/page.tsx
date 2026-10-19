'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { salesApi } from '@/lib/api'
import { TEXT } from '@/lib/theme'
import { extractErrorMessages } from '@/lib/validation'
import { formatDate } from '@/lib/format'
import SalesNav from '@/components/sales/SalesNav'
import { sectionStyle, h2Style, thStyle, tdStyle, Pill, ErrorBanner, PageHeader } from '@/components/sales/SalesUi'
import { SO_STATUS_LABELS, SO_STATUS_HEX, formatINR } from '@/components/sales/labels'
import { recordPath } from '@/lib/recordRef'

type BookRow = { id: number; so_number: string; customer_name: string; status: string; order_month: string | null; models: string[]; taxable_total: number; grand_total: number; delivered_value: number; balance_value: number; units_total: number; units_delivered: number; next_due_date: string | null }
type BacklogRow = { month: string; units: number; value: number; at_risk: number; overdue: number; ld_forecast: number }
type LdRow = { so_id: number; so_number: string; customer_name: string; ld_accrued: number; ld_forecast: number; overdue_units: number; at_risk_units: number }

export default function SalesReportsPage() {
  const { isAuthorized, isLoading } = useRequireApp('sales')
  const router = useRouter()
  const [book, setBook] = useState<BookRow[]>([])
  const [backlog, setBacklog] = useState<BacklogRow[]>([])
  const [ld, setLd] = useState<LdRow[]>([])
  const [error, setError] = useState<string | string[]>('')

  useEffect(() => {
    if (!isAuthorized) return
    Promise.all([salesApi.orderBook(), salesApi.backlog(), salesApi.ldExposure()])
      .then(([b, bl, l]) => { setBook(b); setBacklog(bl); setLd(l) })
      .catch((err) => setError(extractErrorMessages(err, 'Failed to load the sales reports.')))
  }, [isAuthorized])

  if (isLoading || !isAuthorized) return null

  return (
    <div>
      <SalesNav />
      <PageHeader title="Sales Reports" subtitle="Order book, backlog by delivery month and LD exposure (computed, not posted)." />
      <ErrorBanner error={error} />

      <div data-tour="sales-report-book" style={sectionStyle}>
        <h2 style={h2Style}>Order book</h2>
        <div style={{ overflow: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 980 }}>
            <thead><tr>{['Order', 'Customer', 'Models', 'Confirmed', 'Taxable value', 'Delivered value', 'Balance', 'Units', 'Next due', 'Status'].map((h) => <th key={h} style={thStyle}>{h}</th>)}</tr></thead>
            <tbody>
              {book.length === 0 ? <tr><td colSpan={10} style={{ ...tdStyle, color: TEXT.muted }}>No open orders.</td></tr> : book.map((r) => (
                <tr key={r.id} onClick={() => router.push(recordPath('/dashboard/sales/orders', r))} style={{ cursor: 'pointer' }}>
                  <td style={{ ...tdStyle, fontWeight: 600 }}>{r.so_number}</td><td style={tdStyle}>{r.customer_name}</td><td style={tdStyle}>{r.models.join(', ') || '—'}</td>
                  <td style={tdStyle}>{r.order_month || '—'}</td><td style={tdStyle}>{formatINR(r.taxable_total)}</td><td style={tdStyle}>{formatINR(r.delivered_value)}</td>
                  <td style={tdStyle}>{formatINR(r.balance_value)}</td><td style={tdStyle}>{r.units_delivered}/{r.units_total}</td><td style={tdStyle}>{formatDate(r.next_due_date)}</td>
                  <td style={tdStyle}><Pill label={SO_STATUS_LABELS[r.status] || r.status} hex={SO_STATUS_HEX[r.status] || '#78716c'} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', alignItems: 'flex-start' }}>
        <div data-tour="sales-report-backlog" style={{ ...sectionStyle, flex: '1 1 420px' }}>
          <h2 style={h2Style}>Backlog by delivery month</h2>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>{['Month', 'Units', 'Value', 'At risk', 'Overdue', 'LD forecast'].map((h) => <th key={h} style={thStyle}>{h}</th>)}</tr></thead>
            <tbody>
              {backlog.length === 0 ? <tr><td colSpan={6} style={{ ...tdStyle, color: TEXT.muted }}>No undelivered vehicles.</td></tr> : backlog.map((b) => (
                <tr key={b.month}>
                  <td style={{ ...tdStyle, fontWeight: 600 }}>{b.month}</td><td style={tdStyle}>{b.units}</td><td style={tdStyle}>{formatINR(b.value)}</td>
                  <td style={{ ...tdStyle, color: b.at_risk ? '#b45309' : undefined }}>{b.at_risk}</td><td style={{ ...tdStyle, color: b.overdue ? '#b91c1c' : undefined }}>{b.overdue}</td>
                  <td style={tdStyle}>{formatINR(b.ld_forecast)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div data-tour="sales-report-ld" style={{ ...sectionStyle, flex: '1 1 420px' }}>
          <h2 style={h2Style}>LD exposure</h2>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>{['Order', 'Customer', 'Overdue', 'At risk', 'Accrued', 'Forecast'].map((h) => <th key={h} style={thStyle}>{h}</th>)}</tr></thead>
            <tbody>
              {ld.length === 0 ? <tr><td colSpan={6} style={{ ...tdStyle, color: TEXT.muted }}>No exposure.</td></tr> : ld.map((r) => (
                <tr key={r.so_id} onClick={() => router.push(`${recordPath('/dashboard/sales/orders', r, 'so_id')}?tab=schedule`)} style={{ cursor: 'pointer' }}>
                  <td style={{ ...tdStyle, fontWeight: 600 }}>{r.so_number}</td><td style={tdStyle}>{r.customer_name}</td><td style={tdStyle}>{r.overdue_units}</td>
                  <td style={tdStyle}>{r.at_risk_units}</td><td style={tdStyle}>{formatINR(r.ld_accrued)}</td><td style={tdStyle}>{formatINR(r.ld_forecast)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
