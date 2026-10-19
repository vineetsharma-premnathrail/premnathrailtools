'use client'

// Line-level PO report (SAP ME2N by PO / ME2L by vendor / ME2M by item /
// ME80FN all lines) with the PO history (ME23N) of any PO in a popup.
// Everything is computed server-side from PO lines, GRNs, returns to vendor,
// service entries and vendor invoices (GET /p2p/po-reports/open-items).

import { useEffect, useState } from 'react'
import { poReportsApi } from '@/lib/api'
import { useCan } from '@/lib/permissions'
import { TEXT, GLASS, SHADOWS, BORDER } from '@/lib/theme'
import { inputStyle, secondaryBtnStyle } from '@/components/shared/ui'
import MessageDialog from '@/components/erp/MessageDialog'
import { extractErrorMessages } from '@/lib/validation'
import { FormSheet, SHEET, sheetBtn } from '@/components/shared/FormSheet'

type Row = {
  po_id: number; po_number: string; po_date: string; po_status: string; p2p_number?: string | null; vendor_name?: string | null
  po_item_id: number; item_code?: string | null; item_name: string; unit?: string | null; unit_price: number; ordered_qty: number
  received_qty: number; rejected_qty: number; returned_qty: number; delivered_qty: number; invoiced_qty: number; to_invoice_qty: number
  open_qty: number; open_value: number; expected_delivery?: string | null; days_overdue: number
}
type Summary = { vendor_name?: string; item_name?: string; lines: number; open_qty: number; open_value: number; overdue_lines: number; max_days_overdue: number }
type Group = 'po' | 'vendor' | 'item'

const money = (v: number) => `₹${(v || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`
const th: React.CSSProperties = {
  position: 'sticky', top: 0, background: '#fdf1e6', zIndex: 1, textAlign: 'left', padding: '10px 12px', fontSize: 11,
  fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, whiteSpace: 'nowrap',
}
const td: React.CSSProperties = { padding: '9px 12px', fontSize: 12.5, color: TEXT.secondary, borderTop: '1px solid rgba(0,0,0,0.05)', whiteSpace: 'nowrap' }
const wrap: React.CSSProperties = {
  borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur,
  border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), overflow: 'auto', maxHeight: 'calc(100vh - 360px)', minHeight: 160,
}
const EVENT_HEX: Record<string, string> = { grn: '#2563eb', rtv: '#dc2626', invoice: '#16a34a', service_entry: '#7c3aed' }

