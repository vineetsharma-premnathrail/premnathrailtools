'use client'

import Select from '@/components/shared/Select'
import { useEffect, useRef, useState } from 'react'
import { useFormDraft } from '@/lib/formDraft'
import DraftBanner from '@/components/shared/DraftBanner'
import { MinusCircle, Warning } from '@phosphor-icons/react'
import { useAuth } from '@/hooks/useAuth'
import { erpApi } from '@/lib/api'
import { Project, ServiceRequest } from '@/types'
import DateField from './DateField'
import SearchableSelect from './SearchableSelect'
import PhoneField, { isPhoneValid } from './PhoneField'
import ValidatedInput from '@/components/ValidatedInput'
import { isValidEmail, VALIDATION_MESSAGES } from '@/lib/validation'
import { FormPage, SheetColumns, SheetSection, SheetIcon, SHEET, Optional, Req, sheetBtn, sheetInput, sheetLabel, sheetHint } from '@/components/shared/FormSheet'
import { extractErrorMessages } from '@/lib/validation'
import { formatDate } from '@/lib/format'
import { SERVICE_TYPES } from './serviceTypes'
import { pillStyle } from '@/components/shared/ui'

const PRIORITIES = [
  { value: 'standard', label: 'Standard', sub: 'Normal service request', color: '#2563eb', bg: 'rgba(37,99,235,0.1)', icon: 'minus' },
  { value: 'urgent', label: 'Urgent', sub: 'Needs faster attention', color: '#dc2626', bg: 'rgba(220,38,38,0.1)', icon: 'warning' },
] as const

function PriorityIcon({ name }: { name: string }) {
  switch (name) {
    case 'warning':
      return <Warning size={15} />
    case 'minus':
      return <MinusCircle size={15} />
    default:
      return null
  }
}

const STATUS_OPTIONS = [
  { value: 'open', label: 'Open' },
  { value: 'acknowledged', label: 'Acknowledged' },
  { value: 'scheduled', label: 'Scheduled' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'pending_parts', label: 'Pending Parts' },
  { value: 'on_hold', label: 'On Hold' },
  { value: 'work_completed', label: 'Work Completed' },
  { value: 'review', label: 'Review' },
  { value: 'closed', label: 'Closed' },
  { value: 'cancelled', label: 'Cancelled' },
]

type FormState = {
  project_id: string
  issue_title: string
  issue_description: string
  issue_category: string
  service_type: string
  site_location: string
  priority: string
  status: string
  expected_date_to_attend: string
  expected_completion_date: string
  reported_by_name: string
  reported_by_phone: string
  reported_by_email: string
  service_report_notes: string
}

function toFormState(initial?: Partial<ServiceRequest>): FormState {
  return {
    project_id: initial?.project_id ? String(initial.project_id) : '',
    issue_title: initial?.issue_title || '',
    issue_description: initial?.issue_description || '',
    issue_category: initial?.issue_category || '',
    service_type: initial?.service_type || '',
    site_location: '',
    priority: initial?.priority || '',
    status: initial?.status || 'open',
    expected_date_to_attend: initial?.expected_date_to_attend || '',
    expected_completion_date: initial?.expected_completion_date || '',
    reported_by_name: initial?.reported_by_name || '',
    reported_by_phone: initial?.reported_by_phone || '',
    reported_by_email: initial?.reported_by_email || '',
    service_report_notes: initial?.service_report_notes || '',
  }
}

