'use client'

// ME47 / ME49 / ME21N on one RFQ:
// 1. Record each vendor's quote line by line (price, discount, GST, delivery days, make) plus freight / packing.
// 2. Comparison grid — landed unit cost per line (excl. GST), L1 per line and overall.
// 3. Award each line to a vendor (reason when not L1).
// 4. Create one draft PO per awarded vendor (plant / ship-to), then price-check and send each for approval.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { useCan } from '@/lib/permissions'
import { organizationApi, p2pApi, rfqApi, storeApi, vendorsApi } from '@/lib/api'
import { Comparison, LineQuotation, SplitProposal, mmQuotationsApi } from '@/lib/mmPurchasingApi'
import { P2PRequest, RFQ } from '@/types'
import { TEXT, GLASS, SHADOWS, BORDER } from '@/lib/theme'
import { inputStyle, primaryBtnStyle, secondaryBtnStyle } from '@/components/shared/ui'
import P2PNav from '@/components/p2p/P2PNav'
import SearchableSelect from '@/components/erp/SearchableSelect'
import DateField from '@/components/erp/DateField'
import ConfirmDialog from '@/components/erp/ConfirmDialog'
import { extractErrorMessages } from '@/lib/validation'
import { recordHref, recordPath, useRecordId } from '@/lib/recordRef'
import InvalidRecordLink from '@/components/erp/InvalidRecordLink'
import { useEscapeKey } from '@/hooks/useEscapeKey'
import { FormSheet, SheetSection, SheetIcon, Req, SHEET, sheetBtn, sheetInput, sheetLabel, sheetHint } from '@/components/shared/FormSheet'

