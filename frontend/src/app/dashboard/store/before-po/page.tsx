'use client'

// Store › Inward › Before PO: goods that arrived before their purchase order.
// Recorded here, held in store (no stock yet), and listed for Procurement,
// who makes the PO. The GRN against the approved PO posts the stock.

import { useEffect, useState } from 'react'
import { useRequireApp } from '@/hooks/useAuth'
import { prePoStoreApi, PrePoReceipt, PRE_PO_STATUS_HEX, PRE_PO_STATUS_LABEL } from '@/lib/prePoApi'
import { TEXT, GLASS, SHADOWS, BORDER } from '@/lib/theme'
import { formatDate } from '@/lib/format'
import { extractErrorMessages } from '@/lib/validation'
import { useCan } from '@/lib/permissions'
import StoreNav from '@/components/store/StoreNav'
import BeforePOReceiptForm from '@/components/store/BeforePOReceiptForm'
import BeforePOReceiptDetail from '@/components/store/BeforePOReceiptDetail'
import { primaryBtnStyle, RowCount, Pill, StatChip, inputStyle } from '@/components/shared/ui'

const thStyle: React.CSSProperties = {
  position: 'sticky', top: 0, background: '#fdf1e6', zIndex: 1, textAlign: 'left', padding: '10px 14px', fontSize: 11.5,
  fontWeight: 700, letterSpacing: '.04em', textTransform: 'uppercase', color: TEXT.muted, borderBottom: `1px solid ${BORDER.normal}`,
}
const tdStyle: React.CSSProperties = { padding: '10px 14px', fontSize: 13, color: TEXT.body, borderBottom: `1px solid ${BORDER.normal}` }
const byNumber = (a: PrePoReceipt, b: PrePoReceipt) => a.receipt_number.localeCompare(b.receipt_number, undefined, { numeric: true })

