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

interface ItemOpt { id: number; item_code: string; item_name: string }

export default function NewInspectionPlanPage() {
  const { isAuthorized, isLoading } = useRequireApp('quality')
  const router = useRouter()
  const [items, setItems] = useState<ItemOpt[]>([])
  const [form, setForm] = useState({ item_id: '', inspection_type: 'incoming', title: '', sampling_type: 'aql', aql: '1.0', inspection_level: 'II', fixed_sample_size: '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | string[]>('')

  useEffect(() => {
    if (!isAuthorized) return
    qualityApi.lookupItems('').then(setItems).catch(() => setItems([]))
    // Defaults from Quality → Settings → Sampling defaults.
    qualityApi.getSettings().then((s) => {
      const v = s.values || {}
      setForm((f) => ({ ...f, sampling_type: v.default_sampling_type || f.sampling_type, aql: v.default_aql || f.aql, inspection_level: v.default_inspection_level || f.inspection_level }))
    }).catch(() => {})
  }, [isAuthorized])

  const submit = async () => {
    setError('')
    if (!form.item_id) return setError('Pick the item this plan is for.')
    setBusy(true)
    try {
      const plan = await qualityApi.createInspectionPlan({
        item_id: Number(form.item_id), inspection_type: form.inspection_type, title: form.title.trim() || null,
        sampling_type: form.sampling_type, aql: form.sampling_type === 'aql' ? Number(form.aql) : null,
        inspection_level: form.inspection_level, fixed_sample_size: form.sampling_type === 'fixed' ? Number(form.fixed_sample_size) : null,
        lines: [],
      })
      router.push(`/dashboard/quality/inspection-plans/${plan.id}`)
    } catch (err) {
      setError(extractErrorMessages(err, 'Failed to create the plan.'))
    } finally {
      setBusy(false)
    }
  }

  if (isLoading || !isAuthorized) return null

  return (
    <div>
      <QualityNav />
      <PageHeader title="New Inspection Plan">
        <button type="button" onClick={() => router.push('/dashboard/quality/inspection-plans')} style={secondaryBtnStyle}>← Back</button>
      </PageHeader>
      <ErrorBanner error={error} />
      <Section title="Plan header" style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
          <div style={{ flex: '1 1 300px', maxWidth: 460 }}>
            <Field label="Item *">
              <SearchableSelect value={form.item_id} onChange={(v) => setForm({ ...form, item_id: v })} placeholder="Search item"
                options={items.map((i) => ({ value: String(i.id), label: `${i.item_code} — ${i.item_name}` }))} />
            </Field>
          </div>
          <div style={{ flex: '0 1 220px', minWidth: 200 }}>
            <Field label="Inspection type">
              <select style={inputStyle} value={form.inspection_type} onChange={(e) => setForm({ ...form, inspection_type: e.target.value })}>
                {Object.entries(INSPECTION_TYPE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </Field>
          </div>
          <div style={{ flex: '1 1 240px', maxWidth: 360 }}>
            <Field label="Title (optional)"><input style={inputStyle} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></Field>
          </div>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
          <div style={{ flex: '0 1 220px', minWidth: 200 }}>
            <Field label="Sampling">
              <select style={inputStyle} value={form.sampling_type} onChange={(e) => setForm({ ...form, sampling_type: e.target.value })}>
                <option value="aql">AQL table (ISO 2859-1)</option><option value="full">100% inspection</option><option value="fixed">Fixed quantity</option>
              </select>
            </Field>
          </div>
          {form.sampling_type === 'aql' && (
            <>
              <div style={{ flex: '0 1 120px' }}>
                <Field label="AQL">
                  <select style={inputStyle} value={form.aql} onChange={(e) => setForm({ ...form, aql: e.target.value })}>
                    {['0.065', '0.10', '0.15', '0.25', '0.40', '0.65', '1.0', '1.5', '2.5', '4.0', '6.5', '10.0'].map((a) => <option key={a} value={a}>{a}</option>)}
                  </select>
                </Field>
              </div>
              <div style={{ flex: '0 1 130px' }}>
                <Field label="Level">
                  <select style={inputStyle} value={form.inspection_level} onChange={(e) => setForm({ ...form, inspection_level: e.target.value })}>
                    <option value="I">General I</option><option value="II">General II</option><option value="III">General III</option>
                  </select>
                </Field>
              </div>
            </>
          )}
          {form.sampling_type === 'fixed' && (
            <div style={{ flex: '0 1 150px' }}>
              <Field label="Sample size"><input type="number" min={1} style={inputStyle} value={form.fixed_sample_size} onChange={(e) => setForm({ ...form, fixed_sample_size: e.target.value })} /></Field>
            </div>
          )}
        </div>
        <p style={{ fontSize: 12, color: '#78716c', margin: 0 }}>Critical characteristics are always inspected 100% with accept number 0, whatever the sampling.</p>
      </Section>
      <button type="button" disabled={busy} onClick={submit} style={{ ...primaryBtnStyle, opacity: busy ? 0.7 : 1 }}>{busy ? 'Creating…' : 'Create draft & add characteristics'}</button>
    </div>
  )
}
