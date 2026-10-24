'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { storeApi, storeJobWorkApi } from '@/lib/api'
import { StoreItem } from '@/types'
import { TEXT, BRAND, GLASS, SHADOWS } from '@/lib/theme'
import { Field, primaryBtnStyle, secondaryBtnStyle } from '@/components/shared/ui'
import { FormSheet, SheetColumns, SheetSection, SheetIcon, Optional, Req, SHEET, sheetBtn, sheetInput, sheetLabel, SheetError } from '@/components/shared/FormSheet'
import StoreNav from '@/components/store/StoreNav'
import MessageDialog from '@/components/erp/MessageDialog'
import SearchableSelect from '@/components/erp/SearchableSelect'
import DateField from '@/components/erp/DateField'
import { recordPath } from '@/lib/recordRef'
import { extractErrorMessages } from '@/lib/validation'
import { useCan } from '@/lib/permissions'
import Select from '@/components/shared/Select'

// Job work / subcontracting (SAP item category L, ME2O, GST ITC-04): the
// challan is a Material Issue of type Job work; its material sits in
// With-vendor stock until it comes back (Return) or is used up in a processed
// item (Job Work Receipt). Rule 45: back within 1 year (inputs) / 3 years
// (capital goods), or GST is payable.

interface ChallanLine {
  issue_id: number; issue_item_id: number; challan_number?: string | null; issue_number: string; challan_date: string
  vendor_id?: number | null; vendor_name?: string | null; item_id: number; item_code?: string | null; item_name?: string | null
  uom?: string | null; hsn_code?: string | null; batch_number?: string | null; goods_type: string
  quantity_sent: number; quantity_returned: number; quantity_return_pending: number; quantity_consumed: number; quantity_scrap: number
  quantity_outstanding: number; outstanding_value?: number | null; taxable_value?: number | null; days_out: number
  location_id?: number | null
  return_deadline: string; days_to_deadline: number; status: string; process?: string | null
}
interface Challan {
  issue_id: number; issue_number: string; challan_number?: string | null; challan_date: string; expected_return_date?: string | null
  vendor_id?: number | null; vendor_name?: string | null; process?: string | null; location_name?: string | null
  lines: ChallanLine[]; outstanding_value: number; days_out: number; return_deadline: string; status: string
  /** The processed item expected back (set on the challan). */
  output_item_id?: number | null
}
interface VendorStock { vendor_name?: string | null; item_code?: string | null; item_name?: string | null; uom?: string | null; quantity: number; value: number; challans: string[]; oldest_challan_date: string; overdue: boolean }
interface Receipt {
  id: number; receipt_number: string; challan_number?: string | null; issue_number?: string | null; vendor_name?: string | null; receipt_date: string
  output_item_code?: string | null; output_item_name?: string | null; output_quantity: number; uom?: string | null; output_batch_number?: string | null
  component_value?: number | null; job_charge_rate?: number | null; output_unit_cost?: number | null; inspection_lot_number?: string | null
  vendor_challan_number?: string | null
}

const STATUS_LABELS: Record<string, string> = { open: 'At vendor', due_back: 'Past expected return', overdue: 'Rule 45 limit passed', closed: 'Closed' }
const STATUS_HEX: Record<string, string> = { open: '#2563eb', due_back: '#d97706', overdue: '#dc2626', closed: '#16a34a' }

const card: React.CSSProperties = { borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur, border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), overflow: 'auto', maxHeight: 'calc(100vh - 340px)' }
const th: React.CSSProperties = { position: 'sticky', top: 0, background: '#fdf1e6', zIndex: 1, textAlign: 'left', padding: '10px 14px', fontSize: 11, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, whiteSpace: 'nowrap' }
const td: React.CSSProperties = { padding: '10px 14px', fontSize: 13, color: TEXT.secondary, verticalAlign: 'top' }
const fmtDate = (d?: string | null) => (d ? d.split('-').reverse().join('-') : '—')
const money = (v?: number | null) => (v == null ? '—' : `₹${Number(v).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`)

function Badge({ status }: { status: string }) {
  return <span style={{ fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 9999, background: `${STATUS_HEX[status]}1a`, color: STATUS_HEX[status], whiteSpace: 'nowrap' }}>{STATUS_LABELS[status] || status}</span>
}

type Tab = 'challans' | 'vendor' | 'receipts' | 'itc04'

