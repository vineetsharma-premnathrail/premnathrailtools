'use client'

// Upload PO on the requisition (owner, 2026-10-30): POs are made in Tally, not
// in the portal. The buyer attaches the Tally PO (number + PDF), picks the
// vendor from the RFQ quotes, the store it is delivered to and each line's
// price as on the Tally PO. The server builds the PO from the requisition's own
// lines (Item Master ids carry to the GRN) and sends it straight for approval.

import { useEffect, useMemo, useState } from 'react'
import { rfqApi, vendorsApi, storeApi, organizationApi } from '@/lib/api'
import { accountAssignmentApi } from '@/lib/mmLogisticsApi'
import { P2PRequest, RFQ, ProcurementVendor } from '@/types'
import { FormSheet, SheetColumns, SheetSection, SheetIcon, Req, Optional, SHEET, sheetBtn, sheetInput, sheetLabel, sheetHint, FileDropZone } from '@/components/shared/FormSheet'
import { RowCount } from '@/components/shared/ui'
import SearchableSelect from '@/components/erp/SearchableSelect'
import DateField from '@/components/erp/DateField'
import DraftBanner from '@/components/shared/DraftBanner'
import { useFormDraft } from '@/lib/formDraft'
import { extractErrorMessages } from '@/lib/validation'

type Store = { id: number; name: string; code: string; branch_id?: number | null; is_active?: boolean }
type Branch = { id: number; name: string; code: string }
type Price = { unitPrice: string; taxRate: string }

