'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { purchaseOrdersApi } from '@/lib/api'
import { P2PPurchaseOrder } from '@/types'
import { TEXT, GLASS, SHADOWS, BORDER, BRAND } from '@/lib/theme'
import { formatDate } from '@/lib/format'
import { extractErrorMessages } from '@/lib/validation'
import MessageDialog from '@/components/erp/MessageDialog'
import { recordPath } from '@/lib/recordRef'
import OrderProjectPicker, { OrderProjectValue } from '@/components/sales/OrderProjectPicker'

const STATUS_LABELS: Record<string, string> = {
  draft: 'Draft', issued: 'Issued', acknowledged: 'Acknowledged',
  partially_fulfilled: 'Partially Fulfilled', fulfilled: 'Fulfilled', cancelled: 'Cancelled',
}
const STATUS_HEX: Record<string, string> = {
  draft: '#94a3b8', issued: '#3b82f6', acknowledged: '#8b5cf6',
  partially_fulfilled: '#f59e0b', fulfilled: '#22c55e', cancelled: '#94a3b8',
}
// Only these statuses can still be waiting on a delivery — fulfilled/
// cancelled/draft POs are never "overdue" regardless of expected_delivery.
const OPEN_STATUSES = new Set(['issued', 'acknowledged', 'partially_fulfilled'])

function daysOverdue(po: P2PPurchaseOrder): number | null {
  if (!OPEN_STATUSES.has(po.status) || !po.expected_delivery) return null
  const due = new Date(po.expected_delivery)
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  due.setHours(0, 0, 0, 0)
  const diff = Math.round((today.getTime() - due.getTime()) / 86400000)
  return diff > 0 ? diff : null
}

const inputStyle: React.CSSProperties = {
  padding: '9px 12px', borderRadius: 10, border: `1px solid ${BORDER.normal}`,
  background: 'rgba(255,255,255,.7)', fontSize: 13, outline: 'none', color: TEXT.body,
}

// Delivery tracking of every raised PO — the "Tracking" view of Purchase Orders.
export default function POTrackingList() {
  const router = useRouter()
  const [pos, setPos] = useState<P2PPurchaseOrder[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | string[]>('')
  const [statusFilter, setStatusFilter] = useState('')
  const [overdueOnly, setOverdueOnly] = useState(false)
  // Order Project filter (server-side): POs with a line for the project / vehicle / lot.
  const [opFilter, setOpFilter] = useState<OrderProjectValue | null>(null)

  const load = async () => {
    setLoading(true)
    setError('')
    try {
      const data = await purchaseOrdersApi.list({
        ...(statusFilter ? { status: statusFilter } : {}),
        ...(opFilter ? (opFilter.elementId ? { order_project_element_id: opFilter.elementId } : { order_project_id: opFilter.projectId }) : {}),
      })
      setPos(data)
    } catch (err) {
      setError(extractErrorMessages(err, 'Failed to load purchase orders.'))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    Promise.resolve().then(load)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter, opFilter])

  const rows = overdueOnly ? pos.filter((po) => daysOverdue(po) != null) : pos

  return (
    <div>
      <MessageDialog open={!!error} variant="error" title="Cannot Load Purchase Orders" message={error} onClose={() => setError('')} actionLabel="Reload" onAction={() => window.location.reload()} />

      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, marginBottom: 20, flexWrap: 'wrap' }}>
        <p style={{ fontSize: 13, color: TEXT.muted, margin: 0 }}>Delivery status of every raised purchase order.</p>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <select data-tour="p2p-pot-status-filter" style={inputStyle} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="">All Statuses</option>
            {Object.entries(STATUS_LABELS).map(([k, label]) => (
              <option key={k} value={k}>{label}</option>
            ))}
          </select>
          <label data-tour="p2p-pot-overdue-filter" style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: TEXT.body, cursor: 'pointer' }}>
            <input type="checkbox" checked={overdueOnly} onChange={(e) => setOverdueOnly(e.target.checked)} />
            Overdue only
          </label>
          <div aria-label="Filter by order project" style={{ flex: '0 1 300px', minWidth: 240 }}>
            <OrderProjectPicker value={opFilter} onChange={(v) => setOpFilter(v)} requireElement={false} placeholder="All order projects" />
          </div>
        </div>
      </div>

      <div data-tour="p2p-pot-table" style={{ borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur, border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), overflow: 'hidden' }}>
        <div style={{ overflow: 'auto', maxHeight: 'calc(100vh - 360px)' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 950 }}>
            <thead>
              <tr style={{ background: `${BRAND.primary}0d` }}>
                {['PO Number', 'Against PR', 'Vendor', 'PO Date', 'Expected Delivery', 'Buyer', 'Status', 'Overdue'].map((h) => (
                  <th key={h} style={{ textAlign: 'left', padding: '12px 16px', fontSize: 11, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, whiteSpace: 'nowrap', position: 'sticky', top: 0, background: '#fdf1e6', zIndex: 1 }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading && <tr><td colSpan={8} style={{ padding: 24, textAlign: 'center', color: TEXT.muted, fontSize: 13 }}>Loading…</td></tr>}
              {!loading && rows.length === 0 && (
                <tr><td colSpan={8} style={{ padding: 24, textAlign: 'center', color: TEXT.muted, fontSize: 13 }}>No purchase orders found.</td></tr>
              )}
              {rows.map((po) => {
                const overdue = daysOverdue(po)
                const clickable = !!po.p2p_request_id
                return (
                  <tr
                    key={po.id}
                    onClick={() => clickable && router.push(recordPath('/dashboard/p2p', po, 'p2p_request_id'))}
                    style={{ borderTop: '1px solid rgba(0,0,0,0.05)', cursor: clickable ? 'pointer' : 'default' }}
                  >
                    <td style={{ padding: '12px 16px', fontSize: 13, fontWeight: 600, color: TEXT.heading }}>{po.po_number}</td>
                    <td style={{ padding: '12px 16px', fontSize: 13, color: TEXT.secondary }}>{po.p2p_request_number || 'Ad-hoc'}</td>
                    <td style={{ padding: '12px 16px', fontSize: 13, color: TEXT.secondary }}>{po.vendor_name || '—'}</td>
                    <td style={{ padding: '12px 16px', fontSize: 12.5, color: TEXT.secondary, whiteSpace: 'nowrap' }}>{formatDate(po.po_date)}</td>
                    <td style={{ padding: '12px 16px', fontSize: 12.5, color: TEXT.secondary, whiteSpace: 'nowrap' }}>{formatDate(po.expected_delivery) || '—'}</td>
                    <td style={{ padding: '12px 16px', fontSize: 13, color: TEXT.secondary }}>{po.assigned_buyer_name || '—'}</td>
                    <td style={{ padding: '12px 16px' }}>
                      <span data-tour="p2p-pot-status-badge" style={{ fontSize: 11, fontWeight: 600, padding: '4px 10px', borderRadius: 9999, background: `${STATUS_HEX[po.status]}1a`, color: STATUS_HEX[po.status], whiteSpace: 'nowrap' }}>
                        {STATUS_LABELS[po.status] || po.status}
                      </span>
                    </td>
                    <td style={{ padding: '12px 16px' }}>
                      {overdue != null ? (
                        <span data-tour="p2p-pot-overdue-badge" style={{ fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 9999, background: 'rgba(220,38,38,0.1)', color: '#dc2626', whiteSpace: 'nowrap' }}>
                          {overdue}d overdue
                        </span>
                      ) : (
                        <span style={{ color: TEXT.muted, fontSize: 12.5 }}>—</span>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
