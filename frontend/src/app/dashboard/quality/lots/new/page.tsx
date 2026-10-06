'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { qualityApi } from '@/lib/api'
import QualityNav from '@/components/quality/QualityNav'
import SearchableSelect from '@/components/erp/SearchableSelect'
import { Field, Section, inputStyle, primaryBtnStyle, secondaryBtnStyle } from '@/components/shared/ui'
import { PageHeader, ErrorBanner, INSPECTION_TYPE_LABELS } from '@/components/quality/QualityBits'
import { extractErrorMessages } from '@/lib/validation'

interface ItemOpt { id: number; item_code: string; item_name: string; uom?: string }

// Incoming lots come only from GRNs; final lots from production output.
const MANUAL_TYPES = ['stock_reinspection', 'sales_return', 'first_article', 'in_process', 'job_work', 'final', 'third_party']

export default function NewManualLotPage() {
  const { isAuthorized, isLoading } = useRequireApp('quality')
  const router = useRouter()
  const [items, setItems] = useState<ItemOpt[]>([])
  const [locations, setLocations] = useState<{ id: number; code: string; name: string }[]>([])
  const [form, setForm] = useState({ inspection_type: 'stock_reinspection', item_id: '', quantity: '', location_id: '', take_from_free: true, batch_number: '', vendor_name: '', source_reference: '', remarks: '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | string[]>('')

  useEffect(() => {
    if (!isAuthorized) return
    qualityApi.lookupItems('').then(setItems).catch((e) => setError(extractErrorMessages(e, 'Failed to load items.')))
    qualityApi.lookupLocations().then(setLocations).catch(() => setLocations([]))
  }, [isAuthorized])

  const item = items.find((i) => String(i.id) === form.item_id)

  const submit = async () => {
    setError('')
    if (!form.item_id) return setError('Pick the item to inspect.')
    if (!(Number(form.quantity) > 0)) return setError('Enter a quantity greater than zero.')
    if (form.take_from_free && !form.location_id) return setError('Pick the store whose Free stock should be held in Quality for this inspection — or untick "Hold stock".')
    setBusy(true)
    try {
      const lot = await qualityApi.createLot({
        inspection_type: form.inspection_type, item_id: Number(form.item_id), quantity: Number(form.quantity),
        location_id: form.take_from_free ? Number(form.location_id) : null, take_from_free: form.take_from_free,
        batch_number: form.batch_number.trim() || null, vendor_name: form.vendor_name.trim() || null,
        source_reference: form.source_reference.trim() || null, remarks: form.remarks.trim() || null,
      })
      router.push(`/dashboard/quality/lots/${lot.id}`)
    } catch (err) {
      setError(extractErrorMessages(err, 'Failed to create the inspection lot.'))
    } finally {
      setBusy(false)
    }
  }

  if (isLoading || !isAuthorized) return null

  return (
    <div>
      <QualityNav />
      <PageHeader title="New Manual Inspection Lot">
        <button type="button" onClick={() => router.push('/dashboard/quality/lots')} style={secondaryBtnStyle}>← Back</button>
      </PageHeader>
      <ErrorBanner error={error} />
      <Section title="Lot" style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
          <div style={{ flex: '0 1 220px', minWidth: 200 }}>
            <Field label="Inspection type">
              <select style={inputStyle} value={form.inspection_type} onChange={(e) => setForm({ ...form, inspection_type: e.target.value })}>
                {MANUAL_TYPES.map((t) => <option key={t} value={t}>{INSPECTION_TYPE_LABELS[t]}</option>)}
              </select>
            </Field>
          </div>
          <div style={{ flex: '1 1 300px', maxWidth: 460 }}>
            <Field label="Item *">
              <SearchableSelect value={form.item_id} onChange={(v) => setForm({ ...form, item_id: v })} placeholder="Search item code / name"
                options={items.map((i) => ({ value: String(i.id), label: `${i.item_code} — ${i.item_name}` }))} />
            </Field>
          </div>
          <div style={{ flex: '0 1 140px', minWidth: 120 }}>
            <Field label={`Quantity *${item?.uom ? ` (${item.uom})` : ''}`}>
              <input type="number" min={0} step="any" style={inputStyle} value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })} />
            </Field>
          </div>
          <div style={{ flex: '0 1 170px', minWidth: 150 }}>
            <Field label="Batch / serial">
              <input style={inputStyle} value={form.batch_number} onChange={(e) => setForm({ ...form, batch_number: e.target.value })} />
            </Field>
          </div>
        </div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer' }}>
          <input type="checkbox" checked={form.take_from_free} onChange={(e) => setForm({ ...form, take_from_free: e.target.checked })} />
          Hold stock — move this quantity from Free to Quality stock until the usage decision (it can&apos;t be issued meanwhile)
        </label>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
          {form.take_from_free && (
            <div style={{ flex: '1 1 240px', maxWidth: 320 }}>
              <Field label="Store *">
                <select style={inputStyle} value={form.location_id} onChange={(e) => setForm({ ...form, location_id: e.target.value })}>
                  <option value="">Select store…</option>
                  {locations.map((l) => <option key={l.id} value={l.id}>{l.code} — {l.name}</option>)}
                </select>
              </Field>
            </div>
          )}
          <div style={{ flex: '1 1 220px', maxWidth: 320 }}>
            <Field label="Vendor (if any)">
              <input style={inputStyle} value={form.vendor_name} onChange={(e) => setForm({ ...form, vendor_name: e.target.value })} />
            </Field>
          </div>
          <div style={{ flex: '1 1 200px', maxWidth: 280 }}>
            <Field label="Reference document">
              <input style={inputStyle} value={form.source_reference} onChange={(e) => setForm({ ...form, source_reference: e.target.value })} placeholder="e.g. return note no." />
            </Field>
          </div>
        </div>
        <Field label="Remarks">
          <textarea style={{ ...inputStyle, minHeight: 60 }} value={form.remarks} onChange={(e) => setForm({ ...form, remarks: e.target.value })} />
        </Field>
      </Section>
      <button type="button" disabled={busy} onClick={submit} style={{ ...primaryBtnStyle, opacity: busy ? 0.7 : 1 }}>{busy ? 'Creating…' : 'Create Lot'}</button>
    </div>
  )
}
