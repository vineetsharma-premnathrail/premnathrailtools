'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { recordPath } from '@/lib/recordRef'
import { useRequireApp } from '@/hooks/useAuth'
import { qualityApi } from '@/lib/api'
import QualityNav from '@/components/quality/QualityNav'
import SearchableSelect from '@/components/erp/SearchableSelect'
import { FormPage, SheetColumns, SheetSection, SheetIcon, SHEET, sheetBtn, sheetInput, sheetLabel, sheetHint, Req, Optional } from '@/components/shared/FormSheet'
import { ErrorBanner, sheetGap } from '@/components/quality/QualityBits'
import { extractErrorMessages } from '@/lib/validation'
import Select from '@/components/shared/Select'

interface ItemOpt { id: number; item_code: string; item_name: string; uom?: string }
interface Requirement { applies: boolean; released: boolean; trigger?: string | null; drawing_ref?: string | null; open_fai?: string | null }
const TRIGGER_LABELS: Record<string, string> = { new_item: 'new item', new_revision: 'new drawing revision', new_vendor: 'new vendor' }

export default function NewFirstArticlePage() {
  const { isAuthorized, isLoading } = useRequireApp('quality')
  const router = useRouter()
  const [items, setItems] = useState<ItemOpt[]>([])
  const [locations, setLocations] = useState<{ id: number; code: string; name: string }[]>([])
  const [form, setForm] = useState({ item_id: '', vendor_name: '', quantity: '1', take_from_free: false, location_id: '', source_reference: '', remarks: '' })
  const [req, setReq] = useState<Requirement | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | string[]>('')

  useEffect(() => {
    if (!isAuthorized) return
    qualityApi.lookupItems('').then(setItems).catch((e) => setError(extractErrorMessages(e, 'Failed to load items.')))
    qualityApi.lookupLocations().then(setLocations).catch(() => setLocations([]))
  }, [isAuthorized])

  useEffect(() => {
    if (!form.item_id) { setReq(null); return }
    const t = setTimeout(() => {
      qualityApi.firstArticleRequirement(Number(form.item_id), form.vendor_name.trim()).then(setReq).catch(() => setReq(null))
    }, 300)
    return () => clearTimeout(t)
  }, [form.item_id, form.vendor_name])

  const item = items.find((i) => String(i.id) === form.item_id)

  const submit = async () => {
    setError('')
    if (!form.item_id) return setError('Pick the item.')
    if (!(Number(form.quantity) > 0)) return setError('Enter how many first-article pieces are being checked.')
    if (form.take_from_free && !form.location_id) return setError('Pick the store whose Free stock holds the first article — or untick "Hold stock".')
    setBusy(true)
    try {
      const fai = await qualityApi.createFirstArticle({
        item_id: Number(form.item_id), vendor_name: form.vendor_name.trim() || null, quantity: Number(form.quantity),
        take_from_free: form.take_from_free, location_id: form.take_from_free ? Number(form.location_id) : null,
        source_reference: form.source_reference.trim() || null, remarks: form.remarks.trim() || null,
      })
      router.push(recordPath('/dashboard/quality/first-articles', fai))
    } catch (err) {
      setError(extractErrorMessages(err, 'Failed to raise the first article inspection.'))
    } finally {
      setBusy(false)
    }
  }

  if (isLoading || !isAuthorized) return null
  const back = () => router.push('/dashboard/quality/first-articles')

  return (
    <FormPage nav={<QualityNav />} icon="star" title="New First Article Inspection"
      subtitle="For a sample sent ahead of the order or an item that needs re-qualification. Receipts of a new item / revision / vendor raise their FAI automatically." onBack={back} backTour="qa-fai-new-back"
      footer={<>
        <button type="button" onClick={back} disabled={busy} style={sheetBtn('secondary', SHEET.INK, busy)}>Cancel</button>
        <button type="button" onClick={submit} disabled={busy} style={sheetBtn('primary', SHEET.BLUE, busy)}><SheetIcon name="plus" size={16} />{busy ? 'Raising…' : 'Raise FAI'}</button>
      </>}>
      <SheetColumns
        left={<>
          <ErrorBanner error={error} />
          <SheetSection icon="box" title="First article">
            <label style={sheetLabel}>Item <Req /></label>
            <SearchableSelect value={form.item_id} onChange={(v) => setForm({ ...form, item_id: v })} placeholder="Search item code / name"
              options={items.map((i) => ({ value: String(i.id), label: `${i.item_code} — ${i.item_name}` }))} />
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, ...sheetGap }}>
              <div style={{ flex: '1 1 220px', minWidth: 0 }}>
                <label style={sheetLabel}>Vendor</label>
                <input style={sheetInput} value={form.vendor_name} placeholder="Empty = made in-house" onChange={(e) => setForm({ ...form, vendor_name: e.target.value })} />
              </div>
              <div style={{ flex: '0 1 150px', minWidth: 0 }}>
                <label style={sheetLabel}>Pieces{item?.uom ? ` (${item.uom})` : ''} <Req /></label>
                <input type="number" min={0} step="any" style={sheetInput} value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })} />
              </div>
            </div>
            {req && (
              <p style={{ fontSize: 13, margin: '10px 0 0', color: req.released ? '#16A34A' : '#b45309' }}>
                {!req.applies ? 'This item is not inspection-controlled, so rule 9 does not require an FAI — you can still raise one. '
                  : req.released ? 'Already released for regular lots from this source. ' : `FAI required: ${TRIGGER_LABELS[req.trigger || ''] || req.trigger}. `}
                {req.drawing_ref ? `Current drawing: ${req.drawing_ref}.` : 'No released drawing linked in Design.'}
                {req.open_fai ? ` ${req.open_fai} is already open for it.` : ''}
              </p>
            )}
            <label style={{ ...sheetLabel, ...sheetGap }}>Reference document <Optional /></label>
            <input style={sheetInput} value={form.source_reference} onChange={(e) => setForm({ ...form, source_reference: e.target.value })} placeholder="e.g. sample challan no." />
          </SheetSection>
        </>}
        right={<>
          <SheetSection icon="building" title="Stock">
            <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 13, color: SHEET.BODY, cursor: 'pointer' }}>
              <input type="checkbox" style={{ marginTop: 2 }} checked={form.take_from_free} onChange={(e) => setForm({ ...form, take_from_free: e.target.checked })} />
              Hold stock — the pieces are in a store&apos;s Free stock; move them to Quality stock until the decision
            </label>
            {form.take_from_free && (
              <>
                <label style={{ ...sheetLabel, ...sheetGap }}>Store <Req /></label>
                <Select style={sheetInput} value={form.location_id} onChange={(e) => setForm({ ...form, location_id: e.target.value })}>
                  <option value="">Select store…</option>
                  {locations.map((l) => <option key={l.id} value={l.id}>{l.code} — {l.name}</option>)}
                </Select>
              </>
            )}
            <p style={sheetHint}>Leave unticked when the sample isn&apos;t in stock yet (e.g. sent by the vendor ahead of the order).</p>
          </SheetSection>
          <SheetSection icon="chat" title="Remarks" extra={<Optional />}>
            <textarea style={{ ...sheetInput, minHeight: 70, resize: 'vertical' }} value={form.remarks} onChange={(e) => setForm({ ...form, remarks: e.target.value })} />
          </SheetSection>
        </>}
      />
    </FormPage>
  )
}
