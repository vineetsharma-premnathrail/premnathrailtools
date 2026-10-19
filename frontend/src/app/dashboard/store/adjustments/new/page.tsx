'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { useAssigneeFilter } from '@/hooks/useAssigneeFilter'
import { storeApi, usersApi } from '@/lib/api'
import { StoreItem, StoreLocation, StoreStockBalance, DirectoryUser } from '@/types'
import { FormPage, SheetColumns, SheetSection, SheetIcon, Optional, Req, SHEET, sheetBtn, sheetInput, sheetLabel } from '@/components/shared/FormSheet'
import SearchableSelect from '@/components/erp/SearchableSelect'
import StoreNav from '@/components/store/StoreNav'
import { recordPath } from '@/lib/recordRef'
import MessageDialog from '@/components/erp/MessageDialog'
import { extractErrorMessages } from '@/lib/validation'

interface Line { itemId: string; actualQuantity: string; remarks: string }

export default function NewStockAdjustmentPage() {
  const { isAuthorized, isLoading, user } = useRequireApp('store')
  const router = useRouter()
  // The role's assign-to rule for the approver (Role & Permissions › Store › Adjustments).
  const allowApprover = useAssigneeFilter('store:adjustments.approver')

  const [items, setItems] = useState<StoreItem[]>([])
  const [locations, setLocations] = useState<StoreLocation[]>([])
  const [directory, setDirectory] = useState<DirectoryUser[]>([])
  const [balances, setBalances] = useState<StoreStockBalance[]>([])

  const [locationId, setLocationId] = useState('')
  const [approvedById, setApprovedById] = useState('')
  const [reason, setReason] = useState('')
  const [remarks, setRemarks] = useState('')
  const [lines, setLines] = useState<Line[]>([{ itemId: '', actualQuantity: '', remarks: '' }])

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
    storeApi.listLocations().then(setLocations).catch(loadFailed('stores'))
    usersApi.directory().then(setDirectory).catch(loadFailed('the approver list'))
  }, [isAuthorized])

  useEffect(() => {
    if (!locationId) {
      setBalances([])
      return
    }
    storeApi.listStockBalances({ location_id: Number(locationId) }).then(setBalances).catch(loadFailed('stock balances for this store'))
  }, [locationId])

  const existingQtyFor = (itemId: string) => {
    if (!itemId) return null
    const bal = balances.find((b) => String(b.item_id) === itemId)
    return bal ? bal.on_hand_qty : 0
  }

  const updateLine = (idx: number, patch: Partial<Line>) => setLines((prev) => prev.map((l, i) => (i === idx ? { ...l, ...patch } : l)))
  const addLine = () => setLines((prev) => [...prev, { itemId: '', actualQuantity: '', remarks: '' }])
  const removeLine = (idx: number) => setLines((prev) => prev.filter((_, i) => i !== idx))

  const save = async () => {
    const problems: string[] = []
    if (!locationId) problems.push('Store is required.')
    if (!approvedById) problems.push('Approver is required — pick who must approve this adjustment before it changes stock.')
    const validLines = lines.filter((l) => l.itemId && l.actualQuantity !== '')
    if (!validLines.length) problems.push('At least one item is required.')
    for (const l of validLines) {
      if (Number(l.actualQuantity) < 0) problems.push('Actual quantity cannot be negative.')
    }
    if (problems.length) {
      setErrors(problems)
      return
    }
    setBusy(true)
    setErrors([])
    try {
      const adjustment = await storeApi.createStockAdjustment({
        location_id: Number(locationId),
        approved_by_id: Number(approvedById),
        reason: reason.trim() || undefined,
        remarks: remarks.trim() || undefined,
        items: validLines.map((l) => ({
          item_id: Number(l.itemId),
          actual_quantity: Number(l.actualQuantity),
          remarks: l.remarks.trim() || undefined,
        })),
      })
      router.push(recordPath('/dashboard/store/adjustments', adjustment))
    } catch (err) {
      setErrors(extractErrorMessages(err, 'Failed to create stock adjustment.'))
    } finally {
      setBusy(false)
    }
  }

  if (isLoading || !isAuthorized) return null

  return (
    <FormPage nav={<StoreNav />} icon="edit" title="New Stock Adjustment" subtitle="Correct the book quantity to what is physically there — an approver signs it off before stock changes."
      onBack={() => router.push('/dashboard/store/adjustments')} backTour="adjustment-back-btn"
      footer={<>
        <button data-tour="adjustment-cancel-btn" type="button" disabled={busy} onClick={() => router.push('/dashboard/store/adjustments')} style={sheetBtn('secondary', SHEET.INK, busy)}>Cancel</button>
        <button data-tour="adjustment-save-btn" type="button" disabled={busy} onClick={save} style={sheetBtn('primary', SHEET.BLUE, busy)}><SheetIcon name="send" size={16} />{busy ? 'Saving…' : 'Send for Approval'}</button>
      </>}>
      <MessageDialog open={errors.length > 0} variant="error" title="Cannot Save Stock Adjustment" message={errors} onClose={() => setErrors([])} />
      <MessageDialog open={loadErrors.length > 0} variant="error" title="Couldn't Load Form Data" message={loadErrors} onClose={() => setLoadErrors([])} />

      <SheetColumns
        left={
          <SheetSection icon="list" title="Adjustment Details">
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
              <div style={{ flex: '1 1 200px' }}>
                <label style={sheetLabel}>Store <Req /></label>
                <select data-tour="adjustment-location" style={sheetInput} value={locationId} onChange={(e) => { setLocationId(e.target.value); setLines([{ itemId: '', actualQuantity: '', remarks: '' }]) }}>
                  <option value="">— Select —</option>
                  {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                </select>
              </div>
              <div style={{ flex: '1 1 240px' }}>
                <label style={sheetLabel}>Approver <Req /></label>
                <div data-tour="adjustment-approver">
                  {/* You can't approve your own adjustment (the backend refuses it
                      too), so you're left out of the list. */}
                  <SearchableSelect
                    value={approvedById}
                    onChange={setApprovedById}
                    options={directory.filter((u) => u.id !== user?.id && allowApprover(u.id)).map((u) => ({ value: String(u.id), label: `${u.name} — ${u.email}` }))}
                    placeholder="Search name or email…"
                  />
                </div>
              </div>
            </div>
            <label style={{ ...sheetLabel, marginTop: 14 }}>Reason <Optional /></label>
            <input data-tour="adjustment-reason" style={sheetInput} value={reason} onChange={(e) => setReason(e.target.value)} />
          </SheetSection>
        }
        right={
          <SheetSection icon="chat" title="Remarks" extra={<Optional />}>
            <textarea data-tour="adjustment-remarks" style={{ ...sheetInput, minHeight: 90, resize: 'vertical' }} value={remarks} onChange={(e) => setRemarks(e.target.value)} />
          </SheetSection>
        }
      />

      <div style={{ padding: '20px 24px', borderTop: `1px solid ${SHEET.LINE}` }}>
        <SheetSection icon="box" title="Items">
          {!locationId && <p style={{ fontSize: 12.5, color: SHEET.MUTED, margin: '0 0 10px' }}>Select a store first to see current system quantities.</p>}
          {lines.map((line, idx) => {
            const existingQty = existingQtyFor(line.itemId)
            return (
              <div key={idx} style={{ display: 'flex', gap: 10, alignItems: 'flex-end', marginBottom: 10, flexWrap: 'wrap' }}>
                <div style={{ flex: '1 1 280px' }}>
                  {idx === 0 && <label style={sheetLabel}>Item <Req /></label>}
                  <select {...(idx === 0 ? { 'data-tour': 'adjustment-item' } : {})} style={sheetInput} value={line.itemId} onChange={(e) => updateLine(idx, { itemId: e.target.value })} disabled={!locationId}>
                    <option value="">— Select —</option>
                    {items.map((i) => <option key={i.id} value={i.id}>{i.item_code} — {i.item_name}</option>)}
                  </select>
                </div>
                <div style={{ flex: '0 0 120px' }}>
                  {idx === 0 && <label style={sheetLabel}>Existing Qty</label>}
                  <div {...(idx === 0 ? { 'data-tour': 'adjustment-existing-qty' } : {})} style={{ ...sheetInput, background: SHEET.SOFT, color: SHEET.MUTED }}>{existingQty ?? '—'}</div>
                </div>
                <div style={{ flex: '0 0 120px' }}>
                  {idx === 0 && <label style={sheetLabel}>Actual Qty <Req /></label>}
                  <input {...(idx === 0 ? { 'data-tour': 'adjustment-actual-qty' } : {})} type="number" style={sheetInput} value={line.actualQuantity} onChange={(e) => updateLine(idx, { actualQuantity: e.target.value })} />
                </div>
                <div style={{ flex: '0 0 90px', fontSize: 13, fontWeight: 700, paddingBottom: 10, color: line.actualQuantity === '' ? SHEET.MUTED : Number(line.actualQuantity) - (existingQty ?? 0) === 0 ? SHEET.MUTED : Number(line.actualQuantity) - (existingQty ?? 0) > 0 ? '#16A34A' : '#b91c1c' }}>
                  {line.actualQuantity !== '' && existingQty != null ? (Number(line.actualQuantity) - existingQty > 0 ? '+' : '') + (Number(line.actualQuantity) - existingQty) : ''}
                </div>
                <button type="button" aria-label="Remove line" {...(idx === 0 ? { 'data-tour': 'adjustment-remove-line-btn' } : {})} onClick={() => removeLine(idx)} disabled={lines.length === 1}
                  style={{ ...sheetBtn('secondary', SHEET.INK, lines.length === 1), padding: '9px 11px' }}><SheetIcon name="trash" size={15} /></button>
              </div>
            )
          })}
          <button type="button" data-tour="adjustment-add-item-btn" onClick={addLine} disabled={!locationId} style={sheetBtn('ghost', SHEET.BLUE, !locationId)}><SheetIcon name="plus" size={15} />Add Item</button>
        </SheetSection>
      </div>
    </FormPage>
  )
}
