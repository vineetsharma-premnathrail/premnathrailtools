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
import { useVisibility } from '@/lib/visibility'
import { VisTd, VisTh } from '@/lib/visibilityComponents'
import { sampleGrns, sampleReceivablePos } from '@/lib/storePreviewSamples'

// Columns a role may hide (Store › GRN & Inspection › Visibility); GRN / PO number and Status are always shown.
const RECEIPT_HIDEABLE: Record<string, string> = { 'PO Number': 'purchase_order', 'PO Date': 'po_date', Vendor: 'vendor', 'Received Date': 'received_date' }
const UPCOMING_HIDEABLE: Record<string, string> = { 'PR Number': 'requisition', 'PO Date': 'po_date', Vendor: 'vendor', 'Expected Delivery': 'expected_delivery', 'Pending from Vendor': 'pending' }

const primaryBtn = primaryBtnStyle

const STATUS_LABELS: Record<string, string> = { draft: 'Pending quality check', completed: 'Completed', reversed: 'Reversed' }
const STATUS_HEX: Record<string, string> = { draft: '#d97706', completed: '#16a34a', reversed: '#dc2626' }
const PO_STATUS_LABELS: Record<string, string> = { issued: 'Awaiting Delivery', acknowledged: 'Awaiting Delivery', partially_fulfilled: 'Partially Received' }
const PO_STATUS_HEX: Record<string, string> = { issued: '#2563eb', acknowledged: '#2563eb', partially_fulfilled: '#d97706' }

