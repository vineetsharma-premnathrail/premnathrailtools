'use client'

// "Before PO" view of Purchase Orders: goods the store already received before
// their PO existed. Procurement makes the PO for the vendor and items on the
// receipt; it opens as a draft PO.

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { prePoProcurementApi, PrePoReceipt } from '@/lib/prePoApi'
import { TEXT } from '@/lib/theme'
import { extractErrorMessages } from '@/lib/validation'
import { recordHref } from '@/lib/recordRef'
import { formatDate } from '@/lib/format'
import { useCan } from '@/lib/permissions'
import { RowCount, smallSecondaryBtnStyle, StatChip, inputStyle } from '@/components/shared/ui'
import ConfirmDialog from '@/components/erp/ConfirmDialog'
import { PO_CARD, PO_TD, PO_TH, clip } from '@/components/p2p/POTrackingShared'

const itemsText = (r: PrePoReceipt) => r.items.slice(0, 2).map((i) => i.item_name).join(', ') + (r.items.length > 2 ? ` +${r.items.length - 2} more` : '')

export default function BeforePOPendingList() {
  const router = useRouter()
  const { can } = useCan()
  const canCreate = can('p2p', 'purchase_orders', 'create')
  const [rows, setRows] = useState<PrePoReceipt[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [confirmFor, setConfirmFor] = useState<PrePoReceipt | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let cancelled = false
    prePoProcurementApi.pending()
      .then((list) => { if (!cancelled) setRows([...list].sort((a, b) => a.receipt_number.localeCompare(b.receipt_number, undefined, { numeric: true }))) })
      .catch((err) => { if (!cancelled) setError(extractErrorMessages(err, 'Could not load the Before PO receipts — reload the page.').join(' ')) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])

  const q = search.trim().toLowerCase()
  const shown = rows.filter((r) => !q || [r.receipt_number, r.vendor_name, r.delivery_challan_number, r.vendor_invoice_number, ...r.items.map((i) => i.item_name)].some((x) => (x || '').toLowerCase().includes(q)))

  const createPo = async () => {
    const r = confirmFor
    if (!r) return
    setBusy(true)
    setError('')
    try {
      const res = await prePoProcurementApi.createPo(r.id)
      setConfirmFor(null)
      router.push(recordHref('/dashboard/p2p/purchase-orders/new', res.rfq, 'id', { po: res.po.id_ref }, 'rfq'))
    } catch (err) {
      setConfirmFor(null)
      setError(extractErrorMessages(err, `Could not create the PO for ${r.receipt_number} — reload the list and try again.`).join(' '))
      setBusy(false)
    }
  }

  return (
    <div>
      <div data-tour="po-before-stats" style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 14 }}>
        <StatChip label="Receipts waiting for a PO" value={rows.length} color="#ea580c" />
      </div>
      <p style={{ fontSize: 12.5, color: TEXT.muted, margin: '0 0 12px' }}>
        The store already holds these goods. Create the PO for the same vendor and items; the goods enter stock only when the GRN is done after the PO is approved.
      </p>
      {error && <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>{error}</div>}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Receipt no., vendor, item..." aria-label="Search Before PO receipts" data-tour="po-before-search"
          style={{ ...inputStyle, width: 280, maxWidth: '100%' }} />
      </div>
      <div data-tour="po-before-table" style={{ ...PO_CARD, overflow: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr>{['Receipt No.', 'Vendor', 'Received on', 'Items', 'Challan / Invoice', ''].map((h, i) => <th key={h} style={PO_TH}>{h}{i === 0 && <RowCount count={shown.length} />}</th>)}</tr></thead>
          <tbody>
            {loading && <tr><td colSpan={6} style={{ ...PO_TD, textAlign: 'center', color: '#a8a29e' }}>Loading…</td></tr>}
            {!loading && rows.length === 0 && <tr><td colSpan={6} style={{ ...PO_TD, textAlign: 'center', color: '#a8a29e' }}>No goods are waiting for a PO. When the store receives material before its PO exists, it records a Before PO receipt and it appears here.</td></tr>}
            {!loading && rows.length > 0 && shown.length === 0 && <tr><td colSpan={6} style={{ ...PO_TD, textAlign: 'center', color: '#a8a29e' }}>No receipt matches the search — change or clear it.</td></tr>}
            {shown.map((r) => (
              <tr key={r.id}>
                <td style={{ ...PO_TD, fontWeight: 600, color: TEXT.heading, whiteSpace: 'nowrap' }}>{r.receipt_number}</td>
                <td style={{ ...PO_TD, fontWeight: 600, whiteSpace: 'nowrap' }} title={r.vendor_name}>{clip(r.vendor_name)}</td>
                <td style={{ ...PO_TD, whiteSpace: 'nowrap' }}>{formatDate(r.received_date)}</td>
                <td style={PO_TD} title={r.items.map((i) => `${i.item_name} × ${i.quantity}`).join(', ')}>
                  <strong>{r.items.length}</strong> · {clip(itemsText(r))}
                </td>
                <td style={{ ...PO_TD, fontSize: 12 }}>
                  {r.delivery_challan_number && <div>Challan {r.delivery_challan_number}</div>}
                  {r.vendor_invoice_number && <div>Invoice {r.vendor_invoice_number}</div>}
                  {!r.delivery_challan_number && !r.vendor_invoice_number && !(r.attachments || []).length && '—'}
                  {(r.attachments || []).length > 0 && <div title={(r.attachments || []).map((a) => a.filename).join(', ')} style={{ color: '#2563eb' }}>📎 {(r.attachments || []).length} file{(r.attachments || []).length === 1 ? '' : 's'}</div>}
                </td>
                <td style={{ ...PO_TD, textAlign: 'right' }}>
                  <button type="button" disabled={!canCreate || busy} onClick={() => setConfirmFor(r)} data-tour="po-before-create-btn"
                    title={canCreate ? undefined : 'You need Create permission on Purchase Orders to make a PO.'}
                    style={{ ...smallSecondaryBtnStyle, whiteSpace: 'nowrap', opacity: canCreate ? 1 : 0.5 }}>
                    Create PO
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ConfirmDialog open={!!confirmFor} danger={false} confirmLabel={busy ? 'Creating…' : 'Create PO'}
        title={`Create PO for ${confirmFor?.receipt_number || ''}?`}
        message={confirmFor ? `Create a PO to ${confirmFor.vendor_name} for these ${confirmFor.items.length} item${confirmFor.items.length === 1 ? '' : 's'}? It opens as a draft you can price and send for approval.` : ''}
        onConfirm={createPo} onCancel={() => { if (!busy) setConfirmFor(null) }} />
    </div>
  )
}