function POHistoryDialog({ poId, onClose }: { poId: number; onClose: () => void }) {
  const [data, setData] = useState<any>(null)
  const [error, setError] = useState<string | string[]>('')
  useEffect(() => {
    poReportsApi.history(poId).then(setData).catch((err) => setError(extractErrorMessages(err, 'Could not load the PO history.')))
  }, [poId])
  return (
    <FormSheet icon="history" title={`PO History${data ? ` — ${data.po_number}` : ''}`}
      subtitle={data ? `${data.vendor_name || 'No vendor'} · PO date ${data.po_date}${data.expected_delivery ? ` · due ${data.expected_delivery}` : ''}` : 'Receipts, returns, service entries and invoices per line'}
      onClose={onClose} busy={false}
      footer={<button type="button" onClick={onClose} style={sheetBtn('secondary', SHEET.INK)}>Close</button>}>
      <div style={{ padding: '20px 24px' }}>
        <MessageDialog open={!!error} variant="error" title="Cannot Load PO History" message={error} onClose={() => { setError(''); onClose() }} />
        {!data && !error && <p style={{ fontSize: 13, color: TEXT.muted }}>Loading…</p>}
        {data?.lines.map((l: any) => (
          <div key={l.po_item_id} style={{ border: `1px solid ${BORDER.normal}`, borderRadius: 12, padding: 12, marginBottom: 12 }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, fontSize: 13, marginBottom: 8 }}>
              <strong style={{ color: TEXT.heading }}>{l.item_code ? `${l.item_code} — ` : ''}{l.item_name}</strong>
              <span style={{ color: TEXT.muted }}>Ordered {l.ordered_qty} {l.unit || ''}</span>
              {l.summary && <span style={{ color: TEXT.muted }}>Delivered {l.summary.delivered_qty} · Invoiced {l.summary.invoiced_qty} · Open {l.summary.open_qty}</span>}
            </div>
            {l.events.length === 0 ? <p style={{ fontSize: 12.5, color: TEXT.muted, margin: 0 }}>Nothing received or invoiced yet.</p> : (
              <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 640 }}>
                <thead><tr>{['Document', 'No.', 'Date', 'Status', 'Qty', 'Details'].map((h) => <th key={h} style={{ ...th, position: 'static' }}>{h}</th>)}</tr></thead>
                <tbody>
                  {l.events.map((e: any, i: number) => (
                    <tr key={i}>
                      <td style={td}><span style={{ fontSize: 11, fontWeight: 700, padding: '3px 9px', borderRadius: 9999, background: `${EVENT_HEX[e.type] || '#6b7280'}1a`, color: EVENT_HEX[e.type] || '#6b7280' }}>{e.label}</span></td>
                      <td style={{ ...td, fontWeight: 600, color: TEXT.body }}>{e.document_number}</td>
                      <td style={td}>{e.date || '—'}</td>
                      <td style={td}>{e.status || '—'}</td>
                      <td style={td}>{e.quantity}</td>
                      <td style={{ ...td, whiteSpace: 'normal' }}>
                        {e.type === 'grn' && [
                          e.accepted != null ? `accepted ${e.accepted}` : null, e.rejected ? `rejected ${e.rejected}` : null,
                          e.invoice_quantity != null ? `bill qty ${e.invoice_quantity}` : null,
                          e.receipt_variance ? `variance ${e.receipt_variance > 0 ? '+' : ''}${e.receipt_variance}` : null,
                          e.vendor_invoice_number ? `inv ${e.vendor_invoice_number}` : null, e.delivery_challan_number ? `DC ${e.delivery_challan_number}` : null,
                        ].filter(Boolean).join(' · ')}
                        {e.type === 'invoice' && [e.amount != null ? money(e.amount) : null, e.match_status].filter(Boolean).join(' · ')}
                        {e.type === 'rtv' && (e.value != null ? money(e.value) : '')}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        ))}
      </div>
    </FormSheet>
  )
}

export default function POOpenItems() {
  const { can, canFeature } = useCan()
  // Purchase Orders features: PO history popup, and the price switch (the export is a sheet of rates).
  const seeHistory = canFeature('p2p', 'purchase_orders', 'history', 'view')
  const seePrices = canFeature('p2p', 'purchase_orders', 'prices', 'view') || can('p2p', 'purchase_orders', 'edit')
  const [rows, setRows] = useState<Row[]>([])
  const [byVendor, setByVendor] = useState<Summary[]>([])
  const [byItem, setByItem] = useState<Summary[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | string[]>('')
  const [group, setGroup] = useState<Group>('po')
  const [vendor, setVendor] = useState('')
  const [poNumber, setPoNumber] = useState('')
  const [overdueOnly, setOverdueOnly] = useState(false)
  const [allLines, setAllLines] = useState(false)
  const [historyFor, setHistoryFor] = useState<number | null>(null)

  const params = () => ({ vendor_name: vendor.trim() || undefined, po_number: poNumber.trim() || undefined, overdue_only: overdueOnly, open_only: !allLines })

  useEffect(() => {
    setLoading(true)
    const t = setTimeout(() => {
      poReportsApi.openItems(params())
        .then((d) => { setRows(d.rows); setByVendor(d.by_vendor); setByItem(d.by_item); setTotal(d.total_open_value) })
        .catch((err) => setError(extractErrorMessages(err, 'Could not load the open PO items.')))
        .finally(() => setLoading(false))
    }, 300)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vendor, poNumber, overdueOnly, allLines])

  const exportExcel = async () => {
    try {
      const blob = await poReportsApi.exportOpenItems(params())
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = 'po_open_items.xlsx'
      a.click()
      URL.revokeObjectURL(url)
    } catch (err) {
      setError(extractErrorMessages(err, 'Could not export the open PO items.'))
    }
  }

  const summary = group === 'vendor' ? byVendor : byItem
  return (
    <div>
      <MessageDialog open={!!error} variant="error" title="Open PO Items" message={error} onClose={() => setError('')} />
      {historyFor !== null && <POHistoryDialog poId={historyFor} onClose={() => setHistoryFor(null)} />}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center', marginBottom: 12 }}>
        <div style={{ display: 'flex', gap: 4 }}>
          {([['po', 'By PO line'], ['vendor', 'By vendor'], ['item', 'By item']] as [Group, string][]).map(([k, label]) => (
            <button key={k} type="button" onClick={() => setGroup(k)}
              style={{ ...secondaryBtnStyle, padding: '6px 12px', fontSize: 12, background: group === k ? 'rgba(255,122,69,0.12)' : undefined, color: group === k ? '#c2410c' : undefined }}>{label}</button>
          ))}
        </div>
        <input style={{ ...inputStyle, flex: '1 1 180px', maxWidth: 260, width: 'auto' }} placeholder="Vendor" value={vendor} onChange={(e) => setVendor(e.target.value)} />
        <input style={{ ...inputStyle, flex: '1 1 150px', maxWidth: 200, width: 'auto' }} placeholder="PO no." value={poNumber} onChange={(e) => setPoNumber(e.target.value)} />
        <label style={{ fontSize: 12.5, color: TEXT.secondary, display: 'flex', gap: 6, alignItems: 'center' }}>
          <input type="checkbox" checked={overdueOnly} onChange={(e) => setOverdueOnly(e.target.checked)} /> Overdue only
        </label>
        <label style={{ fontSize: 12.5, color: TEXT.secondary, display: 'flex', gap: 6, alignItems: 'center' }}>
          <input type="checkbox" checked={allLines} onChange={(e) => setAllLines(e.target.checked)} /> Include fully delivered lines
        </label>
        {can('p2p', 'purchase_orders', 'export') && seePrices && <button type="button" onClick={exportExcel} style={secondaryBtnStyle}>Export Excel</button>}
        <span style={{ marginLeft: 'auto', fontSize: 13, color: TEXT.secondary }}>Open value <strong style={{ color: TEXT.heading }}>{money(total)}</strong></span>
      </div>

      <div style={wrap}>
        {group === 'po' ? (
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 1300 }}>
            <thead><tr>
              {['PO', 'Vendor', 'Item', 'Ordered', 'Received', 'Rejected', 'Returned', 'Delivered', 'Invoiced', 'Open', 'Open value', 'Due', 'Overdue', ''].map((h) => <th key={h} style={th}>{h}</th>)}
            </tr></thead>
            <tbody>
              {loading && <tr><td colSpan={14} style={{ ...td, textAlign: 'center', padding: 24 }}>Loading…</td></tr>}
              {!loading && rows.length === 0 && <tr><td colSpan={14} style={{ ...td, textAlign: 'center', padding: 24 }}>No open PO lines match.</td></tr>}
              {!loading && rows.map((r) => (
                <tr key={r.po_item_id} onClick={() => { if (seeHistory) setHistoryFor(r.po_id) }} style={{ cursor: seeHistory ? 'pointer' : 'default' }}>
                  <td style={{ ...td, fontWeight: 600, color: TEXT.body }}>{r.po_number}<div style={{ fontSize: 11, color: TEXT.muted, fontWeight: 400 }}>{r.po_date}</div></td>
                  <td style={td}>{r.vendor_name || '—'}</td>
                  <td style={{ ...td, whiteSpace: 'normal', minWidth: 200 }}>{r.item_code ? `${r.item_code} — ` : ''}{r.item_name}</td>
                  <td style={td}>{r.ordered_qty} {r.unit || ''}</td>
                  <td style={td}>{r.received_qty}</td>
                  <td style={{ ...td, color: r.rejected_qty ? '#b91c1c' : TEXT.secondary }}>{r.rejected_qty}</td>
                  <td style={td}>{r.returned_qty}</td>
                  <td style={td}>{r.delivered_qty}</td>
                  <td style={td}>{r.invoiced_qty}</td>
                  <td style={{ ...td, fontWeight: 700, color: r.open_qty > 0 ? '#d97706' : '#16a34a' }}>{r.open_qty}</td>
                  <td style={td}>{money(r.open_value)}</td>
                  <td style={td}>{r.expected_delivery || '—'}</td>
                  <td style={td}>
                    {r.days_overdue > 0
                      ? <span style={{ fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 9999, background: '#dc26261a', color: '#dc2626' }}>{r.days_overdue} d</span>
                      : '—'}
                  </td>
                  <td style={td} onClick={(e) => e.stopPropagation()}>
                    {seeHistory && <span onClick={() => setHistoryFor(r.po_id)} style={{ color: '#c2410c', fontWeight: 600, cursor: 'pointer' }}>History</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 700 }}>
            <thead><tr>{[group === 'vendor' ? 'Vendor' : 'Item', 'Open lines', 'Open qty', 'Open value', 'Overdue lines', 'Max days overdue'].map((h) => <th key={h} style={th}>{h}</th>)}</tr></thead>
            <tbody>
              {!loading && summary.length === 0 && <tr><td colSpan={6} style={{ ...td, textAlign: 'center', padding: 24 }}>No open PO lines match.</td></tr>}
              {summary.map((s, i) => (
                <tr key={i}>
                  <td style={{ ...td, fontWeight: 600, color: TEXT.body, whiteSpace: 'normal' }}>{(group === 'vendor' ? s.vendor_name : s.item_name) || '—'}</td>
                  <td style={td}>{s.lines}</td>
                  <td style={td}>{+s.open_qty.toFixed(3)}</td>
                  <td style={td}>{money(s.open_value)}</td>
                  <td style={{ ...td, color: s.overdue_lines ? '#dc2626' : TEXT.secondary }}>{s.overdue_lines}</td>
                  <td style={td}>{s.max_days_overdue || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