// Upcoming = approved POs whose goods haven't (fully) arrived yet — no GRN
// exists for the outstanding quantity, so it's a list of POs, not GRNs.
type Bucket = 'upcoming' | 'pending' | 'completed' | 'all'
const BUCKETS: { key: Bucket; label: string; status?: string; emptyLabel: string }[] = [
  { key: 'upcoming', label: 'Upcoming', emptyLabel: 'No approved purchase orders are awaiting delivery — issued POs appear here until their goods arrive.' },
  { key: 'pending', label: 'Pending quality check', status: 'draft', emptyLabel: 'No goods receipts are waiting for a quality check.' },
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
  const vis = useVisibility('store:grn')
  const router = useRouter()
  const searchParams = useSearchParams()
  // Goods land in the store, so Store keepers record GRNs as well as the
  // Purchase team (plan §16 #3 — backend accepts either app).
  const isPurchaseTeam = user?.role === 'admin' || !!user?.apps?.some((a) => a === 'store' || a === 'purchase')
  const buckets = BUCKETS.filter((b) => b.key !== 'upcoming' || isPurchaseTeam)
  // Role editor preview: the tabs switch locally (no navigation) and the tables draw made-up rows.
  const [previewBucket, setPreviewBucket] = useState<Bucket>('all')
  const requested = vis.preview ? previewBucket : (searchParams.get('bucket') as Bucket)
  const bucket: Bucket = buckets.some((b) => b.key === requested) ? requested : buckets[0].key
  const active = buckets.find((b) => b.key === bucket) || buckets[0]

  const [grns, setGrns] = useState<P2PGoodsReceipt[]>(vis.preview ? sampleGrns : [])
  const [upcoming, setUpcoming] = useState<P2PReceivablePurchaseOrder[]>(vis.preview ? sampleReceivablePos : [])
  const [loading, setLoading] = useState(!vis.preview)
  const [error, setError] = useState<string | string[]>('')

  useEffect(() => {
    if (!isAuthorized) return
    if (vis.preview) return
    setLoading(true)
    Promise.all([
      goodsReceiptsApi.list().then(setGrns),
      isPurchaseTeam ? goodsReceiptsApi.listPendingPurchaseOrders().then(setUpcoming) : Promise.resolve(),
    ])
      .catch((err) => setError(extractErrorMessages(err, 'Failed to load goods receipts.')))
      .finally(() => setLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthorized, isPurchaseTeam, vis.preview])

  if (isLoading || !isAuthorized) return null

  const counts: Record<Bucket, number> = {
    upcoming: upcoming.length,
    pending: grns.filter((g) => g.status === 'draft').length,
    completed: grns.filter((g) => g.status === 'completed').length,
    all: grns.length,
  }
  const rows = active.status ? grns.filter((g) => g.status === active.status) : grns
  // The preview draws every column (hidden ones dimmed, with a toggle); normal use drops the hidden ones.
  const showUp = (h: string) => !UPCOMING_HIDEABLE[h] || vis.preview || vis.showColumn('upcoming', UPCOMING_HIDEABLE[h])
  const upHeaders = ['PO Number', 'PR Number', 'PO Date', 'Vendor', 'Expected Delivery', 'Pending from Vendor', 'Status', ''].filter(showUp)
  const showRc = (h: string) => !RECEIPT_HIDEABLE[h] || vis.preview || vis.showColumn('receipts', RECEIPT_HIDEABLE[h])
  const rcHeaders = ['GRN Number', 'PO Number', 'PO Date', 'Vendor', 'Received Date', 'Status'].filter(showRc)

  return (
    <div>
      {!vis.preview && <StoreNav />}

      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', marginBottom: 20 }}>
        <div>
          <p style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 4px' }}>
            Store & Inventory Module
          </p>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: TEXT.heading, margin: 0 }}>Goods Receipt (GRN) & Quality check</h1>
          <p style={{ fontSize: 13, color: TEXT.muted, margin: '4px 0 0' }}>Record goods that arrive against a purchase order. Items flagged for a quality check wait for Quality; the rest go straight into Free stock.</p>
        </div>
        {isPurchaseTeam && can('store', 'grn', 'create') && <button data-tour="store-grn-new-btn" onClick={() => router.push('/dashboard/store/grn/new')} style={primaryBtn}>+ New Goods Receipt</button>}
      </div>

      <div data-tour="store-grn-buckets" style={{ display: 'inline-flex', flexWrap: 'wrap', gap: 4, marginBottom: 16 }}>
        {buckets.map((b) => (
          <button
            key={b.key}
            onClick={() => (vis.preview ? setPreviewBucket(b.key) : router.push(`/dashboard/store/grn?bucket=${b.key}`))}
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
                {upHeaders.map((h, hi) => UPCOMING_HIDEABLE[h]
                  ? <VisTh key={h} vis={vis} table="upcoming" k={UPCOMING_HIDEABLE[h]} style={thStyle}>{h}</VisTh>
                  : <th key={h} style={thStyle}>{h}{hi === 0 && <RowCount count={upcoming.length} />}</th>)}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={upHeaders.length} style={{ padding: 24, textAlign: 'center', fontSize: 13, color: TEXT.muted }}>Loading…</td></tr>
              ) : upcoming.length === 0 ? (
                <tr><td colSpan={upHeaders.length} style={{ padding: 24, textAlign: 'center', fontSize: 13, color: TEXT.muted }}>{active.emptyLabel}</td></tr>
              ) : (
                upcoming.map((po) => (
                  <tr key={po.id}>
                    <td style={{ ...tdStyle, fontWeight: 600, color: TEXT.heading }}>{po.po_number}</td>
                    <VisTd vis={vis} table="upcoming" k="requisition" style={tdStyle}>{po.p2p_number || '—'}</VisTd>
                    <VisTd vis={vis} table="upcoming" k="po_date" style={tdStyle}>{po.po_date ? formatDate(po.po_date) : '—'}</VisTd>
                    <VisTd vis={vis} table="upcoming" k="vendor" style={tdStyle}>{po.vendor_name || '—'}</VisTd>
                    <VisTd vis={vis} table="upcoming" k="expected_delivery" style={tdStyle}>{po.expected_delivery ? formatDate(po.expected_delivery) : '—'}</VisTd>
                    <VisTd vis={vis} table="upcoming" k="pending" style={{ ...tdStyle, fontSize: 12.5 }}>
                      {po.items.filter((it) => it.pending_quantity > 0).map((it) => (
                        <div key={it.id} style={{ whiteSpace: 'nowrap' }}>
                          {it.item_name}: <strong style={{ color: '#d97706' }}>{it.pending_quantity.toLocaleString('en-IN')}</strong> of {it.quantity.toLocaleString('en-IN')} {it.unit || ''}
                        </div>
                      ))}
                    </VisTd>
                    <td style={tdStyle}>
                      <Pill label={PO_STATUS_LABELS[po.status] || po.status} hex={PO_STATUS_HEX[po.status] || '#64748b'} />
                    </td>
                    <td style={tdStyle}>
                      <button type="button" disabled={vis.preview} onClick={() => router.push(recordHref('/dashboard/store/grn/new', po, 'id', undefined, 'po_id'))} style={smallSecondaryBtnStyle}>
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
                {rcHeaders.map((h, hi) => RECEIPT_HIDEABLE[h]
                  ? <VisTh key={h} vis={vis} table="receipts" k={RECEIPT_HIDEABLE[h]} style={thStyle}>{h}</VisTh>
                  : <th key={h} style={thStyle}>{h}{hi === 0 && <RowCount count={rows.length} />}</th>)}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={rcHeaders.length} style={{ padding: 24, textAlign: 'center', fontSize: 13, color: TEXT.muted }}>Loading…</td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={rcHeaders.length} style={{ padding: 24, textAlign: 'center', fontSize: 13, color: TEXT.muted }}>{active.emptyLabel}</td></tr>
              ) : (
                rows.map((g) => (
                  <tr key={g.id} onClick={() => { if (!vis.preview) router.push(recordPath('/dashboard/store/grn', g)) }} style={{ cursor: 'pointer' }}>
                    <td style={{ ...tdStyle, fontWeight: 600, color: TEXT.heading }}>{g.grn_number}</td>
                    <VisTd vis={vis} table="receipts" k="purchase_order" style={tdStyle}>{g.po_number || '—'}</VisTd>
                    <VisTd vis={vis} table="receipts" k="po_date" style={tdStyle}>{g.po_date ? formatDate(g.po_date) : '—'}</VisTd>
                    <VisTd vis={vis} table="receipts" k="vendor" style={tdStyle}>{g.vendor_name || '—'}</VisTd>
                    <VisTd vis={vis} table="receipts" k="received_date" style={tdStyle}>{formatDate(g.received_date)}</VisTd>
                    <td style={tdStyle}>
                      <Pill label={STATUS_LABELS[g.status] || g.status} hex={STATUS_HEX[g.status] || '#64748b'} />
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