export default function StoreBeforePoPage() {
  const { isAuthorized, isLoading } = useRequireApp('store')
  const { can } = useCan()
  const canCreate = can('store', 'grn', 'create')
  const canView = can('store', 'grn', 'view')
  const [rows, setRows] = useState<PrePoReceipt[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  // Status picked by clicking a count chip ('' = all); click the same chip again to clear it.
  const [statusFilter, setStatusFilter] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [notice, setNotice] = useState('')
  const [openId, setOpenId] = useState<number | null>(null)

  const load = () => {
    setLoading(true)
    prePoStoreApi.list()
      .then((l) => { setRows([...l].sort(byNumber)); setError('') })
      .catch((err) => setError(extractErrorMessages(err, 'Could not load the Before PO receipts — reload the page.').join(' ')))
      .finally(() => setLoading(false))
  }
  useEffect(() => { if (isAuthorized && canView) load() }, [isAuthorized, canView]) // eslint-disable-line react-hooks/exhaustive-deps

  if (isLoading || !isAuthorized) return null
  if (!canView) {
    return (
      <div>
        <StoreNav />
        <p style={{ fontSize: 13, color: '#b91c1c' }}>You don&apos;t have access to Before PO receipts — ask an admin to give you View on Store › GRN.</p>
      </div>
    )
  }

  const q = search.trim().toLowerCase()
  const shown = rows.filter((r) => (!statusFilter || r.status === statusFilter) && (!q || [r.receipt_number, r.vendor_name, r.po_number, r.p2p_number, r.delivery_challan_number, r.vendor_invoice_number, ...r.items.map((i) => i.item_name)].some((x) => (x || '').toLowerCase().includes(q))))
  const count = (s: string) => rows.filter((r) => r.status === s).length
  const open = rows.find((r) => r.id === openId) || null

  return (
    <div>
      <StoreNav />

      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', marginBottom: 16 }}>
        <div>
          <p style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 4px' }}>Store & Inventory Module</p>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: TEXT.heading, margin: 0 }}>Before PO</h1>
          <p style={{ fontSize: 13, color: TEXT.muted, margin: '4px 0 0' }}>Material that arrived before its purchase order. Procurement makes the PO from these receipts.</p>
        </div>
        {canCreate
          ? <button type="button" data-tour="store-bpo-new-btn" onClick={() => setShowForm(true)} style={primaryBtnStyle}>+ Before PO receipt</button>
          : <span style={{ fontSize: 12, color: TEXT.muted }}>Recording a receipt needs Create permission on GRN.</span>}
      </div>

      <div role="note" data-tour="store-bpo-banner" style={{ padding: '10px 14px', marginBottom: 14, borderRadius: 10, background: 'rgba(234,88,12,0.08)', border: '1px solid rgba(234,88,12,0.25)', color: '#9a3412', fontSize: 13 }}>
        Goods recorded here are held in store and are NOT in stock yet. Stock is added by the GRN once Procurement&apos;s PO is approved.
      </div>

      <div data-tour="store-bpo-stats" style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 14 }}>
        <StatChip label="PO pending" value={count('pending_po')} color="#ea580c" onClick={() => setStatusFilter((f) => (f === 'pending_po' ? '' : 'pending_po'))} active={statusFilter === 'pending_po'} />
        <StatChip label="PO created" value={count('po_created')} color="#2563eb" onClick={() => setStatusFilter((f) => (f === 'po_created' ? '' : 'po_created'))} active={statusFilter === 'po_created'} />
        <StatChip label="Closed" value={count('closed')} color="#16a34a" onClick={() => setStatusFilter((f) => (f === 'closed' ? '' : 'closed'))} active={statusFilter === 'closed'} />
      </div>

      {notice && <div role="alert" style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(234,88,12,0.08)', border: '1px solid rgba(234,88,12,0.25)', color: '#9a3412', fontSize: 13 }}>{notice}</div>}
      {error && <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>{error}</div>}

      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 14 }}>
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Receipt no., vendor, PO, item..." aria-label="Search Before PO receipts" data-tour="store-bpo-search"
          style={{ ...inputStyle, width: 300, maxWidth: '100%' }} />
      </div>

      <div data-tour="store-bpo-table" style={{ borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur, border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), overflow: 'auto', maxHeight: 'calc(100vh - 400px)' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 760 }}>
          <thead>
            <tr>{['Receipt No.', 'Vendor', 'Received on', 'Items', 'Challan / Invoice', 'PO', 'Status'].map((h, i) => <th key={h} style={thStyle}>{h}{i === 0 && <RowCount count={shown.length} />}</th>)}</tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={7} style={{ padding: 24, textAlign: 'center', fontSize: 13, color: TEXT.muted }}>Loading…</td></tr>}
            {!loading && rows.length === 0 && <tr><td colSpan={7} style={{ padding: 24, textAlign: 'center', fontSize: 13, color: TEXT.muted }}>No Before PO receipts yet. When goods arrive and no PO exists, record them with + Before PO receipt.</td></tr>}
            {!loading && rows.length > 0 && shown.length === 0 && <tr><td colSpan={7} style={{ padding: 24, textAlign: 'center', fontSize: 13, color: TEXT.muted }}>No receipt matches the search or the selected count — change the search, or click the highlighted count again to show all.</td></tr>}
            {shown.map((r) => (
              <tr key={r.id} onClick={() => setOpenId(r.id)} style={{ cursor: 'pointer' }}>
                <td style={{ ...tdStyle, fontWeight: 600, color: TEXT.heading, whiteSpace: 'nowrap' }}>{r.receipt_number}</td>
                <td style={tdStyle}>{r.vendor_name}</td>
                <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>{formatDate(r.received_date)}</td>
                <td style={tdStyle} title={r.items.map((i) => `${i.item_name} × ${i.quantity}`).join(', ')}>
                  <strong>{r.items.length}</strong> · {r.items.slice(0, 2).map((i) => i.item_name).join(', ')}{r.items.length > 2 ? ` +${r.items.length - 2} more` : ''}
                </td>
                <td style={{ ...tdStyle, fontSize: 12 }}>
                  {r.delivery_challan_number && <div>Challan {r.delivery_challan_number}</div>}
                  {r.vendor_invoice_number && <div>Invoice {r.vendor_invoice_number}</div>}
                  {!r.delivery_challan_number && !r.vendor_invoice_number && '—'}
                </td>
                <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>{r.po_number || '—'}</td>
                <td style={tdStyle}><Pill label={PRE_PO_STATUS_LABEL[r.status] || r.status} hex={PRE_PO_STATUS_HEX[r.status] || '#64748b'} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showForm && <BeforePOReceiptForm onClose={() => setShowForm(false)} onSaved={(r, note) => { setShowForm(false); setNotice(note || ''); load(); setOpenId(r.id) }} />}
      {open && <BeforePOReceiptDetail receipt={open} canCancel={canCreate} onClose={() => setOpenId(null)} onChanged={() => { setOpenId(null); load() }}
        onUpdated={(r) => setRows((rs) => rs.map((x) => (x.id === r.id ? r : x)))} />}
    </div>
  )
}
