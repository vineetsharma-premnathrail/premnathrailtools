'use client'

import Select from '@/components/shared/Select'
import { useEffect, useMemo, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { hrApi } from '@/lib/api'
import { useCan } from '@/lib/permissions'
import { HrEmployeeProfile, HrFormField, HrFormRules, HrLookups, HrRuleCondition } from '@/types'
import { TEXT } from '@/lib/theme'
import { useFormDraft } from '@/lib/formDraft'
import DraftBanner from '@/components/shared/DraftBanner'
import { FormPage, SheetColumns, SheetSection, SheetIcon, Req, SHEET, sheetBtn, sheetInput, sheetLabel, sheetHint } from '@/components/shared/FormSheet'
import DateField from '@/components/erp/DateField'
import SearchableSelect from '@/components/erp/SearchableSelect'
import ConfirmDialog from '@/components/erp/ConfirmDialog'
import HrNav from '@/components/hr/HrNav'
import { extractErrorMessages } from '@/lib/validation'
import {
  ErrorBanner, StatusPill, EMPLOYMENT_STATUS_LABELS, EMPLOYMENT_TYPE_LABELS,
  WORKER_TYPE_LABELS, RECORD_STATUS_LABELS, RECORD_STATUS_HEX, ATTENDANCE_POLICY_LABELS, LOGIN_STATUS_LABELS, formatDate,
} from '@/components/hr/masters/masterUi'
import { recordPath, useRecordId } from '@/lib/recordRef'
import { todayIso } from '@/components/hr/admin/adminUi'
import InvalidRecordLink from '@/components/erp/InvalidRecordLink'
import JoiningDocumentsChecklist, { DocumentOwner, StagedDocument, uploadChecklistFile } from '@/components/hr/employee/JoiningDocumentsChecklist'
import { chipBtnStyle } from '@/components/shared/ui'

const BLOOD_GROUPS = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-']
const MARITAL = [['single', 'Single'], ['married', 'Married'], ['divorced', 'Divorced'], ['widowed', 'Widowed'], ['other', 'Other']]
const GENDERS = [['male', 'Male'], ['female', 'Female'], ['other', 'Other']]
const WEEKDAYS = [['mon', 'Mon'], ['tue', 'Tue'], ['wed', 'Wed'], ['thu', 'Thu'], ['fri', 'Fri'], ['sat', 'Sat'], ['sun', 'Sun']]

// Every text/select/date field the form edits ('' = empty).
const FIELDS = [
  'employee_code', 'full_name', 'worker_type', 'employment_type', 'designation_id', 'employment_status', 'date_of_joining',
  'branch_id', 'department_id', 'grade_id', 'reporting_manager_id', 'work_location', 'probation_status', 'probation_end_date',
  'confirmation_date', 'contract_start_date', 'contract_end_date', 'shift_id', 'weekly_off', 'attendance_policy',
  'personal_phone', 'personal_email', 'date_of_birth', 'gender', 'blood_group', 'marital_status', 'current_address', 'permanent_address',
  'emergency_contact_name', 'emergency_contact_relation', 'emergency_contact_phone',
  'work_email', 'portal_role_id', 'link_user_id',
  'contractor_name', 'contractor_worker_id', 'contractor_contact_person', 'contractor_contact_phone', 'contractor_agreement_ref', 'contractor_verification',
  'pan_number', 'aadhaar_last4', 'uan_number', 'esic_number', 'safety_induction_status', 'safety_induction_date',
  'medical_clearance_status', 'medical_fitness_date',
  'date_of_exit', 'exit_reason', 'notes',
] as const
// Fields behind HR › Employees features (Organization › Role & Permissions):
// a role without create / edit on the section doesn't see or send them, and
// the server leaves the stored values alone.
const PERSONAL_KEYS = [
  'personal_phone', 'personal_email', 'date_of_birth', 'gender', 'blood_group', 'marital_status', 'current_address', 'permanent_address',
  'emergency_contact_name', 'emergency_contact_relation', 'emergency_contact_phone',
]
const STATUTORY_KEYS = ['pan_number', 'aadhaar_last4', 'uan_number', 'esic_number']
// Yes/No fields, held as 'true' / 'false' / '' (not set).
const BOOL_FIELDS = ['portal_access', 'ot_eligible', 'exit_clearance_done'] as const
type FieldKey = (typeof FIELDS)[number]
type BoolKey = (typeof BOOL_FIELDS)[number]
type FormState = Record<FieldKey | BoolKey, string> & { org_fields_locked: boolean }
const ID_FIELDS: FieldKey[] = ['department_id', 'designation_id', 'grade_id', 'branch_id', 'shift_id', 'reporting_manager_id', 'portal_role_id', 'link_user_id']
// Sent only for records without a portal account.
const NO_LOGIN_ONLY: string[] = ['full_name', 'work_email', 'portal_access', 'portal_role_id', 'link_user_id']

function toForm(p: HrEmployeeProfile | null): FormState {
  const f = {} as FormState
  const rec = (p || {}) as unknown as Record<string, unknown>
  for (const k of FIELDS) {
    const val = k === 'full_name' ? p?.name : rec[k]
    f[k] = val === null || val === undefined ? '' : String(val)
  }
  for (const k of BOOL_FIELDS) f[k] = rec[k] === true ? 'true' : rec[k] === false ? 'false' : ''
  if (!f.employment_status) f.employment_status = 'active'
  if (!f.worker_type) f.worker_type = p ? 'office' : 'factory'
  if (!f.probation_status) f.probation_status = 'not_applicable'
  f.org_fields_locked = p?.has_profile ? p.org_fields_locked !== false : true
  return f
}

// Same evaluation as backend workforce_rules.matches / applies.
function matches(cond: HrRuleCondition, ctx: Record<string, unknown>): boolean {
  if (cond === null) return true
  return cond.some((clause) => Object.entries(clause).every(([k, vals]) => (vals as unknown[]).includes(ctx[k])))
}
const applies = (cond: HrRuleCondition, ctx: Record<string, unknown>) => cond === null || (cond.length > 0 && matches(cond, ctx))

/** The dynamic workforce form — one form for office staff, factory / workshop,
 *  housekeeping and contract labour. Which fields show and which are required
 *  come from the backend rule table (GET /hr/employees/form-rules), so the form
 *  and the server always agree.
 *  - `user`: a portal account's HR record (create or edit), /hr/employees/[ref]/edit
 *  - `new-worker`: add an employee, /hr/employees/workers/new (with or without portal access)
 *  - `worker`: edit an employee without a portal account, /hr/employees/workers/[ref]/edit */
export default function EmployeeProfileForm({ mode }: { mode: 'user' | 'worker' | 'new-worker' }) {
  const { isAuthorized, isLoading } = useRequireApp('hr')
  const router = useRouter()
  const params = useParams<{ id?: string }>()
  const isWorker = mode !== 'user'
  const isNewWorker = mode === 'new-worker'
  const { id: idResolved, error: linkError } = useRecordId(isNewWorker ? undefined : params?.id)
  const id = idResolved ?? 0
  const { canFeature } = useCan()

  const [emp, setEmp] = useState<HrEmployeeProfile | null>(null)
  const [lookups, setLookups] = useState<HrLookups | null>(null)
  const [rules, setRules] = useState<HrFormRules | null>(null)
  const [form, setForm] = useState<FormState | null>(null)
  const [initial, setInitial] = useState<FormState | null>(null)
  const [loadError, setLoadError] = useState<string[]>([])
  const [errors, setErrors] = useState<string[]>([])
  const [notice, setNotice] = useState('')
  const [saving, setSaving] = useState<'' | 'save' | 'draft' | 'another'>('')
  const [confirmLeave, setConfirmLeave] = useState(false)
  // New record: documents picked before the record exists, uploaded right after it is saved.
  const [staged, setStaged] = useState<StagedDocument[]>([])

  const viewHref = isNewWorker ? '/dashboard/hr/employees' : `/dashboard/hr/employees/${isWorker ? 'workers/' : ''}${params?.id}`

  const freshForm = (rl: HrFormRules) => {
    const f = toForm(null)
    for (const [k, v] of Object.entries(rl.defaults[f.worker_type] || {})) (f as Record<string, unknown>)[k] = String(v)
    return f
  }

  useEffect(() => {
    if (!isAuthorized) return
    if (isNewWorker) {
      Promise.all([hrApi.getLookups({ include_inactive: true }), hrApi.getWorkforceFormRules()])
        .then(([lk, rl]) => { setLookups(lk); setRules(rl); const f = freshForm(rl); setForm(f); setInitial(f) })
        .catch((err) => setLoadError(extractErrorMessages(err, "Couldn't load the form.")))
      return
    }
    if (!id) return
    Promise.all([isWorker ? hrApi.getWorker(id) : hrApi.getEmployee(id), hrApi.getLookups({ include_inactive: true }), hrApi.getWorkforceFormRules()])
      .then(([p, lk, rl]) => {
        setEmp(p)
        setLookups(lk)
        setRules(rl)
        const f = toForm(p)
        if (!p.has_profile) {
          // Pre-match the free-text department/designation on the account.
          const norm = (x?: string | null) => (x || '').trim().toLowerCase()
          const dept = lk.departments.find((d) => norm(d.name) === norm(p.user_department))
          const desig = lk.designations.find((d) => norm(d.name) === norm(p.user_designation))
          if (dept && !f.department_id) f.department_id = String(dept.id)
          if (desig && !f.designation_id) f.designation_id = String(desig.id)
        }
        setForm(f)
        setInitial(f)
      })
      .catch((err) => setLoadError(extractErrorMessages(err, "Couldn't load this employee.")))
  }, [isAuthorized, id, isWorker, isNewWorker])

  const set = (k: FieldKey | BoolKey) => (v: string) => setForm((f) => (f ? { ...f, [k]: v } : f))
  const inp = (k: FieldKey) => ({ value: form?.[k] ?? '', onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => set(k)(e.target.value) })

  const rulesByKey = useMemo(() => Object.fromEntries((rules?.fields || []).map((f) => [f.key, f])) as Record<string, HrFormField>, [rules])
  const ctx = useMemo(() => ({
    worker_type: form?.worker_type || 'office', employment_type: form?.employment_type || null,
    employment_status: form?.employment_status || null, portal_access: form?.portal_access === 'true', has_login: !isWorker,
    probation_status: form?.probation_status || 'not_applicable',
    safety_induction_status: form?.safety_induction_status || null, medical_clearance_status: form?.medical_clearance_status || null,
  }), [form?.worker_type, form?.employment_type, form?.employment_status, form?.portal_access, form?.probation_status,
    form?.safety_induction_status, form?.medical_clearance_status, isWorker])
  const featureAct = isNewWorker || !emp?.has_profile ? 'create' : 'edit'
  const featureHidden = new Set<string>([
    ...(canFeature('hr', 'employees', 'personal', featureAct) ? [] : PERSONAL_KEYS),
    ...(canFeature('hr', 'employees', 'statutory_ids', featureAct) ? [] : STATUTORY_KEYS),
    ...(canFeature('hr', 'employees', 'hr_notes', 'view') ? [] : ['notes']),
  ])
  const visible = (key: string) => { if (featureHidden.has(key)) return false; const r = rulesByKey[key]; return !r || matches(r.visible, ctx) }
  const required = (key: string) => { const r = rulesByKey[key]; return !!r && visible(key) && applies(r.required, ctx) }
  const neededForComplete = (key: string) => { const r = rulesByKey[key]; return !!r && visible(key) && applies(r.complete, ctx) }
  const docOwner: DocumentOwner = useMemo(
    () => (isNewWorker || !id ? null : isWorker ? { kind: 'worker', id } : { kind: 'user', id }), [isNewWorker, isWorker, id])
  const refreshRecord = () => {
    if (!id || isNewWorker) return
    ;(isWorker ? hrApi.getWorker(id) : hrApi.getEmployee(id)).then(setEmp).catch(() => { /* the status pill just stays as it was */ })
  }
  // New employee only. PAN / Aadhaar / UAN / ESIC numbers are never kept in the draft.
  const formDraft = useFormDraft(
    isNewWorker && form ? 'hr-employee-new' : null,
    form ? Object.fromEntries(Object.entries(form).filter(([k]) => !STATUTORY_KEYS.includes(k))) : {},
    (d: Record<string, unknown>) => setForm((f) => (f ? { ...f, ...d } as FormState : f)),
  )
  const dirty = !!form && !!initial && (JSON.stringify(form) !== JSON.stringify(initial) || staged.length > 0)

  // A new record takes the worker category's starting values (employment type, attendance policy, OT, portal access…).
  const onWorkerTypeChange = (v: string) => {
    setForm((f) => {
      if (!f) return f
      const next = { ...f, worker_type: v } as FormState
      if (isNewWorker) for (const [k, val] of Object.entries(rules?.defaults[v] || {})) (next as Record<string, unknown>)[k] = String(val)
      return next
    })
  }

  // Active options, plus the currently-selected one even if it's been deactivated.
  const opts = (list: { id: number; name: string; code?: string | null; is_active: boolean }[] | undefined, current: string, withCode = false) =>
    (list || []).filter((o) => o.is_active || String(o.id) === current).map((o) => ({
      value: String(o.id), label: `${withCode && o.code ? `${o.code} · ` : ''}${o.name}${o.is_active ? '' : ' (inactive)'}`,
    }))

  const selfUserId = isWorker ? 0 : id
  const managerOptions = useMemo(() => [
    { value: '', label: '— No manager —' },
    ...(lookups?.users || []).filter((u) => u.id !== selfUserId && (u.is_active || String(u.id) === form?.reporting_manager_id))
      .map((u) => ({ value: String(u.id), label: `${u.name}${u.designation ? ` — ${u.designation}` : ''}${u.is_active ? '' : ' (deactivated)'}` })),
  ], [lookups, selfUserId, form?.reporting_manager_id])
  const accountOptions = useMemo(() => [
    { value: '', label: '— No existing account —' },
    ...(lookups?.users || []).filter((u) => u.is_active).map((u) => ({ value: String(u.id), label: `${u.name}${u.email ? ` — ${u.email}` : ''}` })),
  ], [lookups])

  const onDesignationChange = (v: string) => {
    setForm((f) => {
      if (!f) return f
      const next = { ...f, designation_id: v }
      // Designation may carry a default grade — fill it in if grade is empty.
      if (v && !f.grade_id) {
        hrApi.listDesignations().then((all) => {
          const d = all.find((x) => String(x.id) === v)
          if (d?.grade_id) setForm((ff) => (ff && !ff.grade_id ? { ...ff, grade_id: String(d.grade_id) } : ff))
        }).catch(() => { /* default grade is only a convenience */ })
      }
      return next
    })
  }

  const validate = (f: FormState, draft: boolean): string[] => {
    const p: string[] = []
    if (isWorker && !f.full_name.trim()) p.push('Full name is required — even a draft needs to say who it is.')
    if (!draft) {
      const missing = (rules?.fields || [])
        .filter((r) => r.key !== 'documents' && required(r.key))
        .filter((r) => {
          if (r.key === 'work_email' && f.link_user_id) return false  // taken from the linked account
          return (BOOL_FIELDS as readonly string[]).includes(r.key) ? f[r.key as BoolKey] !== 'true' : !String(f[r.key as FieldKey] ?? '').trim()
        })
        .map((r) => r.label)
      if (missing.length) p.push(`Required for ${WORKER_TYPE_LABELS[f.worker_type] || 'this worker category'}: ${missing.join(', ')}. Fill them in, or use Save Draft to finish later.`)
    }
    if (f.aadhaar_last4 && !/^\d{4}$/.test(f.aadhaar_last4)) p.push('Aadhaar: enter only the last 4 digits. The full Aadhaar number is never stored.')
    if (f.pan_number && !/^[A-Za-z]{5}\d{4}[A-Za-z]$/.test(f.pan_number.replace(/\s/g, ''))) p.push('PAN must be 10 characters: 5 letters, 4 digits, 1 letter (e.g. ABCDE1234F).')
    for (const [k, label] of [['personal_email', 'Personal email'], ['work_email', 'Work email']] as const) {
      if (f[k] && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(f[k])) p.push(`${label} is not a valid email address.`)
    }
    if (f.contract_start_date && f.contract_end_date && f.contract_end_date < f.contract_start_date) p.push('Contract end date is before the contract start date.')
    for (const [k, label] of [['probation_end_date', 'Probation end date'], ['confirmation_date', 'Confirmation date'], ['date_of_exit', 'Last working day']] as const) {
      if (f.date_of_joining && f[k] && f[k] < f.date_of_joining) p.push(`${label} is before the date of joining.`)
    }
    if (f.date_of_birth && f.date_of_birth >= todayIso()) p.push('Date of birth must be in the past.')
    return p
  }

  const save = async (how: 'save' | 'draft' | 'another') => {
    if (!form || !initial || !rules) return
    const draft = how === 'draft'
    const problems = validate(form, draft)
    if (problems.length) { setErrors(problems); window.scrollTo({ top: 0, behavior: 'smooth' }); return }
    const hasProfile = !isNewWorker && !!emp?.has_profile
    // Send only what changed (plus everything for a brand-new record).
    const payload: Record<string, unknown> = {}
    for (const k of FIELDS) {
      if (!isWorker && NO_LOGIN_ONLY.includes(k)) continue  // an account holder's name / login come from their account
      if (featureHidden.has(k)) continue  // section this role can't fill in
      if (hasProfile && form[k] === initial[k]) continue
      const raw = form[k].trim()
      if (ID_FIELDS.includes(k)) payload[k] = raw ? Number(raw) : null
      else payload[k] = raw || null
    }
    for (const k of BOOL_FIELDS) {
      if (!isWorker && NO_LOGIN_ONLY.includes(k)) continue
      if (hasProfile && form[k] === initial[k]) continue
      payload[k] = form[k] === '' ? null : form[k] === 'true'
    }
    // Contractor / contract details hidden by a category change don't belong to this person any more.
    for (const k of FIELDS) {
      if (/^contract(or)?_|^work_email$|^portal_role_id$/.test(k) && !visible(k) && (initial[k] || form[k])) payload[k] = null
    }
    if (!payload.link_user_id) delete payload.link_user_id
    if (!isWorker && (!hasProfile || form.org_fields_locked !== initial.org_fields_locked)) payload.org_fields_locked = form.org_fields_locked
    if (!payload.employment_status && !hasProfile) payload.employment_status = form.employment_status || 'active'
    payload.is_draft = draft
    setSaving(how)
    setErrors([])
    setNotice('')
    try {
      const res = isNewWorker ? await hrApi.createWorker(payload) : await (isWorker ? hrApi.saveWorker(id, payload) : hrApi.saveEmployee(id, payload))
      if (isNewWorker) formDraft.clear()
      const failed: string[] = []
      if (isNewWorker && staged.length) {
        // Saving the record worked; a failed document upload must not lose it — say which files to upload again.
        const owner: Exclude<DocumentOwner, null> = res.has_login && res.user_id ? { kind: 'user', id: res.user_id } : { kind: 'worker', id: res.profile_id as number }
        for (const doc of staged) {
          try { await uploadChecklistFile(owner, doc) } catch { failed.push(`${rules.documents[doc.key]} (${doc.file.name})`) }
        }
      }
      if (how === 'another') {
        const f = freshForm(rules)
        setForm(f)
        setInitial(f)
        setStaged([])
        setNotice(`Added ${res.name} (${res.employee_code || 'no ID'})${failed.length ? ` — but these documents didn't upload: ${failed.join(', ')}. Open the record to upload them again.` : '.'} The form is ready for the next employee.`)
        window.scrollTo({ top: 0, behavior: 'smooth' })
        return
      }
      const q = failed.length ? `?docs_failed=${encodeURIComponent(failed.join(', '))}` : ''
      // Portal access linked the record to an account: it now lives on the account's page.
      if (isWorker && res.has_login && res.user_id) router.push(recordPath('/dashboard/hr/employees', res, 'user_id') + q)
      else if (isNewWorker) router.push(recordPath('/dashboard/hr/employees/workers', res, 'profile_id') + q)
      else router.push(viewHref)
    } catch (err) {
      setErrors(extractErrorMessages(err, isNewWorker ? "Couldn't create the employee." : "Couldn't save the employee record."))
      window.scrollTo({ top: 0, behavior: 'smooth' })
    } finally {
      setSaving('')
    }
  }

  const cancel = () => (dirty ? setConfirmLeave(true) : router.push(viewHref))

  if (isLoading || !isAuthorized) return null
  if (linkError) return (<div><HrNav /><InvalidRecordLink message={linkError} listHref="/dashboard/hr/employees" listLabel="Back to employees" /></div>)
  if (!isNewWorker && !id) return <div><HrNav /></div>

  /** A field driven by the rule table: hidden when its visibility rule says so, starred when required. */
  const field = (key: string, node: React.ReactNode, style: React.CSSProperties, hint?: string, labelOverride?: string) => {
    if (!visible(key)) return null
    const r = rulesByKey[key]
    const label = labelOverride || r?.label || key
    const star = required(key) ? <> <Req /></> : neededForComplete(key) ? ' ◦' : ''
    return (
      <div style={style} data-tour={`hr-prof-${key.replace(/_/g, '-')}`}>
        <label style={{ ...sheetLabel, display: 'flex', alignItems: 'center', gap: 5 }}>
          <span>{label}{star}</span>
          {r && <span title={`Why: ${r.why}\nUsed by: ${r.used_by}\nEdited by: ${r.edit}`} style={{ cursor: 'help', color: SHEET.MUTED, fontWeight: 400 }}>ⓘ</span>}
        </label>
        {node}
        {hint && <p style={sheetHint}>{hint}</p>}
      </div>
    )
  }
  const yesNo = (k: BoolKey, allowUnset = false) => (
    <Select style={sheetInput} value={form?.[k] ?? ''} onChange={(e) => set(k)(e.target.value)}>
      {allowUnset && <option value="">— Not set —</option>}
      <option value="true">Yes</option>
      <option value="false">No</option>
    </Select>
  )
  const choice = (k: FieldKey, options: Record<string, string>, blank = '— Select —') => (
    <Select style={sheetInput} {...inp(k)}>
      {blank && <option value="">{blank}</option>}
      {Object.entries(options).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
    </Select>
  )
  const short: React.CSSProperties = { flex: '0 1 170px', minWidth: 150 }
  const med: React.CSSProperties = { flex: '1 1 220px', maxWidth: 320 }
  const wide: React.CSSProperties = { flex: '1 1 320px', maxWidth: 560 }
  const row: React.CSSProperties = { display: 'flex', gap: 14, flexWrap: 'wrap', marginBottom: 14 }
  const secTitle = (key: string, n?: number) => `${n ? `${n}. ` : ''}${rules?.sections[key] || key}`
  const anyVisible = (...keys: string[]) => keys.some(visible)

  const title = isNewWorker
    ? 'Add Employee'
    : emp ? `${isWorker || emp.has_profile ? 'Edit' : 'Create'} HR Record — ${emp.name}` : 'HR Record'
  const subtitle = isNewWorker
    ? 'One form for office staff, workshop, housekeeping and contract labour — the fields adapt to the worker category.'
    : isWorker ? 'No portal account — HR record only.' : emp?.email
  const exitLocked = !isWorker && form?.employment_status !== 'exited'
  // Employment type: the form's options, plus an older value still on the record.
  const typeOptions = { ...(rules?.employment_types || {}), ...(form?.employment_type && !rules?.employment_types[form.employment_type] ? { [form.employment_type]: EMPLOYMENT_TYPE_LABELS[form.employment_type] || form.employment_type } : {}) }
  const statusOptions = Object.fromEntries((rules?.employment_statuses || [])
    .filter((k) => isWorker || (initial?.employment_status === 'exited' ? k === 'exited' : k !== 'exited'))
    .map((k) => [k, EMPLOYMENT_STATUS_LABELS[k] || k]))
  const relationOptions = Object.fromEntries([...(rules?.emergency_relations || []), ...(form?.emergency_contact_relation && !rules?.emergency_relations.includes(form.emergency_contact_relation) ? [form.emergency_contact_relation] : [])].map((r) => [r, r]))

  const footer = (
    <>
      <button type="button" data-tour="hr-prof-cancel-btn" style={sheetBtn('secondary', SHEET.INK, !!saving)} disabled={!!saving} onClick={cancel}>Cancel</button>
      <button type="button" data-tour="hr-prof-draft-btn" style={sheetBtn('secondary', SHEET.INK, !!saving)} disabled={!!saving} onClick={() => save('draft')}
        title="Save without the required-field checks — the record shows as Draft until saved normally">
        <SheetIcon name="doc" size={15} />{saving === 'draft' ? 'Saving…' : 'Save Draft'}
      </button>
      {isNewWorker && (
        <button type="button" data-tour="hr-prof-another-btn" style={sheetBtn('secondary', SHEET.BLUE, !!saving)} disabled={!!saving} onClick={() => save('another')}>
          <SheetIcon name="plus" size={15} />{saving === 'another' ? 'Saving…' : 'Create & Add Another'}
        </button>
      )}
      <button type="button" data-tour="hr-prof-save-btn" style={sheetBtn('primary', SHEET.BLUE, !!saving)} disabled={!!saving} onClick={() => save('save')}>
        <SheetIcon name="check" size={16} />{saving === 'save' ? 'Saving…' : isNewWorker ? 'Create Employee' : emp?.has_profile ? 'Save Changes' : 'Create Record'}
      </button>
    </>
  )

  return (
    <div>
      <FormPage nav={<HrNav />} tour="hr-prof-form" icon={isNewWorker ? 'plus' : 'user'} title={title} subtitle={subtitle || ''} onBack={cancel} backTour="hr-prof-back"
        footer={form && rules && (emp || isNewWorker) ? footer : <button type="button" data-tour="hr-prof-cancel-btn" style={sheetBtn('secondary', SHEET.INK)} onClick={cancel}>Cancel</button>}>
        {(notice || loadError.length > 0 || errors.length > 0 || emp?.record_status) && (
          <div style={{ padding: '16px 24px 0' }}>
            {emp?.record_status && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, color: SHEET.MUTED, marginBottom: 12 }}>
                Record status <StatusPill label={RECORD_STATUS_LABELS[emp.record_status] || emp.record_status} hex={RECORD_STATUS_HEX[emp.record_status] || '#64748B'} />
              </div>
            )}
            {notice && (
              <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(22,163,74,0.08)', border: '1px solid rgba(22,163,74,0.25)', color: '#15803d', fontSize: 13 }}>{notice}</div>
            )}
            <ErrorBanner errors={[...loadError, ...errors]} />
          </div>
        )}

        {form && rules && (emp || isNewWorker) && (
          <>
            <SheetColumns
              left={<>
                <DraftBanner draft={formDraft} />
                <p style={{ ...sheetHint, margin: '0 0 16px' }}><Req /> required to save · ◦ needed for a Complete record · hover ⓘ to see why a field is asked for and what uses it.</p>
          {/* 1. Workforce information */}
          <SheetSection icon="user" title={secTitle('classification', 1)}>
            <div style={row}>
              {field('employee_code', <input style={sheetInput} {...inp('employee_code')} onChange={(e) => set('employee_code')(e.target.value.toUpperCase())} placeholder="Auto: WF-00001" />, short,
                form.employee_code ? undefined : 'Left blank, the next WF- number is assigned.')}
              {field('full_name', <input style={sheetInput} {...inp('full_name')} placeholder="As on Aadhaar" autoFocus={isNewWorker} />, { flex: '1 1 240px', maxWidth: 340 })}
              {field('worker_type', (
                <Select style={sheetInput} value={form.worker_type} onChange={(e) => onWorkerTypeChange(e.target.value)}>
                  {Object.entries(rules.worker_types).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </Select>
              ), { flex: '0 1 220px', minWidth: 200 })}
            </div>
            <div style={row}>
              {field('employment_type', choice('employment_type', typeOptions), { flex: '0 1 200px', minWidth: 180 })}
              {field('designation_id', <SearchableSelect value={form.designation_id} onChange={onDesignationChange} options={[{ value: '', label: '— Select —' }, ...opts(lookups?.designations, form.designation_id)]} placeholder="— Select —" />, med,
                !form.designation_id && emp?.user_designation ? `Account currently says "${emp.user_designation}". Add it under Masters > Designations if it's missing.` : undefined)}
              {field('employment_status', choice('employment_status', statusOptions, ''), short, isWorker ? undefined : form.employment_status === 'exited'
                ? 'To rehire, raise a joining event in HR > Lifecycle.'
                : 'To record an exit, raise an exit event in HR > Lifecycle.')}
              {field('date_of_joining', <DateField value={form.date_of_joining} onChange={set('date_of_joining')} />, short)}
            </div>
            <p style={{ ...sheetHint, margin: 0 }}>
              Worker category, employment type, designation, employment status and probation status are separate on purpose — each answers one question. A contract labourer is a contractor&apos;s worker; someone on our own rolls for a fixed period is Fixed-term.
            </p>
          </SheetSection>

          {/* 2. Employment & organisation */}
          <SheetSection icon="building" title={secTitle('organization', 2)}>
            <div style={row}>
              {field('branch_id', choice('branch_id', Object.fromEntries(opts(lookups?.branches, form.branch_id).map((o) => [o.value, o.label]))), short)}
              {field('department_id', <SearchableSelect value={form.department_id} onChange={set('department_id')} options={[{ value: '', label: '— None —' }, ...opts(lookups?.departments, form.department_id)]} placeholder="— None —" />, med,
                !form.department_id && emp?.user_department ? `Account currently says "${emp.user_department}". Pick the matching department.` : undefined)}
              {field('grade_id', choice('grade_id', Object.fromEntries(opts(lookups?.grades, form.grade_id, true).map((o) => [o.value, o.label])), '— None —'), short)}
            </div>
            <div style={row}>
              {field('reporting_manager_id', <SearchableSelect value={form.reporting_manager_id} onChange={set('reporting_manager_id')} options={managerOptions} placeholder="— No manager —" />, med,
                isWorker ? 'The portal user responsible for this person (internal supervisor).' : 'Leave, attendance, travel and expense approvals go to this person.')}
              {field('work_location', <input style={sheetInput} {...inp('work_location')} placeholder="Shop floor / Office, Bay 2" />, med)}
            </div>
            <div style={row}>
              {field('probation_status', choice('probation_status', rules.probation_statuses, ''), short)}
              {field('probation_end_date', <DateField value={form.probation_end_date} onChange={set('probation_end_date')} />, short)}
              {field('confirmation_date', <DateField value={form.confirmation_date} onChange={set('confirmation_date')} />, short)}
              {field('contract_start_date', <DateField value={form.contract_start_date} onChange={set('contract_start_date')} />, short)}
              {field('contract_end_date', <DateField value={form.contract_end_date} onChange={set('contract_end_date')} />, short)}
            </div>
            <div style={row}>
              {field('shift_id', choice('shift_id', Object.fromEntries(opts(lookups?.shifts, form.shift_id, true).map((o) => [o.value, o.label])), '— None —'), short,
                lookups && !lookups.shifts?.length ? 'No shifts yet — add them under HR > Masters > Shifts.' : undefined)}
              {field('attendance_policy', choice('attendance_policy', Object.fromEntries(Object.keys(rules.attendance_policies).map((k) => [k, ATTENDANCE_POLICY_LABELS[k] || rules.attendance_policies[k]]))), { flex: '0 1 210px', minWidth: 190 })}
              {field('ot_eligible', yesNo('ot_eligible', true), { flex: '0 1 150px', minWidth: 130 })}
              {field('weekly_off', (
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {WEEKDAYS.map(([k, v]) => {
                    const on = form.weekly_off.split(',').includes(k)
                    const toggle = () => {
                      const cur = form.weekly_off ? form.weekly_off.split(',') : []
                      const next = on ? cur.filter((d) => d !== k) : [...cur, k]
                      set('weekly_off')(WEEKDAYS.map(([d]) => d).filter((d) => next.includes(d)).join(','))
                    }
                    return (
                      <button key={k} type="button" onClick={toggle} style={chipBtnStyle(on)}>{v}</button>
                    )
                  })}
                </div>
              ), { flex: '1 1 340px' }, form.weekly_off ? undefined : 'None picked = the plant’s working days decide.')}
            </div>
            {!isWorker && <p style={{ ...sheetHint, margin: 0 }}>Department, designation and plant are copied to the person&apos;s portal account, so approvals in other modules (e.g. P2P department-head routing) follow them.</p>}
          </SheetSection>

          {/* 3. Contact & personal */}
          {anyVisible(...PERSONAL_KEYS) && <SheetSection icon="users" title={secTitle('personal', 3)}>
            <div style={row}>
              {field('personal_phone', <input style={sheetInput} {...inp('personal_phone')} placeholder="+91 98765 43210" />, short)}
              {field('personal_email', <input style={sheetInput} {...inp('personal_email')} placeholder="name@gmail.com" />, { flex: '1 1 240px', maxWidth: 320 })}
              {field('date_of_birth', <DateField value={form.date_of_birth} onChange={set('date_of_birth')} />, short)}
              {field('gender', choice('gender', Object.fromEntries(GENDERS)), short)}
            </div>
            <div style={row}>
              {field('blood_group', choice('blood_group', Object.fromEntries(BLOOD_GROUPS.map((b) => [b, b]))), { flex: '0 1 120px', minWidth: 110 })}
              {field('marital_status', choice('marital_status', Object.fromEntries(MARITAL)), short)}
            </div>
            <div style={row}>
              {field('current_address', <textarea style={{ ...sheetInput, minHeight: 70, resize: 'vertical' }} {...inp('current_address')} />, wide)}
              {field('permanent_address', <textarea style={{ ...sheetInput, minHeight: 70, resize: 'vertical' }} {...inp('permanent_address')} />, wide)}
            </div>
            <div style={row}>
              {field('emergency_contact_name', <input style={sheetInput} {...inp('emergency_contact_name')} />, med)}
              {field('emergency_contact_relation', choice('emergency_contact_relation', relationOptions), short, undefined, 'Relationship')}
              {field('emergency_contact_phone', <input style={sheetInput} {...inp('emergency_contact_phone')} />, short, undefined, 'Emergency Phone')}
            </div>
          </SheetSection>}

          {/* 4. Portal access (records without an account) */}
          {anyVisible('portal_access') && (
            <SheetSection icon="shield" title={secTitle('access', 4)}>
              <div style={row}>
                {field('portal_access', yesNo('portal_access'), short)}
                {form.portal_access === 'true' && (
                  <div style={med}>
                    <label style={sheetLabel}>Linked User Account</label>
                    <SearchableSelect value={form.link_user_id} onChange={(v) => setForm({ ...form, link_user_id: v, work_email: v ? '' : form.work_email })} options={accountOptions} placeholder="— No existing account —" />
                    <p style={sheetHint}>If they already have a portal account, pick it — the record links to it on save.</p>
                  </div>
                )}
                {!form.link_user_id && field('work_email', <input style={sheetInput} {...inp('work_email')} placeholder="name@premnathrail.com" />, { flex: '1 1 260px', maxWidth: 340 },
                  'Their company (Microsoft) email. The record links when they first sign in.')}
                {field('portal_role_id', choice('portal_role_id', Object.fromEntries(rules.roles.map((r) => [String(r.id), r.name]))), med)}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, color: TEXT.secondary }}>
                <span>Login provisioning:</span>
                <StatusPill
                  label={LOGIN_STATUS_LABELS[emp?.login_status || (form.portal_access === 'true' ? 'not_provisioned' : 'not_required')]}
                  hex={emp?.login_status === 'linked' ? '#16A34A' : form.portal_access === 'true' ? '#CA8A04' : '#64748B'} />
                <span style={{ color: TEXT.muted }}>(system-managed)</span>
              </div>
            </SheetSection>
          )}

          {/* 5. Contractor */}
          {anyVisible('contractor_name') && (
            <SheetSection icon="truck" title={secTitle('contractor', 5)}>
              <div style={row}>
                {field('contractor_name', <input style={sheetInput} {...inp('contractor_name')} placeholder="Contractor firm name" />, med,
                  form.worker_type !== 'contract' ? 'Leave blank if they are on our own rolls.' : undefined)}
                {field('contractor_worker_id', <input style={sheetInput} {...inp('contractor_worker_id')} />, short)}
                {field('contractor_agreement_ref', <input style={sheetInput} {...inp('contractor_agreement_ref')} placeholder="WO-2026-014" />, short)}
                {field('contractor_verification', choice('contractor_verification', rules.verification_statuses), short)}
              </div>
              <div style={row}>
                {field('contractor_contact_person', <input style={sheetInput} {...inp('contractor_contact_person')} />, med)}
                {field('contractor_contact_phone', <input style={sheetInput} {...inp('contractor_contact_phone')} placeholder="+91 98765 43210" />, short)}
              </div>
              {form.worker_type === 'contract' && <p style={{ ...sheetHint, margin: 0 }}>Contract dates, assigned plant / site and internal supervisor are in section 2.</p>}
            </SheetSection>
          )}

          {/* 7. Statutory & compliance */}
          <SheetSection icon="flag" title={secTitle('compliance', 7)}>
            <div style={row}>
              {field('pan_number', <input style={sheetInput} {...inp('pan_number')} onChange={(e) => set('pan_number')(e.target.value.toUpperCase())} placeholder="ABCDE1234F" />, short)}
              {field('aadhaar_last4', <input style={sheetInput} {...inp('aadhaar_last4')} onChange={(e) => set('aadhaar_last4')(e.target.value.replace(/\D/g, '').slice(0, 4))} placeholder="1234" inputMode="numeric" />, short)}
              {field('uan_number', <input style={sheetInput} {...inp('uan_number')} />, short)}
              {field('esic_number', <input style={sheetInput} {...inp('esic_number')} />, short)}
            </div>
            <div style={row}>
              {field('safety_induction_status', choice('safety_induction_status', rules.clearance_statuses.safety_induction_status), short)}
              {field('safety_induction_date', <DateField value={form.safety_induction_date} onChange={set('safety_induction_date')} />, short)}
              {field('medical_clearance_status', choice('medical_clearance_status', rules.clearance_statuses.medical_clearance_status), short)}
              {field('medical_fitness_date', <DateField value={form.medical_fitness_date} onChange={set('medical_fitness_date')} />, short)}
            </div>
            <p style={{ ...sheetHint, margin: 0 }}>Statutory IDs are visible to HR and the employee only. Payroll stays in ADP — these are kept for reference and compliance checks.</p>
          </SheetSection>

          {/* Exit */}
          {anyVisible('date_of_exit', 'exit_reason') && (
            <SheetSection icon="undo" title={secTitle('exit')}>
              <div style={row}>
                {/* Account holders: the Last Working Day is set when the Exit event completes in HR > Lifecycle. */}
                {field('date_of_exit', exitLocked
                  ? <p style={{ ...sheetHint, margin: '10px 0 0' }}>Set when an Exit event is completed in HR &gt; Lifecycle.</p>
                  : <DateField value={form.date_of_exit} onChange={set('date_of_exit')} />, short)}
                {field('exit_reason', <input style={sheetInput} {...inp('exit_reason')} />, wide)}
                {field('exit_clearance_done', yesNo('exit_clearance_done'), short)}
              </div>
            </SheetSection>
          )}

              </>}
              right={<>
          {/* 8. HR administration */}
          <SheetSection icon="gear" title={secTitle('admin', 8)}>
            <div style={row}>
              {field('notes', <textarea style={{ ...sheetInput, minHeight: 70, resize: 'vertical' }} {...inp('notes')} />, { flex: '1 1 420px', maxWidth: 720 })}
            </div>
            {!isWorker && (
              <label data-tour="hr-prof-org-lock" style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 13, color: TEXT.secondary, cursor: 'pointer', marginBottom: 10 }}>
                <input type="checkbox" style={{ marginTop: 2 }} checked={form.org_fields_locked} onChange={(e) => setForm({ ...form, org_fields_locked: e.target.checked })} />
                <span>
                  HR owns department, designation, manager and plant
                  <span style={{ display: 'block', fontSize: 11.5, color: TEXT.muted }}>When ticked, Azure AD login and &quot;Sync Azure Users&quot; won&apos;t overwrite these fields. Untick to let Azure keep them in step again.</span>
                </span>
              </label>
            )}
            <p style={{ ...sheetHint, margin: 0 }}>
              Record status: <b>{RECORD_STATUS_LABELS[emp?.record_status || ''] || (isNewWorker ? 'set on save' : '—')}</b>
              {emp?.has_profile && <> · Created {formatDate(emp.created_at?.slice(0, 10))}{emp.created_by_name ? ` by ${emp.created_by_name}` : ''} · Last updated {formatDate(emp.updated_at?.slice(0, 10))}{emp.updated_by_name ? ` by ${emp.updated_by_name}` : ''}. Every change is in the audit log.</>}
            </p>
          </SheetSection>

              </>}
            />
            <div style={{ padding: '20px 24px 4px', borderTop: `1px solid ${SHEET.LINE}` }}>
          {/* 6. Documents */}
          <SheetSection icon="doc" title={secTitle('documents', 6)}>
            {canFeature('hr', 'employees', 'documents', 'view')
              ? <JoiningDocumentsChecklist rules={rules} ctx={ctx} owner={docOwner} staged={staged} onStage={setStaged} onChanged={refreshRecord} />
              : <p style={{ ...sheetHint, margin: 0 }}>Your role doesn&apos;t include HR › Employees › Documents, so employee documents aren&apos;t shown here. Ask an admin to add it in Organization › Role &amp; Permissions if you need them.</p>}
          </SheetSection>

            </div>
          </>
        )}
      </FormPage>

      <ConfirmDialog
        open={confirmLeave}
        title="Discard changes?"
        message="You have unsaved changes on this form. Leave without saving? Use Save Draft to keep them."
        confirmLabel="Discard"
        onConfirm={() => { setConfirmLeave(false); router.push(viewHref) }}
        onCancel={() => setConfirmLeave(false)}
      />
    </div>
  )
}
