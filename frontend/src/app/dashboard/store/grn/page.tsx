'use client'

import { useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { goodsReceiptsApi } from '@/lib/api'
import { P2PGoodsReceipt, P2PReceivablePurchaseOrder } from '@/types'
import { TEXT, GLASS, SHADOWS, GRADIENTS, BORDER } from '@/lib/theme'
import { formatDate } from '@/lib/format'
import { extractErrorMessages } from '@/lib/validation'
import StoreNav from '@/components/store/StoreNav'

const primaryBtn: React.CSSProperties = {
  padding: '10px 18px', borderRadius: 10, border: 'none', cursor: 'pointer',
  background: GRADIENTS.primary, color: '#fff', fontSize: 13, fontWeight: 600,
}

const STATUS_LABELS: Record<string, string> = { draft: 'Pending Inspection', completed: 'Completed' }
const STATUS_HEX: Record<string, string> = { draft: '#d97706', completed: '#16a34a' }
const PO_STATUS_LABELS: Record<string, string> = { issued: 'Awaiting Delivery', acknowledged: 'Awaiting Delivery', partially_fulfilled: 'Partially Received' }
const PO_STATUS_HEX: Record<string, string> = { issued: '#2563eb', acknowledged: '#2563eb', partially_fulfilled: '#d97706' }

// Upcoming = approved POs whose goods haven't (fully) arrived yet — no GRN
// exists for the outstanding quantity, so it's a list of POs, not GRNs.
type Bucket = 'upcoming' | 'pending' | 'completed' | 'all'
const BUCKETS: { key: Bucket; label: string; status?: string; emptyLabel: string }[] = [
  { key: 'upcoming', label: 'Upcoming', emptyLabel: 'No approved purchase orders are awaiting delivery.' },
  { key: 'pending', label: 'Pending Inspection', status: 'draft', emptyLabel: 'No goods receipts are waiting for inspection.' },
  { key: 'completed', label: 'Completed', status: 'completed', emptyLabel: 'No completed goods receipts yet.' },
  { key: 'all', label: 'All', emptyLabel: 'No goods receipts recorded yet.' },
]

const thStyle: React.CSSProperties = {
  position: 'sticky', top: 0, background: '#fdf1e6', zIndex: 1, textAlign: 'left', padding: '10px 14px', fontSize: 11.5,
  fontWeight: 700, letterSpacing: '.04em', textTransform: 'uppercase', color: TEXT.muted, borderBottom: `1px solid ${BORDER.normal}`,
}
const tdStyle: React.CSSProperties = { padding: '10px 14px', fontSize: 13, color: TEXT.body, borderBottom: `1px solid ${BORDER.normal}` }

function Badge({ label, hex }: { label: string; hex: string }) {
  return (
    <span style={{ fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 9999, background: `${hex}1a`, color: hex, whiteSpace: 'nowrap' }}>
      {label}
    </span>
  )
}

export default function StoreGrnPage() {
  const { isAuthorized, isLoading, user } = useRequireApp('store')
  const router = useRouter()
  const searchParams = useSearchParams()
  // Receiving against a PO is a Purchase-team action (backend enforces the
  // same), so only they see the Upcoming queue.
  const isPurchaseTeam = !!user?.apps?.includes('purchase')
  const buckets = BUCKETS.filter((b) => b.key !== 'upcoming' || isPurchaseTeam)
  const requested = searchParams.get('bucket') as Bucket
  const bucket: Bucket = buckets.some((b) => b.key === requested) ? requested : buckets[0].key
  const active = buckets.find((b) => b.key === bucket) || buckets[0]

  const [grns, setGrns] = useState<P2PGoodsReceipt[]>([])
  const [upcoming, setUpcoming] = useState<P2PReceivablePurchaseOrder[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | string[]>('')

  useEffect(() => {
    if (!isAuthorized) return
    setLoading(true)
    Promise.all([
      goodsReceiptsApi.list().then(setGrns),
      isPurchaseTeam ? goodsReceiptsApi.listPendingPurchaseOrders().then(setUpcoming) : Promise.resolve(),
    ])
      .catch((err) => setError(extractErrorMessages(err, 'Failed to load goods receipts.')))
      .finally(() => setLoading(false))
  }, [isAuthorized, isPurchaseTeam])

  if (isLoading || !isAuthorized) return null

  const counts: Record<Bucket, number> = {
    upcoming: upcoming.length,
    pending: grns.filter((g) => g.status === 'draft').length,
    completed: grns.filter((g) => g.status === 'completed').length,
    all: grns.length,
  }
  const rows = active.status ? grns.filter((g) => g.status === active.status) : grns

  return (
    <div>
      <StoreNav />

      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', marginBottom: 20 }}>
        <div>
          <p style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 4px' }}>
            Store & Inventory Module
          </p>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: TEXT.heading, margin: 0 }}>Goods Receipt (GRN) & Inspection</h1>
        </div>
        {isPurchaseTeam && <button onClick={() => router.push('/dashboard/store/grn/new')} style={primaryBtn}>+ New Goods Receipt</button>}
      </div>

      <div style={{ display: 'inline-flex', flexWrap: 'wrap', gap: 4, padding: 4, borderRadius: 12, background: 'rgba(0,0,0,0.05)', marginBottom: 16 }}>
        {buckets.map((b) => (
          <button
            key={b.key}
            onClick={() => router.push(`/dashboard/store/grn?bucket=${b.key}`)}
            style={{
              padding: '8px 16px', borderRadius: 8, border: 'none', fontSize: 12.5, fontWeight: 600, cursor: 'pointer',
              background: bucket === b.key ? '#fff' : 'transparent',
              color: bucket === b.key ? '#FF7A45' : '#78716c',
              boxShadow: bucket === b.key ? '0 2px 6px rgba(0,0,0,0.08)' : 'none',
            }}
          >
            {b.label}{!loading && ` (${counts[b.key]})`}
          </button>
        ))}
      </div>

      {error && <p style={{ fontSize: 13, color: '#b91c1c', marginBottom: 16 }}>{Array.isArray(error) ? error.join(' ') : error}</p>}

      <div style={{ borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur, border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), overflow: 'auto', maxHeight: 'calc(100vh - 360px)' }}>
        {bucket === 'upcoming' ? (
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 760 }}>
            <thead>
              <tr>
                {['PO Number', 'PR Number', 'PO Date', 'Vendor', 'Expected Delivery', 'Pending from Vendor', 'Status', ''].map((h) => <th key={h} style={thStyle}>{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={8} style={{ padding: 24, textAlign: 'center', fontSize: 13, color: TEXT.muted }}>Loading…</td></tr>
              ) : upcoming.length === 0 ? (
                <tr><td colSpan={8} style={{ padding: 24, textAlign: 'center', fontSize: 13, color: TEXT.muted }}>{active.emptyLabel}</td></tr>
              ) : (
                upcoming.map((po) => (
                  <tr key={po.id}>
                    <td style={{ ...tdStyle, fontWeight: 600, color: TEXT.heading }}>{po.po_number}</td>
                    <td style={tdStyle}>{po.p2p_number || '—'}</td>
                    <td style={tdStyle}>{po.po_date ? formatDate(po.po_date) : '—'}</td>
                    <td style={tdStyle}>{po.vendor_name || '—'}</td>
                    <td style={tdStyle}>{po.expected_delivery ? formatDate(po.expected_delivery) : '—'}</td>
                    <td style={{ ...tdStyle, fontSize: 12.5 }}>
                      {po.items.filter((it) => it.pending_quantity > 0).map((it) => (
                        <div key={it.id} style={{ whiteSpace: 'nowrap' }}>
                          {it.item_name}: <strong style={{ color: '#d97706' }}>{it.pending_quantity}</strong> of {it.quantity} {it.unit || ''}
                        </div>
                      ))}
                    </td>
                    <td style={tdStyle}>
                      <Badge label={PO_STATUS_LABELS[po.status] || po.status} hex={PO_STATUS_HEX[po.status] || '#64748b'} />
                    </td>
                    <td style={tdStyle}>
                      <span onClick={() => router.push(`/dashboard/store/grn/new?po_id=${po.id}`)} style={{ fontSize: 12.5, fontWeight: 600, color: '#c2410c', cursor: 'pointer', whiteSpace: 'nowrap' }}>
                        Receive →
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 760 }}>
            <thead>
              <tr>
                {['GRN Number', 'PO Number', 'PO Date', 'Vendor', 'Received Date', 'Status', ''].map((h) => <th key={h} style={thStyle}>{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={7} style={{ padding: 24, textAlign: 'center', fontSize: 13, color: TEXT.muted }}>Loading…</td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={7} style={{ padding: 24, textAlign: 'center', fontSize: 13, color: TEXT.muted }}>{active.emptyLabel}</td></tr>
              ) : (
                rows.map((g) => (
                  <tr key={g.id} onClick={() => router.push(`/dashboard/store/grn/${g.id}`)} style={{ cursor: 'pointer' }}>
                    <td style={{ ...tdStyle, fontWeight: 600, color: TEXT.heading }}>{g.grn_number}</td>
                    <td style={tdStyle}>{g.po_number || '—'}</td>
                    <td style={tdStyle}>{g.po_date ? formatDate(g.po_date) : '—'}</td>
                    <td style={tdStyle}>{g.vendor_name || '—'}</td>
                    <td style={tdStyle}>{formatDate(g.received_date)}</td>
                    <td style={tdStyle}>
                      <Badge label={STATUS_LABELS[g.status] || g.status} hex={STATUS_HEX[g.status] || '#64748b'} />
                    </td>
                    <td onClick={(e) => e.stopPropagation()} style={tdStyle}>
                      <span onClick={() => router.push(`/dashboard/store/grn/${g.id}`)} style={{ fontSize: 12.5, fontWeight: 600, color: '#c2410c', cursor: 'pointer' }}>View</span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
