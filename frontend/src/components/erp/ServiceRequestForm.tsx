'use client'

import { useEffect, useRef, useState } from 'react'
import { useAuth } from '@/hooks/useAuth'
import { erpApi } from '@/lib/api'
import { Project, ServiceRequest } from '@/types'
import DateField from './DateField'
import SearchableSelect from './SearchableSelect'
import PhoneField, { isPhoneValid } from './PhoneField'
import ValidatedInput from '@/components/ValidatedInput'
import { isValidEmail, VALIDATION_MESSAGES } from '@/lib/validation'
import { inputStyle, Field, Section, Row, Row3 } from '@/components/shared/ui'

const PRIORITIES = [
  { value: 'critical', label: 'Critical', sub: 'Immediate response required', color: '#dc2626', bg: 'rgba(220,38,38,0.1)', icon: 'warning' },
  { value: 'high', label: 'High', sub: 'Urgent action needed', color: '#d97706', bg: 'rgba(217,119,6,0.1)', icon: 'clock' },
  { value: 'medium', label: 'Medium', sub: 'Routine service', color: '#2563eb', bg: 'rgba(37,99,235,0.1)', icon: 'minus' },
  { value: 'low', label: 'Low', sub: 'When time permits', color: '#57534e', bg: 'rgba(0,0,0,0.06)', icon: 'down' },
] as const

function PriorityIcon({ name }: { name: string }) {
  const common = { width: 15, height: 15, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const }
  switch (name) {
    case 'warning':
      return <svg {...common}><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" /></svg>
    case 'clock':
      return <svg {...common}><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg>
    case 'minus':
      return <svg {...common}><circle cx="12" cy="12" r="10" /><line x1="8" y1="12" x2="16" y2="12" /></svg>
    case 'down':
      return <svg {...common}><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="16" /><polyline points="9 13 12 16 15 13" /></svg>
    default:
      return null
  }
}

const STATUS_OPTIONS = [
  { value: 'open', label: 'Open / Reported' },
  { value: 'acknowledged', label: 'Acknowledged' },
  { value: 'assigned', label: 'Assigned' },
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
  sub_category: string
  failure_mode: string
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
    sub_category: initial?.sub_category || '',
    failure_mode: initial?.failure_mode || '',
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
  return new Date().toISOString().slice(0, 10)
}

