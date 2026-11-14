'use client'

// Record goods that reached the store before their purchase order exists.
// FormSheet popup (same standard as PM "Create Task"). Saving puts the goods into the
// store's stock at once (Free, or Quality for items needing a quality check); the GRN
// against Procurement's PO later settles them without adding stock again.

import { useEffect, useState } from 'react'
import { storeApi, vendorsApi } from '@/lib/api'
import { prePoStoreApi, PrePoReceipt, billNameKey } from '@/lib/prePoApi'
import { ProcurementVendor, StoreItem, StoreLocation } from '@/types'
import { extractErrorMessages } from '@/lib/validation'
import { itemOptionDetail } from '@/lib/itemOptions'
import SearchableSelect from '@/components/erp/SearchableSelect'
import DateField from '@/components/erp/DateField'
import Select from '@/components/shared/Select'
import { CONTROL } from '@/lib/theme'
import { segmentBtnStyle } from '@/components/shared/ui'
import { useFormDraft } from '@/lib/formDraft'
import { useAuthStore } from '@/store/authStore'
import DraftBanner from '@/components/shared/DraftBanner'
import { FormSheet, SheetSection, SheetIcon, SheetError, Optional, Req, SHEET, sheetBtn, sheetInput, sheetLabel, sheetHint } from '@/components/shared/FormSheet'

type DocType = 'invoice' | 'challan'
// auto: the item was filled from an earlier bill of this vendor with the same Name on invoice.
type Line = { itemType: string; itemId: string; invoiceName: string; quantity: string; rate: string; remarks: string; auto?: boolean }
const emptyLine = (): Line => ({ itemType: '', itemId: '', invoiceName: '', quantity: '', rate: '', remarks: '' })
// A vendor typed by name (not in the list): created in the background on save (owner, 2026-11-13).
const NEW_VENDOR = '__new__'
// Item types a Before PO receipt may carry: the "stock" purpose's types (backend
// p2p/purpose.py PURPOSE_ITEM_TYPES); types Store added beyond the standard five stay offered.
const STANDARD_ITEM_TYPES = ['material', 'service', 'asset', 'consumable', 'tool_equipment']
const STOCK_TYPES = ['material', 'consumable', 'tool_equipment']
const typeFits = (t: string | null | undefined) => !STANDARD_ITEM_TYPES.includes(t || '') || STOCK_TYPES.includes(t || '')

/** poNotInList: opened from Record Goods Receipt › "PO not in list" (owner, 2026-11-13) — the goods came on a PO
 *  made outside the portal (Tally / vendor), so its PO number is required here. */
