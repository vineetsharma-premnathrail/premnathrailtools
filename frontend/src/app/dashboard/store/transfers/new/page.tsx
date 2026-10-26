'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { storeApi } from '@/lib/api'
import { StoreItem, StoreLocation } from '@/types'
import { FormPage, SheetColumns, SheetSection, SheetIcon, Optional, Req, SHEET, sheetBtn, sheetInput, sheetLabel } from '@/components/shared/FormSheet'
import StoreNav from '@/components/store/StoreNav'
import { recordPath } from '@/lib/recordRef'
import MessageDialog from '@/components/erp/MessageDialog'
import SearchableSelect from '@/components/erp/SearchableSelect'
import { extractErrorMessages } from '@/lib/validation'
import Select from '@/components/shared/Select'
import { CONTROL } from '@/lib/theme'

interface Line { itemId: string; quantity: string; batchNumber: string }

export default function NewStockTransferPage() {
  const { isAuthorized, isLoading } = useRequireApp('store')
  const router = useRouter()

  const [items, setItems] = useState<StoreItem[]>([])
  const [locations, setLocations] = useState<StoreLocation[]>([])
  // Destination may be another plant's store (inter-unit transfer), so it
  // lists every plant; the source stays limited to the user's own plant.
  const [toLocations, setToLocations] = useState<StoreLocation[]>([])

  const [fromLocationId, setFromLocationId] = useState('')
  const [toLocationId, setToLocationId] = useState('')
  const [reason, setReason] = useState('')
  const [remarks, setRemarks] = useState('')
  const [lines, setLines] = useState<Line[]>([{ itemId: '', quantity: '', batchNumber: '' }])

  const [busy, setBusy] = useState(false)
  const [errors, setErrors] = useState<string[]>([])
  const [loadErrors, setLoadErrors] = useState<string[]>([])

  // Load failures go to the error dialog with the server's reason, so an
  // empty dropdown never hides why (e.g. a Store data-access 403).
  const loadFailed = (what: string) => (err: unknown) =>
    setLoadErrors((prev) => [...prev, ...extractErrorMessages(err, 'The server did not respond — check your connection and reload the page.').map((m) => `Couldn't load ${what}: ${m}`)])

  useEffect(() => {
    if (!isAuthorized) return
    storeApi.listItems().then(setItems).catch(loadFailed('items'))
    storeApi.listLocations().then(setLocations).catch(loadFailed('your stores'))
    storeApi.listLocations(undefined, { allPlants: true }).then(setToLocations).catch(loadFailed('destination stores'))
  }, [isAuthorized])

  const updateLine = (idx: number, patch: Partial<Line>) => setLines((prev) => prev.map((l, i) => (i === idx ? { ...l, ...patch } : l)))
  const addLine = () => setLines((prev) => [...prev, { itemId: '', quantity: '', batchNumber: '' }])
  const removeLine = (idx: number) => setLines((prev) => prev.filter((_, i) => i !== idx))

  const save = async () => {
    const problems: string[] = []
    if (!fromLocationId) problems.push('Source store is required.')
    if (!toLocationId) problems.push('Destination store is required.')
    if (fromLocationId && toLocationId && fromLocationId === toLocationId) problems.push('Source and destination store must be different.')
    const validLines = lines.filter((l) => l.itemId && l.quantity)
    if (!validLines.length) problems.push('At least one item is required.')
    for (const l of validLines) {
      if (Number(l.quantity) <= 0) problems.push('Every item quantity must be greater than zero.')
    }
    if (problems.length) {
      setErrors(problems)
      return
    }
    setBusy(true)
    setErrors([])
    try {
      const transfer = await storeApi.createStockTransfer({
        from_location_id: Number(fromLocationId),
        to_location_id: Number(toLocationId),
        reason: reason.trim() || undefined,
        remarks: remarks.trim() || undefined,
        items: validLines.map((l) => ({
          item_id: Number(l.itemId),
          quantity: Number(l.quantity),
          batch_number: l.batchNumber.trim() || undefined,
        })),
      })
      router.push(recordPath('/dashboard/store/transfers', transfer))
    } catch (err) {
      setErrors(extractErrorMessages(err, 'Failed to create stock transfer.'))
    } finally {
      setBusy(false)
    }
  }

  if (isLoading || !isAuthorized) return null

  return (
    <FormPage nav={<StoreNav />} icon="truck" title="New Stock Transfer" subtitle="Move stock from one store to another — approval, dispatch, then receipt."
      onBack={() => router.push('/dashboard/store/transfers')} backTour="transfer-back-btn"
      footer={<>
        <button data-tour="transfer-cancel-btn" type="button" disabled={busy} onClick={() => router.push('/dashboard/store/transfers')} style={sheetBtn('secondary', SHEET.INK, busy)}>Cancel</button>
        <button data-tour="transfer-save-btn" type="button" disabled={busy} onClick={save} style={sheetBtn('primary', SHEET.BLUE, busy)}><SheetIcon name="send" size={16} />{busy ? 'Submitting…' : 'Submit for Approval'}</button>
      </>}>
      <MessageDialog open={errors.length > 0} variant="error" title="Cannot Save Stock Transfer" message={errors} onClose={() => setErrors([])} />
      <MessageDialog open={loadErrors.length > 0} variant="error" title="Couldn't Load Form Data" message={loadErrors} onClose={() => setLoadErrors([])} />

      <SheetColumns
        left={
          <SheetSection icon="building" title="Transfer Details">
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
              <div style={{ flex: '1 1 200px' }}>
                <label style={sheetLabel}>From Store <Req /></label>
                <Select data-tour="transfer-from" style={sheetInput} value={fromLocationId} onChange={(e) => setFromLocationId(e.target.value)}>
                  <option value="">— Select —</option>
                  {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                </Select>
              </div>
              <div style={{ flex: '1 1 200px' }}>
                <label style={sheetLabel}>To Store <Req /></label>
                <Select data-tour="transfer-to" style={sheetInput} value={toLocationId} onChange={(e) => setToLocationId(e.target.value)}>
                  <option value="">— Select —</option>
                  {toLocations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                </Select>
              </div>
            </div>
            <label style={{ ...sheetLabel, marginTop: 14 }}>Reason <Optional /></label>
            <input data-tour="transfer-reason" style={sheetInput} value={reason} onChange={(e) => setReason(e.target.value)} />
          </SheetSection>
        }
        right={<>
          <SheetSection icon="chat" title="Remarks" extra={<Optional />}>
            <textarea data-tour="transfer-remarks" style={{ ...sheetInput, minHeight: 72, resize: 'vertical' }} value={remarks} onChange={(e) => setRemarks(e.target.value)} />
          </SheetSection>
          <SheetSection icon="alert" title="What Happens Next">
            <p style={{ fontSize: 12.5, color: SHEET.MUTED, margin: 0, lineHeight: 1.55 }}>
              Nothing moves yet: the transfer goes to the sending store&apos;s manager for approval, then the sending store dispatches it
              with the Stock Transfer Note and the receiving store confirms receipt.
            </p>
          </SheetSection>
        </>}
      />

      <div style={{ padding: '20px 24px', borderTop: `1px solid ${SHEET.LINE}` }}>
        <SheetSection icon="box" title="Items">
          {lines.map((line, idx) => (
            <div key={idx} style={{ display: 'flex', gap: 10, alignItems: 'flex-end', marginBottom: 10, flexWrap: 'wrap' }}>
              <div style={{ flex: '1 1 300px' }}>
                {idx === 0 && <label style={sheetLabel}>Item <Req /></label>}
                <div {...(idx === 0 ? { 'data-tour': 'transfer-item' } : {})}>
                  <SearchableSelect value={line.itemId} onChange={(v) => updateLine(idx, { itemId: v })} placeholder="Search item code or name…"
                    options={items.map((i) => ({ value: String(i.id), label: `${i.item_code} — ${i.item_name}` }))} />
                </div>
              </div>
              <div style={{ flex: '0 0 130px' }}>
                {idx === 0 && <label style={sheetLabel}>Quantity <Req /></label>}
                <input {...(idx === 0 ? { 'data-tour': 'transfer-quantity' } : {})} type="number" style={sheetInput} value={line.quantity} onChange={(e) => updateLine(idx, { quantity: e.target.value })} />
              </div>
              <div style={{ flex: '0 0 160px' }}>
                {idx === 0 && <label style={sheetLabel}>Batch #</label>}
                <input {...(idx === 0 ? { 'data-tour': 'transfer-batch' } : {})} style={sheetInput} value={line.batchNumber} onChange={(e) => updateLine(idx, { batchNumber: e.target.value })} />
              </div>
              <button type="button" aria-label="Remove line" {...(idx === 0 ? { 'data-tour': 'transfer-remove-line-btn' } : {})} onClick={() => removeLine(idx)} disabled={lines.length === 1}
                style={{ ...sheetBtn('secondary', SHEET.INK, lines.length === 1), padding: 0, width: CONTROL.height, height: CONTROL.height, justifyContent: 'center', flex: 'none' }}><SheetIcon name="trash" size={15} /></button>
            </div>
          ))}
          <button type="button" data-tour="transfer-add-item-btn" onClick={addLine} style={sheetBtn('ghost', SHEET.BLUE)}><SheetIcon name="plus" size={15} />Add Item</button>
        </SheetSection>
      </div>
    </FormPage>
  )
}
