'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { purchaseOrdersApi } from '@/lib/api'
import { P2PPurchaseOrder } from '@/types'
import { TEXT, GLASS, SHADOWS, BORDER, BRAND } from '@/lib/theme'
import { formatDate } from '@/lib/format'
import { extractErrorMessages } from '@/lib/validation'
import MessageDialog from '@/components/erp/MessageDialog'
import P2PNav from '@/components/p2p/P2PNav'

const STATUS_LABELS: Record<string, string> = {
  draft: 'Draft', issued: 'Issued', acknowledged: 'Acknowledged',
  partially_fulfilled: 'Partially Fulfilled', fulfilled: 'Fulfilled', cancelled: 'Cancelled',
}
const STATUS_HEX: Record<string, string> = {
  draft: '#94a3b8', issued: '#3b82f6', acknowledged: '#8b5cf6',
  partially_fulfilled: '#f59e0b', fulfilled: '#22c55e', cancelled: '#dc2626',
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

export default function POTrackingPage() {
  const { isAuthorized, isLoading } = useRequireApp('purchase')
  const router = useRouter()
  const [pos, setPos] = useState<P2PPurchaseOrder[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | string[]>('')
  const [statusFilter, setStatusFilter] = useState('')
  const [overdueOnly, setOverdueOnly] = useState(false)

  const load = async () => {
    setLoading(true)
    setError('')
    try {
      const data = await purchaseOrdersApi.list(statusFilter ? { status: statusFilter } : {})
      setPos(data)
    } catch (err: any) {
      setError(extractErrorMessages(err, 'Failed to load purchase orders.'))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (isAuthorized) load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthorized, statusFilter])

  if (isLoading || !isAuthorized) return null

  const rows = overdueOnly ? pos.filter((po) => daysOverdue(po) != null) : pos

  return (
    <div>
      <P2PNav />

      <MessageDialog open={!!error} variant="error" title="Cannot Load Purchase Orders" message={error} onClose={() => setError('')} actionLabel="Reload" onAction={() => window.location.reload()} />

      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, marginBottom: 20, flexWrap: 'wrap' }}>
        <div>
          <p style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 4px' }}>
            Procure-to-Pay Module
          </p>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: TEXT.heading, margin: '0 0 4px' }}>PO Tracking</h1>
          <p style={{ fontSize: 13.5, color: TEXT.muted, margin: 0 }}>Delivery status of every raised purchase order.</p>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <select style={inputStyle} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="">All Statuses</option>
            {Object.entries(STATUS_LABELS).map(([k, label]) => (
              <option key={k} value={k}>{label}</option>
            ))}
          </select>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: TEXT.body, cursor: 'pointer' }}>
            <input type="checkbox" checked={overdueOnly} onChange={(e) => setOverdueOnly(e.target.checked)} />
            Overdue only
          </label>
        </div>
      </div>

      <div style={{ borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur, border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), overflow: 'hidden' }}>
        <div style={{ overflow: 'auto', maxHeight: 'calc(100vh - 320px)' }}>
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
                    onClick={() => clickable && router.push(`/dashboard/p2p/${po.p2p_request_id}`)}
                    style={{ borderTop: '1px solid rgba(0,0,0,0.05)', cursor: clickable ? 'pointer' : 'default' }}
                  >
                    <td style={{ padding: '12px 16px', fontSize: 13, fontWeight: 600, color: TEXT.heading }}>{po.po_number}</td>
                    <td style={{ padding: '12px 16px', fontSize: 13, color: TEXT.secondary }}>{po.p2p_request_number || 'Ad-hoc'}</td>
                    <td style={{ padding: '12px 16px', fontSize: 13, color: TEXT.secondary }}>{po.vendor_name || '—'}</td>
                    <td style={{ padding: '12px 16px', fontSize: 12.5, color: TEXT.secondary, whiteSpace: 'nowrap' }}>{formatDate(po.po_date)}</td>
                    <td style={{ padding: '12px 16px', fontSize: 12.5, color: TEXT.secondary, whiteSpace: 'nowrap' }}>{formatDate(po.expected_delivery) || '—'}</td>
                    <td style={{ padding: '12px 16px', fontSize: 13, color: TEXT.secondary }}>{po.assigned_buyer_name || '—'}</td>
                    <td style={{ padding: '12px 16px' }}>
                      <span style={{ fontSize: 11, fontWeight: 600, padding: '4px 10px', borderRadius: 9999, background: `${STATUS_HEX[po.status]}1a`, color: STATUS_HEX[po.status], whiteSpace: 'nowrap' }}>
                        {STATUS_LABELS[po.status] || po.status}
                      </span>
                    </td>
                    <td style={{ padding: '12px 16px' }}>
                      {overdue != null ? (
                        <span style={{ fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 9999, background: 'rgba(220,38,38,0.1)', color: '#dc2626', whiteSpace: 'nowrap' }}>
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
