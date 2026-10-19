'use client'

import { useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { salesApi } from '@/lib/api'
import { SalesOrder } from '@/types'
import { TEXT, GLASS, SHADOWS, GRADIENTS } from '@/lib/theme'
import { extractErrorMessages } from '@/lib/validation'
import { formatDate } from '@/lib/format'
import SalesNav from '@/components/sales/SalesNav'
import { inputStyle, thStyle, tdStyle, Pill, ErrorBanner, PageHeader } from '@/components/sales/SalesUi'
import { SO_STATUS_LABELS, SO_STATUS_HEX, LEVEL_LABELS, formatINR } from '@/components/sales/labels'
import { recordPath } from '@/lib/recordRef'
import { useCan } from '@/lib/permissions'

export default function SalesOrdersPage() {
  const { isAuthorized, isLoading } = useRequireApp('sales')
  const { can } = useCan()
  const router = useRouter()
  const searchParams = useSearchParams()
  const [orders, setOrders] = useState<SalesOrder[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | string[]>('')
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState(searchParams.get('status') || '')
  const [mine, setMine] = useState(searchParams.get('mine') === '1')
  const [atRisk, setAtRisk] = useState(false)
  const [month, setMonth] = useState('')

  useEffect(() => {
    if (!isAuthorized) return
    const params: Record<string, unknown> = {}
    if (status) params.status = status
    if (mine) params.pending_my_approval = true
    if (atRisk) params.at_risk = true
    if (/^\d{4}-\d{2}$/.test(month)) params.month = month
    if (search.trim()) params.search = search.trim()
    let ignore = false
    const t = setTimeout(() => {
      salesApi.listOrders(params)
        .then((d) => { if (!ignore) { setOrders(d); setError('') } })
        .catch((err) => { if (!ignore) setError(extractErrorMessages(err, 'Failed to load sales orders.')) })
        .finally(() => { if (!ignore) setLoading(false) })
    }, 250)
    return () => { ignore = true; clearTimeout(t) }
  }, [isAuthorized, status, mine, atRisk, month, search])

  if (isLoading || !isAuthorized) return null

  return (
    <div>
      <SalesNav />
      <PageHeader title="Sales Orders" subtitle="One order per customer PO / LOA. Drafts get their SO number at confirmation.">
        {can('sales', 'orders', 'create') && (
          <button data-tour="sales-orders-new" onClick={() => router.push('/dashboard/sales/orders/new')}
            style={{ padding: '12px 22px', borderRadius: 12, border: 'none', cursor: 'pointer', background: GRADIENTS.primary, color: '#fff', fontSize: 14, fontWeight: 600, boxShadow: `0 8px 20px ${SHADOWS.glowOrange}` }}>
            + New Sales Order
          </button>
        )}
      </PageHeader>
      <ErrorBanner error={error} />

      <div data-tour="sales-orders-filters" style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap', alignItems: 'center' }}>
        <input style={{ ...inputStyle, flex: '1 1 240px', minWidth: 200, maxWidth: 380 }} placeholder="Search SO no., customer, PO / LOA no.…" value={search} onChange={(e) => setSearch(e.target.value)} />
        <select style={{ ...inputStyle, width: 190 }} value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All statuses</option>
          {Object.entries(SO_STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <input style={{ ...inputStyle, width: 150 }} placeholder="Due month YYYY-MM" value={month} onChange={(e) => setMonth(e.target.value)} />
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: TEXT.body, cursor: 'pointer' }}>
          <input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} /> Waiting for my approval
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: TEXT.body, cursor: 'pointer' }}>
          <input type="checkbox" checked={atRisk} onChange={(e) => setAtRisk(e.target.checked)} /> At risk / overdue
        </label>
      </div>

      <div data-tour="sales-orders-table" style={{ borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur, border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), overflow: 'auto', maxHeight: 'calc(100vh - 320px)' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 1150 }}>
          <thead>
            <tr>{['Order', 'Customer', 'Customer PO', 'Value (incl. GST)', 'Units', 'Next due', 'Risk', 'Status', ''].map((h) => <th key={h} style={thStyle}>{h}</th>)}</tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={9} style={{ padding: 20, textAlign: 'center', fontSize: 13, color: TEXT.muted }}>Loading…</td></tr>
            ) : orders.length === 0 ? (
              <tr><td colSpan={9} style={{ padding: 20, textAlign: 'center', fontSize: 13, color: TEXT.muted }}>
                {search || status || mine || atRisk || month ? 'No orders match these filters.' : 'No sales orders yet. Create one from a won inquiry or tender, or directly from a customer PO.'}
              </td></tr>
            ) : orders.map((o) => (
              <tr key={o.id} onClick={() => router.push(recordPath('/dashboard/sales/orders', o))} style={{ cursor: 'pointer' }}>
                <td style={{ ...tdStyle, fontWeight: 600, color: TEXT.heading, whiteSpace: 'nowrap' }}>{o.display_number}</td>
                <td style={tdStyle}>{o.customer_name}</td>
                <td style={tdStyle}>{o.customer_po_number || '—'}{o.customer_po_date ? <span style={{ color: TEXT.muted }}> · {formatDate(o.customer_po_date)}</span> : null}</td>
                <td style={tdStyle}>{formatINR(o.grand_total)}</td>
                <td style={tdStyle}>{o.units_delivered}/{o.units_total}</td>
                <td style={tdStyle}>{formatDate(o.next_due_date)}</td>
                <td style={tdStyle}>
                  {o.units_overdue ? <Pill label={`${o.units_overdue} overdue`} hex="#DC2626" /> : o.units_at_risk ? <Pill label={`${o.units_at_risk} at risk`} hex="#F59E0B" /> : <span style={{ color: TEXT.muted }}>—</span>}
                </td>
                <td style={tdStyle}>
                  <Pill label={SO_STATUS_LABELS[o.status] || o.status} hex={SO_STATUS_HEX[o.status] || '#78716c'} />
                  {(o.approval_stage || o.next_approval_level) && <div style={{ fontSize: 11, color: TEXT.muted, marginTop: 3 }}>with {o.approval_stage || LEVEL_LABELS[o.next_approval_level || '']}</div>}
                </td>
                <td style={tdStyle} onClick={(e) => e.stopPropagation()}>
                  <span onClick={() => router.push(recordPath('/dashboard/sales/orders', o))} style={{ color: '#FF6A2A', fontWeight: 600, cursor: 'pointer' }}>View</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
