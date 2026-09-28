'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { storeApi, usersApi } from '@/lib/api'
import { StoreItem, StoreLocation, StoreStockBalance, DirectoryUser } from '@/types'
import { TEXT } from '@/lib/theme'
import { Field, Section, Row, inputStyle, primaryBtnStyle, secondaryBtnStyle } from '@/components/shared/ui'
import SearchableSelect from '@/components/erp/SearchableSelect'
import StoreNav from '@/components/store/StoreNav'
import MessageDialog from '@/components/erp/MessageDialog'
import { extractErrorMessages } from '@/lib/validation'

interface Line { itemId: string; actualQuantity: string; remarks: string }

export default function NewStockAdjustmentPage() {
  const { isAuthorized, isLoading } = useRequireApp('store')
  const router = useRouter()

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

  useEffect(() => {
    if (!isAuthorized) return
    storeApi.listItems().then(setItems).catch(() => setItems([]))
    storeApi.listLocations().then(setLocations).catch(() => setLocations([]))
    usersApi.directory().then(setDirectory).catch(() => setDirectory([]))
  }, [isAuthorized])

  useEffect(() => {
    if (!locationId) {
      setBalances([])
      return
    }
    storeApi.listStockBalances({ location_id: Number(locationId) }).then(setBalances).catch(() => setBalances([]))
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
    if (!locationId) problems.push('Warehouse is required.')
    if (!approvedById) problems.push('Approved By is required.')
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
      router.push(`/dashboard/store/adjustments/${adjustment.id}`)
    } catch (err) {
      setErrors(extractErrorMessages(err, 'Failed to create stock adjustment.'))
    } finally {
      setBusy(false)
    }
  }

  if (isLoading || !isAuthorized) return null

  return (
    <div>
      <StoreNav />

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
        <div>
          <p style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 4px' }}>
            Store &amp; Inventory
          </p>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: TEXT.heading, margin: 0 }}>New Stock Adjustment</h1>
        </div>
        <button type="button" data-tour="adjustment-back-btn" onClick={() => router.push('/dashboard/store/adjustments')} style={secondaryBtnStyle}>← Back</button>
      </div>

      <MessageDialog open={errors.length > 0} variant="error" title="Cannot Save Stock Adjustment" message={errors} onClose={() => setErrors([])} />

      <Section title="Adjustment Details" style={{ marginBottom: 20 }}>
        <Row>
          <Field label="Warehouse *">
            <select data-tour="adjustment-location" style={inputStyle} value={locationId} onChange={(e) => { setLocationId(e.target.value); setLines([{ itemId: '', actualQuantity: '', remarks: '' }]) }}>
              <option value="">— Select —</option>
              {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          </Field>
          <Field label="Approved By *">
            <div data-tour="adjustment-approver">
              <SearchableSelect
                value={approvedById}
                onChange={setApprovedById}
                options={directory.map((u) => ({ value: String(u.id), label: `${u.name} — ${u.email}` }))}
                placeholder="Search name or email…"
              />
            </div>
          </Field>
          <Field label="Reason">
            <input style={inputStyle} value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
        </Row>
        <Field label="Remarks">
          <textarea style={{ ...inputStyle, minHeight: 60, resize: 'vertical' }} value={remarks} onChange={(e) => setRemarks(e.target.value)} />
        </Field>
      </Section>

      <Section title="Items" style={{ marginBottom: 20 }}>
        {!locationId && <p style={{ fontSize: 12.5, color: TEXT.muted, margin: 0 }}>Select a warehouse first to see current system quantities.</p>}
        {lines.map((line, idx) => {
          const existingQty = existingQtyFor(line.itemId)
          return (
            <div key={idx} style={{ display: 'flex', gap: 10, alignItems: 'flex-end', marginBottom: 4, flexWrap: 'wrap' }}>
              <div style={{ flex: '1 1 240px' }}>
                <label style={{ fontSize: 11, fontWeight: 700, color: TEXT.secondary, marginBottom: 6, display: 'block' }}>Item</label>
                <select {...(idx === 0 ? { 'data-tour': 'adjustment-item' } : {})} style={inputStyle} value={line.itemId} onChange={(e) => updateLine(idx, { itemId: e.target.value })} disabled={!locationId}>
                  <option value="">— Select —</option>
                  {items.map((i) => <option key={i.id} value={i.id}>{i.item_code} — {i.item_name}</option>)}
                </select>
              </div>
              <div style={{ flex: '0 0 110px' }}>
                <label style={{ fontSize: 11, fontWeight: 700, color: TEXT.secondary, marginBottom: 6, display: 'block' }}>Existing Qty</label>
                <div {...(idx === 0 ? { 'data-tour': 'adjustment-existing-qty' } : {})} style={{ ...inputStyle, background: 'rgba(0,0,0,0.04)', color: TEXT.muted }}>{existingQty ?? '—'}</div>
              </div>
              <div style={{ flex: '0 0 110px' }}>
                <label style={{ fontSize: 11, fontWeight: 700, color: TEXT.secondary, marginBottom: 6, display: 'block' }}>Actual Qty</label>
                <input {...(idx === 0 ? { 'data-tour': 'adjustment-actual-qty' } : {})} type="number" style={inputStyle} value={line.actualQuantity} onChange={(e) => updateLine(idx, { actualQuantity: e.target.value })} />
              </div>
              <div style={{ flex: '0 0 90px', fontSize: 13, fontWeight: 700, paddingBottom: 10, color: line.actualQuantity === '' ? TEXT.muted : Number(line.actualQuantity) - (existingQty ?? 0) === 0 ? TEXT.muted : Number(line.actualQuantity) - (existingQty ?? 0) > 0 ? '#16A34A' : '#b91c1c' }}>
                {line.actualQuantity !== '' && existingQty != null ? (Number(line.actualQuantity) - existingQty > 0 ? '+' : '') + (Number(line.actualQuantity) - existingQty) : ''}
              </div>
              <button type="button" onClick={() => removeLine(idx)} disabled={lines.length === 1} style={{ ...secondaryBtnStyle, padding: '10px 14px', opacity: lines.length === 1 ? 0.4 : 1 }}>×</button>
            </div>
          )
        })}
        <button type="button" data-tour="adjustment-add-item-btn" onClick={addLine} disabled={!locationId} style={{ ...secondaryBtnStyle, padding: '7px 14px', fontSize: 12.5, marginTop: 8, opacity: locationId ? 1 : 0.5 }}>+ Add Item</button>
      </Section>

      <div style={{ display: 'flex', gap: 10 }}>
        <button data-tour="adjustment-save-btn" disabled={busy} onClick={save} style={{ ...primaryBtnStyle, opacity: busy ? 0.7 : 1 }}>{busy ? 'Saving…' : 'Post Adjustment'}</button>
        <button disabled={busy} onClick={() => router.push('/dashboard/store/adjustments')} style={{ ...secondaryBtnStyle, opacity: busy ? 0.6 : 1 }}>Cancel</button>
      </div>
    </div>
  )
}
