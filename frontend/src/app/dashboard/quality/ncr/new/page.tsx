'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { qualityApi } from '@/lib/api'
import { QualityDefectCode, QualityMasterValue } from '@/types'
import QualityNav from '@/components/quality/QualityNav'
import SearchableSelect from '@/components/erp/SearchableSelect'
import DateField from '@/components/erp/DateField'
import { Field, Section, inputStyle, primaryBtnStyle, secondaryBtnStyle } from '@/components/shared/ui'
import { PageHeader, ErrorBanner } from '@/components/quality/QualityBits'
import { extractErrorMessages } from '@/lib/validation'

interface ItemOpt { id: number; item_code: string; item_name: string; uom?: string }

export default function NewNcrPage() {
  const { isAuthorized, isLoading } = useRequireApp('quality')
  const router = useRouter()
  const [items, setItems] = useState<ItemOpt[]>([])
  const [locations, setLocations] = useState<{ id: number; code: string; name: string }[]>([])
  const [sources, setSources] = useState<QualityMasterValue[]>([])
  const [codes, setCodes] = useState<QualityDefectCode[]>([])
  const today = new Date().toISOString().slice(0, 10)
  const [form, setForm] = useState({
    source: 'internal', severity: 'minor', item_id: '', item_name: '', quantity: '', block_stock: false, location_id: '',
    batch_number: '', vendor_name: '', defect_code_id: '', source_reference: '', description: '', ncr_date: today,
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | string[]>('')

  useEffect(() => {
    if (!isAuthorized) return
    qualityApi.lookupItems('').then(setItems).catch(() => setItems([]))
    qualityApi.lookupLocations().then(setLocations).catch(() => setLocations([]))
    qualityApi.listMasterValues({ list_key: 'ncr_sources' }).then(setSources).catch(() => setSources([]))
    qualityApi.listMaster('defect-codes').then(setCodes).catch(() => setCodes([]))
  }, [isAuthorized])

  const item = items.find((i) => String(i.id) === form.item_id)

  const submit = async () => {
    setError('')
    if (!form.item_id && !form.item_name.trim()) return setError('Pick the item from the Item Master, or type the name of a non-stock item.')
    if (!form.description.trim()) return setError('Describe the non-conformance.')
    setBusy(true)
    try {
      const ncr = await qualityApi.createNcr({
        source: form.source, severity: form.severity, item_id: form.item_id ? Number(form.item_id) : null,
        item_name: form.item_id ? null : form.item_name.trim(), quantity: form.quantity ? Number(form.quantity) : null,
        block_stock: form.block_stock, location_id: form.block_stock && form.location_id ? Number(form.location_id) : null,
        batch_number: form.batch_number.trim() || null, vendor_name: form.vendor_name.trim() || null,
        defect_code_id: form.defect_code_id ? Number(form.defect_code_id) : null, source_reference: form.source_reference.trim() || null,
        description: form.description.trim(), ncr_date: form.ncr_date,
      })
      router.push(`/dashboard/quality/ncr/${ncr.id}`)
    } catch (err) {
      setError(extractErrorMessages(err, 'Failed to raise the NCR.'))
    } finally {
      setBusy(false)
    }
  }

  if (isLoading || !isAuthorized) return null

  return (
    <div>
      <QualityNav />
      <PageHeader title="Raise NCR">
        <button type="button" onClick={() => router.push('/dashboard/quality/ncr')} style={secondaryBtnStyle}>← Back</button>
      </PageHeader>
      <p style={{ fontSize: 13, color: '#78716c', margin: '-10px 0 16px' }}>
        Rejections at an inspection lot raise their NCR automatically — use this for non-conformances found elsewhere (in stock, on the shop floor, in an audit, from a customer).
      </p>
      <ErrorBanner error={error} />
      <Section title="Non-conformance" style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
          <div style={{ flex: '0 1 220px', minWidth: 190 }}>
            <Field label="Source">
              <select style={inputStyle} value={form.source} onChange={(e) => setForm({ ...form, source: e.target.value })}>
                {sources.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
              </select>
            </Field>
          </div>
          <div style={{ flex: '0 1 140px', minWidth: 120 }}>
            <Field label="Severity">
              <select style={inputStyle} value={form.severity} onChange={(e) => setForm({ ...form, severity: e.target.value })}>
                <option value="minor">Minor</option><option value="major">Major</option><option value="critical">Critical</option>
              </select>
            </Field>
          </div>
          <div style={{ flex: '0 1 160px', minWidth: 150 }}>
            <Field label="NCR date"><DateField value={form.ncr_date} onChange={(v) => setForm({ ...form, ncr_date: v })} /></Field>
          </div>
          <div style={{ flex: '1 1 200px', maxWidth: 280 }}>
            <Field label="Reference document">
              <input style={inputStyle} value={form.source_reference} onChange={(e) => setForm({ ...form, source_reference: e.target.value })} placeholder="Complaint / audit / job no." />
            </Field>
          </div>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
          <div style={{ flex: '1 1 300px', maxWidth: 460 }}>
            <Field label="Item (Item Master)">
              <SearchableSelect value={form.item_id} onChange={(v) => setForm({ ...form, item_id: v })} placeholder="Search item"
                options={[{ value: '', label: '— Not a stock item —' }, ...items.map((i) => ({ value: String(i.id), label: `${i.item_code} — ${i.item_name}` }))]} />
            </Field>
          </div>
          {!form.item_id && (
            <div style={{ flex: '1 1 240px', maxWidth: 340 }}>
              <Field label="Item name (non-stock)"><input style={inputStyle} value={form.item_name} onChange={(e) => setForm({ ...form, item_name: e.target.value })} /></Field>
            </div>
          )}
          <div style={{ flex: '0 1 140px', minWidth: 120 }}>
            <Field label={`Quantity${item?.uom ? ` (${item.uom})` : ''}`}>
              <input type="number" min={0} step="any" style={inputStyle} value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })} />
            </Field>
          </div>
          <div style={{ flex: '0 1 170px', minWidth: 150 }}>
            <Field label="Batch / serial"><input style={inputStyle} value={form.batch_number} onChange={(e) => setForm({ ...form, batch_number: e.target.value })} /></Field>
          </div>
          <div style={{ flex: '1 1 200px', maxWidth: 300 }}>
            <Field label="Vendor"><input style={inputStyle} value={form.vendor_name} onChange={(e) => setForm({ ...form, vendor_name: e.target.value })} /></Field>
          </div>
        </div>
        {form.item_id && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'flex-end' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer', paddingBottom: 10 }}>
              <input type="checkbox" checked={form.block_stock} onChange={(e) => setForm({ ...form, block_stock: e.target.checked })} />
              Block this quantity — move it from Free to Blocked stock
            </label>
            {form.block_stock && (
              <div style={{ flex: '1 1 240px', maxWidth: 320 }}>
                <Field label="Store *">
                  <select style={inputStyle} value={form.location_id} onChange={(e) => setForm({ ...form, location_id: e.target.value })}>
                    <option value="">Select store…</option>
                    {locations.map((l) => <option key={l.id} value={l.id}>{l.code} — {l.name}</option>)}
                  </select>
                </Field>
              </div>
            )}
          </div>
        )}
        <div style={{ flex: '1 1 260px', maxWidth: 420 }}>
          <Field label="Defect code">
            <select style={inputStyle} value={form.defect_code_id} onChange={(e) => setForm({ ...form, defect_code_id: e.target.value })}>
              <option value="">—</option>
              {codes.map((c) => <option key={c.id} value={c.id}>{c.code} — {c.name} ({c.category})</option>)}
            </select>
          </Field>
        </div>
        <Field label="Description *">
          <textarea style={{ ...inputStyle, minHeight: 90 }} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="What is wrong, where it was found, how much is affected" />
        </Field>
      </Section>
      <button type="button" disabled={busy} onClick={submit} style={{ ...primaryBtnStyle, opacity: busy ? 0.7 : 1 }}>{busy ? 'Raising…' : 'Raise NCR'}</button>
    </div>
  )
}
