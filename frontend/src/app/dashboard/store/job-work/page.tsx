'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useFormDraft } from '@/lib/formDraft'
import DraftBanner from '@/components/shared/DraftBanner'
import { useRouter } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { storeApi, storeJobWorkApi } from '@/lib/api'
import { StoreItem } from '@/types'
import { TEXT, BRAND, GLASS, SHADOWS, CONTROL } from '@/lib/theme'
import { Field, primaryBtnStyle, secondaryBtnStyle, chipBtnStyle, RowCount, Pill } from '@/components/shared/ui'
import { formatDate } from '@/lib/format'
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
  /** The processed item expected back (set on the challan) — the first of output_item_ids. */
  output_item_id?: number | null
  /** Every item expected back, with the expected quantity (material sent can come back as several items). */
  output_items?: { item_id: number; quantity?: number | null }[]
}
interface VendorStock { vendor_name?: string | null; item_code?: string | null; item_name?: string | null; uom?: string | null; quantity: number; value: number; challans: string[]; oldest_challan_date: string; overdue: boolean }
interface Receipt {
  id: number; receipt_number: string; challan_number?: string | null; issue_number?: string | null; vendor_name?: string | null; receipt_date: string
  output_item_code?: string | null; output_item_name?: string | null; output_quantity: number; uom?: string | null; output_batch_number?: string | null
  component_value?: number | null; job_charge_rate?: number | null; output_unit_cost?: number | null; inspection_lot_number?: string | null
  vendor_challan_number?: string | null
  /** Every processed item received (one receipt can bring back several). */
  outputs?: { item_id: number; item_name?: string | null; uom?: string | null; quantity: number; batch_number?: string | null; job_charge_rate?: number | null; unit_cost?: number | null; inspection_lot_number?: string | null }[]
}

const STATUS_LABELS: Record<string, string> = { open: 'At vendor', due_back: 'Past expected return', overdue: 'Rule 45 limit passed', closed: 'Closed' }
const STATUS_HEX: Record<string, string> = { open: '#2563eb', due_back: '#d97706', overdue: '#dc2626', closed: '#16a34a' }

const card: React.CSSProperties = { borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur, border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), overflow: 'auto', maxHeight: 'calc(100vh - 340px)' }
const th: React.CSSProperties = { position: 'sticky', top: 0, background: '#fdf1e6', zIndex: 1, textAlign: 'left', padding: '10px 14px', fontSize: 11, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, whiteSpace: 'nowrap' }
const td: React.CSSProperties = { padding: '10px 14px', fontSize: 13, color: TEXT.secondary, verticalAlign: 'top' }
const thNum: React.CSSProperties = { ...th, textAlign: 'right' }
const tdNum: React.CSSProperties = { ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }
// Columns holding numbers / money — right-aligned so digits line up.
const NUM_COLS = new Set(['Value at vendor', 'Days out', 'Quantity at vendor', 'Value', 'Component value', 'Job charge', 'Unit cost', 'Qty', 'Taxable value', 'At vendor', 'With vendor'])
const thFor = (h: string) => (NUM_COLS.has(h) ? thNum : th)
const fmtDate = (d?: string | null) => (d ? formatDate(d) : '—')
const fmtQty = (n?: number | null) => (n == null ? '—' : Number(n).toLocaleString('en-IN', { maximumFractionDigits: 4 }))
const humanize = (v?: string | null) => (v ? v.charAt(0).toUpperCase() + v.slice(1).replace(/_/g, ' ') : '')
const money = (v?: number | null) => (v == null ? '—' : `₹${Number(v).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`)

// Receipts saved before several items per receipt read their single header item.
const outsOf = (r: Receipt) => (r.outputs?.length ? r.outputs : [{
  item_id: 0, item_name: r.output_item_name, uom: r.uom, quantity: r.output_quantity, batch_number: r.output_batch_number,
  job_charge_rate: r.job_charge_rate, unit_cost: r.output_unit_cost, inspection_lot_number: r.inspection_lot_number,
}])

