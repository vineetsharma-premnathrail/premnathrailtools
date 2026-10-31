'use client'

// Upload PO on the requisition (owner, 2026-10-30; one PO per vendor since 2026-10-31): POs are made in
// Tally, not in the portal. The buyer attaches the Tally PO (number + PDF), picks ONE vendor, ticks the
// lines that vendor supplies on this PO, lowers a quantity where less is ordered, and types each price as
// on the Tally PO. The server builds the PO from those lines (Item Master ids carry to the GRN) and sends
// it straight for approval. One RFQ can get several POs, one per awarded vendor.

import { useEffect, useMemo, useState } from 'react'
import { rfqApi, p2pApi, vendorsApi, storeApi, organizationApi } from '@/lib/api'
import { accountAssignmentApi } from '@/lib/mmLogisticsApi'
import { mmQuotationsApi, Comparison } from '@/lib/mmPurchasingApi'
import { P2PRequest, RFQ, PrTracker, ProcurementVendor } from '@/types'
import { FormSheet, SheetColumns, SheetSection, SheetIcon, Req, Optional, SHEET, sheetBtn, sheetInput, sheetLabel, sheetHint, FileDropZone } from '@/components/shared/FormSheet'
import { RowCount } from '@/components/shared/ui'
import SearchableSelect from '@/components/erp/SearchableSelect'
import DateField from '@/components/erp/DateField'
import DraftBanner from '@/components/shared/DraftBanner'
import { useFormDraft } from '@/lib/formDraft'
import { extractErrorMessages } from '@/lib/validation'

type Store = { id: number; name: string; code: string; branch_id?: number | null; is_active?: boolean }
type Branch = { id: number; name: string; code: string }
/** What the buyer typed for one line (keyed `${vendorKey}:${pr_item_id}` so a switch of vendor keeps it). */
type Row = { on?: boolean; qty?: string; unitPrice?: string; taxRate?: string }
/** One line that can go on this PO. `max` = the most that may be ordered now. */
type POLine = { prItemId: number; itemCode: string | null; itemName: string; unit: string | null; max: number; quotedPrice?: number | null; quotedTax?: number | null }
type AwardVendor = { vqId: number; vendorName: string; lines: POLine[]; awardedTotal: number }

