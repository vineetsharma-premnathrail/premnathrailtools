'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { purchaseOrdersApi } from '@/lib/api'
import { P2PPurchaseOrder } from '@/types'
import { TEXT, GLASS, SHADOWS, BORDER } from '@/lib/theme'
import { secondaryBtnStyle } from '@/components/shared/ui'

const STATUS_LABELS: Record<string, string> = {
  draft: 'Draft', issued: 'Issued', acknowledged: 'Acknowledged',
  partially_fulfilled: 'Partially Fulfilled', fulfilled: 'Fulfilled', cancelled: 'Cancelled',
}
const STATUS_HEX: Record<string, string> = {
  draft: '#94a3b8', issued: '#3b82f6', acknowledged: '#8b5cf6',
  partially_fulfilled: '#f59e0b', fulfilled: '#22c55e', cancelled: '#dc2626',
}
const NEXT_STATUS: Record<string, string[]> = {
  draft: ['issued', 'cancelled'],
  issued: ['acknowledged', 'cancelled'],
  acknowledged: ['partially_fulfilled', 'fulfilled', 'cancelled'],
  partially_fulfilled: ['fulfilled', 'cancelled'],
  fulfilled: [],
  cancelled: [],
}

const sectionStyle: React.CSSProperties = {
  borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur,
  border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), padding: 20, marginBottom: 20,
}
const ghostBtn: React.CSSProperties = {
  padding: '9px 16px', borderRadius: 10, border: `1px solid ${BORDER.normal}`, cursor: 'pointer',
  background: 'transparent', color: TEXT.secondary, fontSize: 12.5, fontWeight: 600,
}

export default function PurchaseOrderDetailPage() {
  const { isAuthorized, isLoading } = useRequireApp('purchase')
  const params = useParams()
  const router = useRouter()
  const poId = Number(params.id)

  const [po, setPo] = useState<P2PPurchaseOrder | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const load = async () => {
    setLoading(true)
    setError('')
    try {
      const data = await purchaseOrdersApi.get(poId)
      setPo(data)
    } catch {
      setError('Purchase order not found.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (isAuthorized && poId) load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthorized, poId])

  const setStatus = async (status: string) => {
    if (!window.confirm(`Move this PO to "${STATUS_LABELS[status] || status}"?`)) return
    setBusy(true)
    setError('')
    try {
      await purchaseOrdersApi.update(poId, { status })
      await load()
    } catch (e: unknown) {
      const err = e as { response?: { data?: { detail?: string } } }
      setError(err.response?.data?.detail || 'Failed to update status.')
    } finally {
      setBusy(false)
    }
  }

  if (isLoading || !isAuthorized) return null
  if (loading) return <p style={{ fontSize: 13, color: TEXT.secondary }}>Loading…</p>
  if (error && !po) return <p style={{ fontSize: 13, color: '#b91c1c' }}>{error}</p>
  if (!po) return null

  const statusColor = STATUS_HEX[po.status] || '#64748b'

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, marginBottom: 20, flexWrap: 'wrap' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
            <h1 style={{ fontSize: 22, fontWeight: 700, color: TEXT.heading, margin: 0 }}>{po.po_number}</h1>
            <span style={{ fontSize: 11.5, fontWeight: 600, padding: '4px 10px', borderRadius: 9999, background: `${statusColor}1a`, color: statusColor }}>
              {STATUS_LABELS[po.status] || po.status}
            </span>
          </div>
          <p style={{ fontSize: 13, color: TEXT.secondary, margin: 0 }}>{po.vendor_name || 'No vendor specified'}{po.p2p_request_number ? ` · from ${po.p2p_request_number}` : ''}</p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button onClick={() => router.push('/dashboard/purchase/orders')} type="button" style={secondaryBtnStyle}>
            ← Back
          </button>
          {(NEXT_STATUS[po.status] || []).map((s) => (
            <button key={s} disabled={busy} onClick={() => setStatus(s)} style={ghostBtn}>
              Mark {STATUS_LABELS[s] || s}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
          {error}
        </div>
      )}

      <div style={sectionStyle}>
        <h2 style={{ fontSize: 15, fontWeight: 700, color: TEXT.heading, margin: '0 0 14px' }}>Order Details</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14 }}>
          <InfoRow label="PO Date" value={new Date(po.po_date).toLocaleDateString()} />
          <InfoRow label="Expected Delivery" value={po.expected_delivery ? new Date(po.expected_delivery).toLocaleDateString() : '—'} />
          <InfoRow label="Total Value" value={po.total_value != null ? String(po.total_value) : '—'} />
          <InfoRow label="Created By" value={po.created_by_name || '—'} />
        </div>
        {po.delivery_terms && <div style={{ marginTop: 10 }}><InfoRow label="Delivery Terms" value={po.delivery_terms} /></div>}
      </div>

      <div style={{ ...sectionStyle, overflow: 'auto' }}>
        <h2 style={{ fontSize: 15, fontWeight: 700, color: TEXT.heading, margin: '0 0 14px' }}>Item Details</h2>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 800 }}>
          <thead>
            <tr>
              {['Item Description', 'Make', 'Part Code', 'UOM', 'Qty', 'Unit Price', 'Tax %', 'Line Total'].map((h) => (
                <th key={h} style={{ textAlign: 'left', padding: '8px 10px', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', color: TEXT.muted }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {po.items.map((it) => (
              <tr key={it.id} style={{ borderTop: `1px solid ${BORDER.light}` }}>
                <td style={{ padding: '8px 10px', fontSize: 13 }}>{it.item_name}</td>
                <td style={{ padding: '8px 10px', fontSize: 13, color: TEXT.secondary }}>{it.make || '—'}</td>
                <td style={{ padding: '8px 10px', fontSize: 13, color: TEXT.secondary }}>{it.part_code || '—'}</td>
                <td style={{ padding: '8px 10px', fontSize: 13, color: TEXT.secondary }}>{it.unit || '—'}</td>
                <td style={{ padding: '8px 10px', fontSize: 13 }}>{it.quantity}</td>
                <td style={{ padding: '8px 10px', fontSize: 13, color: TEXT.secondary }}>{it.unit_price ?? '—'}</td>
                <td style={{ padding: '8px 10px', fontSize: 13, color: TEXT.secondary }}>{it.tax_rate ?? '—'}</td>
                <td style={{ padding: '8px 10px', fontSize: 13, color: TEXT.secondary }}>{it.line_total ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p style={{ fontSize: 10.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 3px' }}>{label}</p>
      <p style={{ fontSize: 13.5, color: TEXT.body, margin: 0 }}>{value}</p>
    </div>
  )
}
