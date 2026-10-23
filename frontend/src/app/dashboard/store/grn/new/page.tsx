'use client'

import { useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { goodsReceiptsApi, storeApi, storeBatchesApi } from '@/lib/api'
import { P2PReceivablePurchaseOrder, StoreLocation } from '@/types'
import { TEXT, BORDER } from '@/lib/theme'
import SearchableSelect from '@/components/erp/SearchableSelect'
import DateField from '@/components/erp/DateField'
import { secondaryBtnStyle } from '@/components/shared/ui'
import { FormPage, SheetColumns, SheetSection, SheetIcon, Optional, Req, SHEET, sheetBtn, sheetInput, sheetLabel, sheetHint } from '@/components/shared/FormSheet'
import StoreNav from '@/components/store/StoreNav'
import InvalidRecordLink from '@/components/erp/InvalidRecordLink'
import { recordPath, useRecordId } from '@/lib/recordRef'
import MessageDialog from '@/components/erp/MessageDialog'
import { extractErrorMessages } from '@/lib/validation'
import { useCan } from '@/lib/permissions'
import { OrderProjectChip } from '@/components/sales/OrderProjectPicker'

const inputStyle: React.CSSProperties = sheetInput
const labelStyle: React.CSSProperties = sheetLabel
// One vendor heat / batch of a batch-tracked line, with its mill TC.
type HeatRow = { heat_number: string; quantity: string; tc_number: string; mfg_date: string; expiry_date: string; tc_file: File | null }
const emptyHeat = (): HeatRow => ({ heat_number: '', quantity: '', tc_number: '', mfg_date: '', expiry_date: '', tc_file: null })

// Gate entry + the vendor's documents that came with the goods (MIGO header).
type GrnDocs = {
  gate_entry_number: string; vendor_invoice_number: string; vendor_invoice_date: string; delivery_challan_number: string
  delivery_challan_date: string; eway_bill_number: string; vehicle_number: string; transporter_name: string; lr_number: string
}
const emptyDocs: GrnDocs = {
  gate_entry_number: '', vendor_invoice_number: '', vendor_invoice_date: '', delivery_challan_number: '', delivery_challan_date: '',
  eway_bill_number: '', vehicle_number: '', transporter_name: '', lr_number: '',
}
// Serial numbers typed one per line (or comma separated) → clean list.
const splitSerials = (s: string) => s.split(/[\n,;]+/).map((x) => x.trim()).filter(Boolean)


// Batch split of one GRN line: the vendor's heats (as on the mill TC), their
// quantities (must add up to the received qty), TC number and scan.
function HeatRows({ rows, received, expiry, onChange }: { rows: HeatRow[]; received: number; expiry: boolean; onChange: (r: HeatRow[]) => void }) {
  const set = (i: number, patch: Partial<HeatRow>) => onChange(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)))
  // Store › GRN & Inspection › Upload mill test certificates.
  const canTc = useCan().canFeature('store', 'grn', 'mill_tc', 'create')
  const sum = rows.reduce((a, r) => a + Number(r.quantity || 0), 0)
  const cell: React.CSSProperties = { ...inputStyle, padding: '6px 8px', fontSize: 12.5 }
  return (
    <div style={{ marginTop: 8, padding: 10, borderRadius: 10, background: 'rgba(255,106,42,0.05)', border: `1px dashed ${BORDER.normal}`, minWidth: 520 }}>
      <div style={{ fontSize: 11.5, fontWeight: 700, color: TEXT.secondary, marginBottom: 6 }}>Batch-tracked — heat / batch numbers from the mill TC</div>
      {rows.map((r, i) => (
        <div key={i} style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 6, alignItems: 'center' }}>
          <input style={{ ...cell, flex: '0 1 130px' }} placeholder="Heat / batch no. *" value={r.heat_number} onChange={(e) => set(i, { heat_number: e.target.value })} />
          <input style={{ ...cell, flex: '0 1 80px' }} type="number" min={0} step="any" placeholder="Qty *" value={r.quantity} onChange={(e) => set(i, { quantity: e.target.value })} />
          <input style={{ ...cell, flex: '0 1 120px' }} placeholder="Mill TC no." value={r.tc_number} onChange={(e) => set(i, { tc_number: e.target.value })} />
          {expiry && <div style={{ flex: '0 1 140px' }}><DateField value={r.expiry_date} onChange={(v) => set(i, { expiry_date: v })} style={cell} /></div>}
          {canTc && <input style={{ ...cell, flex: '0 1 170px' }} type="file" accept=".pdf,image/*" onChange={(e) => set(i, { tc_file: e.target.files?.[0] || null })} />}
          {rows.length > 1 && <button type="button" onClick={() => onChange(rows.filter((_, j) => j !== i))} style={{ ...secondaryBtnStyle, padding: '4px 10px', fontSize: 12 }}>Remove</button>}
        </div>
      ))}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <button type="button" onClick={() => onChange([...rows, emptyHeat()])} style={{ ...secondaryBtnStyle, padding: '4px 10px', fontSize: 12 }}>+ Another heat</button>
        <span style={{ fontSize: 11.5, color: Math.abs(sum - received) > 1e-6 ? '#b91c1c' : '#16a34a' }}>Heats total {sum} of {received} received</span>
      </div>
    </div>
  )
}

