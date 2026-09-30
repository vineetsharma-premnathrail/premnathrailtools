'use client'

import { useEffect, useMemo, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { hrApi } from '@/lib/api'
import { HrEmployeeProfile, HrLookups } from '@/types'
import { TEXT } from '@/lib/theme'
import { inputStyle, primaryBtnStyle, secondaryBtnStyle } from '@/components/shared/ui'
import DateField from '@/components/erp/DateField'
import SearchableSelect from '@/components/erp/SearchableSelect'
import HrNav from '@/components/hr/HrNav'
import { extractErrorMessages } from '@/lib/validation'
import { sectionStyle, labelStyle, hintStyle, ErrorBanner, EMPLOYMENT_STATUS_LABELS, EMPLOYMENT_TYPE_LABELS } from '@/components/hr/masters/masterUi'

const BLOOD_GROUPS = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-']
const MARITAL = [['single', 'Single'], ['married', 'Married'], ['divorced', 'Divorced'], ['widowed', 'Widowed'], ['other', 'Other']]
const GENDERS = [['male', 'Male'], ['female', 'Female'], ['other', 'Other']]

// Every field the form edits, as strings ('' = empty) plus the lock flag.
const FIELDS = [
  'employee_code', 'department_id', 'designation_id', 'grade_id', 'branch_id', 'shift_id', 'reporting_manager_id', 'date_of_joining',
  'employment_type', 'employment_status', 'probation_end_date', 'confirmation_date', 'date_of_exit', 'exit_reason', 'work_location',
  'gender', 'date_of_birth', 'blood_group', 'marital_status', 'personal_email', 'personal_phone',
  'emergency_contact_name', 'emergency_contact_phone', 'emergency_contact_relation', 'current_address', 'permanent_address',
  'pan_number', 'aadhaar_last4', 'uan_number', 'esic_number', 'notes',
] as const
type FieldKey = (typeof FIELDS)[number]
type FormState = Record<FieldKey, string> & { org_fields_locked: boolean }
const ID_FIELDS: FieldKey[] = ['department_id', 'designation_id', 'grade_id', 'branch_id', 'shift_id', 'reporting_manager_id']

function toForm(p: HrEmployeeProfile): FormState {
  const f = {} as FormState
  for (const k of FIELDS) {
    const val = (p as unknown as Record<string, unknown>)[k]
    f[k] = val === null || val === undefined ? '' : String(val)
  }
  if (!f.employment_status) f.employment_status = 'active'
  f.org_fields_locked = p.has_profile ? p.org_fields_locked !== false : true
  return f
}

export default function HrEmployeeEditPage() {
  const { isAuthorized, isLoading } = useRequireApp('hr')
  const router = useRouter()
  const params = useParams<{ id: string }>()
  const id = Number(params?.id)

  const [emp, setEmp] = useState<HrEmployeeProfile | null>(null)
  const [lookups, setLookups] = useState<HrLookups | null>(null)
  const [form, setForm] = useState<FormState | null>(null)
  const [initial, setInitial] = useState<FormState | null>(null)
  const [loadError, setLoadError] = useState<string[]>([])
  const [errors, setErrors] = useState<string[]>([])
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!isAuthorized || !Number.isFinite(id)) return
    Promise.all([hrApi.getEmployee(id), hrApi.getLookups({ include_inactive: true })])
      .then(([p, lk]) => {
        setEmp(p)
        setLookups(lk)
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
  }, [isAuthorized, id])

  const set = (k: FieldKey) => (v: string) => setForm((f) => (f ? { ...f, [k]: v } : f))
  const inp = (k: FieldKey) => ({ value: form?.[k] ?? '', onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => set(k)(e.target.value) })

  // Active options, plus the currently-selected one even if it's been deactivated.
  const opts = (list: { id: number; name: string; code?: string | null; is_active: boolean }[] | undefined, current: string, withCode = false) =>
    (list || []).filter((o) => o.is_active || String(o.id) === current).map((o) => ({
      value: String(o.id), label: `${withCode && o.code ? `${o.code} · ` : ''}${o.name}${o.is_active ? '' : ' (inactive)'}`,
    }))

  const managerOptions = useMemo(() => [
    { value: '', label: '— No manager —' },
    ...(lookups?.users || []).filter((u) => u.id !== id && (u.is_active || String(u.id) === form?.reporting_manager_id))
      .map((u) => ({ value: String(u.id), label: `${u.name}${u.designation ? ` — ${u.designation}` : ''}${u.is_active ? '' : ' (deactivated)'}` })),
  ], [lookups, id, form?.reporting_manager_id])

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

  const validate = (f: FormState): string[] => {
    const p: string[] = []
    if (f.aadhaar_last4 && !/^\d{4}$/.test(f.aadhaar_last4)) p.push('Aadhaar: enter only the last 4 digits. The full Aadhaar number is never stored.')
    if (f.pan_number && !/^[A-Za-z]{5}\d{4}[A-Za-z]$/.test(f.pan_number.replace(/\s/g, ''))) p.push('PAN must be 10 characters: 5 letters, 4 digits, 1 letter (e.g. ABCDE1234F).')
    if (f.personal_email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(f.personal_email)) p.push('Personal email is not a valid email address.')
    if (f.employment_status === 'probation' && !f.probation_end_date) p.push('Status "Probation" needs a Probation End Date so HR is reminded before it ends.')
    if (f.employment_status === 'exited' && !f.date_of_exit) p.push('Status "Exited" needs a Date of Exit (last working day). For a full exit with checklist, use HR > Lifecycle > New > Exit.')
    for (const [k, label] of [['probation_end_date', 'Probation end date'], ['confirmation_date', 'Confirmation date'], ['date_of_exit', 'Date of exit']] as const) {
      if (f.date_of_joining && f[k] && f[k] < f.date_of_joining) p.push(`${label} is before the date of joining.`)
    }
    if (f.date_of_birth && f.date_of_birth >= new Date().toISOString().slice(0, 10)) p.push('Date of birth must be in the past.')
    return p
  }

  const save = async () => {
    if (!form || !initial) return
    const problems = validate(form)
    if (problems.length) { setErrors(problems); window.scrollTo({ top: 0, behavior: 'smooth' }); return }
    // Send only what changed (plus everything for a brand-new profile).
    const payload: Record<string, unknown> = {}
    for (const k of FIELDS) {
      if (emp?.has_profile && form[k] === initial[k]) continue
      const raw = form[k].trim()
      if (ID_FIELDS.includes(k)) payload[k] = raw ? Number(raw) : null
      else payload[k] = raw || null
    }
    if (!emp?.has_profile || form.org_fields_locked !== initial.org_fields_locked) payload.org_fields_locked = form.org_fields_locked
    if (!payload.employment_status && !emp?.has_profile) payload.employment_status = 'active'
    if (emp?.has_profile && Object.keys(payload).length === 0) { router.push(`/dashboard/hr/employees/${id}`); return }
    setSaving(true)
    setErrors([])
    try {
      await hrApi.saveEmployee(id, payload)
      router.push(`/dashboard/hr/employees/${id}`)
    } catch (err) {
      setErrors(extractErrorMessages(err, "Couldn't save the employee profile."))
      window.scrollTo({ top: 0, behavior: 'smooth' })
    } finally {
      setSaving(false)
    }
  }

  if (isLoading || !isAuthorized) return null

  const field = (label: string, node: React.ReactNode, style: React.CSSProperties, hint?: string) => (
    <div style={style}>
      <label style={labelStyle}>{label}</label>
      {node}
      {hint && <p style={hintStyle}>{hint}</p>}
    </div>
  )
  const short: React.CSSProperties = { flex: '0 1 170px', minWidth: 150 }
  const med: React.CSSProperties = { flex: '1 1 220px', maxWidth: 320 }
  const wide: React.CSSProperties = { flex: '1 1 320px', maxWidth: 560 }
  const row: React.CSSProperties = { display: 'flex', gap: 14, flexWrap: 'wrap', marginBottom: 14 }
  const h2: React.CSSProperties = { fontSize: 14, fontWeight: 700, color: TEXT.heading, margin: '0 0 14px' }

  return (
    <div>
      <HrNav />

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, marginBottom: 18, flexWrap: 'wrap' }}>
        <div>
          <p style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 4px' }}>
            HR &amp; Administration · Employees
          </p>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: TEXT.heading, margin: '0 0 4px' }}>
            {emp ? `${emp.has_profile ? 'Edit' : 'Create'} HR Profile — ${emp.name}` : 'HR Profile'}
          </h1>
          <p style={{ fontSize: 13.5, color: TEXT.muted, margin: 0 }}>{emp?.email}</p>
        </div>
        <button onClick={() => router.push(`/dashboard/hr/employees/${id}`)} type="button" style={secondaryBtnStyle}>← Back</button>
      </div>

      <ErrorBanner errors={[...loadError, ...errors]} />

      {form && emp && (
        <>
          <div style={sectionStyle}>
            <h2 style={h2}>Employment &amp; Organisation</h2>
            <div style={row}>
              {field('Employee Code', <input style={inputStyle} {...inp('employee_code')} onChange={(e) => set('employee_code')(e.target.value.toUpperCase())} placeholder="PRT-0123" />, short)}
              {field('Date of Joining', <DateField value={form.date_of_joining} onChange={set('date_of_joining')} />, short)}
              {field('Employment Type', (
                <select style={inputStyle} {...inp('employment_type')}>
                  <option value="">— Select —</option>
                  {Object.entries(EMPLOYMENT_TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              ), short)}
              {field('Employment Status *', (
                <select style={inputStyle} {...inp('employment_status')}>
                  {/* Exits and rehires go through HR > Lifecycle, so 'Exited' is never a choice to switch to or from here. */}
                  {Object.entries(EMPLOYMENT_STATUS_LABELS)
                    .filter(([k]) => (initial?.employment_status === 'exited' ? k === 'exited' : k !== 'exited'))
                    .map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              ), short, form.employment_status === 'exited'
                ? 'To rehire, raise a joining event in HR > Lifecycle.'
                : 'To record an exit, raise an exit event in HR > Lifecycle.')}
            </div>
            <div style={row}>
              {field('Department', <SearchableSelect value={form.department_id} onChange={set('department_id')} options={[{ value: '', label: '— None —' }, ...opts(lookups?.departments, form.department_id)]} placeholder="— None —" />, med,
                !form.department_id && emp.user_department ? `Account currently says "${emp.user_department}". Pick the matching department.` : undefined)}
              {field('Designation', <SearchableSelect value={form.designation_id} onChange={onDesignationChange} options={[{ value: '', label: '— None —' }, ...opts(lookups?.designations, form.designation_id)]} placeholder="— None —" />, med,
                !form.designation_id && emp.user_designation ? `Account currently says "${emp.user_designation}". Add it under Masters > Designations if it's missing.` : undefined)}
              {field('Grade', (
                <select style={inputStyle} {...inp('grade_id')}>
                  <option value="">— None —</option>
                  {opts(lookups?.grades, form.grade_id, true).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              ), short)}
            </div>
            <div style={row}>
              {field('Reporting Manager', <SearchableSelect value={form.reporting_manager_id} onChange={set('reporting_manager_id')} options={managerOptions} placeholder="— No manager —" />, med,
                'Leave, attendance, travel and expense approvals go to this person.')}
              {field('Plant', (
                <select style={inputStyle} {...inp('branch_id')}>
                  <option value="">— None —</option>
                  {opts(lookups?.branches, form.branch_id).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              ), short)}
              {field('Shift', (
                <select style={inputStyle} {...inp('shift_id')}>
                  <option value="">— None —</option>
                  {opts(lookups?.shifts, form.shift_id, true).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              ), short)}
              {field('Work Location', <input style={inputStyle} {...inp('work_location')} placeholder="Shop floor / Office, Bay 2" />, med)}
            </div>
            <div style={row}>
              {field('Probation End Date', <DateField value={form.probation_end_date} onChange={set('probation_end_date')} />, short)}
              {field('Confirmation Date', <DateField value={form.confirmation_date} onChange={set('confirmation_date')} />, short)}
              {/* Exits go through HR > Lifecycle (the backend refuses a Date of Exit on anyone not exited);
                  it can only be corrected here once the exit is completed. */}
              {form.employment_status === 'exited'
                ? field('Date of Exit', <DateField value={form.date_of_exit} onChange={set('date_of_exit')} />, short)
                : field('Date of Exit', <p style={{ ...hintStyle, margin: '10px 0 0' }}>Set when an Exit event is completed in HR &gt; Lifecycle.</p>, short)}
              {(form.date_of_exit || form.employment_status === 'exited' || form.employment_status === 'notice') && field('Exit Reason', <input style={inputStyle} {...inp('exit_reason')} />, wide)}
            </div>
            <p style={{ ...hintStyle, margin: 0 }}>Department, designation and plant are copied to the person&apos;s portal account, so approvals in other modules (e.g. P2P department-head routing) follow them.</p>
          </div>

          <div style={sectionStyle}>
            <h2 style={h2}>Personal Details</h2>
            <div style={row}>
              {field('Gender', (
                <select style={inputStyle} {...inp('gender')}>
                  <option value="">— Select —</option>
                  {GENDERS.map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              ), short)}
              {field('Date of Birth', <DateField value={form.date_of_birth} onChange={set('date_of_birth')} />, short)}
              {field('Blood Group', (
                <select style={inputStyle} {...inp('blood_group')}>
                  <option value="">— Select —</option>
                  {BLOOD_GROUPS.map((b) => <option key={b} value={b}>{b}</option>)}
                </select>
              ), { flex: '0 1 120px', minWidth: 110 })}
              {field('Marital Status', (
                <select style={inputStyle} {...inp('marital_status')}>
                  <option value="">— Select —</option>
                  {MARITAL.map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              ), short)}
            </div>
            <div style={row}>
              {field('Personal Email', <input style={inputStyle} {...inp('personal_email')} placeholder="name@gmail.com" />, { flex: '1 1 240px', maxWidth: 320 })}
              {field('Personal Phone', <input style={inputStyle} {...inp('personal_phone')} placeholder="+91 98765 43210" />, short)}
            </div>
            <div style={row}>
              {field('Current Address', <textarea style={{ ...inputStyle, minHeight: 70, resize: 'vertical', fontFamily: 'inherit' }} {...inp('current_address')} />, wide)}
              {field('Permanent Address', <textarea style={{ ...inputStyle, minHeight: 70, resize: 'vertical', fontFamily: 'inherit' }} {...inp('permanent_address')} />, wide)}
            </div>
          </div>

          <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', alignItems: 'flex-start' }}>
            <div style={{ flex: '1 1 380px', display: 'flex', flexDirection: 'column' }}>
              <div style={sectionStyle}>
                <h2 style={h2}>Emergency Contact</h2>
                <div style={row}>
                  {field('Name', <input style={inputStyle} {...inp('emergency_contact_name')} />, med)}
                  {field('Relation', <input style={inputStyle} {...inp('emergency_contact_relation')} placeholder="Spouse / Father" />, short)}
                  {field('Phone', <input style={inputStyle} {...inp('emergency_contact_phone')} />, short)}
                </div>
              </div>
            </div>
            <div style={{ flex: '1 1 380px', display: 'flex', flexDirection: 'column' }}>
              <div style={sectionStyle}>
                <h2 style={h2}>Statutory IDs</h2>
                <div style={row}>
                  {field('PAN', <input style={inputStyle} {...inp('pan_number')} onChange={(e) => set('pan_number')(e.target.value.toUpperCase())} placeholder="ABCDE1234F" />, short)}
                  {field('Aadhaar (last 4 only)', <input style={inputStyle} {...inp('aadhaar_last4')} onChange={(e) => set('aadhaar_last4')(e.target.value.replace(/\D/g, '').slice(0, 4))} placeholder="1234" inputMode="numeric" />, short)}
                  {field('UAN (PF)', <input style={inputStyle} {...inp('uan_number')} />, short)}
                  {field('ESIC No.', <input style={inputStyle} {...inp('esic_number')} />, short)}
                </div>
                <p style={{ ...hintStyle, margin: 0 }}>Payroll stays in ADP — these are kept for reference only.</p>
              </div>
            </div>
          </div>

          <div style={sectionStyle}>
            <h2 style={h2}>HR Notes &amp; Settings</h2>
            <div style={row}>
              {field('Internal Notes (HR only)', <textarea style={{ ...inputStyle, minHeight: 70, resize: 'vertical', fontFamily: 'inherit' }} {...inp('notes')} />, { flex: '1 1 420px', maxWidth: 720 })}
            </div>
            <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 13, color: TEXT.secondary, cursor: 'pointer' }}>
              <input type="checkbox" style={{ marginTop: 2 }} checked={form.org_fields_locked} onChange={(e) => setForm({ ...form, org_fields_locked: e.target.checked })} />
              <span>
                HR owns department, designation, manager and plant
                <span style={{ display: 'block', fontSize: 11.5, color: TEXT.muted }}>When ticked, Azure AD login and &quot;Sync Azure Users&quot; won&apos;t overwrite these fields. Untick to let Azure keep them in step again.</span>
              </span>
            </label>
          </div>

          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginBottom: 30 }}>
            <button type="button" style={secondaryBtnStyle} disabled={saving} onClick={() => router.push(`/dashboard/hr/employees/${id}`)}>Cancel</button>
            <button type="button" style={{ ...primaryBtnStyle, opacity: saving ? 0.7 : 1 }} disabled={saving} onClick={save}>
              {saving ? 'Saving…' : emp.has_profile ? 'Save Changes' : 'Create Profile'}
            </button>
          </div>
        </>
      )}
    </div>
  )
}
