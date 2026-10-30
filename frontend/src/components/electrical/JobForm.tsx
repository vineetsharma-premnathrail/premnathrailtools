'use client'

import Select from '@/components/shared/Select'
import { useEffect, useMemo, useState } from 'react'
import { electricalApi } from '@/lib/api'
import { useAssigneeFilter } from '@/hooks/useAssigneeFilter'
import { ElectricalJob, ElectricalLookupOption } from '@/types'
import SearchableSelect from '@/components/erp/SearchableSelect'
import DateField from '@/components/erp/DateField'
import { FormPage, SheetColumns, SheetSection, SheetIcon, SHEET, sheetBtn, sheetInput, sheetHint, Optional } from '@/components/shared/FormSheet'
import { extractErrorMessages } from '@/lib/validation'
import OrderProjectPicker, { OrderProjectValue } from '@/components/sales/ProjectUnitPicker'
import { useFormDraft } from '@/lib/formDraft'
import DraftBanner from '@/components/shared/DraftBanner'
import {
  ErrorBanner, useLookupErrors, F, rowStyle, PRIORITY_LABELS, toOptions, strOrNull,
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
  if (!v.priority) v.priority = 'standard'
  return v
}

/** Create / edit form for an RRV electrical job: identity, planning and the
 * Electrical Requirement (stage 1). */
