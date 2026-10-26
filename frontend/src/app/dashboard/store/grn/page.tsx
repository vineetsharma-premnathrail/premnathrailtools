'use client'

import { useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { goodsReceiptsApi } from '@/lib/api'
import { P2PGoodsReceipt, P2PReceivablePurchaseOrder } from '@/types'
import { TEXT, GLASS, SHADOWS, BORDER } from '@/lib/theme'
import { formatDate } from '@/lib/format'
import { extractErrorMessages } from '@/lib/validation'
import { useCan } from '@/lib/permissions'
import StoreNav from '@/components/store/StoreNav'
import { recordHref, recordPath } from '@/lib/recordRef'
import { primaryBtnStyle, segmentBtnStyle, smallSecondaryBtnStyle, RowCount, Pill } from '@/components/shared/ui'

const primaryBtn = primaryBtnStyle

const STATUS_LABELS: Record<string, string> = { draft: 'Pending Inspection', completed: 'Completed', reversed: 'Reversed' }
const STATUS_HEX: Record<string, string> = { draft: '#d97706', completed: '#16a34a', reversed: '#dc2626' }
const PO_STATUS_LABELS: Record<string, string> = { issued: 'Awaiting Delivery', acknowledged: 'Awaiting Delivery', partially_fulfilled: 'Partially Received' }
const PO_STATUS_HEX: Record<string, string> = { issued: '#2563eb', acknowledged: '#2563eb', partially_fulfilled: '#d97706' }

// Upcoming = approved POs whose goods haven't (fully) arrived yet — no GRN
// exists for the outstanding quantity, so it's a list of POs, not GRNs.
type Bucket = 'upcoming' | 'pending' | 'completed' | 'all'
const BUCKETS: { key: Bucket; label: string; status?: string; emptyLabel: string }[] = [
  { key: 'upcoming', label: 'Upcoming', emptyLabel: 'No approved purchase orders are awaiting delivery — issued POs appear here until their goods arrive.' },
  { key: 'pending', label: 'Pending Inspection', status: 'draft', emptyLabel: 'No goods receipts are waiting for inspection.' },
  { key: 'completed', label: 'Completed', status: 'completed', emptyLabel: 'No completed goods receipts yet.' },
  { key: 'all', label: 'All', emptyLabel: 'No goods receipts recorded yet — receive a delivery from the Upcoming tab or + New Goods Receipt.' },
]

const thStyle: React.CSSProperties = {
  position: 'sticky', top: 0, background: '#fdf1e6', zIndex: 1, textAlign: 'left', padding: '10px 14px', fontSize: 11.5,
  fontWeight: 700, letterSpacing: '.04em', textTransform: 'uppercase', color: TEXT.muted, borderBottom: `1px solid ${BORDER.normal}`,
}
const tdStyle: React.CSSProperties = { padding: '10px 14px', fontSize: 13, color: TEXT.body, borderBottom: `1px solid ${BORDER.normal}` }

export default function StoreGrnPage() {
  const { isAuthorized, isLoading, user } = useRequireApp('store')
  const { can } = useCan()
  const router = useRouter()
  const searchParams = useSearchParams()
  // Goods land in the store, so Store keepers record GRNs as well as the
  // Purchase team (plan §16 #3 — backend accepts either app).
  const isPurchaseTeam = user?.role === 'admin' || !!user?.apps?.some((a) => a === 'store' || a === 'purchase')
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
          <p style={{ fontSize: 13, color: TEXT.muted, margin: '4px 0 0' }}>Record goods that arrive against a purchase order, then inspect them into Free stock.</p>
        </div>
        {isPurchaseTeam && can('store', 'grn', 'create') && <button data-tour="store-grn-new-btn" onClick={() => router.push('/dashboard/store/grn/new')} style={primaryBtn}>+ New Goods Receipt</button>}
      </div>

      <div data-tour="store-grn-buckets" style={{ display: 'inline-flex', flexWrap: 'wrap', gap: 4, marginBottom: 16 }}>
        {buckets.map((b) => (
          <button
            key={b.key}
            onClick={() => router.push(`/dashboard/store/grn?bucket=${b.key}`)}
            style={segmentBtnStyle(bucket === b.key)}
          >
            {b.label}{!loading && ` (${counts[b.key]})`}
          </button>
        ))}
      </div>

      {error && <p style={{ fontSize: 13, color: '#b91c1c', marginBottom: 16 }}>{Array.isArray(error) ? error.join(' ') : error}</p>}

      <div data-tour="store-grn-table" style={{ borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur, border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), overflow: 'auto', maxHeight: 'calc(100vh - 360px)' }}>
        {bucket === 'upcoming' ? (
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 760 }}>
            <thead>
              <tr>
                {['PO Number', 'PR Number', 'PO Date', 'Vendor', 'Expected Delivery', 'Pending from Vendor', 'Status', ''].map((h, hi) => <th key={h} style={thStyle}>{h}{hi === 0 && <RowCount count={upcoming.length} />}</th>)}
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
                          {it.item_name}: <strong style={{ color: '#d97706' }}>{it.pending_quantity.toLocaleString('en-IN')}</strong> of {it.quantity.toLocaleString('en-IN')} {it.unit || ''}
                        </div>
                      ))}
                    </td>
                    <td style={tdStyle}>
                      <Pill label={PO_STATUS_LABELS[po.status] || po.status} hex={PO_STATUS_HEX[po.status] || '#64748b'} />
                    </td>
                    <td style={tdStyle}>
                      <button type="button" onClick={() => router.push(recordHref('/dashboard/store/grn/new', po, 'id', undefined, 'po_id'))} style={smallSecondaryBtnStyle}>
                        Receive →
                      </button>
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
                {['GRN Number', 'PO Number', 'PO Date', 'Vendor', 'Received Date', 'Status', ''].map((h, hi) => <th key={h} style={thStyle}>{h}{hi === 0 && <RowCount count={rows.length} />}</th>)}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={7} style={{ padding: 24, textAlign: 'center', fontSize: 13, color: TEXT.muted }}>Loading…</td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={7} style={{ padding: 24, textAlign: 'center', fontSize: 13, color: TEXT.muted }}>{active.emptyLabel}</td></tr>
              ) : (
                rows.map((g) => (
                  <tr key={g.id} onClick={() => router.push(recordPath('/dashboard/store/grn', g))} style={{ cursor: 'pointer' }}>
                    <td style={{ ...tdStyle, fontWeight: 600, color: TEXT.heading }}>{g.grn_number}</td>
                    <td style={tdStyle}>{g.po_number || '—'}</td>
                    <td style={tdStyle}>{g.po_date ? formatDate(g.po_date) : '—'}</td>
                    <td style={tdStyle}>{g.vendor_name || '—'}</td>
                    <td style={tdStyle}>{formatDate(g.received_date)}</td>
                    <td style={tdStyle}>
                      <Pill label={STATUS_LABELS[g.status] || g.status} hex={STATUS_HEX[g.status] || '#64748b'} />
                    </td>
                    <td onClick={(e) => e.stopPropagation()} style={tdStyle}>
                      <button type="button" onClick={() => router.push(recordPath('/dashboard/store/grn', g))} style={smallSecondaryBtnStyle}>View</button>
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