const th: React.CSSProperties = { textAlign: 'left', padding: '8px 10px', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', color: SHEET.MUTED, background: SHEET.SOFT, whiteSpace: 'nowrap' }
const td: React.CSSProperties = { padding: '6px 10px', fontSize: 13, color: SHEET.INK, borderTop: `1px solid ${SHEET.LINE}`, verticalAlign: 'middle' }

export default function UploadPODialog({ rfq, pr, onClose, onUploaded }: {
  rfq: RFQ; pr: P2PRequest; onClose: () => void; onUploaded: () => void
}) {
  const [tallyNo, setTallyNo] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const [tier, setTier] = useState('L1')
  const [reason, setReason] = useState('')
  const [vendorId, setVendorId] = useState('')
  const [storeId, setStoreId] = useState('')
  const [expected, setExpected] = useState('')
  const [costCenterId, setCostCenterId] = useState('')
  const [costCenters, setCostCenters] = useState<{ id: number; label: string }[]>([])
  const [prices, setPrices] = useState<Record<number, Price>>({})
  const [vendors, setVendors] = useState<ProcurementVendor[]>([])
  const [stores, setStores] = useState<Store[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  // Lines still to buy — the same ones the server puts on the PO.
  const lines = useMemo(() => pr.items.filter((i) => i.fulfillment_status !== 'stock_issued' && i.quantity - (i.issued_qty || 0) > 0), [pr.items])

  // One option per quoted tier (a tier may carry several files).
  const quotes = useMemo(() => {
    const seen = new Map<string, { tier: string; vendor: string; contact?: string }>()
    for (const a of rfq.attachments || []) {
      if (a.vendor_name && !seen.has(a.vendor_tier)) seen.set(a.vendor_tier, { tier: a.vendor_tier, vendor: a.vendor_name, contact: a.vendor_contact })
    }
    return [...seen.values()].sort((x, y) => x.tier.localeCompare(y.tier))
  }, [rfq])
  // A vendor already chosen on the RFQ (selected quote, Before-PO receipt) is used as is.
  const presetVendor = pr.selected_vendor && pr.status === 'vendor_selected' ? pr.selected_vendor : null
  const showTiers = !presetVendor && quotes.length > 0
  const pickFromMaster = !quotes.length && !presetVendor
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

  const draft = useFormDraft(`p2p-upload-po-${pr.id}`, { tallyNo, tier, reason, vendorId, storeId, expected, costCenterId, prices }, (d) => {
    setTallyNo(d.tallyNo); setTier(d.tier); setReason(d.reason); setVendorId(d.vendorId)
    setStoreId(d.storeId); setExpected(d.expected); setCostCenterId(d.costCenterId || ''); setPrices(d.prices || {})
  })

  const setPrice = (id: number, patch: Partial<Price>) => setPrices((p) => ({ ...p, [id]: { ...(p[id] || { unitPrice: '', taxRate: '' }), ...patch } }))
  const total = lines.reduce((sum, l) => {
    const p = prices[l.id]
    const unit = Number(p?.unitPrice) || 0
    const tax = Number(p?.taxRate) || 0
    return sum + (l.quantity - (l.issued_qty || 0)) * unit * (1 + tax / 100)
  }, 0)

  const close = () => { if (!busy) onClose() }

  const upload = async () => {
    const problems: string[] = []
    if (!tallyNo.trim()) problems.push('Enter the Tally PO number — the voucher number of this PO in Tally.')
    if (!files.length) problems.push('Attach the Tally PO print as a PDF (print it from Tally to PDF).')
    if (showTiers && tier !== 'L1' && !reason.trim()) problems.push(`You picked the ${tier} vendor instead of L1 (lowest) — write the reason.`)
    if (pickFromMaster && !vendorId) problems.push('Pick the vendor the PO is placed with.')
    if (!storeId) problems.push('Pick the store the goods are delivered to.')
    if (needsCostCenter && !costCenterId) problems.push('Pick the cost centre this department purchase is charged to.')
    const unpriced = lines.filter((l) => !(Number(prices[l.id]?.unitPrice) > 0)).map((l) => l.item_name)
    if (unpriced.length) problems.push(`Enter the unit price (as on the Tally PO) for: ${unpriced.join(', ')}.`)
    const badTax = lines.filter((l) => { const t = prices[l.id]?.taxRate; return !!t && !(Number(t) >= 0 && Number(t) <= 100) }).map((l) => l.item_name)
    if (badTax.length) problems.push(`Tax % must be between 0 and 100 for: ${badTax.join(', ')}.`)
    if (problems.length) { setError(problems.join(' ')); return }
    setBusy(true)
    setError('')
    try {
      await rfqApi.uploadPo(rfq.id, tallyNo.trim(), {
        vendor_tier: showTiers ? tier : undefined,
        selection_reason: showTiers && tier !== 'L1' ? reason.trim() : undefined,
        cost_center_id: needsCostCenter ? Number(costCenterId) : undefined,
        vendor_id: pickFromMaster ? Number(vendorId) : undefined,
        ship_to_location_id: Number(storeId),
        expected_delivery: expected || undefined,
        lines: lines.map((l) => ({
          pr_item_id: l.id,
          unit_price: Number(prices[l.id].unitPrice),
          tax_rate: prices[l.id]?.taxRate ? Number(prices[l.id].taxRate) : null,
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
    <FormSheet icon="upload" title="Upload PO" subtitle={`${pr.p2p_number} · ${rfq.rfq_number} — attach the PO made in Tally; it goes for approval.`}
      onClose={close} busy={busy} tour="pr-upload-po-sheet" onSubmit={upload}
      footer={<>
        <button type="button" onClick={close} disabled={busy} style={sheetBtn('secondary', SHEET.INK, busy)}>Cancel</button>
        <button type="submit" disabled={busy} data-tour="pr-upload-po-submit" style={sheetBtn('primary', SHEET.BLUE, busy)}>
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
            {presetVendor && <p style={{ fontSize: 13.5, fontWeight: 600, color: SHEET.INK, margin: 0 }}>{presetVendor}</p>}
            {pickFromMaster && (
              <>
                <label style={sheetLabel}>Vendor <Req /></label>
                <SearchableSelect value={vendorId} onChange={setVendorId} placeholder="Search vendor…"
                  options={vendors.map((v) => ({ value: String(v.id), label: v.code ? `${v.code} — ${v.name}` : v.name }))} />
                <p style={sheetHint}>This RFQ has no L1/L2 quote files (quotes came by email) — pick the vendor of the Tally PO.</p>
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

          <SheetSection icon="list" title="4. Prices (as on the Tally PO)">
            <div style={{ overflow: 'auto', border: `1px solid ${SHEET.LINE}`, borderRadius: 10 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 420 }}>
                <thead><tr><th style={th}>Item<RowCount count={lines.length} /></th><th style={{ ...th, textAlign: 'right' }}>Qty</th><th style={th}>Unit price <Req /></th><th style={th}>Tax %</th></tr></thead>
                <tbody>
                  {lines.map((l) => (
                    <tr key={l.id}>
                      <td style={td}>{l.item_name}</td>
                      <td style={{ ...td, textAlign: 'right', whiteSpace: 'nowrap' }}>{(l.quantity - (l.issued_qty || 0)).toLocaleString('en-IN', { maximumFractionDigits: 3 })} {l.unit || ''}</td>
                      <td style={td}>
                        <input type="number" min={0} step="0.01" inputMode="decimal" aria-label={`Unit price of ${l.item_name}`} value={prices[l.id]?.unitPrice || ''}
                          onChange={(e) => setPrice(l.id, { unitPrice: e.target.value })} style={{ ...sheetInput, width: 110 }} />
                      </td>
                      <td style={td}>
                        <input type="number" min={0} max={100} step="0.01" inputMode="decimal" aria-label={`Tax % of ${l.item_name}`} value={prices[l.id]?.taxRate || ''}
                          onChange={(e) => setPrice(l.id, { taxRate: e.target.value })} style={{ ...sheetInput, width: 72 }} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p style={{ ...sheetHint, fontWeight: 600, color: SHEET.INK }}>PO value (incl. tax): ₹{total.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
            <p style={sheetHint}>The PO number is generated; the Tally PO number is kept on it. The PO goes to the PO approvers, then a Partner.</p>
          </SheetSection>
        </>}
      />
    </FormSheet>
  )
}
