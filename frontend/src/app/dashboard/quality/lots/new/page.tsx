'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { recordPath } from '@/lib/recordRef'
import { qualityApi } from '@/lib/api'
import { VisOptionValues, VisSection } from '@/lib/visibilityComponents'
import { useQualityScreen } from '@/components/quality/useQualityScreen'
import QualityNav from '@/components/quality/QualityNav'
import SearchableSelect from '@/components/erp/SearchableSelect'
import { FormPage, SheetColumns, SheetSection, SheetIcon, SHEET, sheetBtn, sheetInput, sheetLabel, sheetHint, Req, Optional } from '@/components/shared/FormSheet'
import { ErrorBanner, INSPECTION_TYPE_LABELS, sheetGap } from '@/components/quality/QualityBits'
import { extractErrorMessages } from '@/lib/validation'
import OrderProjectPicker, { OrderProjectValue } from '@/components/sales/ProjectUnitPicker'
import Select from '@/components/shared/Select'
import { useFormDraft } from '@/lib/formDraft'
import DraftBanner from '@/components/shared/DraftBanner'

interface ItemOpt { id: number; item_code: string; item_name: string; uom?: string }

// Incoming lots come only from GRNs; final lots from production output.
// First articles are raised from Quality → First Article (they open the FAI record).
const MANUAL_TYPES = ['stock_reinspection', 'sales_return', 'in_process', 'job_work', 'final', 'third_party']

const row: React.CSSProperties = { display: 'flex', flexWrap: 'wrap', gap: 12, ...sheetGap }
function F({ label, flex = '1 1 200px', children }: { label: React.ReactNode; flex?: string; children: React.ReactNode }) {
  return <div style={{ flex, minWidth: 0 }}><label style={sheetLabel}>{label}</label>{children}</div>
}