const card: React.CSSProperties = {
  borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur,
  border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), padding: 20, marginBottom: 16,
}
const h2: React.CSSProperties = { fontSize: 15, fontWeight: 700, color: TEXT.heading, margin: '0 0 12px' }
const cellInput: React.CSSProperties = { ...sheetInput, padding: '6px 8px' }
const th: React.CSSProperties = { textAlign: 'left', padding: '8px 10px', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', color: TEXT.muted, background: '#fdf1e6', whiteSpace: 'nowrap', position: 'sticky', top: 0, zIndex: 1 }
const td: React.CSSProperties = { padding: '7px 10px', fontSize: 12.5, borderTop: `1px solid ${BORDER.normal}`, verticalAlign: 'top' }
const errBox: React.CSSProperties = { padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }
const money = (v: number | null | undefined) => (v == null ? '—' : v.toLocaleString('en-IN', { maximumFractionDigits: 2 }))

type Opt = { value: string; label: string }

export default function QuotationComparisonPage() {
  const { isAuthorized, isLoading } = useRequireApp('purchase')
  const router = useRouter()
  const params = useParams()
  const { id: rfqId, error: linkError } = useRecordId(params?.id as string)
  const { can, canFeature } = useCan()
  // R.F.Q › Quotation comparison + Vendor quotations (role editor) — both feed this page.
  const allowCmp = canFeature('p2p', 'rfq', 'comparison', 'view') && canFeature('p2p', 'rfq', 'vendor_quotes', 'view')
  const [rfq, setRfq] = useState<RFQ | null>(null)
  const [pr, setPr] = useState<P2PRequest | null>(null)
  const [quotes, setQuotes] = useState<LineQuotation[]>([])
  const [cmp, setCmp] = useState<Comparison | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [editing, setEditing] = useState<LineQuotation | 'new' | null>(null)
  const [picks, setPicks] = useState<Record<number, string>>({})
  const [reasons, setReasons] = useState<Record<number, string>>({})
  const [showSplit, setShowSplit] = useState(false)

  const load = useCallback(async () => {
    if (!rfqId) return
    if (!allowCmp) {
      setError("Your role doesn't include R.F.Q › Quotation comparison and Vendor quotations (view), so this page can't be shown. Ask an admin to add them to your role (Organization › Roles).")
      return
    }
    try {
      const r: RFQ = await rfqApi.get(rfqId)
      const [p, q, c] = await Promise.all([p2pApi.get(r.p2p_request_id), mmQuotationsApi.list(rfqId), mmQuotationsApi.comparison(rfqId)])
      setRfq(r); setPr(p); setQuotes(q); setCmp(c)
      setPicks(Object.fromEntries(c.lines.map((l) => {
        const awarded = l.quotes.find((x) => x?.is_awarded)
        return [l.pr_item_id, String(awarded?.vendor_quotation_item_id ?? l.l1_vendor_quotation_item_id ?? '')]
      })))
      setError('')
    } catch (err) { setError(extractErrorMessages(err, 'Could not load the quotations of this RFQ — go back to the RFQ and open it again.').join(' ')) }
  }, [rfqId, allowCmp])
  useEffect(() => { if (isAuthorized) Promise.resolve().then(load) }, [isAuthorized, load])

  if (linkError) return (<div><P2PNav /><InvalidRecordLink message={linkError} listHref="/dashboard/p2p/rfq" listLabel="Back to RFQs" /></div>)
  if (isLoading || !isAuthorized) return null

  const canEdit = can('p2p', 'rfq', 'edit')
  const canRecordQuote = canEdit && canFeature('p2p', 'rfq', 'vendor_quotes', 'create')
  const canAward = canEdit && canFeature('p2p', 'rfq', 'award', 'edit')
  const canExport = can('p2p', 'rfq', 'export') && canFeature('p2p', 'rfq', 'comparison', 'export')
    && (canEdit || canFeature('p2p', 'rfq', 'prices', 'view'))
  const canCreatePo = can('p2p', 'purchase_orders', 'create')

  const saveAwards = async () => {
    if (!cmp || !rfqId) return
    const awards = cmp.lines.filter((l) => picks[l.pr_item_id]).map((l) => ({
      pr_item_id: l.pr_item_id, vendor_quotation_item_id: Number(picks[l.pr_item_id]), reason: reasons[l.pr_item_id]?.trim() || undefined,
    }))
    if (!awards.length) { setError('Pick a vendor for at least one line.'); return }
    setBusy(true)
    try { setCmp(await mmQuotationsApi.award(rfqId, awards)); setError('') } catch (err) {
      setError(extractErrorMessages(err, 'Could not save the awards.').join(' '))
    } finally { setBusy(false) }
  }

  const exportXlsx = async () => {
    if (!rfqId || !rfq) return
    try {
      const blob = await mmQuotationsApi.exportComparison(rfqId)
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = `${rfq.rfq_number}_comparison.xlsx`
      a.click()
    } catch (err) { setError(extractErrorMessages(err, 'Could not export the comparison.').join(' ')) }
  }

  return (
    <div>
      <P2PNav />
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, marginBottom: 16, flexWrap: 'wrap' }}>
        <div>
          <p style={{ fontSize: 12, fontWeight: 600, color: '#FF7A45', margin: '0 0 4px' }}>{pr?.p2p_number}{rfq ? ` · ${rfq.rfq_number}` : ''}</p>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: TEXT.heading, margin: 0 }}>Quotations &amp; Comparison</h1>
          <p style={{ fontSize: 13, color: TEXT.muted, margin: '4px 0 0' }}>Price every line per vendor, compare landed cost, award each line, then create one PO per vendor.</p>
        </div>
        <button type="button" style={secondaryBtnStyle} onClick={() => rfq && router.push(recordPath('/dashboard/p2p/rfq', rfq))}>← Back</button>
      </div>
      {error && <div style={errBox}>{error}</div>}

      {rfq && pr && cmp && (
        <>
          <div style={card}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
              <h2 style={{ ...h2, margin: 0 }}>1. Vendor quotes</h2>
              {canRecordQuote && <button type="button" style={primaryBtnStyle} onClick={() => setEditing('new')}>+ Record a quote</button>}
            </div>
            {quotes.length === 0 ? <p style={{ fontSize: 13, color: TEXT.muted, margin: 0 }}>No line-level quotes yet. Record each vendor&apos;s quote — the vendor is picked from the vendor master.</p> : (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
                {quotes.map((q) => (
                  <div key={q.id} style={{ border: `1px solid ${BORDER.normal}`, borderRadius: 12, padding: '10px 12px', minWidth: 220 }}>
                    <div style={{ fontSize: 13.5, fontWeight: 700 }}>{q.vendor_name}</div>
                    <div style={{ fontSize: 12, color: TEXT.muted }}>{q.quote_ref || 'no ref'} · {q.items.length} line(s) · {money(q.quoted_price)} excl. GST{q.valid_until ? ` · valid till ${q.valid_until}` : ''}</div>
                    {canEdit && canFeature('p2p', 'rfq', 'vendor_quotes', 'edit') && <span style={{ fontSize: 12, color: '#2563eb', cursor: 'pointer' }} onClick={() => setEditing(q)}>Edit</span>}
                  </div>
                ))}
              </div>
            )}
          </div>

          <div style={card}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 6 }}>
              <h2 style={{ ...h2, margin: 0 }}>2. Comparison &amp; award</h2>
              {canExport && <button type="button" style={secondaryBtnStyle} onClick={exportXlsx}>Export Excel</button>}
            </div>
            <p style={{ fontSize: 12, color: TEXT.muted, margin: '0 0 10px' }}>{cmp.basis} Best of lines total: <b>{money(cmp.best_of_lines_total)}</b></p>
            <div style={{ overflow: 'auto', maxHeight: 'calc(100vh - 320px)', border: `1px solid ${BORDER.normal}`, borderRadius: 10 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 760 + cmp.vendors.length * 160 }}>
                <thead>
                  <tr>
                    <th style={th}>Item</th><th style={th}>Qty</th><th style={th}>Last PO</th>
                    {cmp.vendors.map((v) => (
                      <th key={v.vendor_quotation_id} style={th}>
                        {v.vendor_name}{v.overall_rank ? ` (${v.overall_rank})` : ''}
                        {!v.eligible && <div style={{ color: '#b91c1c', textTransform: 'none' }}>{v.ineligible_reason}</div>}
                      </th>
                    ))}
                    <th style={th}>Award to</th>
                  </tr>
                </thead>
                <tbody>
                  {cmp.lines.map((l) => {
                    const picked = Number(picks[l.pr_item_id] || 0)
                    const notL1 = picked && picked !== l.l1_vendor_quotation_item_id
                    return (
                      <tr key={l.pr_item_id}>
                        <td style={td}>{l.item_code ? `${l.item_code} · ` : ''}{l.item_name}</td>
                        <td style={{ ...td, whiteSpace: 'nowrap' }}>{l.quantity} {l.unit || ''}</td>
                        <td style={{ ...td, whiteSpace: 'nowrap' }}>{l.last_po ? `${money(l.last_po.unit_price)} (${l.last_po.vendor_name})` : '—'}</td>
                        {l.quotes.map((c, i) => (
                          <td key={i} style={{ ...td, background: c?.rank === 'L1' ? 'rgba(22,163,74,0.07)' : undefined }}>
                            {c ? (
                              <>
                                <div><b>{money(c.landed_unit)}</b> landed {c.rank && <span style={{ fontSize: 11, fontWeight: 800, color: c.rank === 'L1' ? '#16a34a' : TEXT.muted }}>{c.rank}</span>}</div>
                                <div style={{ fontSize: 11, color: TEXT.muted }}>rate {money(c.unit_price)}{c.discount_pct ? ` −${c.discount_pct}%` : ''} · GST {c.gst_rate ?? 0}%{c.delivery_days != null ? ` · ${c.delivery_days} d` : ''}</div>
                                {c.is_awarded && <div style={{ fontSize: 11, color: '#2563eb', fontWeight: 700 }}>awarded</div>}
                              </>
                            ) : <span style={{ color: TEXT.muted }}>not quoted</span>}
                          </td>
                        ))}
                        <td style={{ ...td, minWidth: 220 }}>
                          <select value={picks[l.pr_item_id] || ''} disabled={!canAward} onChange={(e) => setPicks((s) => ({ ...s, [l.pr_item_id]: e.target.value }))} style={{ ...inputStyle, padding: '6px 8px' }}>
                            <option value="">—</option>
                            {l.quotes.map((c, i) => c && c.eligible && <option key={i} value={c.vendor_quotation_item_id}>{cmp.vendors[i].vendor_name} ({c.rank})</option>)}
                          </select>
                          {notL1 ? <input value={reasons[l.pr_item_id] || ''} onChange={(e) => setReasons((s) => ({ ...s, [l.pr_item_id]: e.target.value }))} placeholder="Why not L1? *" style={{ ...inputStyle, padding: '6px 8px', marginTop: 6 }} /> : null}
                        </td>
                      </tr>
                    )
                  })}
                  <tr>
                    <td style={{ ...td, fontWeight: 700 }} colSpan={3}>Total landed (excl. GST)</td>
                    {cmp.vendors.map((v) => <td key={v.vendor_quotation_id} style={{ ...td, fontWeight: 700 }}>{money(v.landed_total)}{!v.complete && <div style={{ fontSize: 11, color: TEXT.muted, fontWeight: 400 }}>{v.lines_quoted}/{cmp.lines.length} lines</div>}</td>)}
                    <td style={td} />
                  </tr>
                </tbody>
              </table>
            </div>
            {canAward && cmp.lines.length > 0 && <button type="button" disabled={busy} style={{ ...primaryBtnStyle, marginTop: 12, opacity: busy ? 0.6 : 1 }} onClick={saveAwards}>Save awards</button>}
          </div>

          <div style={card}>
            <h2 style={h2}>3. Purchase orders by vendor</h2>
            <p style={{ fontSize: 12.5, color: TEXT.muted, margin: '0 0 10px' }}>Awarded lines become one draft PO per vendor, priced from the awarded quote (or the vendor + item info record), with per-line delivery dates.</p>
            {canCreatePo ? <button type="button" style={primaryBtnStyle} onClick={() => setShowSplit(true)}>Create POs by vendor</button>
              : <p style={{ fontSize: 12.5, color: TEXT.muted, margin: 0 }}>Creating POs needs Create access on Procurement › Purchase Orders.</p>}
          </div>
        </>
      )}

      {editing && rfq && pr && <QuoteDialog rfq={rfq} pr={pr} quote={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load() }} />}
      {showSplit && rfq && <SplitDialog rfq={rfq} onClose={() => setShowSplit(false)} onDone={(poRow) => {
        setShowSplit(false)
        router.push(recordHref('/dashboard/p2p/purchase-orders/new', rfq, 'id', { po: poRow ? (poRow as { id_ref?: string }).id_ref : undefined }, 'rfq'))
      }} />}
    </div>
  )
}

