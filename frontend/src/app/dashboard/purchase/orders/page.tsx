'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { purchaseOrdersApi } from '@/lib/api'
import { P2PPurchaseOrder } from '@/types'
import { TEXT, GLASS, SHADOWS, GRADIENTS, BRAND } from '@/lib/theme'

const STATUS_LABELS: Record<string, string> = {
  draft: 'Draft', issued: 'Issued', acknowledged: 'Acknowledged',
  partially_fulfilled: 'Partially Fulfilled', fulfilled: 'Fulfilled', cancelled: 'Cancelled',
}
const STATUS_HEX: Record<string, string> = {
  draft: '#94a3b8', issued: '#3b82f6', acknowledged: '#8b5cf6',
  partially_fulfilled: '#f59e0b', fulfilled: '#22c55e', cancelled: '#dc2626',
}

export default function PurchaseOrdersPage() {
  const { isAuthorized, isLoading } = useRequireApp('purchase')
  const router = useRouter()
  const [orders, setOrders] = useState<P2PPurchaseOrder[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = async () => {
    setLoading(true)
    setError('')
    try {
      const data = await purchaseOrdersApi.list({ limit: 1000 })
      setOrders(data)
    } catch {
      setError('Failed to load purchase orders.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (isAuthorized) load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthorized])

  if (isLoading || !isAuthorized) return null

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, marginBottom: 20, flexWrap: 'wrap' }}>
        <div>
          <p style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 4px' }}>
            Purchase Module
          </p>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: TEXT.heading, margin: '0 0 4px' }}>Purchase Orders</h1>
          <p style={{ fontSize: 13.5, color: TEXT.muted, margin: 0 }}>{orders.length} PO(s)</p>
        </div>
        <button
          onClick={() => router.push('/dashboard/purchase/orders/new')}
          style={{ padding: '12px 22px', borderRadius: 12, border: 'none', cursor: 'pointer', background: GRADIENTS.primary, color: '#fff', fontSize: 14, fontWeight: 600, boxShadow: `0 8px 20px ${SHADOWS.glowOrange}` }}
        >
          + New PO
        </button>
      </div>

      {error && (
        <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
          {error}
        </div>
      )}

      <div style={{ borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur, border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), overflow: 'auto', maxHeight: 'calc(100vh - 320px)' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 900 }}>
          <thead>
            <tr style={{ background: `${BRAND.primary}0d` }}>
              {['PO Number', 'Vendor', 'Linked PR', 'PO Date', 'Value', 'Status', ''].map((h) => (
                <th key={h} style={{ textAlign: 'left', padding: '12px 16px', fontSize: 11, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, whiteSpace: 'nowrap', position: 'sticky', top: 0, background: '#fdf1e6', zIndex: 1 }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={7} style={{ padding: 24, textAlign: 'center', color: TEXT.muted, fontSize: 13 }}>Loading…</td></tr>}
            {!loading && orders.length === 0 && (
              <tr><td colSpan={7} style={{ padding: 24, textAlign: 'center', color: TEXT.muted, fontSize: 13 }}>No purchase orders yet.</td></tr>
            )}
            {orders.map((po) => (
              <tr key={po.id} onClick={() => router.push(`/dashboard/purchase/orders/${po.id}`)} style={{ borderTop: '1px solid rgba(0,0,0,0.05)', cursor: 'pointer' }}>
                <td style={{ padding: '12px 16px', fontSize: 13, fontWeight: 600, color: TEXT.heading }}>{po.po_number}</td>
                <td style={{ padding: '12px 16px', fontSize: 13, color: TEXT.secondary }}>{po.vendor_name || '—'}</td>
                <td style={{ padding: '12px 16px', fontSize: 13, color: TEXT.secondary }}>{po.p2p_request_number || '—'}</td>
                <td style={{ padding: '12px 16px', fontSize: 12.5, color: TEXT.secondary, whiteSpace: 'nowrap' }}>{new Date(po.po_date).toLocaleDateString()}</td>
                <td style={{ padding: '12px 16px', fontSize: 13, color: TEXT.secondary }}>{po.total_value ?? '—'}</td>
                <td style={{ padding: '12px 16px' }}>
                  <span style={{ fontSize: 11, fontWeight: 600, padding: '4px 10px', borderRadius: 9999, background: `${STATUS_HEX[po.status]}1a`, color: STATUS_HEX[po.status], whiteSpace: 'nowrap' }}>
                    {STATUS_LABELS[po.status] || po.status}
                  </span>
                </td>
                <td style={{ padding: '12px 16px' }} onClick={(e) => e.stopPropagation()}>
                  <span onClick={() => router.push(`/dashboard/purchase/orders/${po.id}`)} style={{ fontSize: 11.5, fontWeight: 600, color: '#2563eb', cursor: 'pointer' }}>View</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
