'use client'

import { useEffect, useState } from 'react'
import { electricalApi } from '@/lib/api'
import { ElectricalJob, ElectricalLookupOption } from '@/types'
import SearchableSelect from '@/components/erp/SearchableSelect'
import DateField from '@/components/erp/DateField'
import { secondaryBtnStyle } from '@/components/shared/ui'
import { extractErrorMessages } from '@/lib/validation'
import {
  inputStyle, sectionStyle, sectionTitle, primaryBtn, ErrorBanner, F, rowStyle, PRIORITY_LABELS, toOptions, strOrNull,
} from '@/components/electrical/shared'

type Values = Record<string, string>

const FIELDS = [
  'title', 'erp_project_id', 'rrv_model', 'vehicle_number', 'customer_name', 'branch_id', 'lead_engineer_id', 'priority',
  'planned_start_date', 'target_handover_date', 'system_voltage', 'battery_spec', 'alternator_spec', 'applicable_standards',
  'customer_spec_ref', 'requirement_notes', 'remarks',
] as const
const ID_FIELDS = new Set(['erp_project_id', 'branch_id', 'lead_engineer_id'])
const DATE_FIELDS = new Set(['planned_start_date', 'target_handover_date'])

function initialValues(job?: ElectricalJob | null): Values {
  const v: Values = {}
  for (const f of FIELDS) {
    const raw = job ? (job as unknown as Record<string, unknown>)[f] : undefined
    v[f] = raw === null || raw === undefined ? '' : String(raw)
  }
  if (!v.priority) v.priority = 'normal'
  return v
}

/** Create / edit form for an RRV electrical job: identity, planning and the
 * Electrical Requirement (stage 1). */