export default function BeforePOReceiptForm({ onClose, onSaved, poNotInList = false }: { onClose: () => void; onSaved: (r: PrePoReceipt, note?: string) => void; poNotInList?: boolean }) {
  const [vendors, setVendors] = useState<ProcurementVendor[]>([])
  const [items, setItems] = useState<StoreItem[]>([])
  const [locations, setLocations] = useState<StoreLocation[]>([])
  const user = useAuthStore((st) => st.user)
  const [vendorId, setVendorId] = useState('')
  const [vendorNew, setVendorNew] = useState('')
  const [typeLabels, setTypeLabels] = useState<Record<string, string>>({})
  // Names on this vendor's earlier bills -> item (Name on invoice remembered per vendor).
  const [billNamesOf, setBillNamesOf] = useState<{ vendorId: string; map: Record<string, number> }>({ vendorId: '', map: {} })
  const billNames = billNamesOf.vendorId === vendorId ? billNamesOf.map : {}
  const [receivedDate, setReceivedDate] = useState(new Date().toLocaleDateString('en-CA')) // local date, not UTC
  const [locationId, setLocationId] = useState('')
  const [challan, setChallan] = useState('')
  const [invoice, setInvoice] = useState('')
  const [invoiceDate, setInvoiceDate] = useState('')
  // Tax invoice or delivery challan - only the chosen document's fields show and are saved (owner, 2026-11-07).
  const [docType, setDocType] = useState<DocType>('invoice')
  const [challanDate, setChallanDate] = useState('')
  const [remarks, setRemarks] = useState('')
  const [invoiceFile, setInvoiceFile] = useState<File | null>(null)
  const [challanFile, setChallanFile] = useState<File | null>(null)
  // PO not in the portal's PO list: number + date as printed on the PO, and its file.
  const [poNumber, setPoNumber] = useState('')
  const [poDate, setPoDate] = useState('')
  const [poFile, setPoFile] = useState<File | null>(null)
  const [lines, setLines] = useState<Line[]>([emptyLine()])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | string[]>('')
  const draft = useFormDraft(poNotInList ? 'store-receipt-po-not-in-list-new' : 'store-before-po-receipt-new', { vendorId, vendorNew, receivedDate, locationId, docType, challan, challanDate, invoice, invoiceDate, poNumber, poDate, remarks, lines }, (d) => {
    setPoNumber(d.poNumber ?? ''); setPoDate(d.poDate ?? ''); setVendorNew(d.vendorNew ?? '')
    setVendorId(d.vendorId ?? ''); setReceivedDate(d.receivedDate || new Date().toLocaleDateString('en-CA')); setLocationId(d.locationId ?? '')
    setDocType(d.docType === 'challan' ? 'challan' : 'invoice'); setChallan(d.challan ?? ''); setChallanDate(d.challanDate ?? ''); setInvoice(d.invoice ?? ''); setInvoiceDate(d.invoiceDate ?? ''); setRemarks(d.remarks ?? '')
    setLines(d.lines?.length ? d.lines.map((l: Partial<Line>) => ({ itemType: l.itemType ?? '', itemId: l.itemId ?? '', invoiceName: l.invoiceName ?? '', quantity: l.quantity ?? '', rate: l.rate ?? '', remarks: l.remarks ?? '' })) : [emptyLine()])
  })

  useEffect(() => {
    const fail = (what: string) => (err: unknown) => setError(extractErrorMessages(err, `Could not load ${what} — close this form and open it again.`))
    vendorsApi.list({ status: 'active' }).then((v) => setVendors([...v].sort((a, b) => a.name.localeCompare(b.name)))).catch(fail('the vendor list'))
    storeApi.listItems({ status: 'active' }).then((i: StoreItem[]) => setItems([...i].sort((a, b) => a.item_code.localeCompare(b.item_code, undefined, { numeric: true })))).catch(fail('the Item Master'))
    storeApi.listLocations().then((ls: StoreLocation[]) => setLocations(ls.filter((l) => l.is_active))).catch(fail('the store locations'))
    storeApi.getItemMeta().then((m) => setTypeLabels(Object.fromEntries(m.item_types.map((t) => [t.value, t.label])))).catch(() => setTypeLabels({}))
  }, [])

  // A store person books into their own store only (owner, 2026-10-28; the server
  // enforces the same in store/routes/pre_po_receipts.py _own_store_id): the stores
  // they manage, else the stores of their plant. Admins may pick any store.
  const isAdmin = user?.role === 'admin'
  const managed = locations.filter((l) => !!user && l.manager_user_id === user.id)
  const ownStores = isAdmin ? locations : managed.length ? managed : locations
  const lockedStore = !isAdmin && ownStores.length === 1 ? ownStores[0] : null
  useEffect(() => {
    if (lockedStore && locationId !== String(lockedStore.id)) setLocationId(String(lockedStore.id))
  }, [lockedStore, locationId])

  useEffect(() => {
    if (!vendorId || vendorId === NEW_VENDOR) return
    let live = true
    prePoStoreApi.billNames({ vendor_id: Number(vendorId) })
      .then((rows) => {
        if (!live) return
        const map = Object.fromEntries(rows.map((r) => [r.name_key, r.store_item_id]))
        setBillNamesOf({ vendorId, map })
        // Names typed before the vendor was picked: fill the empty items now.
        setLines((ls) => ls.map((l) => {
          const hit = map[billNameKey(l.invoiceName)]
          return !l.itemId && hit && !ls.some((o) => o.itemId === String(hit)) ? { ...l, itemId: String(hit), auto: true } : l
        }))
      })
      .catch(() => { if (live) setBillNamesOf({ vendorId, map: {} }) })
    return () => { live = false }
  }, [vendorId])

  // Typing the Name on invoice fills the item when this vendor's earlier bill used the same name.
  const setInvoiceName = (idx: number, invoiceName: string) => setLines((ls) => ls.map((l, i) => {
    if (i !== idx) return l
    const hit = billNames[billNameKey(invoiceName)]
    const free = hit && !ls.some((o, j) => j !== idx && o.itemId === String(hit))
    if (hit && free && (!l.itemId || l.auto)) return { ...l, invoiceName, itemId: String(hit), itemType: '', auto: true }
    if (!hit && l.auto) return { ...l, invoiceName, itemId: '', auto: false }
    return { ...l, invoiceName }
  }))

  // One search over every stock item (code, name and technical details) - no type / category steps (owner, 2026-11-06).
  const stockItems = items.filter((i) => typeFits(i.item_type))
  // Item type of each line: narrows the item search (optional) and shows the picked item's type.
  const typeValues = [...new Set(stockItems.map((i) => i.item_type).filter((t): t is string => !!t))].sort((a, b) => (typeLabels[a] || a).localeCompare(typeLabels[b] || b))

  const setLine = (idx: number, patch: Partial<Line>) => setLines((ls) => ls.map((l, i) => (i === idx ? { ...l, ...patch } : l)))
  const usedIds = new Set(lines.map((l) => l.itemId).filter(Boolean))
  const itemOf = (id: string) => items.find((i) => String(i.id) === id)

  const save = async () => {
    setError('')
    if (!vendorId || (vendorId === NEW_VENDOR && !vendorNew.trim())) { setError('Pick the vendor the goods came from, or type its name and choose “Use as new vendor”.'); return }
    if (!receivedDate) { setError('Enter the date the goods were received.'); return }
    if (!lockedStore && !locationId) {
      setError(ownStores.length ? 'Pick the store the goods went into — the receipt puts them into that store\'s stock.'
        : 'No store is linked to you, so goods cannot be booked. Ask an admin to make you the manager of your store in Store › Settings › Stores.')
      return
    }
    if (poNotInList && !poNumber.trim()) { setError('Type the PO number as printed on the purchase order — or, if there is no PO at all, use Before PO instead.'); return }
    if (poDate && !poNumber.trim()) { setError('A PO date is filled in but no PO number — type the PO number, or clear the PO date.'); return }
    if (docType === 'challan' && challanDate && challanDate > receivedDate) { setError('The challan date is after the date the goods were received — check the date printed on the delivery challan, or correct the Received on date.'); return }
    if (docType === 'invoice' && invoiceDate && invoiceDate > receivedDate) { setError('The invoice date is after the date the goods were received — check the date printed on the vendor’s bill, or correct the Received on date.'); return }
    const filled = lines.filter((l) => l.itemId || l.quantity)
    if (!filled.length) { setError('Add at least one item with its quantity.'); return }
    for (const l of filled) {
      const name = itemOf(l.itemId)?.item_name || 'A line'
      if (!l.itemId) { setError('Pick the Item Master item on every line, or remove the empty line.'); return }
      if (!(Number(l.quantity) > 0)) { setError(`${name}: enter the quantity received (above 0).`); return }
      if (l.rate.trim() !== '' && !(Number.isFinite(Number(l.rate)) && Number(l.rate) > 0)) { setError(`${name}: the rate must be more than 0 — or leave it blank if you do not know it yet.`); return }
    }
    setBusy(true)
    try {
      const saved = await prePoStoreApi.create({
        ...(vendorId === NEW_VENDOR ? { vendor_name: vendorNew.trim() } : { vendor_id: Number(vendorId) }),
        received_date: receivedDate,
        store_location_id: locationId ? Number(locationId) : undefined,
        delivery_challan_number: docType === 'challan' ? challan.trim() || undefined : undefined,
        delivery_challan_date: docType === 'challan' ? challanDate || undefined : undefined,
        vendor_invoice_number: docType === 'invoice' ? invoice.trim() || undefined : undefined,
        vendor_invoice_date: docType === 'invoice' ? invoiceDate || undefined : undefined,
        manual_po_number: poNumber.trim() || undefined,
        manual_po_date: poNumber.trim() ? poDate || undefined : undefined,
        remarks: remarks.trim() || undefined,
        items: filled.map((l) => ({ store_item_id: Number(l.itemId), quantity: Number(l.quantity), unit_rate: l.rate.trim() !== '' ? Number(l.rate) : undefined, remarks: l.remarks.trim() || undefined, invoice_item_name: l.invoiceName.trim() || undefined })),
      })
      // Files go up after the receipt exists; a failed upload doesn't undo the receipt.
      const notes: string[] = []
      let latest = saved
      for (const [file, type] of [docType === 'invoice' ? [invoiceFile, 'invoice'] : [challanFile, 'challan'], [poNumber.trim() ? poFile : null, 'po']] as [File | null, 'invoice' | 'challan' | 'po'][]) {
        if (!file) continue
        try { latest = await prePoStoreApi.uploadAttachment(saved.id, file, type) }
        catch (err) { notes.push(`${file.name}: ${extractErrorMessages(err, 'upload failed').join(' ')}`) }
      }
      draft.clear()
      onSaved(latest, notes.length ? `${saved.receipt_number} is saved, but a file could not be attached — ${notes.join(' ')} Open the receipt and attach it again.` : undefined)
    } catch (err) {
      setError(extractErrorMessages(err, `Could not save the ${poNotInList ? 'goods receipt' : 'Before PO receipt'} — check the vendor, items and quantities and try again.`))
      setBusy(false)
    }
  }

  return (
    <FormSheet icon="box" title={poNotInList ? 'Goods receipt — PO not in list' : 'Before PO receipt'}
      subtitle={poNotInList ? 'The PO was made outside the portal (Tally / vendor) — type its number and date' : 'Goods that arrived before their purchase order'} onClose={onClose} busy={busy} tour="store-bpo-form" width={1320} onSubmit={save}
      footer={<>
        <button type="button" disabled={busy} onClick={onClose} data-tour="store-bpo-cancel-btn" style={sheetBtn('secondary', SHEET.INK, busy)}>Cancel</button>
        <button type="submit" disabled={busy} data-tour="store-bpo-save-btn" style={sheetBtn('primary', SHEET.BLUE, busy)}><SheetIcon name="check" size={16} />{busy ? 'Saving…' : 'Save receipt'}</button>
      </>}>
      <div style={{ padding: '20px 24px' }}>
        <DraftBanner draft={draft} />
        <SheetError error={error} />
        <div role="note" style={{ padding: '10px 14px', marginBottom: 18, borderRadius: 10, background: 'rgba(234,88,12,0.08)', border: '1px solid rgba(234,88,12,0.25)', color: '#9a3412', fontSize: 13 }}>
          Goods go into stock as soon as this is saved — Free stock, or Quality stock for items that need a quality check. Rate is optional; the PO rate replaces it when the PO is received.
        </div>

        <SheetSection icon="building" title="Receipt">
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14 }}>
            <div data-tour="store-bpo-vendor" style={{ flex: '1 1 300px', minWidth: 240 }}>
              <label style={sheetLabel}>Vendor <Req /></label>
              <SearchableSelect value={vendorId} onChange={setVendorId} placeholder="Search a vendor, or type a new name…"
                onAdd={(q) => { const n = q.trim(); if (n) { setVendorNew(n); setVendorId(NEW_VENDOR) } }} addLabel="+ Use as new vendor"
                options={[...(vendorNew ? [{ value: NEW_VENDOR, label: `${vendorNew} (new vendor)` }] : []), ...vendors.map((v) => ({ value: String(v.id), label: v.name }))]} />
              {vendorId === NEW_VENDOR && <p style={sheetHint}>Not in the vendor list — it is added on save with this name; Procurement fills in GSTIN, address and bank details later.</p>}
            </div>
            <div data-tour="store-bpo-date" style={{ flex: '0 1 180px', minWidth: 160 }}>
              <label style={sheetLabel}>Received on <Req /></label>
              <DateField value={receivedDate} onChange={setReceivedDate} />
            </div>
            <div data-tour="store-bpo-location" style={{ flex: '0 1 220px', minWidth: 190 }}>
              <label style={sheetLabel}>Store <Req /></label>
              {lockedStore ? (
                <div title="Goods are booked into your own store" style={{ ...sheetInput, display: 'flex', alignItems: 'center', background: 'rgba(15,23,42,0.04)', color: SHEET.INK }}>{lockedStore.name}</div>
              ) : (
                <Select style={sheetInput} value={locationId} onChange={(e) => setLocationId(e.target.value)}>
                  <option value="">— store the goods go into —</option>
                  {ownStores.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                </Select>
              )}
            </div>
          </div>
          <div style={{ marginTop: 14 }}>
            <label style={sheetLabel}>Remarks <Optional /></label>
            <textarea style={{ ...sheetInput, minHeight: 60, resize: 'vertical' }} value={remarks} onChange={(e) => setRemarks(e.target.value)} placeholder="Condition on arrival, who brought it, why there is no PO yet…" />
          </div>
        </SheetSection>

        <SheetSection icon="doc" title="Purchase Order" extra={poNotInList ? undefined : <Optional />}>
          <div data-tour="store-bpo-manual-po" style={{ display: 'flex', flexWrap: 'wrap', gap: 14 }}>
            <div style={{ flex: '1 1 200px', maxWidth: 280 }}>
              <label style={sheetLabel}>PO number {poNotInList ? <Req /> : <Optional />}</label>
              <input style={sheetInput} value={poNumber} onChange={(e) => setPoNumber(e.target.value)} maxLength={100} placeholder="As printed on the PO" aria-label="PO number" />
            </div>
            <div style={{ flex: '0 1 180px', minWidth: 160 }}>
              <label style={sheetLabel}>PO date <Optional /></label>
              <DateField value={poDate} onChange={setPoDate} />
            </div>
            <div style={{ flex: '1 1 260px' }}>
              <label style={sheetLabel}>PO file <Optional /></label>
              <input type="file" accept=".pdf,image/*,.doc,.docx,.xls,.xlsx" style={sheetInput} disabled={!poNumber.trim()} title={poNumber.trim() ? undefined : 'Type the PO number first'}
                onChange={(e) => setPoFile(e.target.files?.[0] || null)} aria-label="PO file" />
            </div>
          </div>
          <p style={sheetHint}>{poNotInList
            ? 'For a PO made in Tally or sent by the vendor, which is not in the portal’s PO list. The number is shown on the receipt and can be searched.'
            : 'Fill this only if the goods came on a PO made outside the portal (Tally / vendor).'}</p>
        </SheetSection>

        <SheetSection icon="clip" title="Vendor Documents">
          <label style={sheetLabel}>Goods came with</label>
          <div role="radiogroup" aria-label="Goods came with" data-tour="store-bpo-doc-type" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
            {([['invoice', 'Tax Invoice'], ['challan', 'Delivery Challan']] as [DocType, string][]).map(([v, l]) => (
              <button key={v} type="button" role="radio" aria-checked={docType === v} onClick={() => setDocType(v)}
                style={{ ...segmentBtnStyle(docType === v), minWidth: 140 }}>{l}</button>
            ))}
          </div>
          {docType === 'invoice' ? (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14 }}>
              <div style={{ flex: '1 1 200px', maxWidth: 280 }}>
                <label style={sheetLabel}>Invoice no. <Optional /></label>
                <input style={sheetInput} value={invoice} onChange={(e) => setInvoice(e.target.value)} maxLength={100} placeholder="As on the bill" />
              </div>
              <div style={{ flex: '0 1 180px', minWidth: 160 }}>
                <label style={sheetLabel}>Invoice date <Optional /></label>
                <DateField value={invoiceDate} onChange={setInvoiceDate} />
              </div>
              <div style={{ flex: '1 1 260px' }}>
                <label style={sheetLabel}>Invoice file <Optional /></label>
                <input type="file" accept=".pdf,image/*,.doc,.docx,.xls,.xlsx" style={sheetInput} onChange={(e) => setInvoiceFile(e.target.files?.[0] || null)} aria-label="Vendor invoice file" />
              </div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14 }}>
              <div style={{ flex: '1 1 200px', maxWidth: 280 }}>
                <label style={sheetLabel}>Delivery challan no. <Optional /></label>
                <input style={sheetInput} value={challan} onChange={(e) => setChallan(e.target.value)} maxLength={100} />
              </div>
              <div style={{ flex: '0 1 180px', minWidth: 160 }}>
                <label style={sheetLabel}>Challan date <Optional /></label>
                <DateField value={challanDate} onChange={setChallanDate} />
              </div>
              <div style={{ flex: '1 1 260px' }}>
                <label style={sheetLabel}>Challan file <Optional /></label>
                <input type="file" accept=".pdf,image/*,.doc,.docx,.xls,.xlsx" style={sheetInput} onChange={(e) => setChallanFile(e.target.files?.[0] || null)} aria-label="Delivery challan file" />
              </div>
            </div>
          )}
          <p style={sheetHint}>Procurement sees the file on the PO. More can be attached later from the receipt.</p>
        </SheetSection>

        <div style={{ marginTop: 6 }}>
          <SheetSection icon="list" title="Items received">
            <div data-tour="store-bpo-lines">
              {lines.map((line, idx) => {
                const it = itemOf(line.itemId)
                const last = idx === lines.length - 1
                return (
                  // Fields wrap inside their own box; the delete / add icons stay at the end of the row.
                  <div key={idx} style={{ display: 'flex', gap: 10, alignItems: 'flex-end', marginBottom: 10 }}>
                    <div style={{ flex: 1, minWidth: 0, display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
                    <div style={{ flex: '0 1 100px', minWidth: 90 }}>
                      {idx === 0 && <label style={sheetLabel}>Item type <Optional /></label>}
                      <Select style={sheetInput} value={it?.item_type || line.itemType} aria-label={`Item type, line ${idx + 1}`}
                        onChange={(e) => setLine(idx, { itemType: e.target.value, itemId: it && it.item_type !== e.target.value ? '' : line.itemId })}>
                        <option value="">All types</option>
                        {typeValues.map((t) => <option key={t} value={t}>{typeLabels[t] || t}</option>)}
                      </Select>
                    </div>
                    <div style={{ flex: '1 1 170px', minWidth: 150 }}>
                      {idx === 0 && <label style={sheetLabel}>Item (Item Master) <Req /></label>}
                      <SearchableSelect ariaLabel={`Item, line ${idx + 1}`} value={line.itemId} onChange={(v) => setLine(idx, { itemId: v, auto: false })}
                        placeholder="Search code, name or technical details…"
                        options={stockItems.filter((i) => !line.itemType || i.item_type === line.itemType || String(i.id) === line.itemId).map((i) => ({ value: String(i.id), label: `${i.item_code} — ${i.item_name}`, description: itemOptionDetail(i), disabled: usedIds.has(String(i.id)) && String(i.id) !== line.itemId }))} />
                    </div>
                    <div style={{ flex: '1 1 120px', minWidth: 100 }}>
                      {idx === 0 && <label style={sheetLabel}>Name on invoice <Optional /></label>}
                      <input style={line.auto ? { ...sheetInput, borderColor: '#16a34a', background: 'rgba(22,163,74,0.06)' } : sheetInput} value={line.invoiceName} maxLength={255}
                        onChange={(e) => setInvoiceName(idx, e.target.value)}
                        title={line.auto ? 'The item was filled from an earlier bill of this vendor with this name — change the item if it is wrong' : undefined}
                        placeholder="As written on the bill" aria-label={`Name on invoice, line ${idx + 1}`} />
                    </div>
                    <div style={{ flex: '1 1 120px', minWidth: 100 }}>
                      {idx === 0 && <label style={sheetLabel}>Technical details</label>}
                      <input style={{ ...sheetInput, background: 'rgba(15,23,42,0.04)', color: SHEET.INK }} readOnly tabIndex={-1}
                        value={it ? it.specification || it.description || '—' : ''} title={it ? it.specification || it.description || '' : ''}
                        placeholder="Shows after the item is picked" aria-label={`Technical details, line ${idx + 1}`} />
                    </div>
                    <div style={{ flex: '0 0 72px' }}>
                      {idx === 0 && <label style={sheetLabel}>Quantity <Req /></label>}
                      <input type="number" min={0} step="any" style={sheetInput} value={line.quantity} onChange={(e) => setLine(idx, { quantity: e.target.value })} aria-label="Quantity received" />
                    </div>
                    <div style={{ flex: '0 0 32px', paddingBottom: 8, fontSize: 13, color: SHEET.MUTED }}>{it?.uom || ''}</div>
                    <div data-tour={idx === 0 ? 'store-bpo-rate' : undefined} style={{ flex: '0 0 84px' }}>
                      {idx === 0 && <label style={sheetLabel}>Rate (₹/unit) <Optional /></label>}
                      <input type="number" min={0} step="any" style={sheetInput} value={line.rate} onChange={(e) => setLine(idx, { rate: e.target.value })} aria-label={`Rate per unit, line ${idx + 1}`} placeholder="If known" />
                    </div>
                    <div style={{ flex: '1 1 90px', minWidth: 80 }}>
                      {idx === 0 && <label style={sheetLabel}>Remarks <Optional /></label>}
                      <input style={sheetInput} value={line.remarks} onChange={(e) => setLine(idx, { remarks: e.target.value })} aria-label="Line remarks" />
                    </div>
                    </div>
                    <div style={{ display: 'flex', gap: 10, flex: 'none', width: CONTROL.height * 2 + 10 }}>
                    <button type="button" aria-label="Remove line" title="Remove line" disabled={lines.length === 1} onClick={() => setLines((ls) => ls.filter((_, i) => i !== idx))}
                      style={{ ...sheetBtn('secondary', SHEET.INK, lines.length === 1), padding: 0, width: CONTROL.height, height: CONTROL.height, justifyContent: 'center', flex: 'none' }}><SheetIcon name="trash" size={15} /></button>
                    {last && (
                      <button type="button" aria-label="Add line" title="Add line" data-tour="store-bpo-add-line-btn" onClick={() => setLines((ls) => [...ls, emptyLine()])}
                        style={{ ...sheetBtn('secondary', SHEET.BLUE), padding: 0, width: CONTROL.height, height: CONTROL.height, justifyContent: 'center', flex: 'none' }}><SheetIcon name="plus" size={15} /></button>
                    )}
                    </div>
                  </div>
                )
              })}
            </div>
            <p style={sheetHint}>Search the Item Master item by code, name or technical details, so Procurement&apos;s PO carries the same item. Type the Name on invoice first: if this vendor’s earlier bill used the same name, the item fills by itself (green). An item can be on one line only. Batch- or serial-controlled items cannot be booked here — record those with a GRN after the PO.</p>
          </SheetSection>
        </div>
      </div>
    </FormSheet>
  )
}