export default function NewManualLotPage() {
  // What the user's roles let them see here (the lot types a role may raise by hand are also enforced by the
  // server); in the Role editor's preview nothing is loaded or saved.
  const { vis, isAuthorized, isLoading } = useQualityScreen('quality:inspection_lots')
  const preview = vis.preview
  const typeChoices = vis.options('inspection_type', MANUAL_TYPES, (t) => t)
  const router = useRouter()
  const [items, setItems] = useState<ItemOpt[]>([])
  const [locations, setLocations] = useState<{ id: number; code: string; name: string }[]>([])
  const [form, setForm] = useState({ inspection_type: 'stock_reinspection', item_id: '', quantity: '', location_id: '', take_from_free: true, batch_number: '', vendor_name: '', source_reference: '', remarks: '' })
  const [busy, setBusy] = useState(false)
  // Project (the vehicle / spares lot this inspection is for) — optional.
  const [op, setOp] = useState<OrderProjectValue | null>(null)
  const [error, setError] = useState<string | string[]>('')
  const draft = useFormDraft(preview ? null : 'quality-lot-new', { form, op }, (d) => {
    if (d.form) setForm((f) => ({ ...f, ...d.form }))
    setOp(d.op || null)
  })
  // When the role doesn't offer the default type, the form shows (and sends) the first type it does offer.
  const inspectionType = typeChoices.includes(form.inspection_type) ? form.inspection_type : (typeChoices[0] || form.inspection_type)

  useEffect(() => {
    if (!isAuthorized || preview) return
    qualityApi.lookupItems('').then(setItems).catch((e) => setError(extractErrorMessages(e, 'Failed to load items.')))
    qualityApi.lookupLocations().then(setLocations).catch(() => setLocations([]))
  }, [isAuthorized, preview])

  const item = items.find((i) => String(i.id) === form.item_id)

  const submit = async () => {
    setError('')
    if (!form.item_id) return setError('Pick the item to inspect.')
    if (!(Number(form.quantity) > 0)) return setError('Enter a quantity greater than zero.')
    if (form.take_from_free && !form.location_id) return setError('Pick the store whose Free stock should be held in Quality for this inspection — or untick "Hold stock".')
    setBusy(true)
    try {
      const lot = await qualityApi.createLot({
        inspection_type: inspectionType, item_id: Number(form.item_id), quantity: Number(form.quantity),
        location_id: form.take_from_free ? Number(form.location_id) : null, take_from_free: form.take_from_free,
        batch_number: form.batch_number.trim() || null, vendor_name: form.vendor_name.trim() || null,
        source_reference: form.source_reference.trim() || null, remarks: form.remarks.trim() || null,
        order_project_id: op?.projectId ?? null, order_project_element_id: op?.elementId ?? null,
      })
      draft.clear()
      router.push(recordPath('/dashboard/quality/lots', lot))
    } catch (err) {
      setError(extractErrorMessages(err, 'Failed to create the inspection lot.'))
    } finally {
      setBusy(false)
    }
  }

  if (isLoading || !isAuthorized) return null
  const back = () => router.push('/dashboard/quality/lots')

  return (
    <FormPage nav={preview ? undefined : <QualityNav />} icon="box" title="New Manual Inspection Lot"
      subtitle="Incoming lots come from GRNs and final lots from production output — raise one here for re-inspection, returns, job work, in-process or third-party." onBack={preview ? undefined : back} backTour="qa-lot-new-back"
      footer={<>
        <button type="button" onClick={back} disabled={busy || preview} style={sheetBtn('secondary', SHEET.INK, busy)}>Cancel</button>
        <button type="button" onClick={submit} disabled={busy || preview} style={sheetBtn('primary', SHEET.BLUE, busy)}><SheetIcon name="plus" size={16} />{busy ? 'Creating…' : 'Create Lot'}</button>
      </>}>
      <SheetColumns
        left={<>
          <ErrorBanner error={error} />
          <DraftBanner draft={draft} />
          <VisSection vis={vis} k="lot">
          <SheetSection icon="box" title="Lot">
            <label style={sheetLabel}>Inspection type</label>
            <Select style={sheetInput} value={inspectionType} onChange={(e) => setForm({ ...form, inspection_type: e.target.value })}>
              {typeChoices.map((t) => <option key={t} value={t}>{INSPECTION_TYPE_LABELS[t]}</option>)}
            </Select>
            <VisOptionValues vis={vis} dropdown="inspection_type" />
            <label style={{ ...sheetLabel, ...sheetGap }}>Item <Req /></label>
            <SearchableSelect value={form.item_id} onChange={(v) => setForm({ ...form, item_id: v })} placeholder="Search item code / name"
              options={items.map((i) => ({ value: String(i.id), label: `${i.item_code} — ${i.item_name}` }))} />
            <div style={row}>
              <F label={<>Quantity{item?.uom ? ` (${item.uom})` : ''} <Req /></>} flex="0 1 160px">
                <input type="number" min={0} step="any" style={sheetInput} value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })} />
              </F>
              <F label="Batch / serial"><input style={sheetInput} value={form.batch_number} onChange={(e) => setForm({ ...form, batch_number: e.target.value })} /></F>
            </div>
            <div style={row}>
              <F label="Vendor (if any)"><input style={sheetInput} value={form.vendor_name} onChange={(e) => setForm({ ...form, vendor_name: e.target.value })} /></F>
              <F label="Reference document"><input style={sheetInput} value={form.source_reference} onChange={(e) => setForm({ ...form, source_reference: e.target.value })} placeholder="e.g. return note no." /></F>
            </div>
            <label style={{ ...sheetLabel, ...sheetGap }}>Project — Unit (vehicle / lot) <Optional /></label>
            <OrderProjectPicker value={op} onChange={(v) => setOp(v)} />
            <p style={sheetHint}>Link a final / in-process check to the build it belongs to — it shows on the Project&apos;s Quality column.</p>
          </SheetSection>
          </VisSection>
        </>}
        right={<>
          <VisSection vis={vis} k="stock">
          <SheetSection icon="building" title="Stock">
            <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 13, color: SHEET.BODY, cursor: 'pointer' }}>
              <input type="checkbox" style={{ marginTop: 2 }} checked={form.take_from_free} onChange={(e) => setForm({ ...form, take_from_free: e.target.checked })} />
              Hold stock — move this quantity from Free to Quality stock until the usage decision (it can&apos;t be issued meanwhile)
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
            <p style={sheetHint}>Untick only when the material is not in a store&apos;s Free stock.</p>
          </SheetSection>
          </VisSection>
          <VisSection vis={vis} k="remarks">
          <SheetSection icon="chat" title="Remarks" extra={<Optional />}>
            <textarea style={{ ...sheetInput, minHeight: 70, resize: 'vertical' }} value={form.remarks} onChange={(e) => setForm({ ...form, remarks: e.target.value })} />
          </SheetSection>
          </VisSection>
        </>}
      />
    </FormPage>
  )
}
