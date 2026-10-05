'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { storeApi } from '@/lib/api'
import { StoreItem, StoreLocation } from '@/types'
import { TEXT } from '@/lib/theme'
import { Field, Section, Row, inputStyle, primaryBtnStyle, secondaryBtnStyle } from '@/components/shared/ui'
import StoreNav from '@/components/store/StoreNav'
import MessageDialog from '@/components/erp/MessageDialog'
import SearchableSelect from '@/components/erp/SearchableSelect'
import { extractErrorMessages } from '@/lib/validation'

interface Line { itemId: string; quantity: string; batchNumber: string }

export default function NewStockTransferPage() {
  const { isAuthorized, isLoading } = useRequireApp('store')
  const router = useRouter()

  const [items, setItems] = useState<StoreItem[]>([])
  const [locations, setLocations] = useState<StoreLocation[]>([])

  const [fromLocationId, setFromLocationId] = useState('')
  const [toLocationId, setToLocationId] = useState('')
  const [reason, setReason] = useState('')
  const [remarks, setRemarks] = useState('')
  const [lines, setLines] = useState<Line[]>([{ itemId: '', quantity: '', batchNumber: '' }])

  const [busy, setBusy] = useState(false)
  const [errors, setErrors] = useState<string[]>([])

  useEffect(() => {
    if (!isAuthorized) return
    storeApi.listItems().then(setItems).catch(() => setItems([]))
    storeApi.listLocations().then(setLocations).catch(() => setLocations([]))
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
      router.push(`/dashboard/store/transfers/${transfer.id}`)
    } catch (err) {
      setErrors(extractErrorMessages(err, 'Failed to create stock transfer.'))
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
          <h1 style={{ fontSize: 22, fontWeight: 700, color: TEXT.heading, margin: 0 }}>New Stock Transfer</h1>
        </div>
        <button type="button" data-tour="transfer-back-btn" onClick={() => router.push('/dashboard/store/transfers')} style={secondaryBtnStyle}>← Back</button>
      </div>

      <MessageDialog open={errors.length > 0} variant="error" title="Cannot Save Stock Transfer" message={errors} onClose={() => setErrors([])} />

      <Section title="Transfer Details" style={{ marginBottom: 20 }}>
        <Row>
          <Field label="From Store *">
            <select data-tour="transfer-from" style={inputStyle} value={fromLocationId} onChange={(e) => setFromLocationId(e.target.value)}>
              <option value="">— Select —</option>
              {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          </Field>
          <Field label="To Store *">
            <select data-tour="transfer-to" style={inputStyle} value={toLocationId} onChange={(e) => setToLocationId(e.target.value)}>
              <option value="">— Select —</option>
              {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
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
        {lines.map((line, idx) => (
          <div key={idx} style={{ display: 'flex', gap: 10, alignItems: 'flex-end', marginBottom: 4 }}>
            <div style={{ flex: '1 1 260px' }}>
              <label style={{ fontSize: 11, fontWeight: 700, color: TEXT.secondary, marginBottom: 6, display: 'block' }}>Item</label>
              <div {...(idx === 0 ? { 'data-tour': 'transfer-item' } : {})}>
                <SearchableSelect value={line.itemId} onChange={(v) => updateLine(idx, { itemId: v })} placeholder="Search item code or name…"
                  options={items.map((i) => ({ value: String(i.id), label: `${i.item_code} — ${i.item_name}` }))} />
              </div>
            </div>
            <div style={{ flex: '0 0 120px' }}>
              <label style={{ fontSize: 11, fontWeight: 700, color: TEXT.secondary, marginBottom: 6, display: 'block' }}>Quantity</label>
              <input {...(idx === 0 ? { 'data-tour': 'transfer-quantity' } : {})} type="number" style={inputStyle} value={line.quantity} onChange={(e) => updateLine(idx, { quantity: e.target.value })} />
            </div>
            <div style={{ flex: '0 0 140px' }}>
              <label style={{ fontSize: 11, fontWeight: 700, color: TEXT.secondary, marginBottom: 6, display: 'block' }}>Batch #</label>
              <input style={inputStyle} value={line.batchNumber} onChange={(e) => updateLine(idx, { batchNumber: e.target.value })} />
            </div>
            <button type="button" onClick={() => removeLine(idx)} disabled={lines.length === 1} style={{ ...secondaryBtnStyle, padding: '10px 14px', opacity: lines.length === 1 ? 0.4 : 1 }}>×</button>
          </div>
        ))}
        <button type="button" data-tour="transfer-add-item-btn" onClick={addLine} style={{ ...secondaryBtnStyle, padding: '7px 14px', fontSize: 12.5, marginTop: 8 }}>+ Add Item</button>
      </Section>

      <div style={{ display: 'flex', gap: 10 }}>
        <button data-tour="transfer-save-btn" disabled={busy} onClick={save} style={{ ...primaryBtnStyle, opacity: busy ? 0.7 : 1 }}>{busy ? 'Saving…' : 'Transfer Stock'}</button>
        <button disabled={busy} onClick={() => router.push('/dashboard/store/transfers')} style={{ ...secondaryBtnStyle, opacity: busy ? 0.6 : 1 }}>Cancel</button>
      </div>
    </div>
  )
}