export default function JobWorkPage() {
  const { isAuthorized, isLoading } = useRequireApp('store')
  const { can, canFeature } = useCan()
  // Issues › Job work (this page), › Receive processed items (receipts), and
  // Items › Stock value & rates (the ₹ columns — blanked by the server too).
  const seeJobWork = canFeature('store', 'issues', 'job_work', 'view')
  const seeReceipts = canFeature('store', 'issues', 'job_work_receipts', 'view')
  const canReceive = canFeature('store', 'issues', 'job_work_receipts', 'create')
  const seeValues = canFeature('store', 'items', 'stock_values', 'view')
  const router = useRouter()
  const [tab, setTab] = useState<Tab>('challans')
  const [showAll, setShowAll] = useState(false)
  const [challans, setChallans] = useState<Challan[]>([])
  const [vendorStock, setVendorStock] = useState<VendorStock[]>([])
  const [receipts, setReceipts] = useState<Receipt[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | string[]>('')
  const [receiving, setReceiving] = useState<Challan | null>(null)
  const [returning, setReturning] = useState<Challan | null>(null)
  const [returned, setReturned] = useState('')
  const [done, setDone] = useState('')

  const load = useCallback(() => {
    setLoading(true)
    Promise.all([
      storeJobWorkApi.challans({ status: showAll ? 'all' : 'open' }).then(setChallans),
      storeJobWorkApi.vendorStock().then(setVendorStock),
      seeReceipts ? storeJobWorkApi.receipts().then(setReceipts) : Promise.resolve(setReceipts([])),
    ]).catch((err) => setError(extractErrorMessages(err, 'Could not load job work — check your connection and reload.')))
      .finally(() => setLoading(false))
  }, [showAll, seeReceipts])

  useEffect(() => { if (isAuthorized && seeJobWork) load() }, [isAuthorized, seeJobWork, load])

  if (isLoading || !isAuthorized) return null
  if (!seeJobWork) return (
    <div>
      <StoreNav />
      <p style={{ fontSize: 13, color: TEXT.muted }}>
        You don&apos;t have View on Store › Issues › Job work (subcontracting). Ask your admin to add it to your role in Organization › Roles &amp; Permissions.
      </p>
    </div>
  )

  const overdue = challans.filter((c) => c.status === 'overdue').length
  const atVendorValue = vendorStock.reduce((a, s) => a + (s.value || 0), 0)

  return (
    <div>
      <StoreNav />
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap', marginBottom: 14 }}>
        <div>
          <p style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 4px' }}>Store &amp; Inventory</p>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: TEXT.heading, margin: 0 }}>Job Work</h1>
          <p style={{ fontSize: 12.5, color: TEXT.muted, margin: '6px 0 0', maxWidth: 720 }}>
            Material sent to job workers on a challan stays ours and valued (stock with vendor) until it comes back or is used in the processed item.
            GST Rule 45: it must be back within 1 year (inputs) / 3 years (capital goods).
          </p>
        </div>
        {canFeature('store', 'issues', 'job_work', 'create') && (
          <button onClick={() => router.push('/dashboard/store/job-work/new')} style={primaryBtnStyle}>
            <span style={{ fontSize: 17, lineHeight: 1, marginRight: 6 }}>+</span> New Challan
          </button>
        )}
      </div>

      <MessageDialog open={!!error} variant="error" title="Job Work" message={error} onClose={() => setError('')} />
      <MessageDialog open={!!done} variant="success" title="Job Work Receipt Posted" message={done} onClose={() => setDone('')} />
      <MessageDialog open={!!returned} variant="success" title="Return Recorded" message={returned} onClose={() => setReturned('')} />

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
        {[
          { label: 'Open challans', value: String(challans.filter((c) => c.status !== 'closed').length) },
          ...(seeValues ? [{ label: 'Value at vendors', value: money(atVendorValue) }] : []),
          { label: 'Past Rule 45 limit', value: String(overdue), danger: overdue > 0 },
        ].map((k) => (
          <div key={k.label} style={{ flex: '0 1 200px', padding: '12px 16px', borderRadius: 14, background: GLASS.card, border: `1px solid ${GLASS.border}` }}>
            <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.05em', color: TEXT.muted }}>{k.label}</div>
            <div style={{ fontSize: 20, fontWeight: 700, color: k.danger ? '#dc2626' : TEXT.heading }}>{k.value}</div>
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14, alignItems: 'center' }}>
        {([['challans', 'Challans'], ['vendor', 'Stock with Vendors'], ['receipts', 'Job Work Receipts'], ['itc04', 'ITC-04']] as [Tab, string][]).filter(([k]) => k !== 'receipts' || seeReceipts).map(([k, l]) => (
          <button key={k} type="button" onClick={() => setTab(k)} style={{ padding: '7px 14px', borderRadius: 9999, fontSize: 12.5, fontWeight: 600, cursor: 'pointer',
            color: tab === k ? '#fff' : '#57534e', background: tab === k ? BRAND.primaryActive : 'rgba(0,0,0,0.04)', border: tab === k ? `1px solid ${BRAND.primaryActive}` : '1px solid rgba(0,0,0,0.08)' }}>{l}</button>
        ))}
        {tab === 'challans' && (
          <label style={{ fontSize: 12.5, color: TEXT.secondary, marginLeft: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
            <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} /> Show closed challans too
          </label>
        )}
      </div>

      {tab === 'challans' && (
        <div style={card}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 1100 }}>
            <thead><tr>{['Challan', 'Date', 'Vendor', 'Material (sent / back / used / at vendor)', ...(seeValues ? ['Value at vendor'] : []), 'Days out', 'Return by (Rule 45)', 'Status', ''].map((h) => <th key={h} style={th}>{h}</th>)}</tr></thead>
            <tbody>
              {loading && <tr><td colSpan={9} style={{ ...td, textAlign: 'center' }}>Loading…</td></tr>}
              {!loading && challans.length === 0 && <tr><td colSpan={9} style={{ ...td, textAlign: 'center' }}>No job-work material is out at vendors.</td></tr>}
              {!loading && challans.map((c) => (
                <tr key={c.issue_id} style={{ borderTop: '1px solid rgba(0,0,0,0.05)', cursor: 'pointer' }} onClick={() => router.push(recordPath('/dashboard/store/issues', c, 'issue_id'))}>
                  <td style={{ ...td, fontWeight: 600, color: TEXT.body }}>{c.challan_number || '—'}<div style={{ fontSize: 11.5, color: TEXT.muted, fontWeight: 400 }}>{c.issue_number}</div></td>
                  <td style={td}>{fmtDate(c.challan_date)}</td>
                  <td style={td}>{c.vendor_name || '—'}{c.process && <div style={{ fontSize: 11.5, color: TEXT.muted }}>{c.process.replace('_', ' ')}</div>}</td>
                  <td style={td}>
                    {c.lines.map((l) => (
                      <div key={l.issue_item_id} style={{ marginBottom: 3 }}>
                        <b style={{ color: TEXT.body }}>{l.item_name}</b>{l.batch_number ? ` · ${l.batch_number}` : ''} — {l.quantity_sent} / {l.quantity_returned} / {+(l.quantity_consumed + l.quantity_scrap).toFixed(4)} /{' '}
                        <b style={{ color: l.quantity_outstanding > 0 ? '#7c3aed' : '#16a34a' }}>{l.quantity_outstanding}</b> {l.uom}
                        {l.quantity_return_pending > 0 && <span style={{ color: '#d97706' }}> ({l.quantity_return_pending} return awaiting approval)</span>}
                      </div>
                    ))}
                  </td>
                  {seeValues && <td style={td}>{money(c.outstanding_value)}</td>}
                  <td style={td}>{c.days_out}</td>
                  <td style={{ ...td, color: c.status === 'overdue' ? '#dc2626' : TEXT.secondary }}>{fmtDate(c.return_deadline)}</td>
                  <td style={td}><Badge status={c.status} /></td>
                  <td style={td} onClick={(e) => e.stopPropagation()}>
                    {c.status !== 'closed' && canReceive && (
                      <span onClick={() => setReceiving(c)} style={{ color: BRAND.primaryActive, fontSize: 12.5, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' }}>Receive processed item</span>
                    )}
                    {c.status !== 'closed' && can('store', 'returns', 'create') && (
                      <div><span onClick={() => setReturning(c)} style={{ color: '#2563eb', fontSize: 12.5, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' }}>Return as-is</span></div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'vendor' && (
        <div style={card}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 860 }}>
            <thead><tr>{['Vendor', 'Item', 'Quantity at vendor', ...(seeValues ? ['Value'] : []), 'Challans', 'Oldest challan'].map((h) => <th key={h} style={th}>{h}</th>)}</tr></thead>
            <tbody>
              {!loading && vendorStock.length === 0 && <tr><td colSpan={6} style={{ ...td, textAlign: 'center' }}>No stock is with vendors.</td></tr>}
              {vendorStock.map((s, i) => (
                <tr key={i} style={{ borderTop: '1px solid rgba(0,0,0,0.05)' }}>
                  <td style={{ ...td, fontWeight: 600, color: TEXT.body }}>{s.vendor_name || '—'}</td>
                  <td style={td}>{s.item_code} — {s.item_name}</td>
                  <td style={{ ...td, fontWeight: 600, color: '#7c3aed' }}>{s.quantity} {s.uom}</td>
                  {seeValues && <td style={td}>{money(s.value)}</td>}
                  <td style={td}>{s.challans.join(', ')}</td>
                  <td style={{ ...td, color: s.overdue ? '#dc2626' : TEXT.secondary }}>{fmtDate(s.oldest_challan_date)}{s.overdue ? ' · Rule 45 limit passed' : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'receipts' && seeReceipts && (
        <div style={card}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 1000 }}>
            <thead><tr>{['Receipt', 'Date', 'Challan', 'Vendor', 'Processed item', 'Batch', ...(seeValues ? ['Component value'] : []), 'Job charge', ...(seeValues ? ['Unit cost'] : []), 'Inspection'].map((h) => <th key={h} style={th}>{h}</th>)}</tr></thead>
            <tbody>
              {!loading && receipts.length === 0 && <tr><td colSpan={10} style={{ ...td, textAlign: 'center' }}>No job work receipts yet.</td></tr>}
              {receipts.map((r) => (
                <tr key={r.id} style={{ borderTop: '1px solid rgba(0,0,0,0.05)' }}>
                  <td style={{ ...td, fontWeight: 600, color: TEXT.body }}>{r.receipt_number}{r.vendor_challan_number && <div style={{ fontSize: 11.5, color: TEXT.muted, fontWeight: 400 }}>Vendor DC {r.vendor_challan_number}</div>}</td>
                  <td style={td}>{fmtDate(r.receipt_date)}</td>
                  <td style={td}>{r.challan_number || r.issue_number}</td>
                  <td style={td}>{r.vendor_name || '—'}</td>
                  <td style={td}>{r.output_quantity} {r.uom} {r.output_item_name}</td>
                  <td style={td}>{r.output_batch_number || '—'}</td>
                  {seeValues && <td style={td}>{money(r.component_value)}</td>}
                  <td style={td}>{r.job_charge_rate != null ? `${money(r.job_charge_rate)} / ${r.uom || 'unit'}` : '—'}</td>
                  {seeValues && <td style={td}>{money(r.output_unit_cost)}</td>}
                  <td style={td}>{r.inspection_lot_number || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'itc04' && <Itc04 canExport={canFeature('store', 'issues', 'job_work', 'export')} onError={setError} />}

      {returning && (
        <ReturnAsIsDialog challan={returning} onClose={() => setReturning(null)}
          onDone={(msg) => { setReturning(null); setReturned(msg); load() }} />
      )}
      {receiving && (
        <ReceiveDialog challan={receiving} onClose={() => setReceiving(null)}
          onDone={(r) => { setReceiving(null); setDone(`${r.receipt_number}: ${r.output_quantity} ${r.uom || ''} ${r.output_item_name} received${r.inspection_lot_number ? ` into Quality stock under lot ${r.inspection_lot_number}` : ''}${r.output_unit_cost != null ? ` at ${money(r.output_unit_cost)} each` : ''}.`); load() }} />
      )}
    </div>
  )
}

function quarterBounds(): [string, string] {
  const d = new Date()
  const q = Math.floor(d.getMonth() / 3)
  const start = new Date(d.getFullYear(), q * 3, 1)
  const end = new Date(d.getFullYear(), q * 3 + 3, 0)
  const iso = (x: Date) => `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`
  return [iso(start), iso(end)]
}

function Itc04({ canExport, onError }: { canExport: boolean; onError: (e: string | string[]) => void }) {
  const [[from, to], setRange] = useState<[string, string]>(quarterBounds())
  const [data, setData] = useState<{ sent: ChallanLine[]; received: { challan_number: string; document: string; document_date: string; nature: string; item_name: string; quantity: number; uom?: string; taxable_value?: number | null }[]; outstanding: ChallanLine[]; overdue: ChallanLine[] } | null>(null)
  const [busy, setBusy] = useState(false)

  const run = () => {
    setBusy(true)
    storeJobWorkApi.itc04(from, to).then(setData).catch((err) => onError(extractErrorMessages(err, 'Could not build the ITC-04 report.'))).finally(() => setBusy(false))
  }
  const download = async () => {
    try {
      const blob = await storeJobWorkApi.itc04Xlsx(from, to)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `ITC-04_${from}_${to}.xlsx`
      a.click()
      URL.revokeObjectURL(url)
    } catch (err) { onError(extractErrorMessages(err, 'Could not download the ITC-04 workbook.')) }
  }

  return (
    <div>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 14 }}>
        <div style={{ flex: '0 1 160px' }}><Field label="From"><DateField value={from} onChange={(v) => setRange([v, to])} /></Field></div>
        <div style={{ flex: '0 1 160px' }}><Field label="To"><DateField value={to} onChange={(v) => setRange([from, v])} /></Field></div>
        <button type="button" disabled={busy} onClick={run} style={primaryBtnStyle}>{busy ? 'Building…' : 'Show report'}</button>
        {canExport && <button type="button" onClick={download} style={secondaryBtnStyle}>Download Excel</button>}
      </div>
      {data && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <p style={{ fontSize: 13, color: TEXT.secondary, margin: 0 }}>
            Table 4 (sent): <b>{data.sent.length}</b> line(s) · Table 5A (received back / used): <b>{data.received.length}</b> line(s) ·
            Outstanding at job workers: <b>{data.outstanding.length}</b>{data.overdue.length > 0 && <span style={{ color: '#dc2626' }}> · {data.overdue.length} past the Rule 45 limit</span>}
          </p>
          <div style={card}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 900 }}>
              <thead><tr>{['4 · Challan', 'Date', 'Job worker', 'Item', 'HSN', 'Qty', 'Taxable value', 'Type'].map((h) => <th key={h} style={th}>{h}</th>)}</tr></thead>
              <tbody>
                {data.sent.length === 0 && <tr><td colSpan={8} style={{ ...td, textAlign: 'center' }}>Nothing sent in this period.</td></tr>}
                {data.sent.map((r) => (
                  <tr key={r.issue_item_id} style={{ borderTop: '1px solid rgba(0,0,0,0.05)' }}>
                    <td style={{ ...td, fontWeight: 600 }}>{r.challan_number}</td><td style={td}>{fmtDate(r.challan_date)}</td><td style={td}>{r.vendor_name}</td>
                    <td style={td}>{r.item_name}</td><td style={td}>{r.hsn_code || '—'}</td><td style={td}>{r.quantity_sent} {r.uom}</td>
                    <td style={td}>{money(r.taxable_value)}</td><td style={td}>{r.goods_type === 'capital_goods' ? 'Capital goods' : 'Inputs'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={card}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 900 }}>
              <thead><tr>{['5A · Original challan', 'Our document', 'Date', 'Received as', 'Item', 'Qty', 'Taxable value'].map((h) => <th key={h} style={th}>{h}</th>)}</tr></thead>
              <tbody>
                {data.received.length === 0 && <tr><td colSpan={7} style={{ ...td, textAlign: 'center' }}>Nothing received back in this period.</td></tr>}
                {data.received.map((r, i) => (
                  <tr key={i} style={{ borderTop: '1px solid rgba(0,0,0,0.05)' }}>
                    <td style={{ ...td, fontWeight: 600 }}>{r.challan_number}</td><td style={td}>{r.document}</td><td style={td}>{fmtDate(r.document_date)}</td>
                    <td style={td}>{r.nature}</td><td style={td}>{r.item_name}</td><td style={td}>{r.quantity} {r.uom || ''}</td><td style={td}>{money(r.taxable_value)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

function ReceiveDialog({ challan, onClose, onDone }: {
  challan: Challan; onClose: () => void; onDone: (r: Receipt) => void
}) {
  const [items, setItems] = useState<StoreItem[]>([])
  const [poLines, setPoLines] = useState<{ id: number; label: string; unit_price?: number | null }[]>([])
  const open = challan.lines.filter((l) => l.quantity_outstanding - l.quantity_return_pending > 0)
  // The challan says what comes back; with one material sent, the same quantity is the usual start.
  const [outputItemId, setOutputItemId] = useState(challan.output_item_id ? String(challan.output_item_id) : '')
  const [outputQty, setOutputQty] = useState(challan.output_item_id && open.length === 1
    ? String(+(open[0].quantity_outstanding - open[0].quantity_return_pending).toFixed(4)) : '')
  const [receiptDate, setReceiptDate] = useState(new Date().toLocaleDateString('en-CA')) // local date, not UTC
  const [vendorDc, setVendorDc] = useState('')
  const [poLineId, setPoLineId] = useState('')
  const [rate, setRate] = useState('')
  const [remarks, setRemarks] = useState('')
  const [use, setUse] = useState<Record<number, { consumed: string; scrap: string }>>(
    Object.fromEntries(open.map((l) => [l.issue_item_id, { consumed: String(+(l.quantity_outstanding - l.quantity_return_pending).toFixed(4)), scrap: '' }])))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | string[]>('')

  useEffect(() => {
    storeApi.listItems().then(setItems).catch(() => setItems([]))
    if (challan.vendor_id) storeJobWorkApi.poLines(challan.vendor_id).then(setPoLines).catch(() => setPoLines([]))
  }, [challan.vendor_id])

  const save = async () => {
    if (!outputItemId) { setError('Pick the processed item that came back (Item Master).'); return }
    if (!(Number(outputQty) > 0)) { setError('Enter how many processed items came back.'); return }
    setBusy(true)
    setError('')
    try {
      const r = await storeJobWorkApi.createReceipt({
        issue_id: challan.issue_id, output_item_id: Number(outputItemId), output_quantity: Number(outputQty), receipt_date: receiptDate,
        vendor_challan_number: vendorDc.trim() || undefined, purchase_order_item_id: poLineId ? Number(poLineId) : undefined,
        job_charge_rate: rate !== '' ? Number(rate) : undefined, remarks: remarks.trim() || undefined,
        components: open.map((l) => ({ issue_item_id: l.issue_item_id, consumed_quantity: Number(use[l.issue_item_id]?.consumed || 0), scrap_quantity: Number(use[l.issue_item_id]?.scrap || 0) })),
      })
      onDone(r)
    } catch (err) {
      setError(extractErrorMessages(err, 'The job work receipt could not be posted.'))
    } finally { setBusy(false) }
  }

  return (
    <FormSheet icon="box" title="Receive processed item"
      subtitle={`Challan ${challan.challan_number || challan.issue_number} · ${challan.vendor_name || '—'} — material used leaves stock with the vendor; the processed item comes in at component value + job charge.`}
      onClose={onClose} busy={busy}
      footer={<>
        <button type="button" onClick={onClose} disabled={busy} style={sheetBtn('secondary', SHEET.INK, busy)}>Cancel</button>
        <button type="button" onClick={save} disabled={busy} style={sheetBtn('primary', SHEET.BLUE, busy)}><SheetIcon name="check" size={16} />{busy ? 'Posting…' : 'Post receipt'}</button>
      </>}>
      <SheetColumns
        left={<>
          <SheetError error={error} />
          <SheetSection icon="box" title="Processed Item">
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
              <div style={{ flex: '1 1 260px' }}>
                <label style={sheetLabel}>Processed item <Req /></label>
                <SearchableSelect value={outputItemId} onChange={setOutputItemId} placeholder="Search item code or name…"
                  options={items.map((i) => ({ value: String(i.id), label: `${i.item_code} — ${i.item_name}` }))} />
              </div>
              <div style={{ flex: '0 1 120px', minWidth: 110 }}>
                <label style={sheetLabel}>Qty received <Req /></label>
                <input type="number" min={0} step="any" style={sheetInput} value={outputQty} onChange={(e) => setOutputQty(e.target.value)} />
              </div>
            </div>
          </SheetSection>
          <SheetSection icon="list" title="Challan Material Used">
            <div style={{ overflow: 'auto', border: `1px solid ${SHEET.LINE}`, borderRadius: 10 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr>{['Item', 'At vendor', 'Used in item', 'Process scrap'].map((h) => <th key={h} style={{ ...th, position: 'static' }}>{h}</th>)}</tr></thead>
                <tbody>
                  {open.map((l) => (
                    <tr key={l.issue_item_id}>
                      <td style={td}>{l.item_name}{l.batch_number ? ` · ${l.batch_number}` : ''}</td>
                      <td style={td}>{+(l.quantity_outstanding - l.quantity_return_pending).toFixed(4)} {l.uom}</td>
                      <td style={td}><input type="number" min={0} step="any" style={{ ...sheetInput, width: 100, padding: '7px 10px' }} value={use[l.issue_item_id]?.consumed || ''}
                        onChange={(e) => setUse((u) => ({ ...u, [l.issue_item_id]: { ...u[l.issue_item_id], consumed: e.target.value } }))} /></td>
                      <td style={td}><input type="number" min={0} step="any" style={{ ...sheetInput, width: 100, padding: '7px 10px' }} value={use[l.issue_item_id]?.scrap || ''}
                        onChange={(e) => setUse((u) => ({ ...u, [l.issue_item_id]: { ...u[l.issue_item_id], scrap: e.target.value } }))} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </SheetSection>
        </>}
        right={<>
          <SheetSection icon="calendar" title="Receipt Details">
            <label style={sheetLabel}>Receipt date</label>
            <DateField value={receiptDate} onChange={setReceiptDate} />
            <label style={{ ...sheetLabel, marginTop: 14 }}>Vendor&apos;s DC / invoice <Optional /></label>
            <input style={sheetInput} value={vendorDc} onChange={(e) => setVendorDc(e.target.value)} />
          </SheetSection>
          <SheetSection icon="rupee" title="Job Charge" extra={<Optional />}>
            <label style={sheetLabel}>From PO line</label>
            <SearchableSelect value={poLineId} onChange={(v) => { setPoLineId(v); const pl = poLines.find((p) => String(p.id) === v); if (pl?.unit_price != null) setRate(String(pl.unit_price)) }}
              placeholder={poLines.length ? 'Pick the job-work PO line…' : 'No issued PO with this vendor'} options={poLines.map((p) => ({ value: String(p.id), label: p.label }))} />
            <label style={{ ...sheetLabel, marginTop: 14 }}>Job charge / unit</label>
            <input type="number" min={0} step="any" style={{ ...sheetInput, maxWidth: 160 }} value={rate} onChange={(e) => setRate(e.target.value)} placeholder="₹" />
          </SheetSection>
          <SheetSection icon="chat" title="Remarks" extra={<Optional />}>
            <textarea style={{ ...sheetInput, minHeight: 60, resize: 'vertical' }} value={remarks} onChange={(e) => setRemarks(e.target.value)} />
          </SheetSection>
        </>}
      />
    </FormSheet>
  )
}

/** Material back from the vendor UNPROCESSED (nothing was done to it): a
 *  Material Return against this challan — same item, same value, no job
 *  charge. Lowers the stock with the vendor (GST Rule 45 / ITC-04). */
function ReturnAsIsDialog({ challan, onClose, onDone }: {
  challan: Challan; onClose: () => void; onDone: (message: string) => void
}) {
  const open = challan.lines.filter((l) => l.quantity_outstanding - l.quantity_return_pending > 0)
  const left = (l: ChallanLine) => +(l.quantity_outstanding - l.quantity_return_pending).toFixed(4)
  const [qty, setQty] = useState<Record<number, string>>({})
  const [conditions, setConditions] = useState<{ value: string; label: string }[]>([])
  const [condition, setCondition] = useState<Record<number, string>>({})
  const [reason, setReason] = useState('')
  const [remarks, setRemarks] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | string[]>('')

  useEffect(() => {
    storeApi.listDocTypes('return_condition').then((c: { value: string; label: string }[]) => setConditions(c)).catch(() => setConditions([]))
  }, [])

  const save = async () => {
    const lines = open.filter((l) => Number(qty[l.issue_item_id] || 0) > 0)
    const problems: string[] = []
    if (!lines.length) problems.push('Enter the quantity that came back on at least one line.')
    for (const l of lines) {
      if (Number(qty[l.issue_item_id]) > left(l)) problems.push(`${l.item_name}: only ${left(l)} ${l.uom || ''} is still with the vendor.`)
    }
    if (!reason.trim()) problems.push('Say why it came back unprocessed (e.g. vendor could not do it, extra sent, order changed).')
    const locationId = open[0]?.location_id
    if (!locationId) problems.push('The store this challan was issued from is not known — use Store › Returns instead.')
    if (problems.length) { setError(problems); return }
    setBusy(true)
    setError('')
    try {
      const r = await storeApi.createMaterialReturn({
        location_id: locationId, source_type: 'issue', source_issue_id: challan.issue_id, reason: reason.trim(), remarks: remarks.trim() || undefined,
        items: lines.map((l) => ({ item_id: l.item_id, quantity: Number(qty[l.issue_item_id]), condition: condition[l.issue_item_id] || conditions[0]?.value || 'good', batch_number: l.batch_number || undefined })),
      })
      const pending = r?.status && r.status !== 'approved' && r.status !== 'completed'
      onDone(`${r?.return_number || 'Return'}: material back from ${challan.vendor_name || 'the vendor'} on challan ${challan.challan_number || challan.issue_number}`
        + (pending ? ' — waiting for approval; stock with the vendor goes down once it is approved.' : '. Stock with the vendor is reduced.'))
    } catch (err) {
      setError(extractErrorMessages(err, 'The return could not be recorded.'))
    } finally { setBusy(false) }
  }

  const cell: React.CSSProperties = { padding: '8px 10px', fontSize: 13, borderTop: `1px solid ${SHEET.LINE}` }
  return (
    <FormSheet width={760} icon="undo" title="Return as-is"
      subtitle={`Challan ${challan.challan_number || challan.issue_number} · ${challan.vendor_name || '—'}${challan.location_name ? ` · back into ${challan.location_name}` : ''} — unprocessed material, same item at the same value, no job charge.`}
      onClose={onClose} busy={busy}
      footer={<>
        <button type="button" onClick={onClose} disabled={busy} style={sheetBtn('secondary', SHEET.INK, busy)}>Cancel</button>
        <button type="button" onClick={save} disabled={busy} style={sheetBtn('primary', SHEET.BLUE, busy)}><SheetIcon name="undo" size={16} />{busy ? 'Saving…' : 'Record return'}</button>
      </>}>
      <div style={{ padding: '20px 24px' }}>
        <SheetError error={error} />
        <SheetSection icon="box" title="Material Back">
          <div style={{ border: `1px solid ${SHEET.LINE}`, borderRadius: 12, overflow: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 520 }}>
              <thead><tr style={{ background: SHEET.SOFT }}>{['Item', 'With vendor', 'Qty back', 'Condition'].map((h) => <th key={h} style={{ textAlign: 'left', padding: '8px 10px', fontSize: 11.5, color: SHEET.BODY }}>{h}</th>)}</tr></thead>
              <tbody>
                {open.map((l) => (
                  <tr key={l.issue_item_id}>
                    <td style={cell}>{l.item_name}{l.batch_number ? <div style={{ fontSize: 11.5, color: SHEET.MUTED }}>Batch {l.batch_number}</div> : null}</td>
                    <td style={cell}>{left(l)} {l.uom}</td>
                    <td style={{ ...cell, width: 130 }}>
                      <input style={{ ...sheetInput, padding: '7px 10px' }} type="number" min={0} max={left(l)} value={qty[l.issue_item_id] || ''} placeholder="0"
                        onChange={(e) => setQty({ ...qty, [l.issue_item_id]: e.target.value })} />
                    </td>
                    <td style={{ ...cell, width: 220 }}>
                      <Select style={{ ...sheetInput, padding: '7px 10px' }} value={condition[l.issue_item_id] || conditions[0]?.value || ''} onChange={(e) => setCondition({ ...condition, [l.issue_item_id]: e.target.value })}>
                        {conditions.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                      </Select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </SheetSection>
        <SheetSection icon="chat" title="Reason">
          <label style={sheetLabel}>Reason <Req /></label>
          <input style={sheetInput} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Vendor could not do it / extra quantity sent / order changed…" />
          <label style={{ ...sheetLabel, marginTop: 14 }}>Remarks <Optional /></label>
          <textarea style={{ ...sheetInput, minHeight: 60, resize: 'vertical' }} value={remarks} onChange={(e) => setRemarks(e.target.value)} />
        </SheetSection>
      </div>
    </FormSheet>
  )
}