type QLine = { unit_price: string; discount_pct: string; gst_rate: string; delivery_days: string; make_offered: string }

function QuoteDialog({ rfq, pr, quote, onClose, onSaved }: { rfq: RFQ; pr: P2PRequest; quote: LineQuotation | null; onClose: () => void; onSaved: () => void }) {
  const buyLines = (pr.items || []).filter((i) => i.fulfillment_status !== 'stock_issued')
  const [vendors, setVendors] = useState<Opt[]>([])
  const [vendorId, setVendorId] = useState(quote?.vendor_id ? String(quote.vendor_id) : '')
  const [ref, setRef] = useState(quote?.quote_ref || '')
  const [validUntil, setValidUntil] = useState(quote?.valid_until || '')
  const [freight, setFreight] = useState(quote?.freight_total != null ? String(quote.freight_total) : '')
  const [packing, setPacking] = useState(quote?.packing_total != null ? String(quote.packing_total) : '')
  const [payTerms, setPayTerms] = useState(quote?.payment_terms || '')
  const [lines, setLines] = useState<Record<number, QLine>>(() => Object.fromEntries(buyLines.map((i) => {
    const q = quote?.items.find((x) => x.pr_item_id === i.id)
    return [i.id, { unit_price: q ? String(q.unit_price) : '', discount_pct: q?.discount_pct != null ? String(q.discount_pct) : '',
      gst_rate: q?.gst_rate != null ? String(q.gst_rate) : '18', delivery_days: q?.delivery_days != null ? String(q.delivery_days) : '', make_offered: q?.make_offered || '' }]
  })))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const close = () => { if (!busy) onClose() }
  useEscapeKey(true, close)
  useEffect(() => { vendorsApi.list({ status: 'active' }).then((vs) => setVendors(vs.map((v) => ({ value: String(v.id), label: `${v.name}${v.code ? ` (${v.code})` : ''}` })))).catch(() => setVendors([])) }, [])

  const save = async () => {
    if (!vendorId) { setError('Pick the vendor from the vendor master.'); return }
    const items = buyLines.filter((i) => Number(lines[i.id]?.unit_price) > 0).map((i) => ({
      pr_item_id: i.id, unit_price: Number(lines[i.id].unit_price),
      discount_pct: lines[i.id].discount_pct === '' ? null : Number(lines[i.id].discount_pct),
      gst_rate: lines[i.id].gst_rate === '' ? null : Number(lines[i.id].gst_rate),
      delivery_days: lines[i.id].delivery_days === '' ? null : Number(lines[i.id].delivery_days),
      make_offered: lines[i.id].make_offered.trim() || null,
    }))
    if (!items.length) { setError('Enter a unit price for at least one line the vendor quoted (leave a line blank if not quoted).'); return }
    const payload = { vendor_id: Number(vendorId), quote_ref: ref.trim() || null, valid_until: validUntil || null,
      freight_total: freight === '' ? null : Number(freight), packing_total: packing === '' ? null : Number(packing), payment_terms: payTerms.trim() || null, items }
    setBusy(true); setError('')
    try {
      if (quote) await mmQuotationsApi.replace(rfq.id, quote.id, payload); else await mmQuotationsApi.add(rfq.id, payload)
      onSaved()
    } catch (err) { setError(extractErrorMessages(err, 'Could not save the quote.').join(' ')); setBusy(false) }
  }

  const set = (id: number, patch: Partial<QLine>) => setLines((s) => ({ ...s, [id]: { ...s[id], ...patch } }))

  return (
    <FormSheet icon="rupee" title={quote ? `Edit ${quote.vendor_name}'s quote` : 'Record a vendor quote'}
      subtitle={`${rfq.rfq_number} · price each line the vendor quoted — leave a line blank if it was not quoted.`}
      onClose={close} busy={busy}
      footer={<>
        <button type="button" onClick={close} disabled={busy} style={sheetBtn('secondary', SHEET.INK, busy)}>Cancel</button>
        <button type="button" onClick={save} disabled={busy} style={sheetBtn('primary', SHEET.BLUE, busy)}><SheetIcon name="check" size={16} />{busy ? 'Saving…' : 'Save quote'}</button>
      </>}>
      <div style={{ padding: '20px 24px' }}>
        {error && <div style={errBox}>{error}</div>}
        <SheetSection icon="building" title="Vendor & Terms">
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
            <div style={{ flex: '1 1 260px', maxWidth: 340 }}><label style={sheetLabel}>Vendor <Req /></label><SearchableSelect value={vendorId} onChange={setVendorId} options={vendors} placeholder="Search the vendor master…" /></div>
            <div style={{ flex: '0 1 160px' }}><label style={sheetLabel}>Quote ref.</label><input value={ref} onChange={(e) => setRef(e.target.value)} style={sheetInput} /></div>
            <div style={{ flex: '0 1 160px' }}><label style={sheetLabel}>Valid until</label><DateField value={validUntil} onChange={setValidUntil} /></div>
            <div style={{ flex: '0 1 120px' }}><label style={sheetLabel}>Freight</label><input type="number" min="0" value={freight} onChange={(e) => setFreight(e.target.value)} style={sheetInput} /></div>
            <div style={{ flex: '0 1 120px' }}><label style={sheetLabel}>Packing</label><input type="number" min="0" value={packing} onChange={(e) => setPacking(e.target.value)} style={sheetInput} /></div>
            <div style={{ flex: '1 1 220px', maxWidth: 360 }}><label style={sheetLabel}>Payment terms</label><input value={payTerms} onChange={(e) => setPayTerms(e.target.value)} style={sheetInput} /></div>
          </div>
        </SheetSection>
        <SheetSection icon="list" title="Line prices">
          <div style={{ overflow: 'auto', border: `1px solid ${SHEET.LINE}`, borderRadius: 10 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 760 }}>
              <thead><tr>{['Item', 'Qty', 'Unit price', 'Disc. %', 'GST %', 'Delivery (days)', 'Make offered'].map((h) => <th key={h} style={{ ...th, position: 'static' }}>{h}</th>)}</tr></thead>
              <tbody>
                {buyLines.map((i) => (
                  <tr key={i.id}>
                    <td style={td}>{i.item_code ? `${i.item_code} · ` : ''}{i.item_name}</td>
                    <td style={{ ...td, whiteSpace: 'nowrap' }}>{i.quantity - (i.issued_qty || 0)} {i.unit || ''}</td>
                    <td style={{ ...td, width: 120 }}><input type="number" min="0" step="0.01" value={lines[i.id].unit_price} onChange={(e) => set(i.id, { unit_price: e.target.value })} style={cellInput} /></td>
                    <td style={{ ...td, width: 80 }}><input type="number" min="0" max="99" value={lines[i.id].discount_pct} onChange={(e) => set(i.id, { discount_pct: e.target.value })} style={cellInput} /></td>
                    <td style={{ ...td, width: 80 }}><input type="number" min="0" max="100" value={lines[i.id].gst_rate} onChange={(e) => set(i.id, { gst_rate: e.target.value })} style={cellInput} /></td>
                    <td style={{ ...td, width: 100 }}><input type="number" min="0" value={lines[i.id].delivery_days} onChange={(e) => set(i.id, { delivery_days: e.target.value })} style={cellInput} /></td>
                    <td style={{ ...td, width: 160 }}><input value={lines[i.id].make_offered} onChange={(e) => set(i.id, { make_offered: e.target.value })} style={cellInput} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p style={sheetHint}>Prices excl. GST. Landed cost on the comparison adds freight and packing, spread over the quoted lines.</p>
        </SheetSection>
      </div>
    </FormSheet>
  )
}

function SplitDialog({ rfq, onClose, onDone }: { rfq: RFQ; onClose: () => void; onDone: (firstPo: unknown) => void }) {
  const [prop, setProp] = useState<SplitProposal | null>(null)
  const [plants, setPlants] = useState<Opt[]>([])
  const [locations, setLocations] = useState<Opt[]>([])
  const [plant, setPlant] = useState('')
  const [shipTo, setShipTo] = useState('')
  const [dates, setDates] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [confirm, setConfirm] = useState(false)
  const close = () => { if (!busy) onClose() }
  useEscapeKey(true, close)

  useEffect(() => {
    mmQuotationsApi.splitProposal(rfq.id).then((p) => {
      setProp(p)
      setDates(Object.fromEntries(p.groups.flatMap((g) => g.lines.map((l) => [`${g.vendor_id}:${l.pr_item_id}`, l.delivery_date || '']))))
    }).catch((err) => setError(extractErrorMessages(err, 'Could not build the PO split.').join(' ')))
    organizationApi.listBranches().then((bs: { id: number; name: string }[]) => setPlants(bs.map((b) => ({ value: String(b.id), label: b.name })))).catch(() => setPlants([]))
    storeApi.listLocations().then((ls: { id: number; name: string; code: string }[]) => setLocations(ls.map((l) => ({ value: String(l.id), label: `${l.name} (${l.code})` })))).catch(() => setLocations([]))
  }, [rfq.id])

  const payload = useMemo(() => ({
    plant_branch_id: plant ? Number(plant) : null, ship_to_location_id: shipTo ? Number(shipTo) : null,
    pos: (prop?.groups || []).map((g) => ({
      vendor_id: g.vendor_id, vendor_quotation_id: g.vendor_quotation_id, delivery_terms: g.delivery_terms,
      lines: g.lines.map((l) => ({ pr_item_id: l.pr_item_id, vendor_quotation_item_id: l.vendor_quotation_item_id, quantity: l.quantity,
        delivery_date: dates[`${g.vendor_id}:${l.pr_item_id}`] || null })),
    })),
  }), [prop, plant, shipTo, dates])

  const create = async () => {
    setConfirm(false); setBusy(true); setError('')
    try { const pos = await mmQuotationsApi.createSplitPos(rfq.id, payload); onDone((pos as unknown[])[0]) } catch (err) {
      setError(extractErrorMessages(err, 'Could not create the POs.').join(' ')); setBusy(false)
    }
  }

  return (
    <FormSheet icon="cart" title="Create POs by vendor" subtitle={`${rfq.rfq_number} · awarded lines become one draft PO per vendor — you then check each and send it for approval.`}
      onClose={close} busy={busy}
      footer={<>
        <button type="button" onClick={close} disabled={busy} style={sheetBtn('secondary', SHEET.INK, busy)}>Cancel</button>
        <button type="button" onClick={() => setConfirm(true)} disabled={busy || !prop?.groups.length} style={sheetBtn('primary', SHEET.BLUE, busy || !prop?.groups.length)}>
          <SheetIcon name="plus" size={16} />{busy ? 'Creating…' : `Create ${prop?.groups.length || 0} PO draft(s)`}
        </button>
      </>}>
      <div style={{ padding: '20px 24px' }}>
        {error && <div style={errBox}>{error}</div>}
        <SheetSection icon="building" title="Receiving">
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <div style={{ flex: '1 1 220px', maxWidth: 300 }}><label style={sheetLabel}>Receiving plant</label><SearchableSelect value={plant} onChange={setPlant} options={plants} placeholder="Pick the plant…" /></div>
            <div style={{ flex: '1 1 220px', maxWidth: 300 }}><label style={sheetLabel}>Ship-to store</label><SearchableSelect value={shipTo} onChange={setShipTo} options={locations} placeholder="Pick the store…" /></div>
          </div>
        </SheetSection>
        <SheetSection icon="truck" title="POs by vendor">
          {!prop && !error && <p style={{ fontSize: 13, color: SHEET.MUTED, margin: 0 }}>Loading…</p>}
          {prop && prop.groups.length === 0 && <p style={{ fontSize: 13, color: SHEET.MUTED, margin: 0 }}>No awarded lines are left to order. Award lines on the comparison first.</p>}
          {prop?.groups.map((g) => (
            <div key={g.vendor_id} style={{ border: `1px solid ${SHEET.LINE}`, borderRadius: 12, padding: 12, marginBottom: 10 }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: SHEET.INK, marginBottom: 6 }}>{g.vendor_name}</div>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr>{['Item', 'Qty', 'Rate', 'GST %', 'Delivery date'].map((h) => <th key={h} style={{ ...th, position: 'static' }}>{h}</th>)}</tr></thead>
                <tbody>
                  {g.lines.map((l) => (
                    <tr key={l.pr_item_id}>
                      <td style={td}>{l.item_name}</td>
                      <td style={td}>{l.quantity} {l.unit || ''}</td>
                      <td style={td}>{money(l.unit_price)}</td>
                      <td style={td}>{l.tax_rate ?? '—'}</td>
                      <td style={{ ...td, width: 170 }}><DateField value={dates[`${g.vendor_id}:${l.pr_item_id}`] || ''} onChange={(v) => setDates((s) => ({ ...s, [`${g.vendor_id}:${l.pr_item_id}`]: v }))} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
          {prop && prop.unawarded.length > 0 && (
            <p style={{ fontSize: 12.5, color: '#b45309', margin: '6px 0 0' }}>Not awarded yet (stay open for a later PO): {prop.unawarded.map((u) => `${u.item_name} (${u.quantity})`).join(', ')}</p>
          )}
          {prop && prop.existing_pos.length > 0 && (
            <p style={sheetHint}>Existing POs on {prop.p2p_number}: {prop.existing_pos.map((p) => `${p.po_number} (${p.vendor_name}, ${p.status})`).join(', ')}</p>
          )}
        </SheetSection>
      </div>
      <ConfirmDialog open={confirm} title="Create the PO drafts?" message={`One draft PO per vendor (${prop?.groups.map((g) => g.vendor_name).join(', ')}). You then check each and send it for approval.`}
        onConfirm={create} onCancel={() => setConfirm(false)} />
    </FormSheet>
  )
}
