'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { storeApi } from '@/lib/api'
import { StoreItem, StoreLocation, StoreMaterialIssue } from '@/types'
import { TEXT } from '@/lib/theme'
import { Field, Section, Row, inputStyle, primaryBtnStyle, secondaryBtnStyle } from '@/components/shared/ui'
import StoreNav from '@/components/store/StoreNav'
import MessageDialog from '@/components/erp/MessageDialog'
import { extractErrorMessages } from '@/lib/validation'

interface Line { itemId: string; quantity: string; condition: string; batchNumber: string }

const CONDITIONS = [
  { value: 'good', label: 'Good — returns to usable stock' },
  { value: 'damaged', label: 'Damaged — excluded from usable stock' },
  { value: 'rejected', label: 'Rejected — excluded from usable stock' },
]

export default function NewMaterialReturnPage() {
  const { isAuthorized, isLoading } = useRequireApp('store')
  const router = useRouter()

  const [items, setItems] = useState<StoreItem[]>([])
  const [locations, setLocations] = useState<StoreLocation[]>([])
  const [issues, setIssues] = useState<StoreMaterialIssue[]>([])

  const [locationId, setLocationId] = useState('')
  const [sourceType, setSourceType] = useState<'issue' | 'other'>('issue')
  const [sourceIssueId, setSourceIssueId] = useState('')
  const [sourceDescription, setSourceDescription] = useState('')
  const [reason, setReason] = useState('')
  const [remarks, setRemarks] = useState('')
  const [lines, setLines] = useState<Line[]>([{ itemId: '', quantity: '', condition: 'good', batchNumber: '' }])

  const [busy, setBusy] = useState(false)
  const [errors, setErrors] = useState<string[]>([])

  useEffect(() => {
    if (!isAuthorized) return
    storeApi.listItems().then(setItems).catch(() => setItems([]))
    storeApi.listLocations().then(setLocations).catch(() => setLocations([]))
    storeApi.listMaterialIssues().then(setIssues).catch(() => setIssues([]))
  }, [isAuthorized])

  const updateLine = (idx: number, patch: Partial<Line>) => setLines((prev) => prev.map((l, i) => (i === idx ? { ...l, ...patch } : l)))
  const addLine = () => setLines((prev) => [...prev, { itemId: '', quantity: '', condition: 'good', batchNumber: '' }])
  const removeLine = (idx: number) => setLines((prev) => prev.filter((_, i) => i !== idx))

  const save = async () => {
    const problems: string[] = []
    if (!locationId) problems.push('Warehouse is required.')
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
      const ret = await storeApi.createMaterialReturn({
        location_id: Number(locationId),
        source_type: sourceType,
        source_issue_id: sourceType === 'issue' && sourceIssueId ? Number(sourceIssueId) : undefined,
        source_description: sourceType === 'other' ? sourceDescription.trim() || undefined : undefined,
        reason: reason.trim() || undefined,
        remarks: remarks.trim() || undefined,
        items: validLines.map((l) => ({
          item_id: Number(l.itemId),
          quantity: Number(l.quantity),
          condition: l.condition,
          batch_number: l.batchNumber.trim() || undefined,
        })),
      })
      router.push(`/dashboard/store/returns/${ret.id}`)
    } catch (err) {
      setErrors(extractErrorMessages(err, 'Failed to create material return.'))
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
          <h1 style={{ fontSize: 22, fontWeight: 700, color: TEXT.heading, margin: 0 }}>New Material Return</h1>
        </div>
        <button type="button" data-tour="return-back-btn" onClick={() => router.push('/dashboard/store/returns')} style={secondaryBtnStyle}>← Back</button>
      </div>

      <MessageDialog open={errors.length > 0} variant="error" title="Cannot Save Material Return" message={errors} onClose={() => setErrors([])} />

      <Section title="Return Details" style={{ marginBottom: 20 }}>
        <Row>
          <Field label="Warehouse *">
            <select data-tour="return-location" style={inputStyle} value={locationId} onChange={(e) => setLocationId(e.target.value)}>
              <option value="">— Select —</option>
              {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          </Field>
          <Field label="Source">
            <select data-tour="return-source-type" style={inputStyle} value={sourceType} onChange={(e) => setSourceType(e.target.value as 'issue' | 'other')}>
              <option value="issue">Against a Material Issue</option>
              <option value="other">Other</option>
            </select>
          </Field>
          {sourceType === 'issue' ? (
            <Field label="Material Issue">
              <select data-tour="return-source-issue" style={inputStyle} value={sourceIssueId} onChange={(e) => setSourceIssueId(e.target.value)}>
                <option value="">— Select —</option>
                {issues.map((i) => <option key={i.id} value={i.id}>{i.issue_number}</option>)}
              </select>
            </Field>
          ) : (
            <Field label="Source Description">
              <input style={inputStyle} value={sourceDescription} onChange={(e) => setSourceDescription(e.target.value)} placeholder="e.g. Site surplus return" />
            </Field>
          )}
        </Row>
        <Row>
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
          <div key={idx} style={{ display: 'flex', gap: 10, alignItems: 'flex-end', marginBottom: 4, flexWrap: 'wrap' }}>
            <div style={{ flex: '1 1 220px' }}>
              <label style={{ fontSize: 11, fontWeight: 700, color: TEXT.secondary, marginBottom: 6, display: 'block' }}>Item</label>
              <select {...(idx === 0 ? { 'data-tour': 'return-item' } : {})} style={inputStyle} value={line.itemId} onChange={(e) => updateLine(idx, { itemId: e.target.value })}>
                <option value="">— Select —</option>
                {items.map((i) => <option key={i.id} value={i.id}>{i.item_code} — {i.item_name}</option>)}
              </select>
            </div>
            <div style={{ flex: '0 0 110px' }}>
              <label style={{ fontSize: 11, fontWeight: 700, color: TEXT.secondary, marginBottom: 6, display: 'block' }}>Quantity</label>
              <input {...(idx === 0 ? { 'data-tour': 'return-quantity' } : {})} type="number" style={inputStyle} value={line.quantity} onChange={(e) => updateLine(idx, { quantity: e.target.value })} />
            </div>
            <div style={{ flex: '0 0 220px' }}>
              <label style={{ fontSize: 11, fontWeight: 700, color: TEXT.secondary, marginBottom: 6, display: 'block' }}>Condition</label>
              <select {...(idx === 0 ? { 'data-tour': 'return-condition' } : {})} style={inputStyle} value={line.condition} onChange={(e) => updateLine(idx, { condition: e.target.value })}>
                {CONDITIONS.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
              </select>
            </div>
            <div style={{ flex: '0 0 130px' }}>
              <label style={{ fontSize: 11, fontWeight: 700, color: TEXT.secondary, marginBottom: 6, display: 'block' }}>Batch #</label>
              <input style={inputStyle} value={line.batchNumber} onChange={(e) => updateLine(idx, { batchNumber: e.target.value })} />
            </div>
            <button type="button" onClick={() => removeLine(idx)} disabled={lines.length === 1} style={{ ...secondaryBtnStyle, padding: '10px 14px', opacity: lines.length === 1 ? 0.4 : 1 }}>×</button>
          </div>
        ))}
        <button type="button" data-tour="return-add-item-btn" onClick={addLine} style={{ ...secondaryBtnStyle, padding: '7px 14px', fontSize: 12.5, marginTop: 8 }}>+ Add Item</button>
      </Section>

      <div style={{ display: 'flex', gap: 10 }}>
        <button data-tour="return-save-btn" disabled={busy} onClick={save} style={{ ...primaryBtnStyle, opacity: busy ? 0.7 : 1 }}>{busy ? 'Saving…' : 'Record Return'}</button>
        <button disabled={busy} onClick={() => router.push('/dashboard/store/returns')} style={{ ...secondaryBtnStyle, opacity: busy ? 0.6 : 1 }}>Cancel</button>
      </div>
    </div>
  )
}