const EPS = 0.0005
const th: React.CSSProperties = { textAlign: 'left', padding: '8px 10px', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', color: SHEET.MUTED, background: SHEET.SOFT, whiteSpace: 'nowrap' }
const td: React.CSSProperties = { padding: '6px 10px', fontSize: 13, color: SHEET.INK, borderTop: `1px solid ${SHEET.LINE}`, verticalAlign: 'middle' }
const fmt = (n: number) => n.toLocaleString('en-IN', { maximumFractionDigits: 3 })
const LEGACY = 'legacy'

export default function UploadPODialog({ rfq, pr, onClose, onUploaded }: {
  rfq: RFQ; pr: P2PRequest; onClose: () => void; onUploaded: () => void
}) {
  const [tallyNo, setTallyNo] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const [vendorKey, setVendorKey] = useState('')   // awarded vendor (quote id) picked for this PO
  const [tier, setTier] = useState('L1')
  const [reason, setReason] = useState('')
  const [vendorId, setVendorId] = useState('')
  const [storeId, setStoreId] = useState('')
  const [expected, setExpected] = useState('')
  const [costCenterId, setCostCenterId] = useState('')
  const [costCenters, setCostCenters] = useState<{ id: number; label: string }[]>([])
  const [rows, setRows] = useState<Record<string, Row>>({})
  const [vendors, setVendors] = useState<ProcurementVendor[]>([])
  const [stores, setStores] = useState<Store[]>([])
  const [comparison, setComparison] = useState<Comparison | null>(null)
  const [tracker, setTracker] = useState<PrTracker | null>(null)
  const [loadingAwards, setLoadingAwards] = useState(true)
  const [awardNote, setAwardNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  // Awarded vendors of this RFQ (the comparison) and what is already on live POs (the tracker): the dialog offers
  // only the quantity that is still awarded and not yet on a PO. Either failing falls back to the awarded
  // quantity; the server checks again and its message is shown if a quantity is too high.
  useEffect(() => {
    let cancelled = false
    Promise.all([
      mmQuotationsApi.comparison(rfq.id).then((c) => ({ c, note: '' })).catch((err) => ({ c: null as Comparison | null, note: extractErrorMessages(err, 'The awarded vendors could not be loaded.').join(' ') })),
      p2pApi.tracker(pr.id).catch(() => null),
    ]).then(([cmp, trk]) => {
      if (cancelled) return
      setComparison(cmp.c); setAwardNote(cmp.note); setTracker(trk); setLoadingAwards(false)
    })
    return () => { cancelled = true }
  }, [rfq.id, pr.id])

  // Vendors holding an award on this RFQ, each with the lines (and remaining quantity) it can be ordered now.
  const awardVendors = useMemo<AwardVendor[]>(() => {
    if (!comparison) return []
    const onLiveByVendorLine = new Map<string, number>()  // `${vendor name}:${line}` -> quantity on live POs
    for (const l of tracker?.lines || []) {
      for (const p of l.pos) {
        if (p.stage === 'cancelled' || p.vendor_name == null) continue
        const k = `${p.vendor_name}:${l.pr_item_id}`
        onLiveByVendorLine.set(k, (onLiveByVendorLine.get(k) || 0) + (p.quantity || 0))
      }
    }
    const byVq = new Map<number, AwardVendor>()
    for (const row of comparison.lines) {
      for (const a of row.awards || []) {
        const v = comparison.vendors.find((x) => x.vendor_quotation_id === a.vendor_quotation_id)
        if (!v) continue
        const cell = row.quotes.find((q) => q && q.vendor_quotation_item_id === a.vendor_quotation_item_id) || null
        const remaining = Math.max(0, a.quantity - (onLiveByVendorLine.get(`${v.vendor_name}:${row.pr_item_id}`) || 0))
        const entry = byVq.get(v.vendor_quotation_id) || { vqId: v.vendor_quotation_id, vendorName: v.vendor_name, lines: [], awardedTotal: 0 }
        entry.awardedTotal += a.quantity
        entry.lines.push({ prItemId: row.pr_item_id, itemCode: row.item_code, itemName: row.item_name, unit: row.unit, max: remaining,
          quotedPrice: cell?.net_unit ?? null, quotedTax: cell?.gst_rate ?? null })
        byVq.set(v.vendor_quotation_id, entry)
      }
    }
    return [...byVq.values()].sort((a, b) => a.vendorName.localeCompare(b.vendorName))
  }, [comparison, tracker])
  const orderable = awardVendors.filter((v) => v.lines.some((l) => l.max > EPS))
  const awardMode = awardVendors.length > 0

  // No awards (quotes came as L1–L4 files, e-mail, or a Before-PO receipt): pick the vendor from the quoted tiers,
  // the vendor master, or the vendor already chosen — then tick lines and quantities from the RFQ's lines.
  const quotes = useMemo(() => {
    const seen = new Map<string, { tier: string; vendor: string; contact?: string }>()
    for (const a of rfq.attachments || []) {
      if (a.vendor_name && !seen.has(a.vendor_tier)) seen.set(a.vendor_tier, { tier: a.vendor_tier, vendor: a.vendor_name, contact: a.vendor_contact })
    }
    return [...seen.values()].sort((x, y) => x.tier.localeCompare(y.tier))
  }, [rfq])
  const presetVendor = pr.selected_vendor && pr.status === 'vendor_selected' ? pr.selected_vendor : null
  const showTiers = !awardMode && !presetVendor && quotes.length > 0
  const pickFromMaster = !awardMode && !quotes.length && !presetVendor && !loadingAwards

  const legacyLines = useMemo<POLine[]>(() => {
    const active = (rfq.items || []).filter((i) => !i.withdrawn_at)
    if (active.length) {
      return active.map((i) => {
        const item = pr.items.find((x) => x.id === i.pr_item_id)
        const toBuy = item ? Math.max(0, item.quantity - (item.issued_qty || 0) - (item.short_closed_qty || 0)) : i.quantity
        return { prItemId: i.pr_item_id, itemCode: i.item_code, itemName: i.item_name || item?.item_name || 'Item', unit: i.unit,
          max: i.open_qty != null ? i.open_qty : Math.min(i.quantity, toBuy) }
      })
    }
    return pr.items.filter((i) => i.fulfillment_status !== 'stock_issued' && i.quantity - (i.issued_qty || 0) - (i.short_closed_qty || 0) > 0)
      .map((i) => ({ prItemId: i.id, itemCode: i.item_code || null, itemName: i.item_name, unit: i.unit || null, max: i.quantity - (i.issued_qty || 0) - (i.short_closed_qty || 0) }))
  }, [rfq.items, pr.items])

  const selectedVendor = awardMode ? (orderable.find((v) => String(v.vqId) === vendorKey) || orderable[0] || null) : null
  const vKey = awardMode ? String(selectedVendor?.vqId ?? '') : LEGACY
  const lines: POLine[] = awardMode ? (selectedVendor?.lines.filter((l) => l.max > EPS) || []) : legacyLines
  const rowOf = (l: POLine): Row => rows[`${vKey}:${l.prItemId}`] || {}
  const isOn = (l: POLine) => rowOf(l).on !== false
  const qtyOf = (l: POLine) => (rowOf(l).qty != null && rowOf(l).qty !== '' ? Number(rowOf(l).qty) : l.max)
  const setRow = (l: POLine, patch: Partial<Row>) => setRows((p) => ({ ...p, [`${vKey}:${l.prItemId}`]: { ...(p[`${vKey}:${l.prItemId}`] || {}), ...patch } }))

  // A department running-cost requisition's PO is charged to a cost centre; ask when the PR doesn't name one.
  const charge = pr as unknown as { cost_center_id?: number | null; internal_order_id?: number | null }
  const needsCostCenter = pr.purpose === 'department' && !charge.internal_order_id && !charge.cost_center_id

  useEffect(() => {
    let cancelled = false
    if (pickFromMaster) {
      vendorsApi.list({ status: 'active' }).then((v) => { if (!cancelled) setVendors(v || []) }).catch(() => { if (!cancelled) setVendors([]) })
    }
    if (needsCostCenter) {
      accountAssignmentApi.options('cost_center').then((r) => { if (!cancelled) setCostCenters(r.options || []) }).catch(() => { if (!cancelled) setCostCenters([]) })
    }
    // Ship to: the plant the requisition names ("Name (CODE)") and its first store.
    Promise.all([storeApi.listLocations(undefined, { allPlants: true }), organizationApi.listBranches()])
      .then(([ls, bs]: [Store[], Branch[]]) => {
        if (cancelled) return
        const active = (ls || []).filter((l) => l.is_active !== false)
        setStores(active)
        const targets = new Set(pr.items.map((i) => (i.ship_to || '').trim()).filter(Boolean))
        const branch = targets.size === 1 ? (bs || []).find((b) => `${b.name} (${b.code})` === [...targets][0]) : undefined
        const first = branch ? active.filter((l) => l.branch_id === branch.id).sort((a, b) => a.name.localeCompare(b.name))[0] : undefined
        if (first) setStoreId((cur) => cur || String(first.id))
      })
      .catch(() => { if (!cancelled) setStores([]) })
    return () => { cancelled = true }
  }, [pickFromMaster, needsCostCenter, pr.items])

  const draft = useFormDraft(`p2p-upload-po-${pr.id}-${rfq.id}`, { tallyNo, vendorKey, tier, reason, vendorId, storeId, expected, costCenterId, rows }, (d) => {
    setTallyNo(d.tallyNo); setVendorKey(d.vendorKey || ''); setTier(d.tier || 'L1'); setReason(d.reason || ''); setVendorId(d.vendorId || '')
    setStoreId(d.storeId); setExpected(d.expected); setCostCenterId(d.costCenterId || ''); setRows(d.rows || {})
  })

  const ticked = lines.filter(isOn)
  const priceOf = (l: POLine) => Number(rowOf(l).unitPrice) || 0
  const total = ticked.reduce((sum, l) => sum + qtyOf(l) * priceOf(l) * (1 + (Number(rowOf(l).taxRate) || 0) / 100), 0)

  const close = () => { if (!busy) onClose() }

  const upload = async () => {
    const problems: string[] = []
    if (!tallyNo.trim()) problems.push('Enter the Tally PO number — the voucher number of this PO in Tally.')
    if (!files.length) problems.push('Attach the Tally PO print as a PDF (print it from Tally to PDF).')
    if (awardMode && !selectedVendor) problems.push('Every awarded quantity of this RFQ is already on a PO. Nothing is left to upload; cancel or amend a PO first if it must change.')
    if (showTiers && tier !== 'L1' && !reason.trim()) problems.push(`You picked the ${tier} vendor instead of L1 (lowest) — write the reason.`)
    if (pickFromMaster && !vendorId) problems.push('Pick the vendor the PO is placed with.')
    if (!storeId) problems.push('Pick the store the goods are delivered to.')
    if (needsCostCenter && !costCenterId) problems.push('Pick the cost centre this department purchase is charged to.')
    if (!ticked.length) problems.push('Tick at least one line to put on this PO.')
    const badQty = ticked.filter((l) => !(qtyOf(l) > 0) || qtyOf(l) > l.max + EPS).map((l) => `${l.itemName} (up to ${fmt(l.max)})`)
    if (badQty.length) problems.push(`Quantity must be more than 0 and not above what is left to order for: ${badQty.join(', ')}.`)
    const unpriced = ticked.filter((l) => !(priceOf(l) > 0)).map((l) => l.itemName)
    if (unpriced.length) problems.push(`Enter the unit price (as on the Tally PO) for: ${unpriced.join(', ')}.`)
    const badTax = ticked.filter((l) => { const t = rowOf(l).taxRate; return !!t && !(Number(t) >= 0 && Number(t) <= 100) }).map((l) => l.itemName)
    if (badTax.length) problems.push(`Tax % must be between 0 and 100 for: ${badTax.join(', ')}.`)
    if (problems.length) { setError(problems.join(' ')); return }
    setBusy(true)
    setError('')
    try {
      await rfqApi.uploadPo(rfq.id, tallyNo.trim(), {
        vendor_quotation_id: awardMode && selectedVendor ? selectedVendor.vqId : undefined,
        vendor_tier: showTiers ? tier : undefined,
        selection_reason: showTiers && tier !== 'L1' ? reason.trim() : undefined,
        cost_center_id: needsCostCenter ? Number(costCenterId) : undefined,
        vendor_id: pickFromMaster ? Number(vendorId) : undefined,
        ship_to_location_id: Number(storeId),
        expected_delivery: expected || undefined,
        lines: ticked.map((l) => ({
          pr_item_id: l.prItemId,
          quantity: qtyOf(l),
          unit_price: priceOf(l),
          tax_rate: rowOf(l).taxRate ? Number(rowOf(l).taxRate) : null,
        })),
      }, files[0])
      draft.clear()
      onUploaded()
    } catch (err) {
      setError(extractErrorMessages(err, 'Could not upload the PO — check the details and try again.').join(' '))
      setBusy(false)
    }
  }

  const errorBox = error ? <div role="alert" style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>{error}</div> : null

  return (
    <FormSheet icon="upload" title="Upload PO" subtitle={`${pr.p2p_number} · ${rfq.rfq_number} — one PO per vendor: attach the PO made in Tally; it goes for approval.`}
      onClose={close} busy={busy} tour="pr-upload-po-sheet" onSubmit={upload}
      footer={<>
        <button type="button" onClick={close} disabled={busy} style={sheetBtn('secondary', SHEET.INK, busy)}>Cancel</button>
        <button type="submit" disabled={busy || loadingAwards} data-tour="pr-upload-po-submit" style={sheetBtn('primary', SHEET.BLUE, busy || loadingAwards)}>
          <SheetIcon name="upload" size={16} />{busy ? 'Uploading…' : 'Upload & send for approval'}
        </button>
      </>}>
      <div style={{ padding: '0 24px' }}><DraftBanner draft={draft} /></div>
      <SheetColumns
        left={<>
          {errorBox}
          <SheetSection icon="doc" title="1. Tally PO">
            <label htmlFor="upload-po-tally-no" style={sheetLabel}>Tally PO no. <Req /></label>
            <input id="upload-po-tally-no" value={tallyNo} onChange={(e) => setTallyNo(e.target.value)} maxLength={100} placeholder="e.g. PO/0042/26-27" style={sheetInput} data-tour="pr-upload-po-number" />
            <div style={{ marginTop: 12 }}>
              <label style={sheetLabel}>Tally PO print (PDF) <Req /></label>
              <FileDropZone files={files} onChange={setFiles} accept=".pdf,application/pdf" max={1} hint="PDF only · up to 15 MB" tour="pr-upload-po-file" />
            </div>
          </SheetSection>

          <SheetSection icon="building" title="2. Vendor">
            {loadingAwards && <p style={{ ...sheetHint, margin: 0 }}>Loading the awarded vendors…</p>}
            {!loadingAwards && awardNote && !awardMode && <p style={{ ...sheetHint, color: '#92400e', margin: '0 0 10px' }}>{awardNote} You can still pick the vendor below.</p>}
            {awardMode && (
              orderable.length === 0 ? (
                <p style={{ fontSize: 13, color: '#92400e', margin: 0 }}>Every awarded quantity of this RFQ is already on a PO, so there is nothing left to upload. To change an order, cancel or amend that PO first.</p>
              ) : (
                <div data-tour="pr-upload-po-vendor" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {orderable.map((v) => {
                    const left = v.lines.filter((l) => l.max > EPS)
                    const active = selectedVendor?.vqId === v.vqId
                    return (
                      <label key={v.vqId} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: 10, cursor: 'pointer',
                        border: `1px solid ${active ? SHEET.BLUE : SHEET.LINE}`, background: active ? '#eff6ff' : '#fff' }}>
                        <input type="radio" name="upload-po-vendor" checked={active} onChange={() => setVendorKey(String(v.vqId))} />
                        <span style={{ flex: 1, fontSize: 13.5, fontWeight: 600, color: SHEET.INK }}>
                          {v.vendorName}
                          <span style={{ fontWeight: 400, color: SHEET.MUTED, fontSize: 12 }}> · {left.length} line{left.length === 1 ? '' : 's'} left to order</span>
                        </span>
                      </label>
                    )
                  })}
                  <p style={sheetHint}>One PO is made for one vendor. Upload the next vendor&apos;s PO after this one.</p>
                </div>
              )
            )}
            {presetVendor && <p style={{ fontSize: 13.5, fontWeight: 600, color: SHEET.INK, margin: 0 }}>{presetVendor}</p>}
            {pickFromMaster && (
              <>
                <label style={sheetLabel}>Vendor <Req /></label>
                <SearchableSelect value={vendorId} onChange={setVendorId} placeholder="Search vendor…"
                  options={vendors.map((v) => ({ value: String(v.id), label: v.code ? `${v.code} — ${v.name}` : v.name }))} />
                <p style={sheetHint}>This RFQ has no awarded vendor or L1/L2 quote files (quotes came by email) — pick the vendor of the Tally PO.</p>
              </>
            )}
            {showTiers && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {quotes.map((q) => (
                  <label key={q.tier} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: 10, cursor: 'pointer',
                    border: `1px solid ${tier === q.tier ? SHEET.BLUE : SHEET.LINE}`, background: tier === q.tier ? '#eff6ff' : '#fff' }}>
                    <input type="radio" name="upload-po-tier" checked={tier === q.tier} onChange={() => setTier(q.tier)} />
                    <span style={{ fontSize: 11, fontWeight: 800, color: q.tier === 'L1' ? '#16a34a' : SHEET.MUTED, minWidth: 22 }}>{q.tier}</span>
                    <span style={{ flex: 1, fontSize: 13.5, fontWeight: 600, color: SHEET.INK }}>
                      {q.vendor}<span style={{ fontWeight: 400, color: SHEET.MUTED, fontSize: 12 }}>{q.contact ? ` · ${q.contact}` : ''}</span>
                    </span>
                    {q.tier === 'L1' && <span style={{ fontSize: 11, color: '#16a34a', fontWeight: 600 }}>lowest</span>}
                  </label>
                ))}
              </div>
            )}
            {showTiers && tier !== 'L1' && (
              <div style={{ marginTop: 12 }}>
                <label htmlFor="upload-po-reason" style={sheetLabel}>Why not L1 (lowest)? <Req /></label>
                <textarea id="upload-po-reason" value={reason} onChange={(e) => setReason(e.target.value)} rows={2} style={{ ...sheetInput, height: 'auto', resize: 'vertical' }}
                  placeholder="e.g. L1 can't deliver before the required date / L1 failed technical evaluation" />
              </div>
            )}
          </SheetSection>
        </>}
        right={<>
          <SheetSection icon="truck" title="3. Delivery">
            <label style={sheetLabel}>Deliver to store <Req /></label>
            <SearchableSelect value={storeId} onChange={setStoreId} placeholder="Search store…"
              options={stores.map((s) => ({ value: String(s.id), label: `${s.code} — ${s.name}` }))} />
            <p style={sheetHint}>The store&apos;s address is the PO&apos;s delivery address; the GRN is done there.</p>
            <div style={{ marginTop: 12 }}>
              <label style={sheetLabel}>Expected delivery <Optional /></label>
              <DateField value={expected} onChange={setExpected} />
            </div>
            {needsCostCenter && (
              <div style={{ marginTop: 12 }}>
                <label style={sheetLabel}>Cost centre (charged to) <Req /></label>
                <SearchableSelect value={costCenterId} onChange={setCostCenterId} placeholder="Search cost centre…"
                  options={costCenters.map((c) => ({ value: String(c.id), label: c.label }))} />
                <p style={sheetHint}>A department running-cost purchase is charged to a cost centre; Finance books the invoice to it.</p>
              </div>
            )}
          </SheetSection>
        </>}
      />
      <div style={{ padding: '4px 24px 20px', borderTop: `1px solid ${SHEET.LINE}` }}>
        <div style={{ paddingTop: 16 }}>
          <SheetSection icon="list" title={`4. Lines on this PO${selectedVendor ? ` — ${selectedVendor.vendorName}` : ''} (prices as on the Tally PO)`}>
            {lines.length === 0 ? (
              <p style={{ fontSize: 13, color: SHEET.MUTED, margin: 0 }}>
                {loadingAwards ? 'Loading…' : awardMode ? 'No line is left to order for this vendor.' : 'No line of this RFQ has quantity left to order. Everything is on a PO, issued from stock or short-closed.'}
              </p>
            ) : (
              <div data-tour="pr-upload-po-lines" style={{ overflow: 'auto', border: `1px solid ${SHEET.LINE}`, borderRadius: 10 }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 640 }}>
                  <thead>
                    <tr>
                      <th style={{ ...th, width: 36 }} aria-label="On this PO" />
                      <th style={th}>Item<RowCount count={lines.length} /></th>
                      <th style={{ ...th, textAlign: 'right' }}>Left to order</th>
                      <th style={th}>Quantity <Req /></th>
                      <th style={th}>Unit price <Req /></th>
                      <th style={th}>Tax %</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lines.map((l) => {
                      const on = isOn(l)
                      const r = rowOf(l)
                      return (
                        <tr key={l.prItemId} style={{ opacity: on ? 1 : 0.55 }}>
                          <td style={td}>
                            <input type="checkbox" checked={on} onChange={(e) => setRow(l, { on: e.target.checked })} aria-label={`Put ${l.itemName} on this PO`} />
                          </td>
                          <td style={td}>{l.itemCode && <b>{l.itemCode} — </b>}{l.itemName}</td>
                          <td style={{ ...td, textAlign: 'right', whiteSpace: 'nowrap' }}>{fmt(l.max)} {l.unit || ''}</td>
                          <td style={td}>
                            <input type="number" min={0} max={l.max} step="any" inputMode="decimal" disabled={!on} aria-label={`Quantity of ${l.itemName}`}
                              value={r.qty ?? String(l.max)} onChange={(e) => setRow(l, { qty: e.target.value })} style={{ ...sheetInput, width: 96 }} />
                          </td>
                          <td style={td}>
                            <input type="number" min={0} step="0.01" inputMode="decimal" disabled={!on} aria-label={`Unit price of ${l.itemName}`} value={r.unitPrice || ''}
                              placeholder={l.quotedPrice != null ? `quoted ${l.quotedPrice}` : undefined}
                              onChange={(e) => setRow(l, { unitPrice: e.target.value })} style={{ ...sheetInput, width: 120 }} />
                          </td>
                          <td style={td}>
                            <input type="number" min={0} max={100} step="0.01" inputMode="decimal" disabled={!on} aria-label={`Tax % of ${l.itemName}`} value={r.taxRate || ''}
                              placeholder={l.quotedTax != null ? String(l.quotedTax) : undefined}
                              onChange={(e) => setRow(l, { taxRate: e.target.value })} style={{ ...sheetInput, width: 80 }} />
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
            <p style={{ ...sheetHint, fontWeight: 600, color: SHEET.INK }}>PO value (incl. tax): ₹{total.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
            <p style={sheetHint}>Lower a quantity to order less than is left; the rest stays to order on another PO. Un-tick a line to leave it off this PO. The grey figure in a price box is the vendor&apos;s quoted rate, for reference only: type the price on the Tally PO. The PO number is generated; the Tally PO number is kept on it. The PO goes to the PO approvers, then a Partner.</p>
          </SheetSection>
        </div>
      </div>
    </FormSheet>
  )
}