export default function JobForm({ initial, submitLabel, onSubmit, onCancel, title, subtitle, nav, onBack }: {
  initial?: ElectricalJob | null
  submitLabel: string
  /** Header of the FormPage the form renders in. */
  title: string
  subtitle: string
  /** Module sub-nav, rendered above the header (create page only). */
  nav?: React.ReactNode
  /** Shows the app-wide "← Back" pill in the header. */
  onBack?: () => void
  onSubmit: (payload: Record<string, unknown>) => Promise<void>
  onCancel: () => void
}) {
  const [values, setValues] = useState<Values>(() => initialValues(initial))
  const [orderProject, setOrderProject] = useState<OrderProjectValue | null>(() =>
    initial?.order_project_id ? { projectId: initial.order_project_id, elementId: initial.order_project_element_id ?? null } : null)
  const [projects, setProjects] = useState<ElectricalLookupOption[]>([])
  const [branches, setBranches] = useState<ElectricalLookupOption[]>([])
  const [users, setUsers] = useState<ElectricalLookupOption[]>([])
  // Role "Assign to" rule (Role & Permissions › Electrical › RRV Electrical Jobs › Lead engineer); the current lead stays listed.
  const allowLead = useAssigneeFilter('electrical:jobs.lead_engineer')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | string[]>('')
  const [lookupErrors, addLookupError] = useLookupErrors()
  // Server-side search — the machine lookup returns only the newest 200.
  const [projectSearch, setProjectSearch] = useState('')
  // Label of the machine picked in this session, so it stays visible after
  // the search text (and so the option list) changes.
  const [pickedProjectLabel, setPickedProjectLabel] = useState('')

  const draft = useFormDraft(initial ? null : 'elec-job-new',
    { values, orderProject },
    (d) => {
      setValues((v) => ({ ...v, ...(d.values || {}) }))
      setOrderProject(d.orderProject ?? null)
    })

  useEffect(() => {
    electricalApi.lookupBranches().then(setBranches).catch((err) => addLookupError(extractErrorMessages(err,
      "Couldn't load branches for the Branch picker — you can still save the job without one, or refresh to try again.")))
    electricalApi.lookupUsers().then(setUsers).catch((err) => addLookupError(extractErrorMessages(err,
      "Couldn't load users for the Lead Engineer picker — you can still save the job without one, or refresh to try again.")))
  }, [])

  useEffect(() => {
    let cancelled = false
    const q = projectSearch.trim()
    const t = setTimeout(() => {
      electricalApi.lookupProjects(q || undefined)
        .then((rows: ElectricalLookupOption[]) => { if (!cancelled) setProjects(rows) })
        .catch((err) => { if (!cancelled) addLookupError(extractErrorMessages(err,
          "Couldn't load ERP machines for the RRV picker — you can still save the job without linking one, or refresh to try again.")) })
    }, q ? 300 : 0)
    return () => { cancelled = true; clearTimeout(t) }
  }, [projectSearch])

  const set = (key: string) => (value: string) => setValues((v) => ({ ...v, [key]: value }))
  const bind = (key: string) => ({ value: values[key], onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => set(key)(e.target.value) })

  // Keep the linked / picked machine in the options even when it isn't in the
  // latest search result (outside the newest 200, or the search text changed).
  const projectOptions = useMemo(() => {
    const opts = toOptions(projects, '— Not linked —')
    const id = values.erp_project_id
    if (id && !opts.some((o) => o.value === id)) {
      const initialLabel = initial && String(initial.erp_project_id ?? '') === id ? initial.project_label : null
      opts.push({ value: id, label: pickedProjectLabel || initialLabel || `ERP machine #${id}` })
    }
    return opts
  }, [projects, values.erp_project_id, pickedProjectLabel, initial])

  const pickProject = (value: string) => {
    set('erp_project_id')(value)
    // Prefill customer / model / serial from the ERP machine when those are still blank.
    const p = projects.find((x) => String(x.id) === value)
    if (!p) return
    setPickedProjectLabel(p.label)
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
    payload.order_project_id = orderProject?.projectId ?? null
    payload.order_project_element_id = orderProject?.elementId ?? null
    setSaving(true)
    try {
      await onSubmit(payload)
      draft.clear()
    } catch (err) {
      setError(extractErrorMessages(err, initial ? 'Failed to save the job.' : 'Failed to create the job.'))
      setSaving(false)
    }
  }

  return (
    <form onSubmit={submit}>
      <FormPage
        tour="elec-job-form" icon={initial ? 'edit' : 'gear'} title={title} subtitle={subtitle} nav={nav} onBack={onBack} backTour="elec-job-form-back-btn"
        footer={<>
          <button data-tour="elec-job-form-cancel" type="button" onClick={onCancel} style={sheetBtn('secondary', SHEET.INK, saving)} disabled={saving}>Cancel</button>
          <button data-tour="elec-job-form-submit" type="submit" style={sheetBtn('primary', SHEET.BLUE, saving)} disabled={saving}>
            <SheetIcon name={initial ? 'check' : 'plus'} size={16} />{saving ? 'Saving…' : submitLabel}
          </button>
        </>}
      >
        <SheetColumns
          left={<>
            <ErrorBanner error={error} />
            <DraftBanner draft={draft} />
            <ErrorBanner error={lookupErrors} />
            <SheetSection icon="truck" title="RRV & Job">
              <div style={rowStyle}>
                <F tour="elec-job-title" label="Job Title" req basis={300} grow>
                  <input style={sheetInput} {...bind('title')} placeholder="e.g. RRV-450 electrical — Northern Railway" />
                </F>
                <F tour="elec-job-priority" label="Priority" basis={130}>
                  <Select style={sheetInput} {...bind('priority')}>
                    {Object.entries(PRIORITY_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </Select>
                </F>
              </div>
              <div style={rowStyle}>
                <F tour="elec-job-order-project" label="Project / Unit" optional basis={320} grow>
                  <OrderProjectPicker value={orderProject} requireElement={false} kind="vehicle"
                    onChange={(v, item) => {
                      setOrderProject(v)
                      if (item?.client_name) setValues((x) => ({ ...x, customer_name: x.customer_name || item.client_name || '' }))
                    }} />
                </F>
              </div>
              <div style={rowStyle}>
                <F tour="elec-job-erp-project" label="RRV / Machine (ERP)" optional basis={320} grow>
                  <input style={{ ...sheetInput, marginBottom: 6 }} value={projectSearch} onChange={(e) => setProjectSearch(e.target.value)}
                    placeholder="Search ERP machines by serial, model or customer…" aria-label="Search ERP machines" />
                  <SearchableSelect value={values.erp_project_id} onChange={pickProject} options={projectOptions} placeholder="Pick an ERP machine" />
                </F>
              </div>
              <p style={{ ...sheetHint, margin: '-4px 0 12px' }}>Picking a machine fills in the serial number and customer when those are still blank.</p>
              <div style={{ ...rowStyle, marginBottom: 0 }}>
                <F tour="elec-job-rrv-model" label="RRV Model" basis={160} grow max={260}>
                  <input style={sheetInput} {...bind('rrv_model')} placeholder="e.g. RRV-450" />
                </F>
                <F tour="elec-job-vehicle" label="Vehicle / Serial No." basis={160} grow max={240}>
                  <input style={sheetInput} {...bind('vehicle_number')} />
                </F>
                <F tour="elec-job-customer" label="Customer" basis={220} grow max={400}>
                  <input style={sheetInput} {...bind('customer_name')} />
                </F>
              </div>
            </SheetSection>
            <SheetSection icon="calendar" title="Ownership & Schedule">
              <div style={rowStyle}>
                <F tour="elec-job-plant" label="Plant" basis={200} grow max={280}>
                  <Select style={sheetInput} {...bind('branch_id')}>
                    <option value="">— Select plant —</option>
                    {branches.map((b) => <option key={b.id} value={b.id}>{b.label}</option>)}
                  </Select>
                </F>
                <F tour="elec-job-lead-engineer" label="Lead Engineer" basis={240} grow max={320}>
                  <SearchableSelect value={values.lead_engineer_id} onChange={set('lead_engineer_id')} options={toOptions(users.filter((u) => u.id === initial?.lead_engineer_id || allowLead(u.id)), '— Unassigned —')} placeholder="Search people" />
                </F>
              </div>
              <div style={{ ...rowStyle, marginBottom: 0 }}>
                <F tour="elec-job-planned-start" label="Planned Start" basis={160}>
                  <DateField value={values.planned_start_date} onChange={set('planned_start_date')} />
                </F>
                <F tour="elec-job-target-handover" label="Target Handover" basis={160}>
                  <DateField value={values.target_handover_date} onChange={set('target_handover_date')} />
                </F>
              </div>
            </SheetSection>
          </>}
          right={<>
            <SheetSection icon="gear" title="Electrical Requirement">
              <div style={rowStyle}>
                <F tour="elec-job-voltage" label="System Voltage" basis={130}>
                  <input style={sheetInput} {...bind('system_voltage')} placeholder="e.g. 24 V DC" />
                </F>
                <F tour="elec-job-battery" label="Battery" basis={180} grow>
                  <input style={sheetInput} {...bind('battery_spec')} placeholder="e.g. 2 × 12 V 150 Ah" />
                </F>
              </div>
              <div style={rowStyle}>
                <F tour="elec-job-alternator" label="Alternator / Charger" basis={200} grow>
                  <input style={sheetInput} {...bind('alternator_spec')} placeholder="e.g. 28 V 100 A" />
                </F>
              </div>
              <div style={rowStyle}>
                <F tour="elec-job-standards" label="Applicable Standards" basis={200} grow>
                  <input style={sheetInput} {...bind('applicable_standards')} placeholder="e.g. RDSO spec, IS/IEC references" />
                </F>
                <F tour="elec-job-spec-ref" label="Customer Spec Ref." basis={150} grow>
                  <input style={sheetInput} {...bind('customer_spec_ref')} />
                </F>
              </div>
              <div style={{ ...rowStyle, marginBottom: 0 }}>
                <F tour="elec-job-requirement" label="Requirement" basis={300} grow>
                  <textarea style={{ ...sheetInput, minHeight: 110, resize: 'vertical' }} {...bind('requirement_notes')}
                    placeholder="Loads and circuits the customer needs — lighting, beacons, horns, cab controls, instruments, interlocks…" />
                </F>
              </div>
            </SheetSection>
            <SheetSection icon="chat" title="Remarks" extra={<Optional />}>
              <textarea data-tour="elec-job-remarks" style={{ ...sheetInput, minHeight: 60, resize: 'vertical' }} {...bind('remarks')} aria-label="Remarks" />
            </SheetSection>
          </>}
        />
      </FormPage>
    </form>
  )
}