function todayISO() {
  // Local date — toISOString() is UTC and gives yesterday before 05:30 IST.
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export default function ServiceRequestForm({
  initial,
  lockProject,
  submitLabel,
  onSubmit,
  onCancel,
  title,
  subtitle,
  nav,
}: {
  initial?: Partial<ServiceRequest>
  /** True in edit mode — the machine a Service Request is raised against can't be changed after creation. */
  lockProject?: boolean
  submitLabel: string
  onSubmit: (payload: Record<string, unknown>, files: File[]) => Promise<void>
  /** "← Back" pill (top-right) and the footer Cancel. */
  onCancel: () => void
  title: string
  subtitle: string
  /** Module sub-nav, rendered above the header. */
  nav?: React.ReactNode
}) {
  const { user } = useAuth()
  const [projects, setProjects] = useState<Project[]>([])

  const [form, setForm] = useState<FormState>(() => toFormState(initial))
  const [requestDate] = useState(todayISO())
  const [queuedFiles, setQueuedFiles] = useState<File[]>([])
  const [dragOver, setDragOver] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | string[]>('')
  const submittingRef = useRef(false)
  const errorRef = useRef<HTMLDivElement>(null)
  // Bring a new error banner into view — the submit button sits in the sticky footer.
  useEffect(() => { if (error) errorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }) }, [error])

  // The person who raises the SR is its engineer; it is not reassigned in this version.
  const engineerName = initial ? (initial.assigned_to_name || '—') : (user?.name || user?.email || '—')
  const [machinesError, setMachinesError] = useState('')
  const [focusedPriority, setFocusedPriority] = useState('')
  useEffect(() => {
    erpApi.listProjects({ limit: 5000 }).then(setProjects)
      .catch((e) => setMachinesError(`Machines could not be loaded: ${extractErrorMessages(e, 'check your connection').join(' ')}. Reload the page to try again.`))
  }, [])

  // A new request's typed data survives a refresh / network failure (lib/formDraft.ts).
  // Chargeability is decided by the server from the machine's warranty cover.
  const draft = useFormDraft(!initial ? 'erp-service-request-new' : null, { form }, (d) => setForm(d.form))

  const set = (field: keyof FormState, value: string) => setForm((f) => ({ ...f, [field]: value }))

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (submittingRef.current) return
    if (!form.project_id) {
      setError('Please select a machine/asset.')
      return
    }
    // Edit mode: the location already sits in the description text, so it is only asked on create.
    if (!initial && !form.site_location.trim()) {
      setError('Site / Location is required — enter where the machine is right now (e.g. Itarsi yard, Line 4).')
      return
    }
    if (!form.service_type) {
      setError('Please select a Service Type (e.g. Warranty, AMC, Paid Service).')
      return
    }
    if (!form.issue_title.trim()) {
      setError('Issue title is required.')
      return
    }
    if (!form.priority) {
      setError('Please select a priority level.')
      return
    }
    if (!isPhoneValid(form.reported_by_phone)) {
      setError('Please enter a valid phone number before submitting.')
      return
    }
    if (!isValidEmail(form.reported_by_email)) {
      setError(VALIDATION_MESSAGES.email)
      return
    }
    submittingRef.current = true
    setSaving(true)
    setError('')
    try {
      // The backend has no dedicated location column — legacy folds Site/Location
      // into the description text, and we do the same for parity.
      const { site_location, ...rest } = form
      const issue_description = [rest.issue_description.trim(), site_location.trim() && `Location: ${site_location.trim()}`].filter(Boolean).join('\n\n')

      const payload: Record<string, unknown> = {
        ...rest,
        issue_description,
        project_id: Number(form.project_id),
      }
      // On create, drop untouched-empty optional fields entirely. On edit, keep them —
      // an intentionally-cleared field must reach the backend as "" so PATCH's
      // exclude_unset=True actually clears it instead of silently no-op'ing.
      if (!initial) {
        Object.keys(payload).forEach((k) => {
          if (payload[k] === '' || payload[k] === null) delete payload[k]
        })
      } else {
        // Untouched empty text boxes aren't edits — leave them out so no junk audit lines are written.
        Object.keys(payload).forEach((k) => {
          if (payload[k] === '' && !(initial as Record<string, unknown>)[k]) delete payload[k]
        })
        // Date fields are `date | None` on the backend — "" is a 422, so a cleared date is sent as null.
        for (const k of ['expected_date_to_attend', 'expected_completion_date']) {
          if (payload[k] === '') payload[k] = null
        }
      }
      await onSubmit(payload, queuedFiles)
      draft.clear()
    } catch (err) {
      setError(extractErrorMessages(err, 'Failed to save service request.'))
      submittingRef.current = false
    } finally {
      setSaving(false)
    }
  }

  const errorText = Array.isArray(error) ? error.join(' ') : error

  return (
    <form onSubmit={handleSubmit}>
      <FormPage tour="erp-srf-page" icon={initial ? 'edit' : 'tool'} title={title} subtitle={subtitle} onBack={onCancel} backTour="erp-srf-back" nav={nav}
        footer={<>
          <button type="button" onClick={onCancel} disabled={saving} style={sheetBtn('secondary', SHEET.INK, saving)} data-tour="erp-srf-cancel-btn">Cancel</button>
          <button type="submit" disabled={saving} style={sheetBtn('primary', SHEET.BLUE, saving)} data-tour="erp-srf-submit-btn">
            <SheetIcon name={initial ? 'check' : 'plus'} size={16} />{saving ? 'Saving…' : submitLabel}
          </button>
        </>}>
        <SheetColumns
          left={<>
            <DraftBanner draft={draft} />
            {errorText && (
              <div ref={errorRef} style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
                <b>Cannot save the service request:</b> {errorText}
              </div>
            )}
            {machinesError && (
              <div role="alert" style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>{machinesError}</div>
            )}
            <SheetSection icon="truck" title="Machine">
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
                <div data-tour="erp-srf-asset" style={{ flex: '1 1 280px', maxWidth: 440 }}>
                  <label style={sheetLabel}>Asset / Vehicle <Req /></label>
                  {lockProject ? (
                    <p style={{ fontSize: 13, color: SHEET.BODY, margin: '10px 0 0' }}>
                      {projects.find((p) => String(p.id) === form.project_id)?.serial_number || 'this machine'} (can&apos;t be changed after creation)
                    </p>
                  ) : (
                    <SearchableSelect
                      value={form.project_id}
                      onChange={(v) => set('project_id', v)}
                      placeholder="Select a vehicle..."
                      options={projects.map((p) => ({
                        value: String(p.id),
                        label: `${p.serial_number}${p.model_name ? ` — ${p.model_name}` : ''}${p.client_company ? ` (${p.client_company})` : ''}`,
                      }))}
                    />
                  )}
                </div>
                <div data-tour="erp-srf-request-date" style={{ flex: '0 1 190px', minWidth: 170 }}>
                  <label style={sheetLabel}>{initial ? 'Request date' : 'Request date'}</label>
                  <div aria-readonly="true" style={{ ...sheetInput, display: 'flex', alignItems: 'center', background: SHEET.SOFT, color: SHEET.BODY }}>
                    {initial
                      ? (initial.created_at ? formatDate(initial.created_at).replace(/\//g, '-') : '—')
                      : `${requestDate.split('-').reverse().join('-')} (today)`}
                  </div>
                </div>
              </div>
              <label style={{ ...sheetLabel, marginTop: 14 }}>Site / Location {initial ? <Optional /> : <Req />}</label>
              <input value={form.site_location} onChange={(e) => set('site_location', e.target.value)} placeholder="Current location of asset" style={sheetInput} data-tour="erp-srf-location" />
            </SheetSection>

            <SheetSection icon="alert" title="Issue Information">
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
                <div>
                  <label style={sheetLabel}>Service Type <Req /></label>
                  <Select value={form.service_type} onChange={(e) => set('service_type', e.target.value)} style={sheetInput} data-tour="erp-srf-service-type">
                    <option value="">Select Service Type</option>
                    {SERVICE_TYPES.map((t) => (
                      <option key={t.value} value={t.value}>{t.label}</option>
                    ))}
                  </Select>
                </div>
                <div>
                  <div style={sheetLabel}>Priority Level <Req /></div>
                  <div data-tour="erp-srf-priority" role="radiogroup" aria-label="Priority" style={{ display: 'flex', gap: 8 }}>
                    {PRIORITIES.map((p) => (
                      <label
                        key={p.value}
                        title={p.sub}
                        style={{
                          position: 'relative', flex: '1 1 0', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '0 10px', minHeight: 38, borderRadius: 10, cursor: 'pointer',
                          border: `1px solid ${form.priority === p.value ? p.color : SHEET.LINE}`, background: form.priority === p.value ? p.bg : '#fff',
                          boxShadow: focusedPriority === p.value ? `0 0 0 3px ${p.color}55` : undefined,
                        }}
                      >
                        <input type="radio" name="priority" value={p.value} checked={form.priority === p.value} onChange={() => set('priority', p.value)}
                          onFocus={() => setFocusedPriority(p.value)} onBlur={() => setFocusedPriority('')}
                          style={{ position: 'absolute', opacity: 0, width: 1, height: 1, margin: 0, pointerEvents: 'none' }} />
                        <span style={{ color: p.color, display: 'inline-flex' }}><PriorityIcon name={p.icon} /></span>
                        <span style={{ fontSize: 13.5, fontWeight: 600, color: SHEET.INK }}>{p.label}</span>
                      </label>
                    ))}
                  </div>
                </div>
              </div>
              <label style={{ ...sheetLabel, marginTop: 14 }}>Issue Title <Req /></label>
              <input value={form.issue_title} onChange={(e) => set('issue_title', e.target.value)} placeholder="Brief summary of the fault..." style={sheetInput} data-tour="erp-srf-title" />
              <label style={{ ...sheetLabel, marginTop: 14 }}>Detailed Description <Optional /></label>
              <textarea value={form.issue_description} onChange={(e) => set('issue_description', e.target.value)} rows={4} placeholder="Describe symptoms, context, and impact..." style={{ ...sheetInput, resize: 'vertical' }} data-tour="erp-srf-description" />
            </SheetSection>

            <SheetSection icon="user" title="Reported By" extra={<Optional />}>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
                <div style={{ flex: '1 1 220px', maxWidth: 320 }}>
                  <label style={sheetLabel}>Company / Client Name</label>
                  <input value={form.reported_by_name} onChange={(e) => set('reported_by_name', e.target.value)} placeholder="Enter company or client name" style={sheetInput} data-tour="erp-srf-reporter-name" />
                </div>
                <div style={{ flex: '1 1 180px', maxWidth: 240 }}>
                  <label style={sheetLabel}>Phone</label>
                  <div data-tour="erp-srf-reporter-phone"><PhoneField value={form.reported_by_phone} onChange={(v) => set('reported_by_phone', v)} style={sheetInput} /></div>
                </div>
                <div style={{ flex: '1 1 220px', maxWidth: 300 }}>
                  <label style={sheetLabel}>Email</label>
                  <div data-tour="erp-srf-reporter-email"><ValidatedInput type="email" value={form.reported_by_email} onChange={(v) => set('reported_by_email', v)} validator={isValidEmail} errorMessage={VALIDATION_MESSAGES.email} placeholder="Email address" style={sheetInput} /></div>
                </div>
              </div>
            </SheetSection>
            <div aria-hidden style={{ height: 28 }} />
          </>}
          right={<>
            <SheetSection icon="calendar" title="Assignment & Schedule">
              <label style={sheetLabel}>Assign To Engineer</label>
              <div data-tour="erp-srf-assignee">
                <div aria-readonly="true" style={{ ...sheetInput, display: 'flex', alignItems: 'center', background: SHEET.SOFT, color: SHEET.BODY }}>
                  {engineerName}
                </div>
              </div>
              <p style={sheetHint}>The person raising the SR is its engineer and the one who works on it.</p>
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 14 }}>
                <div data-tour="erp-srf-attend-date" style={{ flex: '1 1 140px' }}>
                  <label style={sheetLabel}>Expected Attend Date</label>
                  <DateField value={form.expected_date_to_attend} onChange={(v) => set('expected_date_to_attend', v)} />
                </div>
                <div data-tour="erp-srf-close-date" style={{ flex: '1 1 140px' }}>
                  <label style={sheetLabel}>Expected Close Date</label>
                  <DateField value={form.expected_completion_date} onChange={(v) => set('expected_completion_date', v)} />
                </div>
              </div>
              <label style={{ ...sheetLabel, marginTop: 14 }}>{initial ? 'Status' : 'Initial Status'}</label>
              <Select value={form.status} onChange={(e) => set('status', e.target.value)} style={sheetInput} data-tour="erp-srf-status">
                {/* A new SR starts at an opening step (backend SR_CREATE_STATUSES); Work Completed / Review /
                    Closed / Cancelled are reached only through the status steps on the SR page */}
                {STATUS_OPTIONS.filter((s) => initial || !['work_completed', 'review', 'closed', 'cancelled'].includes(s.value)).map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
              </Select>
            </SheetSection>
            <SheetSection icon="chat" title="Notes" extra={<Optional />}>
              <textarea value={form.service_report_notes} onChange={(e) => set('service_report_notes', e.target.value)} rows={3} placeholder="Any additional notes..." style={{ ...sheetInput, resize: 'vertical' }} data-tour="erp-srf-notes" />
            </SheetSection>
            <SheetSection icon="clip" title="Attachments" extra={<Optional />}>
              <div
                data-tour="erp-srf-attachments"
                onClick={() => fileRef.current?.click()}
                onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
                onDragLeave={() => setDragOver(false)}
                onDrop={(e) => {
                  e.preventDefault()
                  setDragOver(false)
                  if (e.dataTransfer.files) setQueuedFiles((prev) => [...prev, ...Array.from(e.dataTransfer.files)])
                }}
                style={{ border: `1.5px dashed ${dragOver ? SHEET.BLUE : '#cbd5e1'}`, borderRadius: 12, padding: '18px 12px', textAlign: 'center', cursor: 'pointer', background: dragOver ? '#eff6ff' : '#fff' }}
              >
                <input ref={fileRef} type="file" multiple hidden
                  onChange={(e) => { if (e.target.files) setQueuedFiles((prev) => [...prev, ...Array.from(e.target.files!)]); e.target.value = '' }} />
                <SheetIcon name="clip" size={22} color={SHEET.BLUE} />
                <div style={{ fontSize: 13, color: SHEET.BODY, marginTop: 6 }}>Drag and drop files here, or <span style={{ color: SHEET.BLUE, fontWeight: 600 }}>click to browse</span></div>
                <div style={{ fontSize: 11.5, color: SHEET.MUTED, marginTop: 2 }}>Images, videos, PDFs, Office documents</div>
              </div>
              {queuedFiles.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
                  {queuedFiles.map((f, i) => (
                    <span key={`${f.name}-${i}`} style={{ ...pillStyle(SHEET.BODY), background: '#f1f5f9', gap: 4, fontSize: 12, fontWeight: 500, padding: '4px 10px', maxWidth: '100%', whiteSpace: 'normal' }}>
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.name}</span>
                      <button type="button" aria-label={`Remove ${f.name}`} onClick={() => setQueuedFiles((prev) => prev.filter((_, idx) => idx !== i))} style={{ border: 'none', background: 'none', cursor: 'pointer', padding: 0, color: SHEET.MUTED, display: 'inline-flex' }}><SheetIcon name="x" size={12} /></button>
                    </span>
                  ))}
                </div>
              )}
            </SheetSection>
            <div aria-hidden style={{ height: 28 }} />
          </>}
        />
      </FormPage>
    </form>
  )
}
