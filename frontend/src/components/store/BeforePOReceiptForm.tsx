'use client'

// Record goods that reached the store before their purchase order exists.
// FormSheet popup (same standard as PM "Create Task"). No stock is posted here —
// the GRN does that once Procurement's PO is approved.

import { useEffect, useState } from 'react'
import { storeApi, vendorsApi } from '@/lib/api'
import { prePoStoreApi, PrePoReceipt } from '@/lib/prePoApi'
import { ProcurementVendor, StoreItem, StoreLocation } from '@/types'
import { extractErrorMessages } from '@/lib/validation'
import SearchableSelect from '@/components/erp/SearchableSelect'
import DateField from '@/components/erp/DateField'
import Select from '@/components/shared/Select'
import { CONTROL } from '@/lib/theme'
import { useFormDraft } from '@/lib/formDraft'
import DraftBanner from '@/components/shared/DraftBanner'
import { FormSheet, SheetSection, SheetIcon, SheetError, Optional, Req, SHEET, sheetBtn, sheetInput, sheetLabel, sheetHint } from '@/components/shared/FormSheet'

type Line = { itemId: string; quantity: string; remarks: string }
const emptyLine = (): Line => ({ itemId: '', quantity: '', remarks: '' })

export default function BeforePOReceiptForm({ onClose, onSaved }: { onClose: () => void; onSaved: (r: PrePoReceipt, note?: string) => void }) {
  const [vendors, setVendors] = useState<ProcurementVendor[]>([])
  const [items, setItems] = useState<StoreItem[]>([])
  const [locations, setLocations] = useState<StoreLocation[]>([])
  const [vendorId, setVendorId] = useState('')
  const [receivedDate, setReceivedDate] = useState(new Date().toLocaleDateString('en-CA')) // local date, not UTC
  const [locationId, setLocationId] = useState('')
  const [challan, setChallan] = useState('')
  const [invoice, setInvoice] = useState('')
  const [remarks, setRemarks] = useState('')
  const [invoiceFile, setInvoiceFile] = useState<File | null>(null)
  const [challanFile, setChallanFile] = useState<File | null>(null)
  const [lines, setLines] = useState<Line[]>([emptyLine()])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | string[]>('')
  const draft = useFormDraft('store-before-po-receipt-new', { vendorId, receivedDate, locationId, challan, invoice, remarks, lines }, (d) => {
    setVendorId(d.vendorId ?? ''); setReceivedDate(d.receivedDate || new Date().toLocaleDateString('en-CA')); setLocationId(d.locationId ?? '')
    setChallan(d.challan ?? ''); setInvoice(d.invoice ?? ''); setRemarks(d.remarks ?? '')
    setLines(d.lines?.length ? d.lines : [emptyLine()])
  })

  useEffect(() => {
    const fail = (what: string) => (err: unknown) => setError(extractErrorMessages(err, `Could not load ${what} — close this form and open it again.`))
    vendorsApi.list({ status: 'active' }).then((v) => setVendors([...v].sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true })))).catch(fail('the vendor list'))
    storeApi.listItems({ status: 'active' }).then((i: StoreItem[]) => setItems([...i].sort((a, b) => a.item_code.localeCompare(b.item_code, undefined, { numeric: true })))).catch(fail('the Item Master'))
    storeApi.listLocations().then(setLocations).catch(fail('the store locations'))
  }, [])

  const setLine = (idx: number, patch: Partial<Line>) => setLines((ls) => ls.map((l, i) => (i === idx ? { ...l, ...patch } : l)))
  const usedIds = new Set(lines.map((l) => l.itemId).filter(Boolean))
  const itemOf = (id: string) => items.find((i) => String(i.id) === id)

  const save = async () => {
    setError('')
    if (!vendorId) { setError('Pick the vendor the goods came from — Procurement makes the PO to this vendor.'); return }
    if (!receivedDate) { setError('Enter the date the goods were received.'); return }
    const filled = lines.filter((l) => l.itemId || l.quantity)
    if (!filled.length) { setError('Add at least one item with its quantity.'); return }
    for (const l of filled) {
      const name = itemOf(l.itemId)?.item_name || 'A line'
      if (!l.itemId) { setError('Pick the Item Master item on every line, or remove the empty line.'); return }
      if (!(Number(l.quantity) > 0)) { setError(`${name}: enter the quantity received (above 0).`); return }
    }
    setBusy(true)
    try {
      const saved = await prePoStoreApi.create({
        vendor_id: Number(vendorId),
        received_date: receivedDate,
        store_location_id: locationId ? Number(locationId) : undefined,
        delivery_challan_number: challan.trim() || undefined,
        vendor_invoice_number: invoice.trim() || undefined,
        remarks: remarks.trim() || undefined,
        items: filled.map((l) => ({ store_item_id: Number(l.itemId), quantity: Number(l.quantity), remarks: l.remarks.trim() || undefined })),
      })
      // Files go up after the receipt exists; a failed upload doesn't undo the receipt.
      const notes: string[] = []
      let latest = saved
      for (const [file, type] of [[invoiceFile, 'invoice'], [challanFile, 'challan']] as const) {
        if (!file) continue
        try { latest = await prePoStoreApi.uploadAttachment(saved.id, file, type) }
        catch (err) { notes.push(`${file.name}: ${extractErrorMessages(err, 'upload failed').join(' ')}`) }
      }
      draft.clear()
      onSaved(latest, notes.length ? `${saved.receipt_number} is saved, but a file could not be attached — ${notes.join(' ')} Open the receipt and attach it again.` : undefined)
    } catch (err) {
      setError(extractErrorMessages(err, 'Could not save the Before PO receipt — check the vendor, items and quantities and try again.'))
      setBusy(false)
    }
  }

  return (
    <FormSheet icon="box" title="Before PO receipt" subtitle="Goods that arrived before their purchase order" onClose={onClose} busy={busy} tour="store-bpo-form" onSubmit={save}
      footer={<>
        <button type="button" disabled={busy} onClick={onClose} data-tour="store-bpo-cancel-btn" style={sheetBtn('secondary', SHEET.INK, busy)}>Cancel</button>
        <button type="submit" disabled={busy} data-tour="store-bpo-save-btn" style={sheetBtn('primary', SHEET.BLUE, busy)}><SheetIcon name="check" size={16} />{busy ? 'Saving…' : 'Save receipt'}</button>
      </>}>
      <div style={{ padding: '20px 24px' }}>
        <DraftBanner draft={draft} />
        <SheetError error={error} />
        <div role="note" style={{ padding: '10px 14px', marginBottom: 18, borderRadius: 10, background: 'rgba(234,88,12,0.08)', border: '1px solid rgba(234,88,12,0.25)', color: '#9a3412', fontSize: 13 }}>
          Goods recorded here are held in store and are NOT in stock yet. Stock is added by the GRN once Procurement&apos;s PO is approved.
        </div>

        <SheetSection icon="building" title="Receipt">
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14 }}>
            <div data-tour="store-bpo-vendor" style={{ flex: '1 1 300px', minWidth: 240 }}>
              <label style={sheetLabel}>Vendor <Req /></label>
              <SearchableSelect value={vendorId} onChange={setVendorId} placeholder="Search a vendor…"
                options={vendors.map((v) => ({ value: String(v.id), label: `${v.code} — ${v.name}` }))} />
            </div>
            <div data-tour="store-bpo-date" style={{ flex: '0 1 180px', minWidth: 160 }}>
              <label style={sheetLabel}>Received on <Req /></label>
              <DateField value={receivedDate} onChange={setReceivedDate} />
            </div>
            <div data-tour="store-bpo-location" style={{ flex: '0 1 220px', minWidth: 190 }}>
              <label style={sheetLabel}>Store location <Optional /></label>
              <Select style={sheetInput} value={locationId} onChange={(e) => setLocationId(e.target.value)}>
                <option value="">— where the goods are held —</option>
                {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
              </Select>
            </div>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, marginTop: 14 }}>
            <div style={{ flex: '1 1 200px', maxWidth: 280 }}>
              <label style={sheetLabel}>Delivery challan no. <Optional /></label>
              <input style={sheetInput} value={challan} onChange={(e) => setChallan(e.target.value)} maxLength={100} />
            </div>
            <div style={{ flex: '1 1 200px', maxWidth: 280 }}>
              <label style={sheetLabel}>Vendor invoice no. <Optional /></label>
              <input style={sheetInput} value={invoice} onChange={(e) => setInvoice(e.target.value)} maxLength={100} placeholder="As on the bill" />
            </div>
          </div>
          <div style={{ marginTop: 14 }}>
            <label style={sheetLabel}>Remarks <Optional /></label>
            <textarea style={{ ...sheetInput, minHeight: 60, resize: 'vertical' }} value={remarks} onChange={(e) => setRemarks(e.target.value)} placeholder="Condition on arrival, who brought it, why there is no PO yet…" />
          </div>
        </SheetSection>

        <SheetSection icon="clip" title="Invoice & challan files">
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14 }}>
            <div style={{ flex: '1 1 260px' }}>
              <label style={sheetLabel}>Vendor invoice <Optional /></label>
              <input type="file" accept=".pdf,image/*,.doc,.docx,.xls,.xlsx" style={sheetInput} onChange={(e) => setInvoiceFile(e.target.files?.[0] || null)} aria-label="Vendor invoice file" />
            </div>
            <div style={{ flex: '1 1 260px' }}>
              <label style={sheetLabel}>Delivery challan <Optional /></label>
              <input type="file" accept=".pdf,image/*,.doc,.docx,.xls,.xlsx" style={sheetInput} onChange={(e) => setChallanFile(e.target.files?.[0] || null)} aria-label="Delivery challan file" />
            </div>
          </div>
          <p style={sheetHint}>Procurement sees these files on the PO. More can be attached later from the receipt.</p>
        </SheetSection>

        <div style={{ marginTop: 6 }}>
          <SheetSection icon="list" title="Items received">
            <div data-tour="store-bpo-lines">
              {lines.map((line, idx) => {
                const it = itemOf(line.itemId)
                const last = idx === lines.length - 1
                return (
                  <div key={idx} style={{ display: 'flex', gap: 10, alignItems: 'flex-end', marginBottom: 10, flexWrap: 'wrap' }}>
                    <div style={{ flex: '1 1 300px', minWidth: 220 }}>
                      {idx === 0 && <label style={sheetLabel}>Item (Item Master) <Req /></label>}
                      <SearchableSelect value={line.itemId} onChange={(v) => setLine(idx, { itemId: v })} placeholder="Search an item by code or name…"
                        options={items.map((i) => ({ value: String(i.id), label: `${i.item_code} — ${i.item_name}`, disabled: usedIds.has(String(i.id)) && String(i.id) !== line.itemId }))} />
                    </div>
                    <div style={{ flex: '0 0 130px' }}>
                      {idx === 0 && <label style={sheetLabel}>Quantity <Req /></label>}
                      <input type="number" min={0} step="any" style={sheetInput} value={line.quantity} onChange={(e) => setLine(idx, { quantity: e.target.value })} aria-label="Quantity received" />
                    </div>
                    <div style={{ flex: '0 0 70px', paddingBottom: 8, fontSize: 13, color: SHEET.MUTED }}>{it?.uom || ''}</div>
                    <div style={{ flex: '1 1 180px', minWidth: 150 }}>
                      {idx === 0 && <label style={sheetLabel}>Remarks <Optional /></label>}
                      <input style={sheetInput} value={line.remarks} onChange={(e) => setLine(idx, { remarks: e.target.value })} aria-label="Line remarks" />
                    </div>
                    <button type="button" aria-label="Remove line" title="Remove line" disabled={lines.length === 1} onClick={() => setLines((ls) => ls.filter((_, i) => i !== idx))}
                      style={{ ...sheetBtn('secondary', SHEET.INK, lines.length === 1), padding: 0, width: CONTROL.height, height: CONTROL.height, justifyContent: 'center', flex: 'none' }}><SheetIcon name="trash" size={15} /></button>
                    {last && (
                      <button type="button" aria-label="Add line" title="Add line" data-tour="store-bpo-add-line-btn" onClick={() => setLines((ls) => [...ls, emptyLine()])}
                        style={{ ...sheetBtn('secondary', SHEET.BLUE), padding: 0, width: CONTROL.height, height: CONTROL.height, justifyContent: 'center', flex: 'none' }}><SheetIcon name="plus" size={15} /></button>
                    )}
                  </div>
                )
              })}
            </div>
            <p style={sheetHint}>Pick items from the Item Master so Procurement&apos;s PO carries the same item. An item can be on one line only.</p>
          </SheetSection>
        </div>
      </div>
    </FormSheet>
  )
}
