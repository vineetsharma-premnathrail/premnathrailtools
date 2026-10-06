'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { qualityApi } from '@/lib/api'
import { TEXT } from '@/lib/theme'
import QualityNav from '@/components/quality/QualityNav'
import SearchableSelect from '@/components/erp/SearchableSelect'
import { Field, Section, inputStyle, primaryBtnStyle, secondaryBtnStyle } from '@/components/shared/ui'
import { PageHeader, ErrorBanner } from '@/components/quality/QualityBits'
import { extractErrorMessages } from '@/lib/validation'

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
      router.push(`/dashboard/quality/first-articles/${fai.id}`)
    } catch (err) {
      setError(extractErrorMessages(err, 'Failed to raise the first article inspection.'))
    } finally {
      setBusy(false)
    }
  }

  if (isLoading || !isAuthorized) return null

  return (
    <div>
      <QualityNav />
      <PageHeader title="New First Article Inspection">
        <button type="button" onClick={() => router.push('/dashboard/quality/first-articles')} style={secondaryBtnStyle}>← Back</button>
      </PageHeader>
      <ErrorBanner error={error} />
      <Section title="First article" style={{ marginBottom: 20 }}>
        <p style={{ fontSize: 12.5, color: TEXT.muted, margin: 0 }}>
          Use this for a sample sent ahead of the order or an item that needs re-qualification. Receipts of a new item / revision / vendor raise their FAI automatically.
        </p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
          <div style={{ flex: '1 1 300px', maxWidth: 460 }}>
            <Field label="Item *">
              <SearchableSelect value={form.item_id} onChange={(v) => setForm({ ...form, item_id: v })} placeholder="Search item code / name"
                options={items.map((i) => ({ value: String(i.id), label: `${i.item_code} — ${i.item_name}` }))} />
            </Field>
          </div>
          <div style={{ flex: '1 1 240px', maxWidth: 320 }}>
            <Field label="Vendor (empty = made in-house)">
              <input style={inputStyle} value={form.vendor_name} onChange={(e) => setForm({ ...form, vendor_name: e.target.value })} />
            </Field>
          </div>
          <div style={{ flex: '0 1 140px', minWidth: 120 }}>
            <Field label={`Pieces *${item?.uom ? ` (${item.uom})` : ''}`}>
              <input type="number" min={0} step="any" style={inputStyle} value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })} />
            </Field>
          </div>
        </div>
        {req && (
          <p style={{ fontSize: 13, margin: 0, color: req.released ? '#16A34A' : '#b45309' }}>
            {!req.applies ? 'This item is not inspection-controlled, so rule 9 does not require an FAI — you can still raise one. '
              : req.released ? 'Already released for regular lots from this source. ' : `FAI required: ${TRIGGER_LABELS[req.trigger || ''] || req.trigger}. `}
            {req.drawing_ref ? `Current drawing: ${req.drawing_ref}.` : 'No released drawing linked in Design.'}
            {req.open_fai ? ` ${req.open_fai} is already open for it.` : ''}
          </p>
        )}
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer' }}>
          <input type="checkbox" checked={form.take_from_free} onChange={(e) => setForm({ ...form, take_from_free: e.target.checked })} />
          Hold stock — the pieces are in a store&apos;s Free stock; move them to Quality stock until the decision
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
          <div style={{ flex: '1 1 220px', maxWidth: 300 }}>
            <Field label="Reference document">
              <input style={inputStyle} value={form.source_reference} onChange={(e) => setForm({ ...form, source_reference: e.target.value })} placeholder="e.g. sample challan no." />
            </Field>
          </div>
        </div>
        <Field label="Remarks">
          <textarea style={{ ...inputStyle, minHeight: 60 }} value={form.remarks} onChange={(e) => setForm({ ...form, remarks: e.target.value })} />
        </Field>
      </Section>
      <button type="button" disabled={busy} onClick={submit} style={{ ...primaryBtnStyle, opacity: busy ? 0.7 : 1 }}>{busy ? 'Raising…' : 'Raise FAI'}</button>
    </div>
  )
}