export default function JobForm({ initial, submitLabel, onSubmit, onCancel }: {
  initial?: ElectricalJob | null
  submitLabel: string
  onSubmit: (payload: Record<string, unknown>) => Promise<void>
  onCancel: () => void
}) {
  const [values, setValues] = useState<Values>(() => initialValues(initial))
  const [projects, setProjects] = useState<ElectricalLookupOption[]>([])
  const [branches, setBranches] = useState<ElectricalLookupOption[]>([])
  const [users, setUsers] = useState<ElectricalLookupOption[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | string[]>('')

  useEffect(() => {
    electricalApi.lookupProjects().then(setProjects).catch(() => setProjects([]))
    electricalApi.lookupBranches().then(setBranches).catch(() => setBranches([]))
    electricalApi.lookupUsers().then(setUsers).catch(() => setUsers([]))
  }, [])

  const set = (key: string) => (value: string) => setValues((v) => ({ ...v, [key]: value }))
  const bind = (key: string) => ({ value: values[key], onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => set(key)(e.target.value) })

  const pickProject = (value: string) => {
    set('erp_project_id')(value)
    // Prefill customer / model / serial from the ERP machine when those are still blank.
    const p = projects.find((x) => String(x.id) === value)
    if (!p) return
    setValues((v) => ({
      ...v,
      erp_project_id: value,
      vehicle_number: v.vehicle_number || p.code || '',
      customer_name: v.customer_name || p.extra || '',
    }))
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    if (!values.title.trim()) { setError('Enter a title for the job, e.g. "RRV-450 electrical — Northern Railway".'); return }
    if (values.planned_start_date && values.target_handover_date && values.target_handover_date < values.planned_start_date) {
      setError('Target handover date can\'t be before the planned start date.')
      return
    }
    const payload: Record<string, unknown> = {}
    for (const f of FIELDS) {
      const raw = values[f]
      if (ID_FIELDS.has(f)) payload[f] = raw ? Number(raw) : null
      else if (DATE_FIELDS.has(f)) payload[f] = raw || null
      else if (f === 'priority' || f === 'title') payload[f] = raw.trim()
      else payload[f] = strOrNull(raw)
    }
    setSaving(true)
    try {
      await onSubmit(payload)
    } catch (err) {
      setError(extractErrorMessages(err, initial ? 'Failed to save the job.' : 'Failed to create the job.'))
      setSaving(false)
    }
  }

  return (
    <form onSubmit={submit}>
      <ErrorBanner error={error} />

      <div style={sectionStyle}>
        <p style={sectionTitle}>RRV & Job</p>
        <div style={rowStyle}>
          <F label="Job Title *" basis={320} grow max={560}>
            <input style={inputStyle} {...bind('title')} placeholder="e.g. RRV-450 electrical — Northern Railway" />
          </F>
          <F label="Priority" basis={130}>
            <select style={inputStyle} {...bind('priority')}>
              {Object.entries(PRIORITY_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </F>
        </div>
        <div style={rowStyle}>
          <F label="RRV / Machine (ERP)" basis={320} grow max={480}>
            <SearchableSelect value={values.erp_project_id} onChange={pickProject} options={toOptions(projects, '— Not linked —')} placeholder="Search by serial, model or customer" />
          </F>
          <F label="RRV Model" basis={180} grow max={260}>
            <input style={inputStyle} {...bind('rrv_model')} placeholder="e.g. RRV-450" />
          </F>
          <F label="Vehicle / Serial No." basis={170} grow max={240}>
            <input style={inputStyle} {...bind('vehicle_number')} />
          </F>
        </div>
        <div style={rowStyle}>
          <F label="Customer" basis={260} grow max={400}>
            <input style={inputStyle} {...bind('customer_name')} />
          </F>
          <F label="Plant" basis={200} grow max={280}>
            <select style={inputStyle} {...bind('branch_id')}>
              <option value="">— Select plant —</option>
              {branches.map((b) => <option key={b.id} value={b.id}>{b.label}</option>)}
            </select>
          </F>
          <F label="Lead Engineer" basis={240} grow max={320}>
            <SearchableSelect value={values.lead_engineer_id} onChange={set('lead_engineer_id')} options={toOptions(users, '— Unassigned —')} placeholder="Search people" />
          </F>
        </div>
        <div style={{ ...rowStyle, marginBottom: 0 }}>
          <F label="Planned Start" basis={160}>
            <DateField value={values.planned_start_date} onChange={set('planned_start_date')} />
          </F>
          <F label="Target Handover" basis={160}>
            <DateField value={values.target_handover_date} onChange={set('target_handover_date')} />
          </F>
        </div>
      </div>

      <div style={sectionStyle}>
        <p style={sectionTitle}>Electrical Requirement</p>
        <div style={rowStyle}>
          <F label="System Voltage" basis={150}>
            <input style={inputStyle} {...bind('system_voltage')} placeholder="e.g. 24 V DC" />
          </F>
          <F label="Battery" basis={220} grow max={320}>
            <input style={inputStyle} {...bind('battery_spec')} placeholder="e.g. 2 × 12 V 150 Ah" />
          </F>
          <F label="Alternator / Charger" basis={220} grow max={320}>
            <input style={inputStyle} {...bind('alternator_spec')} placeholder="e.g. 28 V 100 A" />
          </F>
        </div>
        <div style={rowStyle}>
          <F label="Applicable Standards" basis={300} grow max={480}>
            <input style={inputStyle} {...bind('applicable_standards')} placeholder="e.g. RDSO spec, IS/IEC references" />
          </F>
          <F label="Customer Spec Ref." basis={220} grow max={320}>
            <input style={inputStyle} {...bind('customer_spec_ref')} />
          </F>
        </div>
        <div style={rowStyle}>
          <F label="Requirement" basis={400} grow>
            <textarea style={{ ...inputStyle, minHeight: 110, resize: 'vertical' }} {...bind('requirement_notes')}
              placeholder="Loads and circuits the customer needs — lighting, beacons, horns, cab controls, instruments, interlocks…" />
          </F>
        </div>
        <div style={{ ...rowStyle, marginBottom: 0 }}>
          <F label="Remarks" basis={400} grow>
            <textarea style={{ ...inputStyle, minHeight: 60, resize: 'vertical' }} {...bind('remarks')} />
          </F>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
        <button type="button" onClick={onCancel} style={secondaryBtnStyle} disabled={saving}>Cancel</button>
        <button type="submit" style={{ ...primaryBtn, opacity: saving ? 0.7 : 1 }} disabled={saving}>{saving ? 'Saving…' : submitLabel}</button>
      </div>
    </form>
  )
}
