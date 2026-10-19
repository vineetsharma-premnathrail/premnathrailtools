'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { recordPath } from '@/lib/recordRef'
import { useRequireApp } from '@/hooks/useAuth'
import { qualityApi } from '@/lib/api'
import QualityNav from '@/components/quality/QualityNav'
import SearchableSelect from '@/components/erp/SearchableSelect'
import { FormPage, SheetColumns, SheetSection, SheetIcon, SHEET, sheetBtn, sheetInput, sheetLabel, sheetHint, Req, Optional } from '@/components/shared/FormSheet'
import { ErrorBanner, INSPECTION_TYPE_LABELS, sheetGap } from '@/components/quality/QualityBits'
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
      router.push(recordPath('/dashboard/quality/inspection-plans', plan))
    } catch (err) {
      setError(extractErrorMessages(err, 'Failed to create the plan.'))
    } finally {
      setBusy(false)
    }
  }

  if (isLoading || !isAuthorized) return null
  const back = () => router.push('/dashboard/quality/inspection-plans')

  return (
    <FormPage nav={<QualityNav />} icon="list" title="New Inspection Plan" subtitle="Create the draft plan header — characteristics are added on the plan next." onBack={back} backTour="qa-plan-new-back"
      footer={<>
        <button type="button" onClick={back} disabled={busy} style={sheetBtn('secondary', SHEET.INK, busy)}>Cancel</button>
        <button type="button" onClick={submit} disabled={busy} style={sheetBtn('primary', SHEET.BLUE, busy)}><SheetIcon name="plus" size={16} />{busy ? 'Creating…' : 'Create draft & add characteristics'}</button>
      </>}>
      <SheetColumns
        left={<>
          <ErrorBanner error={error} />
          <SheetSection icon="list" title="Plan header">
            <label style={sheetLabel}>Item <Req /></label>
            <SearchableSelect value={form.item_id} onChange={(v) => setForm({ ...form, item_id: v })} placeholder="Search item"
              options={items.map((i) => ({ value: String(i.id), label: `${i.item_code} — ${i.item_name}` }))} />
            <label style={{ ...sheetLabel, ...sheetGap }}>Inspection type</label>
            <select style={sheetInput} value={form.inspection_type} onChange={(e) => setForm({ ...form, inspection_type: e.target.value })}>
              {Object.entries(INSPECTION_TYPE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
            <label style={{ ...sheetLabel, ...sheetGap }}>Title <Optional /></label>
            <input style={sheetInput} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
          </SheetSection>
        </>}
        right={<>
          <SheetSection icon="search" title="Sampling">
            <label style={sheetLabel}>Sampling</label>
            <select style={sheetInput} value={form.sampling_type} onChange={(e) => setForm({ ...form, sampling_type: e.target.value })}>
              <option value="aql">AQL table (ISO 2859-1)</option><option value="full">100% inspection</option><option value="fixed">Fixed quantity</option>
            </select>
            {form.sampling_type === 'aql' && (
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', ...sheetGap }}>
                <div style={{ flex: '1 1 110px' }}>
                  <label style={sheetLabel}>AQL</label>
                  <select style={sheetInput} value={form.aql} onChange={(e) => setForm({ ...form, aql: e.target.value })}>
                    {['0.065', '0.10', '0.15', '0.25', '0.40', '0.65', '1.0', '1.5', '2.5', '4.0', '6.5', '10.0'].map((a) => <option key={a} value={a}>{a}</option>)}
                  </select>
                </div>
                <div style={{ flex: '1 1 130px' }}>
                  <label style={sheetLabel}>Level</label>
                  <select style={sheetInput} value={form.inspection_level} onChange={(e) => setForm({ ...form, inspection_level: e.target.value })}>
                    <option value="I">General I</option><option value="II">General II</option><option value="III">General III</option>
                  </select>
                </div>
              </div>
            )}
            {form.sampling_type === 'fixed' && (
              <>
                <label style={{ ...sheetLabel, ...sheetGap }}>Sample size</label>
                <input type="number" min={1} style={sheetInput} value={form.fixed_sample_size} onChange={(e) => setForm({ ...form, fixed_sample_size: e.target.value })} />
              </>
            )}
            <p style={sheetHint}>Critical characteristics are always inspected 100% with accept number 0, whatever the sampling.</p>
          </SheetSection>
        </>}
      />
    </FormPage>
  )
}