export default function NewStoreGrnPage() {
  const { isAuthorized, isLoading, user } = useRequireApp('store')
  const router = useRouter()
  const searchParams = useSearchParams()
  // ?po_id=<signed ref> pre-selects the purchase order ("Receive →" on the GRN list).
  const { id: initialPoId, error: linkError, loading: poLoading } = useRecordId(searchParams.get('po_id'))

  // Store keepers and the Purchase team can both record a goods receipt.
  const isPurchaseTeam = user?.role === 'admin' || !!user?.apps?.some((a) => a === 'store' || a === 'purchase')

  const [pos, setPos] = useState<P2PReceivablePurchaseOrder[]>([])
  const [locations, setLocations] = useState<StoreLocation[]>([])
  const [poId, setPoId] = useState(initialPoId ? String(initialPoId) : '')
  useEffect(() => { if (initialPoId) setPoId(String(initialPoId)) }, [initialPoId])
  const [storeLocationId, setStoreLocationId] = useState('')
  const [receivedDate, setReceivedDate] = useState(new Date().toLocaleDateString('en-CA')) // local date, not UTC
  const [remarks, setRemarks] = useState('')
  const [receivedQty, setReceivedQty] = useState<Record<number, string>>({})
  // Blind receipt: what the bill says, apart from what the store counted.
  const [invoiceQty, setInvoiceQty] = useState<Record<number, string>>({})
  const [lineBin, setLineBin] = useState<Record<number, string>>({})
  const [lineSerials, setLineSerials] = useState<Record<number, string>>({})
  const [docs, setDocs] = useState<GrnDocs>(emptyDocs)
  const [bins, setBins] = useState<{ id: number; code: string; name?: string | null; is_active?: boolean }[]>([])
  const [heats, setHeats] = useState<Record<number, HeatRow[]>>({})
  const [tcNote, setTcNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | string[]>('')

  useEffect(() => {
    if (!isAuthorized) return
    goodsReceiptsApi.listPendingPurchaseOrders().then(setPos).catch((err) => setError(extractErrorMessages(err, 'Failed to load purchase orders.')))
    storeApi.listLocations().then(setLocations).catch((err) => setError(extractErrorMessages(err, 'Failed to load store locations.')))
  }, [isAuthorized])

  // Putaway bins of the receiving store.
  useEffect(() => {
    if (!isAuthorized || !storeLocationId) { setBins([]); return }
    storeApi.listBins(Number(storeLocationId)).then((b: any[]) => setBins(b.filter((x) => x.is_active !== false))).catch(() => setBins([]))
    setLineBin({})
  }, [isAuthorized, storeLocationId])

  if (isLoading || !isAuthorized) return null
  if (linkError) return (<div><StoreNav /><InvalidRecordLink message={linkError} listHref="/dashboard/store/grn" listLabel="Back to goods receipts" /></div>)
  if (poLoading) return <div><StoreNav /></div>
  if (!isPurchaseTeam) {
    return (
      <div>
        <StoreNav />
        <p style={{ fontSize: 13, color: '#b91c1c' }}>Only Store or Purchase users can record a goods receipt — ask an admin to give you Store access.</p>
      </div>
    )
  }

  const selectedPo = pos.find((p) => String(p.id) === poId)

  const save = async () => {
    setError('')
    if (!poId) { setError('Select a purchase order.'); return }
    if (!storeLocationId) { setError('Pick the store the goods were received into — the GRN puts them into that store’s stock.'); return }
    const items = (selectedPo?.items || [])
      .map((it) => ({
        po_item_id: it.id, received_quantity: Number(receivedQty[it.id] || 0),
        invoice_quantity: invoiceQty[it.id] !== undefined && invoiceQty[it.id] !== '' ? Number(invoiceQty[it.id]) : undefined,
        bin_id: lineBin[it.id] ? Number(lineBin[it.id]) : undefined,
        serials: it.serial_controlled ? splitSerials(lineSerials[it.id] || '') : [],
        batches: it.batch_controlled ? (heats[it.id] || []).filter((h) => h.heat_number.trim() || h.quantity).map((h) => ({
          heat_number: h.heat_number.trim(), quantity: Number(h.quantity || 0), tc_number: h.tc_number.trim() || undefined,
          mfg_date: h.mfg_date || undefined, expiry_date: h.expiry_date || undefined,
        })) : [],
      }))
      .filter((it) => it.received_quantity > 0)
    if (items.length === 0) { setError('Enter a received quantity for at least one item.'); return }
    for (const it of items) {
      const line = selectedPo?.items.find((l) => l.id === it.po_item_id)
      if (line?.serial_controlled && it.serials.length !== it.received_quantity) {
        setError(`'${line.item_name}' is serial-numbered — enter ${it.received_quantity} serial number(s), one per unit (${it.serials.length} entered).`); return
      }
      if (docs.vendor_invoice_number.trim() && !docs.vendor_invoice_date) { setError('Enter the vendor invoice date too — it is printed next to the invoice number on the bill.'); return }
      if (!line?.batch_controlled) continue
      const sum = it.batches.reduce((a, b) => a + b.quantity, 0)
      if (!it.batches.length) { setError(`'${line.item_name}' is batch-tracked — add the vendor's heat / batch number(s) with their quantities and mill TC number.`); return }
      if (Math.abs(sum - it.received_quantity) > 1e-6) { setError(`'${line.item_name}': the heats add up to ${sum} but ${it.received_quantity} is received — they must match.`); return }
    }

    setBusy(true)
    try {
      const grn = await goodsReceiptsApi.create({
        purchase_order_id: Number(poId),
        store_location_id: storeLocationId ? Number(storeLocationId) : undefined,
        received_date: receivedDate,
        remarks: remarks.trim() || undefined,
        ...Object.fromEntries(Object.entries(docs).filter(([, v]) => String(v).trim()).map(([k, v]) => [k, String(v).trim()])),
        items,
      })
      // Mill TC scans go up after the GRN exists; a failed upload doesn't undo the receipt.
      const failed: string[] = []
      for (const line of grn.items || []) {
        const rows = heats[line.po_item_id] || []
        for (const b of line.batches || []) {
          const row = rows.find((h) => h.heat_number.trim().toLowerCase() === String(b.heat_number || '').toLowerCase())
          if (row?.tc_file) {
            try { await storeBatchesApi.uploadTc(b.id, row.tc_file) } catch { failed.push(String(b.heat_number)) }
          }
        }
      }
      if (failed.length) {
        setTcNote(`GRN ${grn.grn_number} is saved, but the mill TC for heat ${failed.join(', ')} couldn't be uploaded — attach it from Store › Batches.`)
        return
      }
      router.push(recordPath('/dashboard/store/grn', grn))
    } catch (err: any) {
      setError(extractErrorMessages(err, 'Failed to record goods receipt.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <FormPage nav={<StoreNav />} icon="truck" title="Record Goods Receipt" subtitle="Goods received against a purchase order — count what arrived; Quality inspection follows."
      onBack={() => router.push('/dashboard/store/grn')} backTour="store-grn-form-back-btn"
      footer={<>
        <button data-tour="store-grn-form-cancel-btn" type="button" disabled={busy} onClick={() => router.push('/dashboard/store/grn')} style={sheetBtn('secondary', SHEET.INK, busy)}>Cancel</button>
        <button data-tour="store-grn-form-save-btn" type="button" disabled={busy || !selectedPo} onClick={save} style={sheetBtn('primary', SHEET.BLUE, busy || !selectedPo)}><SheetIcon name="check" size={16} />{busy ? 'Saving…' : 'Save Goods Receipt'}</button>
      </>}>
      <MessageDialog open={!!error} variant="error" title="Cannot Save Goods Receipt" message={error} onClose={() => setError('')} />
      <MessageDialog open={!!tcNote} variant="error" title="Mill TC Not Uploaded" message={tcNote} onClose={() => { setTcNote(''); router.push('/dashboard/store/grn') }} />

      <SheetColumns
        left={<>
          <SheetSection icon="cart" title="Receipt">
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14 }}>
          <div data-tour="store-grn-form-po" style={{ flex: '1 1 320px', minWidth: 260 }}>
            <label style={labelStyle}>Purchase Order <Req /></label>
            <SearchableSelect
              value={poId}
              onChange={(v) => { setPoId(v); setReceivedQty({}) }}
              options={pos.map((p) => ({ value: String(p.id), label: `${p.po_number} — ${p.vendor_name || 'No vendor'}${p.p2p_number ? ` (${p.p2p_number})` : ''}` }))}
              placeholder="Search a purchase order awaiting receipt…"
            />
          </div>
          <div data-tour="store-grn-form-location" style={{ flex: '0 1 220px', minWidth: 200 }}>
            <label style={labelStyle}>Store Location <Req /></label>
            <select style={inputStyle} value={storeLocationId} onChange={(e) => setStoreLocationId(e.target.value)}>
              <option value="">— select the receiving store —</option>
              {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          </div>
          <div data-tour="store-grn-form-date" style={{ flex: '0 1 180px', minWidth: 160 }}>
            <label style={labelStyle}>Received Date <Req /></label>
            <DateField value={receivedDate} onChange={setReceivedDate} />
          </div>
            </div>
          </SheetSection>
          {selectedPo && (
            <div data-tour="store-grn-form-docs">
              <SheetSection icon="doc" title="Gate Entry & Vendor Documents">
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
            <div style={{ flex: '0 1 170px', minWidth: 150 }}>
              <label style={labelStyle}>Gate Entry No.</label>
              <input style={inputStyle} value={docs.gate_entry_number} onChange={(e) => setDocs({ ...docs, gate_entry_number: e.target.value })} placeholder="Auto if blank" />
            </div>
            <div style={{ flex: '1 1 180px', maxWidth: 260 }}>
              <label style={labelStyle}>Vendor Invoice No.</label>
              <input style={inputStyle} value={docs.vendor_invoice_number} onChange={(e) => setDocs({ ...docs, vendor_invoice_number: e.target.value })} placeholder="As on the bill" />
            </div>
            <div style={{ flex: '0 1 160px', minWidth: 150 }}>
              <label style={labelStyle}>Invoice Date</label>
              <DateField value={docs.vendor_invoice_date} onChange={(v) => setDocs({ ...docs, vendor_invoice_date: v })} />
            </div>
            <div style={{ flex: '1 1 160px', maxWidth: 240 }}>
              <label style={labelStyle}>Delivery Challan No.</label>
              <input style={inputStyle} value={docs.delivery_challan_number} onChange={(e) => setDocs({ ...docs, delivery_challan_number: e.target.value })} />
            </div>
            <div style={{ flex: '0 1 160px', minWidth: 150 }}>
              <label style={labelStyle}>Challan Date</label>
              <DateField value={docs.delivery_challan_date} onChange={(v) => setDocs({ ...docs, delivery_challan_date: v })} />
            </div>
            <div style={{ flex: '0 1 170px', minWidth: 150 }}>
              <label style={labelStyle}>E-way Bill No.</label>
              <input style={inputStyle} value={docs.eway_bill_number} onChange={(e) => setDocs({ ...docs, eway_bill_number: e.target.value })} placeholder="12 digits" />
            </div>
            <div style={{ flex: '0 1 150px', minWidth: 140 }}>
              <label style={labelStyle}>Vehicle No.</label>
              <input style={inputStyle} value={docs.vehicle_number} onChange={(e) => setDocs({ ...docs, vehicle_number: e.target.value })} placeholder="MH12AB1234" />
            </div>
            <div style={{ flex: '1 1 180px', maxWidth: 280 }}>
              <label style={labelStyle}>Transporter</label>
              <input style={inputStyle} value={docs.transporter_name} onChange={(e) => setDocs({ ...docs, transporter_name: e.target.value })} />
            </div>
            <div style={{ flex: '0 1 140px', minWidth: 130 }}>
              <label style={labelStyle}>LR No.</label>
              <input style={inputStyle} value={docs.lr_number} onChange={(e) => setDocs({ ...docs, lr_number: e.target.value })} />
            </div>
          </div>
                <p style={sheetHint}>A vendor invoice number can be received only once per vendor. The gate entry number is generated when left blank.</p>
              </SheetSection>
            </div>
          )}
        </>}
        right={<>
          <SheetSection icon="chat" title="Remarks" extra={<Optional />}>
            <div data-tour="store-grn-form-remarks">
              <textarea style={{ ...inputStyle, minHeight: 72, resize: 'vertical' }} value={remarks} onChange={(e) => setRemarks(e.target.value)} placeholder="Condition on arrival, packing, etc." />
            </div>
          </SheetSection>
          <SheetSection icon="alert" title="Blind Receipt">
            <p style={{ fontSize: 12.5, color: SHEET.MUTED, margin: 0, lineHeight: 1.55 }}>
              Count the goods and enter what actually arrived — the Invoice Qty is what the vendor&apos;s bill says, and the difference shows as Variance.
              Anything less than pending stays open on the PO and Purchase is notified of the balance due from the vendor.
              Quality inspection (accepted/rejected quantities) is recorded as a separate step after this receipt is saved.
            </p>
          </SheetSection>
        </>}
      />

      {selectedPo && (
        <div style={{ padding: '20px 24px', borderTop: `1px solid ${SHEET.LINE}` }}>
          <SheetSection icon="box" title="Line Items" extra={
            <button
              type="button"
              data-tour="store-grn-form-fill-btn"
              onClick={() => setInvoiceQty(Object.fromEntries(selectedPo.items.filter((it) => it.pending_quantity > 0).map((it) => [it.id, String(it.pending_quantity)])))}
              style={{ ...sheetBtn('secondary', SHEET.INK), padding: '6px 12px', fontSize: 12, marginLeft: 'auto' }}
            >
              Invoice qty = pending
            </button>
          }>
          <div data-tour="store-grn-form-lines" style={{ overflow: 'auto', border: `1px solid ${SHEET.LINE}`, borderRadius: 12 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 860 }}>
              <thead>
                <tr>
                  {['Item', 'Unit', 'Ordered Qty', 'Already Received', 'Pending', 'Invoice Qty', 'Received Now *', 'Variance', 'Bin'].map((h) => (
                    <th key={h} style={{ textAlign: 'left', padding: '8px 10px', fontSize: 11.5, fontWeight: 700, letterSpacing: '.04em', textTransform: 'uppercase', color: TEXT.muted, background: SHEET.SOFT, borderBottom: `1px solid ${BORDER.normal}` }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {selectedPo.items.map((it) => {
                  const now = Number(receivedQty[it.id] || 0)
                  const balance = it.pending_quantity - now
                  const inv = invoiceQty[it.id] !== undefined && invoiceQty[it.id] !== '' ? Number(invoiceQty[it.id]) : null
                  const variance = inv !== null && receivedQty[it.id] ? +(now - inv).toFixed(3) : null
                  return (
                  <tr key={it.id} style={{ opacity: it.pending_quantity <= 0 ? 0.5 : 1 }}>
                    <td style={{ padding: '8px 10px', fontSize: 13, color: TEXT.body, borderBottom: `1px solid ${BORDER.normal}` }}>
                      {it.item_name}
                      {it.order_project_number && (
                        <div style={{ marginTop: 4 }}><OrderProjectChip opNumber={it.order_project_number} elementNo={it.order_project_element_no} label={it.order_project_element_label} /></div>
                      )}
                    </td>
                    <td style={{ padding: '8px 10px', fontSize: 13, color: TEXT.body, borderBottom: `1px solid ${BORDER.normal}` }}>{it.unit || '—'}</td>
                    <td style={{ padding: '8px 10px', fontSize: 13, color: TEXT.body, borderBottom: `1px solid ${BORDER.normal}` }}>{it.quantity}</td>
                    <td style={{ padding: '8px 10px', fontSize: 13, color: TEXT.body, borderBottom: `1px solid ${BORDER.normal}` }}>{it.received_quantity}</td>
                    <td style={{ padding: '8px 10px', fontSize: 13, fontWeight: 600, color: it.pending_quantity > 0 ? '#d97706' : '#16a34a', borderBottom: `1px solid ${BORDER.normal}` }}>
                      {it.pending_quantity > 0 ? it.pending_quantity : 'Received'}
                    </td>
                    <td style={{ padding: '8px 10px', borderBottom: `1px solid ${BORDER.normal}` }}>
                      <input
                        type="number" min={0} step="any" disabled={it.pending_quantity <= 0}
                        value={invoiceQty[it.id] || ''}
                        onChange={(e) => setInvoiceQty((q) => ({ ...q, [it.id]: e.target.value }))}
                        style={{ ...inputStyle, width: 95 }} placeholder="As billed"
                      />
                    </td>
                    <td style={{ padding: '8px 10px', borderBottom: `1px solid ${BORDER.normal}` }}>
                      <input
                        type="number" min={0} max={it.pending_quantity} step="any"
                        disabled={it.pending_quantity <= 0}
                        value={receivedQty[it.id] || ''}
                        onChange={(e) => setReceivedQty((q) => ({ ...q, [it.id]: e.target.value }))}
                        style={{ ...inputStyle, width: 110 }}
                        placeholder="0"
                      />
                      {now > 0 && balance > 1e-9 && (
                        <div style={{ fontSize: 11, color: '#d97706', marginTop: 4 }}>Short by {+balance.toFixed(3)} — stays pending from vendor</div>
                      )}
                      {now > it.pending_quantity + 1e-9 && (
                        <div style={{ fontSize: 11, color: '#b91c1c', marginTop: 4 }}>More than pending ({it.pending_quantity})</div>
                      )}
                      {it.batch_controlled && now > 0 && (
                        <HeatRows rows={heats[it.id] || [emptyHeat()]} received={now} expiry={!!it.expiry_controlled}
                          onChange={(rows) => setHeats((h) => ({ ...h, [it.id]: rows }))} />
                      )}
                      {it.serial_controlled && now > 0 && (
                        <div style={{ marginTop: 8, minWidth: 220 }}>
                          <div style={{ fontSize: 11.5, fontWeight: 700, color: TEXT.secondary, marginBottom: 4 }}>
                            Serial numbers — one per unit ({splitSerials(lineSerials[it.id] || '').length} of {now})
                          </div>
                          <textarea style={{ ...inputStyle, minHeight: 56, fontSize: 12.5 }} value={lineSerials[it.id] || ''}
                            onChange={(e) => setLineSerials((s) => ({ ...s, [it.id]: e.target.value }))}
                            placeholder={'One per line, as on the name plate\ne.g. ENG-45821'} />
                        </div>
                      )}
                    </td>
                    <td style={{ padding: '8px 10px', fontSize: 13, fontWeight: 600, borderBottom: `1px solid ${BORDER.normal}`,
                      color: variance === null ? TEXT.muted : variance < 0 ? '#b91c1c' : variance > 0 ? '#d97706' : '#16a34a' }}>
                      {variance === null ? '—' : variance === 0 ? 'Matches' : variance < 0 ? `Short ${-variance}` : `Excess ${variance}`}
                    </td>
                    <td style={{ padding: '8px 10px', borderBottom: `1px solid ${BORDER.normal}` }}>
                      <select style={{ ...inputStyle, width: 130 }} value={lineBin[it.id] || ''} disabled={!bins.length}
                        onChange={(e) => setLineBin((b) => ({ ...b, [it.id]: e.target.value }))}>
                        <option value="">{bins.length ? '— no bin —' : 'No bins'}</option>
                        {bins.map((b) => <option key={b.id} value={b.id}>{b.code}{b.name ? ` — ${b.name}` : ''}</option>)}
                      </select>
                    </td>
                  </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          </SheetSection>
        </div>
      )}
    </FormPage>
  )
}