function Badge({ status }: { status: string }) {
  return <Pill label={STATUS_LABELS[status] || humanize(status)} hex={STATUS_HEX[status] || '#64748b'} />
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

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12, marginBottom: 16 }}>
        {[
          { label: 'Open challans', value: challans.filter((c) => c.status !== 'closed').length.toLocaleString('en-IN') },
          ...(seeValues ? [{ label: 'Value at vendors', value: money(atVendorValue) }] : []),
          { label: 'Past Rule 45 limit', value: overdue.toLocaleString('en-IN'), danger: overdue > 0 },
        ].map((k) => (
          <div key={k.label} style={{ padding: '12px 16px', borderRadius: 14, background: GLASS.card, border: `1px solid ${GLASS.border}` }}>
            <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.05em', color: TEXT.muted }}>{k.label}</div>
            <div style={{ fontSize: 20, fontWeight: 700, color: k.danger ? '#dc2626' : TEXT.heading }}>{k.value}</div>
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14, alignItems: 'center' }}>
        {([['challans', 'Challans'], ['vendor', 'Stock with Vendors'], ['receipts', 'Job Work Receipts'], ['itc04', 'ITC-04']] as [Tab, string][]).filter(([k]) => k !== 'receipts' || seeReceipts).map(([k, l]) => (
          <button key={k} type="button" onClick={() => setTab(k)} style={chipBtnStyle(tab === k)}>{l}</button>
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
            <thead><tr>{['Challan', 'Date', 'Vendor', 'Material (sent / back / used / at vendor)', ...(seeValues ? ['Value at vendor'] : []), 'Days out', 'Return by (Rule 45)', 'Status', ''].map((h, hi) => <th key={h} style={thFor(h)}>{h}{hi === 0 && <RowCount count={challans.length} />}</th>)}</tr></thead>
            <tbody>
              {loading && <tr><td colSpan={9} style={{ ...td, textAlign: 'center' }}>Loading…</td></tr>}
              {!loading && challans.length === 0 && <tr><td colSpan={9} style={{ ...td, textAlign: 'center' }}>{showAll ? 'No job-work challans yet — use + New Challan to send material to a job worker.' : 'No job-work material is out at vendors — tick “Show closed challans too” to see past ones.'}</td></tr>}
              {!loading && challans.map((c) => (
                <tr key={c.issue_id} style={{ borderTop: '1px solid rgba(0,0,0,0.05)', cursor: 'pointer' }} onClick={() => router.push(recordPath('/dashboard/store/issues', c, 'issue_id'))}>
                  <td style={{ ...td, fontWeight: 600, color: TEXT.body }}>{c.challan_number || '—'}<div style={{ fontSize: 11.5, color: TEXT.muted, fontWeight: 400 }}>{c.issue_number}</div></td>
                  <td style={{ ...td, whiteSpace: 'nowrap' }}>{fmtDate(c.challan_date)}</td>
                  <td style={td}>{c.vendor_name || '—'}{c.process && <div style={{ fontSize: 11.5, color: TEXT.muted }}>{humanize(c.process)}</div>}</td>
                  <td style={td}>
                    {c.lines.map((l) => (
                      <div key={l.issue_item_id} style={{ marginBottom: 3 }}>
                        <b style={{ color: TEXT.body }}>{l.item_name}</b>{l.batch_number ? ` · ${l.batch_number}` : ''} — {fmtQty(l.quantity_sent)} / {fmtQty(l.quantity_returned)} / {fmtQty(+(l.quantity_consumed + l.quantity_scrap).toFixed(4))} /{' '}
                        <b style={{ color: l.quantity_outstanding > 0 ? '#7c3aed' : '#16a34a' }}>{fmtQty(l.quantity_outstanding)}</b> {l.uom || ''}
                        {l.quantity_return_pending > 0 && <span style={{ color: '#d97706' }}> ({fmtQty(l.quantity_return_pending)} return awaiting approval)</span>}
                      </div>
                    ))}
                  </td>
                  {seeValues && <td style={tdNum}>{money(c.outstanding_value)}</td>}
                  <td style={tdNum}>{c.days_out}</td>
                  <td style={{ ...td, whiteSpace: 'nowrap', color: c.status === 'overdue' ? '#dc2626' : TEXT.secondary }}>{fmtDate(c.return_deadline)}</td>
                  <td style={td}><Badge status={c.status} /></td>
                  <td style={td} onClick={(e) => e.stopPropagation()}>
                    {c.status !== 'closed' && canReceive && (
                      <span onClick={() => setReceiving(c)} style={{ color: BRAND.primaryActive, fontSize: 12.5, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' }}>Receive processed items</span>
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
            <thead><tr>{['Vendor', 'Item', 'Quantity at vendor', ...(seeValues ? ['Value'] : []), 'Challans', 'Oldest challan'].map((h, hi) => <th key={h} style={thFor(h)}>{h}{hi === 0 && <RowCount count={vendorStock.length} />}</th>)}</tr></thead>
            <tbody>
              {loading && <tr><td colSpan={6} style={{ ...td, textAlign: 'center' }}>Loading…</td></tr>}
              {!loading && vendorStock.length === 0 && <tr><td colSpan={6} style={{ ...td, textAlign: 'center' }}>No stock is with vendors — material shows here once a job-work challan is issued.</td></tr>}
              {!loading && vendorStock.map((s, i) => (
                <tr key={i} style={{ borderTop: '1px solid rgba(0,0,0,0.05)' }}>
                  <td style={{ ...td, fontWeight: 600, color: TEXT.body }}>{s.vendor_name || '—'}</td>
                  <td style={td}>{s.item_code || '—'} — {s.item_name || '—'}</td>
                  <td style={{ ...tdNum, fontWeight: 600, color: '#7c3aed' }}>{fmtQty(s.quantity)} {s.uom || ''}</td>
                  {seeValues && <td style={tdNum}>{money(s.value)}</td>}
                  <td style={td}>{s.challans.join(', ') || '—'}</td>
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
            <thead><tr>{['Receipt', 'Date', 'Challan', 'Vendor', 'Processed items', 'Batch', ...(seeValues ? ['Component value'] : []), 'Job charge', ...(seeValues ? ['Unit cost'] : []), 'Inspection'].map((h, hi) => <th key={h} style={thFor(h)}>{h}{hi === 0 && <RowCount count={receipts.length} />}</th>)}</tr></thead>
            <tbody>
              {loading && <tr><td colSpan={10} style={{ ...td, textAlign: 'center' }}>Loading…</td></tr>}
              {!loading && receipts.length === 0 && <tr><td colSpan={10} style={{ ...td, textAlign: 'center' }}>No job work receipts yet — use “Receive processed item” on an open challan.</td></tr>}
              {!loading && receipts.map((r) => (
                <tr key={r.id} style={{ borderTop: '1px solid rgba(0,0,0,0.05)' }}>
                  <td style={{ ...td, fontWeight: 600, color: TEXT.body }}>{r.receipt_number}{r.vendor_challan_number && <div style={{ fontSize: 11.5, color: TEXT.muted, fontWeight: 400 }}>Vendor DC {r.vendor_challan_number}</div>}</td>
                  <td style={{ ...td, whiteSpace: 'nowrap' }}>{fmtDate(r.receipt_date)}</td>
                  <td style={td}>{r.challan_number || r.issue_number || '—'}</td>
                  <td style={td}>{r.vendor_name || '—'}</td>
                  <td style={td}>{outsOf(r).map((o, i) => <div key={i}>{fmtQty(o.quantity)} {o.uom || ''} {o.item_name || ''}</div>)}</td>
                  <td style={td}>{outsOf(r).map((o, i) => <div key={i}>{o.batch_number || '—'}</div>)}</td>
                  {seeValues && <td style={tdNum}>{money(r.component_value)}</td>}
                  <td style={tdNum}>{outsOf(r).map((o, i) => <div key={i}>{o.job_charge_rate != null ? `${money(o.job_charge_rate)} / ${o.uom || 'unit'}` : '—'}</div>)}</td>
                  {seeValues && <td style={tdNum}>{outsOf(r).map((o, i) => <div key={i}>{money(o.unit_cost)}</div>)}</td>}
                  <td style={td}>{outsOf(r).map((o, i) => <div key={i}>{o.inspection_lot_number || '—'}</div>)}</td>
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
          onDone={(r) => { setReceiving(null); setDone(`${r.receipt_number}: ` + outsOf(r).map((o) => `${fmtQty(o.quantity)} ${o.uom || ''} ${o.item_name || ''} received${o.inspection_lot_number ? ` into Quality stock under lot ${o.inspection_lot_number}` : ''}${o.unit_cost != null ? ` at ${money(o.unit_cost)} each` : ''}`).join('; ') + '.'); load() }} />
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
            Table 4 (sent): <b>{data.sent.length}</b> line{data.sent.length === 1 ? '' : 's'} · Table 5A (received back / used): <b>{data.received.length}</b> line{data.received.length === 1 ? '' : 's'} ·
            Outstanding at job workers: <b>{data.outstanding.length}</b>{data.overdue.length > 0 && <span style={{ color: '#dc2626' }}> · {data.overdue.length} past the Rule 45 limit</span>}
          </p>
          <div style={card}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 900 }}>
              <thead><tr>{['4 · Challan', 'Date', 'Job worker', 'Item', 'HSN', 'Qty', 'Taxable value', 'Type'].map((h, hi) => <th key={h} style={thFor(h)}>{h}{hi === 0 && <RowCount count={data.sent.length} />}</th>)}</tr></thead>
              <tbody>
                {data.sent.length === 0 && <tr><td colSpan={8} style={{ ...td, textAlign: 'center' }}>Nothing sent in this period.</td></tr>}
                {data.sent.map((r) => (
                  <tr key={r.issue_item_id} style={{ borderTop: '1px solid rgba(0,0,0,0.05)' }}>
                    <td style={{ ...td, fontWeight: 600 }}>{r.challan_number || '—'}</td><td style={{ ...td, whiteSpace: 'nowrap' }}>{fmtDate(r.challan_date)}</td><td style={td}>{r.vendor_name || '—'}</td>
                    <td style={td}>{r.item_name}</td><td style={td}>{r.hsn_code || '—'}</td><td style={tdNum}>{fmtQty(r.quantity_sent)} {r.uom || ''}</td>
                    <td style={tdNum}>{money(r.taxable_value)}</td><td style={td}>{r.goods_type === 'capital_goods' ? 'Capital goods' : 'Inputs'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={card}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 900 }}>
              <thead><tr>{['5A · Original challan', 'Our document', 'Date', 'Received as', 'Item', 'Qty', 'Taxable value'].map((h, hi) => <th key={h} style={thFor(h)}>{h}{hi === 0 && <RowCount count={data.received.length} />}</th>)}</tr></thead>
              <tbody>
                {data.received.length === 0 && <tr><td colSpan={7} style={{ ...td, textAlign: 'center' }}>Nothing received back in this period.</td></tr>}
                {data.received.map((r, i) => (
                  <tr key={i} style={{ borderTop: '1px solid rgba(0,0,0,0.05)' }}>
                    <td style={{ ...td, fontWeight: 600 }}>{r.challan_number}</td><td style={td}>{r.document}</td><td style={{ ...td, whiteSpace: 'nowrap' }}>{fmtDate(r.document_date)}</td>
                    <td style={td}>{r.nature}</td><td style={td}>{r.item_name}</td><td style={tdNum}>{fmtQty(r.quantity)} {r.uom || ''}</td><td style={tdNum}>{money(r.taxable_value)}</td>
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

interface OutputLine { itemId: string; qty: string; poLineId: string; rate: string; share: string }
const emptyOutput = (): OutputLine => ({ itemId: '', qty: '', poLineId: '', rate: '', share: '' })
const smallBtn: React.CSSProperties = { ...sheetBtn('secondary', SHEET.INK), padding: '6px 12px', minHeight: 30, fontSize: 12 }

function ReceiveDialog({ challan, onClose, onDone }: {
  challan: Challan; onClose: () => void; onDone: (r: Receipt) => void
}) {
  const [items, setItems] = useState<StoreItem[]>([])
  const [poLines, setPoLines] = useState<{ id: number; label: string; unit_price?: number | null }[]>([])
  const open = challan.lines.filter((l) => l.quantity_outstanding - l.quantity_return_pending > 0)
  // The challan says what comes back; with one material sent, the same quantity is the usual start.
  // Material sent can come back as several different items (plate → flange + ring): one line each.
  // One line per item the challan expects back, with its expected quantity (or, for one item back
  // from one material with no quantity given, what is still at the vendor).
  const expected = challan.output_items?.length ? challan.output_items : (challan.output_item_id ? [{ item_id: challan.output_item_id, quantity: null }] : [])
  const [outputs, setOutputs] = useState<OutputLine[]>(expected.length ? expected.map((e) => ({
    ...emptyOutput(), itemId: String(e.item_id),
    qty: e.quantity != null ? String(e.quantity)
      : expected.length === 1 && open.length === 1 ? String(+(open[0].quantity_outstanding - open[0].quantity_return_pending).toFixed(4)) : '',
  })) : [emptyOutput()])
  const [receiptDate, setReceiptDate] = useState(new Date().toLocaleDateString('en-CA')) // local date, not UTC
  const [vendorDc, setVendorDc] = useState('')
  const [remarks, setRemarks] = useState('')
  const [use, setUse] = useState<Record<number, { consumed: string; scrap: string }>>(
    Object.fromEntries(open.map((l) => [l.issue_item_id, { consumed: String(+(l.quantity_outstanding - l.quantity_return_pending).toFixed(4)), scrap: '' }])))
  const [busy, setBusy] = useState(false)
  const [importing, setImporting] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const [error, setError] = useState<string | string[]>('')
  const draft = useFormDraft(`store-job-work-receipt-new-${challan.issue_id}`,
    { outputs, receiptDate, vendorDc, remarks, use }, (d) => {
      if (Array.isArray(d.outputs) && d.outputs.length) setOutputs(d.outputs)
      setReceiptDate(d.receiptDate || new Date().toLocaleDateString('en-CA'))
      setVendorDc(d.vendorDc ?? ''); setRemarks(d.remarks ?? '')
      setUse((u) => ({ ...u, ...(d.use ?? {}) }))
    })

  useEffect(() => {
    storeApi.listItems().then(setItems).catch(() => setItems([]))
    if (challan.vendor_id) storeJobWorkApi.poLines(challan.vendor_id).then(setPoLines).catch(() => setPoLines([]))
  }, [challan.vendor_id])

  const setOut = (idx: number, patch: Partial<OutputLine>) => setOutputs((prev) => prev.map((o, i) => (i === idx ? { ...o, ...patch } : o)))
  const removeOut = (idx: number) => setOutputs((prev) => (prev.length === 1 ? [emptyOutput()] : prev.filter((_, i) => i !== idx)))
  const filled = outputs.filter((o) => o.itemId || o.qty)
  const shareTotal = filled.reduce((a, o) => a + (o.share !== '' ? Number(o.share) : 0), 0)

  const importFile = async (file: File | undefined) => {
    if (!file) return
    setImporting(true)
    try {
      const res = await storeJobWorkApi.importReceiptOutputs(file)
      const imported: OutputLine[] = res.lines.map((l) => ({
        itemId: String(l.item_id), qty: String(l.quantity), poLineId: '',
        rate: l.job_charge_rate != null ? String(l.job_charge_rate) : '', share: l.cost_share_pct != null ? String(l.cost_share_pct) : '',
      }))
      setOutputs((prev) => {
        const all = [...prev.filter((o) => o.itemId || o.qty), ...imported]
        return all.length ? all : [emptyOutput()]
      })
      if (res.errors.length) {
        setError([
          `${res.lines.length} item(s) were added. ${res.errors.length} row(s) were skipped — fix them in the file and import again, or add them by hand:`,
          ...res.errors.map((e) => `Row ${e.row}${e.item_code ? ` (${e.item_code})` : ''}: ${e.reason}`),
        ])
      }
    } catch (err) {
      setError(extractErrorMessages(err, 'Could not read the file — use the template (.xlsx or .csv) and keep its header row.'))
    } finally {
      setImporting(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const downloadTemplate = async () => {
    try {
      const url = URL.createObjectURL(await storeJobWorkApi.receiptOutputsTemplate())
      const a = document.createElement('a')
      a.href = url
      a.download = 'job_work_receipt_items_template.xlsx'
      a.click()
      URL.revokeObjectURL(url)
    } catch (err) { setError(extractErrorMessages(err, 'Could not download the template.')) }
  }

  const save = async () => {
    const problems: string[] = []
    if (!filled.length) problems.push('Add the processed item(s) that came back (Item Master).')
    filled.forEach((o, i) => {
      const name = items.find((it) => String(it.id) === o.itemId)?.item_name || `Line ${i + 1}`
      if (!o.itemId) problems.push(`Line ${i + 1}: pick the processed item.`)
      if (!(Number(o.qty) > 0)) problems.push(`${name}: enter how many came back.`)
    })
    const withShare = filled.filter((o) => o.share !== '').length
    if (filled.length > 1 && withShare && withShare !== filled.length) problems.push('Cost share % is filled on some items and blank on others — fill every line (total 100) or leave all blank.')
    if (filled.length > 1 && withShare === filled.length && Math.abs(shareTotal - 100) > 0.01) problems.push(`Cost shares add up to ${+shareTotal.toFixed(2)}% — they must total 100%.`)
    if (problems.length) { setError(problems); return }
    setBusy(true)
    setError('')
    try {
      const r = await storeJobWorkApi.createReceipt({
        issue_id: challan.issue_id, receipt_date: receiptDate,
        vendor_challan_number: vendorDc.trim() || undefined, remarks: remarks.trim() || undefined,
        outputs: filled.map((o) => ({
          item_id: Number(o.itemId), quantity: Number(o.qty), purchase_order_item_id: o.poLineId ? Number(o.poLineId) : undefined,
          job_charge_rate: o.rate !== '' ? Number(o.rate) : undefined, cost_share_pct: filled.length > 1 && o.share !== '' ? Number(o.share) : undefined,
        })),
        components: open.map((l) => ({ issue_item_id: l.issue_item_id, consumed_quantity: Number(use[l.issue_item_id]?.consumed || 0), scrap_quantity: Number(use[l.issue_item_id]?.scrap || 0) })),
      })
      draft.clear()
      onDone(r)
    } catch (err) {
      setError(extractErrorMessages(err, 'The job work receipt could not be posted.'))
    } finally { setBusy(false) }
  }

  const cellInput: React.CSSProperties = { ...sheetInput, padding: '7px 10px' }
  return (
    <FormSheet icon="box" title="Receive processed items"
      subtitle={`Challan ${challan.challan_number || challan.issue_number} · ${challan.vendor_name || '—'} — material used leaves stock with the vendor; each processed item comes in at its share of the material value + its job charge.`}
      onClose={onClose} busy={busy}
      footer={<>
        <button type="button" onClick={onClose} disabled={busy} style={sheetBtn('secondary', SHEET.INK, busy)}>Cancel</button>
        <button type="button" onClick={save} disabled={busy} style={sheetBtn('primary', SHEET.BLUE, busy)}><SheetIcon name="check" size={16} />{busy ? 'Posting…' : 'Post receipt'}</button>
      </>}>
      <SheetColumns
        left={<>
          <DraftBanner draft={draft} />
          <SheetError error={error} />
          <SheetSection icon="box" title="Processed Items" extra={
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <input ref={fileRef} type="file" hidden accept=".xlsx,.xlsm,.csv" onChange={(e) => importFile(e.target.files?.[0])} />
              <button type="button" onClick={() => fileRef.current?.click()} disabled={importing} style={smallBtn}>
                <SheetIcon name="upload" size={14} />{importing ? 'Reading…' : 'Import from Excel'}
              </button>
              <button type="button" onClick={downloadTemplate} style={smallBtn}><SheetIcon name="doc" size={14} />Download template</button>
            </div>
          }>
            <p style={{ fontSize: 12, color: SHEET.MUTED, margin: '0 0 10px' }}>
              One line per different item that came back.{outputs.length > 1 && ' Cost share % = part of the sent material’s value each item carries; leave all blank to split by standard cost × quantity.'}
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {outputs.map((o, idx) => (
                <div key={idx} style={{ border: `1px solid ${SHEET.LINE}`, borderRadius: 10, padding: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
                    <div style={{ flex: '1 1 240px' }}>
                      <label style={sheetLabel}>Processed item <Req /></label>
                      <SearchableSelect value={o.itemId} onChange={(v) => setOut(idx, { itemId: v })} placeholder="Search item code or name…"
                        options={items.map((i) => ({ value: String(i.id), label: `${i.item_code} — ${i.item_name}` }))} />
                    </div>
                    <div style={{ flex: '0 1 110px', minWidth: 100 }}>
                      <label style={sheetLabel}>Qty received <Req /></label>
                      <input type="number" min={0} step="any" style={cellInput} value={o.qty} onChange={(e) => setOut(idx, { qty: e.target.value })} />
                    </div>
                    <button type="button" title="Remove this item" aria-label="Remove item" onClick={() => removeOut(idx)}
                      style={{ ...sheetBtn('secondary', SHEET.INK), padding: 0, width: CONTROL.height, height: CONTROL.height, justifyContent: 'center' }}><SheetIcon name="trash" size={15} /></button>
                  </div>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
                    <div style={{ flex: '1 1 220px' }}>
                      <label style={sheetLabel}>Job charge from PO line <Optional /></label>
                      <SearchableSelect value={o.poLineId} onChange={(v) => { const pl = poLines.find((p) => String(p.id) === v); setOut(idx, { poLineId: v, ...(pl?.unit_price != null ? { rate: String(pl.unit_price) } : {}) }) }}
                        placeholder={poLines.length ? 'Pick the job-work PO line…' : 'No issued PO with this vendor'} options={poLines.map((p) => ({ value: String(p.id), label: p.label }))} />
                    </div>
                    <div style={{ flex: '0 1 120px', minWidth: 100 }}>
                      <label style={sheetLabel}>Job charge / unit</label>
                      <input type="number" min={0} step="any" style={cellInput} value={o.rate} onChange={(e) => setOut(idx, { rate: e.target.value })} placeholder="₹" />
                    </div>
                    {outputs.length > 1 && (
                      <div style={{ flex: '0 1 110px', minWidth: 100 }}>
                        <label style={sheetLabel}>Cost share %</label>
                        <input type="number" min={0} max={100} step="any" style={cellInput} value={o.share} onChange={(e) => setOut(idx, { share: e.target.value })} placeholder="Auto" />
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 10, gap: 10, flexWrap: 'wrap' }}>
              <button type="button" onClick={() => setOutputs((prev) => [...prev, emptyOutput()])} style={sheetBtn('ghost', SHEET.BLUE)}><SheetIcon name="plus" size={15} />Add Item</button>
              {outputs.length > 1 && filled.some((o) => o.share !== '') && (
                <span style={{ fontSize: 12.5, color: Math.abs(shareTotal - 100) > 0.01 ? '#b91c1c' : '#16a34a' }}>Cost share total: {+shareTotal.toFixed(2)}%</span>
              )}
            </div>
          </SheetSection>
          <SheetSection icon="list" title="Challan Material Used">
            <div style={{ overflow: 'auto', border: `1px solid ${SHEET.LINE}`, borderRadius: 10 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr>{['Item', 'At vendor', 'Used in items', 'Process scrap'].map((h, hi) => <th key={h} style={{ ...thFor(h), position: 'static' }}>{h}{hi === 0 && <RowCount count={open.length} />}</th>)}</tr></thead>
                <tbody>
                  {open.map((l) => (
                    <tr key={l.issue_item_id}>
                      <td style={td}>{l.item_name}{l.batch_number ? ` · ${l.batch_number}` : ''}</td>
                      <td style={tdNum}>{fmtQty(+(l.quantity_outstanding - l.quantity_return_pending).toFixed(4))} {l.uom || ''}</td>
                      <td style={td}><input type="number" min={0} step="any" style={{ ...cellInput, width: 100 }} value={use[l.issue_item_id]?.consumed || ''}
                        onChange={(e) => setUse((u) => ({ ...u, [l.issue_item_id]: { ...u[l.issue_item_id], consumed: e.target.value } }))} /></td>
                      <td style={td}><input type="number" min={0} step="any" style={{ ...cellInput, width: 100 }} value={use[l.issue_item_id]?.scrap || ''}
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
  const draft = useFormDraft(`store-job-work-return-new-${challan.issue_id}`, { qty, condition, reason, remarks }, (d) => {
    setQty(d.qty ?? {}); setCondition(d.condition ?? {}); setReason(d.reason ?? ''); setRemarks(d.remarks ?? '')
  })

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
      draft.clear()
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
        <DraftBanner draft={draft} />
        <SheetError error={error} />
        <SheetSection icon="box" title="Material Back">
          <div style={{ border: `1px solid ${SHEET.LINE}`, borderRadius: 12, overflow: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 520 }}>
              <thead><tr style={{ background: SHEET.SOFT }}>{['Item', 'With vendor', 'Qty back', 'Condition'].map((h, hi) => <th key={h} style={{ textAlign: h === 'With vendor' ? 'right' : 'left', padding: '8px 10px', fontSize: 11.5, color: SHEET.BODY, whiteSpace: 'nowrap' }}>{h}{hi === 0 && <RowCount count={open.length} />}</th>)}</tr></thead>
              <tbody>
                {open.map((l) => (
                  <tr key={l.issue_item_id}>
                    <td style={cell}>{l.item_name}{l.batch_number ? <div style={{ fontSize: 11.5, color: SHEET.MUTED }}>Batch {l.batch_number}</div> : null}</td>
                    <td style={{ ...cell, textAlign: 'right', whiteSpace: 'nowrap' }}>{fmtQty(left(l))} {l.uom || ''}</td>
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