export default function ServiceRequestForm({
  initial,
  lockProject,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  initial?: Partial<ServiceRequest>
  /** True in edit mode — the machine a Service Request is raised against can't be changed after creation. */
  lockProject?: boolean
  submitLabel: string
  onSubmit: (payload: Record<string, unknown>, files: File[]) => Promise<void>
  onCancel: () => void
}) {
  const { user } = useAuth()
  const [projects, setProjects] = useState<Project[]>([])

  const [form, setForm] = useState<FormState>(() => toFormState(initial))
  const [requestDate] = useState(todayISO())
  const [queuedFiles, setQueuedFiles] = useState<File[]>([])
  const [dragOver, setDragOver] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const submittingRef = useRef(false)

  // Legacy behavior: the assignee is always auto-filled with the creator's name — there's
  // no picker anywhere in the UI, so we don't invent one here either.
  const assignedToName = initial?.assigned_to_name || user?.name || ''

  useEffect(() => {
    erpApi.listProjects({ limit: 5000 }).then(setProjects).catch(() => setError('Failed to load machines'))
  }, [])

  const set = (field: keyof FormState, value: string) => setForm((f) => ({ ...f, [field]: value }))

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (submittingRef.current) return
    if (!form.project_id) {
      setError('Please select a machine/asset.')
      return
    }
    if (!form.issue_title.trim()) {
      setError('Issue title is required.')
      return
    }
    if (!form.issue_description.trim()) {
      setError('Detailed description is required.')
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
      const issue_description = site_location.trim() ? `${rest.issue_description}\n\nLocation: ${site_location.trim()}` : rest.issue_description

      const payload: Record<string, unknown> = {
        ...rest,
        issue_description,
        project_id: Number(form.project_id),
        assigned_to_name: assignedToName,
      }
      Object.keys(payload).forEach((k) => {
        if (payload[k] === '') delete payload[k]
      })
      await onSubmit(payload, queuedFiles)
    } catch (err: any) {
      setError(err?.response?.data?.detail || 'Failed to save service request.')
      submittingRef.current = false
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      {error && (
        <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="sr-form-grid" style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 20, alignItems: 'start' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <Section title="Issue Information">
            <Row>
              <Field label="Asset / Vehicle *">
                {lockProject ? (
                  <p style={{ fontSize: 13, color: '#57534e', margin: '10px 0 0' }}>
                    {projects.find((p) => String(p.id) === form.project_id)?.serial_number || `Project #${form.project_id}`} (can&apos;t be changed after creation)
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
              </Field>
              <Field label="Request Date *">
                <DateField value={requestDate} onChange={() => {}} />
              </Field>
            </Row>

            <Field label="Issue Title *">
              <input value={form.issue_title} onChange={(e) => set('issue_title', e.target.value)} placeholder="Brief summary of the fault..." style={inputStyle} />
            </Field>
            <Field label="Detailed Description *">
              <textarea value={form.issue_description} onChange={(e) => set('issue_description', e.target.value)} rows={4} placeholder="Describe symptoms, context, and impact..." style={{ ...inputStyle, resize: 'vertical' }} />
            </Field>

            <Row>
              <Field label="Issue Category">
                <select value={form.issue_category} onChange={(e) => set('issue_category', e.target.value)} style={inputStyle}>
                  <option value="">Select Category</option>
                  {['Mechanical', 'Electrical', 'Hydraulic', 'Pneumatic', 'Engine', 'Software', 'Other'].map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </Field>
              <Field label="Failure Mode">
                <input value={form.failure_mode} onChange={(e) => set('failure_mode', e.target.value)} placeholder="e.g., Pressure Drop" style={inputStyle} />
              </Field>
            </Row>
            <Row>
              <Field label="Sub-Category">
                <input value={form.sub_category} onChange={(e) => set('sub_category', e.target.value)} placeholder="e.g., Engine, Brakes..." style={inputStyle} />
              </Field>
              <Field label="Site / Location">
                <input value={form.site_location} onChange={(e) => set('site_location', e.target.value)} placeholder="Current location of asset" style={inputStyle} />
              </Field>
            </Row>
          </Section>

          <Section title="Reported By">
            <Row3>
              <Field label="Company / Client Name">
                <input value={form.reported_by_name} onChange={(e) => set('reported_by_name', e.target.value)} placeholder="Enter company or client name" style={inputStyle} />
              </Field>
              <Field label="Phone">
                <PhoneField value={form.reported_by_phone} onChange={(v) => set('reported_by_phone', v)} style={inputStyle} />
              </Field>
              <Field label="Email">
                <ValidatedInput type="email" value={form.reported_by_email} onChange={(v) => set('reported_by_email', v)} validator={isValidEmail} errorMessage={VALIDATION_MESSAGES.email} placeholder="Email address" style={inputStyle} />
              </Field>
            </Row3>
          </Section>

          <Section title="Attachments">
            <div
              onClick={() => fileRef.current?.click()}
              onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => {
                e.preventDefault()
                setDragOver(false)
                if (e.dataTransfer.files) setQueuedFiles((prev) => [...prev, ...Array.from(e.dataTransfer.files)])
              }}
              style={{
                padding: '28px 20px',
                borderRadius: 14,
                border: `2px dashed ${dragOver ? '#FF7A45' : 'rgba(0,0,0,0.15)'}`,
                background: dragOver ? 'rgba(244,113,59,0.05)' : '#fff',
                textAlign: 'center',
                cursor: 'pointer',
              }}
            >
              <input
                ref={fileRef}
                type="file"
                multiple
                hidden
                onChange={(e) => e.target.files && setQueuedFiles((prev) => [...prev, ...Array.from(e.target.files!)])}
              />
              <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#FF7A45" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{ margin: '0 auto 8px' }}>
                <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
                <polyline points="17 8 12 3 7 8" />
                <line x1="12" y1="3" x2="12" y2="15" />
              </svg>
              <p style={{ fontSize: 13.5, fontWeight: 600, color: '#1f1108', margin: '0 0 4px' }}>Drag &amp; drop files here</p>
              <p style={{ fontSize: 12, color: '#a8a29e', margin: 0 }}>or click to browse — images, videos, PDFs, Office documents</p>
            </div>

            {queuedFiles.length === 0 ? (
              <p style={{ fontSize: 12.5, color: '#a8a29e', padding: '10px 12px', borderRadius: 8, background: '#faf9f7', margin: 0 }}>No uploaded attachments yet.</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {queuedFiles.map((f, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '9px 12px', borderRadius: 8, background: '#faf9f7', border: '1px solid rgba(0,0,0,0.05)' }}>
                    <span style={{ fontSize: 12.5, color: '#57534e', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.name}</span>
                    <button type="button" onClick={() => setQueuedFiles((prev) => prev.filter((_, idx) => idx !== i))} style={{ border: 'none', background: 'none', color: '#b91c1c', cursor: 'pointer', fontSize: 11.5, fontWeight: 600, flex: 'none', marginLeft: 10 }}>Remove</button>
                  </div>
                ))}
              </div>
            )}
          </Section>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <Section title="Priority Level *">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {PRIORITIES.map((p) => (
                <label
                  key={p.value}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    padding: '10px 8px',
                    borderRadius: 10,
                    cursor: 'pointer',
                    background: form.priority === p.value ? p.bg : 'transparent',
                  }}
                >
                  <input type="radio" name="priority" value={p.value} checked={form.priority === p.value} onChange={() => set('priority', p.value)} style={{ display: 'none' }} />
                  <span style={{ width: 32, height: 32, borderRadius: 10, flex: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', background: p.bg, color: p.color }}>
                    <PriorityIcon name={p.icon} />
                  </span>
                  <span>
                    <span style={{ display: 'block', fontSize: 13.5, fontWeight: 600, color: '#1f1108' }}>{p.label}</span>
                    <span style={{ display: 'block', fontSize: 11.5, color: '#a8a29e' }}>{p.sub}</span>
                  </span>
                </label>
              ))}
            </div>
          </Section>

          <Section title="Assignment">
            <Field label="Assign To Engineer">
              <input value={assignedToName} disabled style={{ ...inputStyle, background: '#f5f5f4', color: '#78716c' }} />
            </Field>
            <Field label="Expected Attend Date">
              <DateField value={form.expected_date_to_attend} onChange={(v) => set('expected_date_to_attend', v)} />
            </Field>
            <Field label="Expected Close Date">
              <DateField value={form.expected_completion_date} onChange={(v) => set('expected_completion_date', v)} />
            </Field>
            <Field label="Initial Status">
              <select value={form.status} onChange={(e) => set('status', e.target.value)} style={inputStyle}>
                {STATUS_OPTIONS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
              </select>
            </Field>
            <Field label="Notes">
              <textarea value={form.service_report_notes} onChange={(e) => set('service_report_notes', e.target.value)} rows={3} placeholder="Any additional notes..." style={{ ...inputStyle, resize: 'vertical' }} />
            </Field>
          </Section>
        </div>

        <div style={{ gridColumn: '1 / -1', display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button type="button" onClick={onCancel} style={secondaryBtnStyle}>Cancel</button>
          <button type="submit" disabled={saving} style={{ ...primaryBtnStyle, opacity: saving ? 0.7 : 1 }}>
            {saving ? 'Saving…' : submitLabel}
          </button>
        </div>
      </form>

      <style jsx>{`
        @media (min-width: 768px) {
          .sr-form-grid {
            grid-template-columns: 2fr 1fr !important;
          }
        }
      `}</style>
    </div>
  )
}

const primaryBtnStyle: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 600,
  padding: '10px 22px',
  borderRadius: 10,
  border: 'none',
  background: 'linear-gradient(140deg,#FF7A45,#ffe3d0)',
  color: '#fff',
  cursor: 'pointer',
  whiteSpace: 'nowrap',
}

const secondaryBtnStyle: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 600,
  padding: '10px 18px',
  borderRadius: 10,
  border: '1px solid rgba(0,0,0,0.1)',
  background: '#fff',
  color: '#57534e',
  cursor: 'pointer',
  whiteSpace: 'nowrap',
}
