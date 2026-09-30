'use client'

import { useCallback, useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useProtectedPage } from '@/hooks/useAuth'
import { hrApi } from '@/lib/api'
import { HrLifecycleEvent, HrLifecycleMeta } from '@/types'
import { TEXT, GLASS, SHADOWS, BORDER } from '@/lib/theme'
import { extractErrorMessages } from '@/lib/validation'
import { dangerBtnStyle, primaryBtnStyle, secondaryBtnStyle } from '@/components/shared/ui'
import PromptDialog from '@/components/erp/PromptDialog'
import HrNav from '@/components/hr/HrNav'
import EventFields, { EventFormState, EXIT_TYPE_LABELS, eventToForm, formToPayload } from '@/components/hr/lifecycle/EventFields'
import ChecklistPanel from '@/components/hr/lifecycle/ChecklistPanel'
import CompletionPanel from '@/components/hr/lifecycle/CompletionPanel'

const TYPE_LABELS: Record<string, string> = { joining: 'Joining', confirmation: 'Confirmation', transfer: 'Transfer', promotion: 'Promotion', exit: 'Exit' }
const TYPE_HEX: Record<string, string> = { joining: '#16A34A', confirmation: '#0891B2', transfer: '#2563EB', promotion: '#7C3AED', exit: '#DC2626' }
const STATUS_LABELS: Record<string, string> = { draft: 'Draft', in_progress: 'In Progress', completed: 'Completed', cancelled: 'Cancelled' }
const STATUS_HEX: Record<string, string> = { draft: '#78716C', in_progress: '#F59E0B', completed: '#16A34A', cancelled: '#DC2626' }

const sectionStyle: React.CSSProperties = {
  borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur,
  border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), padding: 20, marginBottom: 20,
}
const errorBox: React.CSSProperties = { padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }
const badge = (hex: string): React.CSSProperties => ({ fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 9999, background: `${hex}1a`, color: hex, whiteSpace: 'nowrap' })
const fmtDate = (d: string | null) => (d ? d.slice(0, 10).split('-').reverse().join('-') : '—')

function Info({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div style={{ flex: '1 1 180px', minWidth: 150, maxWidth: 300 }}>
      <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '.04em', textTransform: 'uppercase', color: TEXT.muted, marginBottom: 3 }}>{label}</div>
      <div style={{ fontSize: 13.5, color: TEXT.heading, whiteSpace: 'pre-wrap' }}>{value || '—'}</div>
    </div>
  )
}

export default function HrLifecycleDetailPage() {
  const { isAuthorized, isLoading, user } = useProtectedPage()
  const router = useRouter()
  const params = useParams<{ id: string }>()
  const id = Number(params?.id)
  const isHr = !!user?.apps?.includes('hr')

  const [event, setEvent] = useState<HrLifecycleEvent | null>(null)
  const [meta, setMeta] = useState<HrLifecycleMeta | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string[]>([])
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState<EventFormState | null>(null)
  const [saving, setSaving] = useState(false)
  const [cancelOpen, setCancelOpen] = useState(false)

  const load = useCallback(() => {
    if (!id) return
    hrApi.getLifecycleEvent(id)
      .then((ev: HrLifecycleEvent) => { setEvent(ev); setError([]) })
      .catch((err) => setError(extractErrorMessages(err, 'Could not load this lifecycle event.')))
      .finally(() => setLoading(false))
  }, [id])

  useEffect(() => { if (isAuthorized) load() }, [isAuthorized, load])
  useEffect(() => {
    if (!isAuthorized || !isHr) return
    hrApi.getLifecycleMeta().then(setMeta).catch(() => setMeta(null))
  }, [isAuthorized, isHr])

  const open = event?.status === 'draft' || event?.status === 'in_progress'
  const backHref = isHr ? '/dashboard/hr/lifecycle' : '/dashboard/hr/me'

  const saveEdit = async () => {
    if (!event || !form) return
    if (event.event_type === 'exit' && !form.last_working_day) { setError(['Enter the last working day.']); return }
    setSaving(true)
    setError([])
    try {
      const ev = await hrApi.updateLifecycleEvent(event.id, formToPayload(event.event_type, form))
      setEvent(ev)
      setEditing(false)
    } catch (err) {
      setError(extractErrorMessages(err, 'Could not save the changes.'))
    } finally {
      setSaving(false)
    }
  }

  const start = async () => {
    if (!event) return
    setError([])
    try {
      setEvent(await hrApi.updateLifecycleEvent(event.id, { status: 'in_progress' }))
    } catch (err) {
      setError(extractErrorMessages(err, 'Could not start the event.'))
    }
  }

  const cancel = async (reason: string) => {
    setCancelOpen(false)
    if (!event) return
    if (!reason.trim()) { setError(['Give a reason to cancel the event — it is kept on record.']); return }
    setError([])
    try {
      setEvent(await hrApi.cancelLifecycleEvent(event.id, reason.trim()))
    } catch (err) {
      setError(extractErrorMessages(err, 'Could not cancel the event.'))
    }
  }

  if (isLoading || !isAuthorized) return null

  const summary = event?.completion_summary
  const move = (label: string, from: string | null, to: string | null) => (
    <Info label={label} value={to ? <>{from || '—'} <span style={{ color: TEXT.muted }}>→</span> <b>{to}</b></> : (from || '—')} />
  )

  return (
    <div>
      <HrNav />

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, marginBottom: 20, flexWrap: 'wrap' }}>
        <div style={{ minWidth: 0 }}>
          <p style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 4px' }}>
            HR &amp; Administration · Lifecycle
          </p>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <h1 style={{ fontSize: 24, fontWeight: 700, color: TEXT.heading, margin: 0 }}>{event ? event.event_no : 'Lifecycle event'}</h1>
            {event && <span style={badge(TYPE_HEX[event.event_type])}>{TYPE_LABELS[event.event_type]}</span>}
            {event && <span style={badge(STATUS_HEX[event.status])}>{STATUS_LABELS[event.status]}</span>}
          </div>
          {event && (
            <p style={{ fontSize: 13.5, color: TEXT.muted, margin: '4px 0 0' }}>
              <b style={{ color: TEXT.heading }}>{event.subject_name || '—'}</b>
              {event.employee_code ? ` · ${event.employee_code}` : ''}{event.subject_email ? ` · ${event.subject_email}` : ''}
              {isHr && event.user_id && (
                <span onClick={() => router.push(`/dashboard/hr/employees/${event.user_id}`)} style={{ marginLeft: 8, color: '#FF6A2A', fontWeight: 600, cursor: 'pointer' }}>Employee record</span>
              )}
            </p>
          )}
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          {isHr && event && open && !editing && (
            <>
              {event.status === 'draft' && <button type="button" onClick={start} style={primaryBtnStyle}>Start checklist</button>}
              <button type="button" onClick={() => { setForm(eventToForm(event)); setEditing(true) }} style={secondaryBtnStyle}>Edit details</button>
              <button type="button" onClick={() => setCancelOpen(true)} style={dangerBtnStyle}>Cancel event</button>
            </>
          )}
          <button onClick={() => router.push(backHref)} type="button" style={secondaryBtnStyle}>← Back</button>
        </div>
      </div>

      {error.length > 0 && <div style={errorBox}>{error.join(' ')}</div>}

      {loading && <div style={sectionStyle}><p style={{ fontSize: 13, color: TEXT.muted, margin: 0 }}>Loading…</p></div>}

      {event && (
        <>
          {event.status === 'cancelled' && event.cancelled_reason && (
            <div style={{ ...sectionStyle, border: '1px solid rgba(220,38,38,0.25)' }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#b91c1c', marginBottom: 4 }}>Cancelled</div>
              <div style={{ fontSize: 13, color: TEXT.body }}>{event.cancelled_reason}</div>
            </div>
          )}

          {event.status === 'completed' && (
            <div style={{ ...sectionStyle, border: '1px solid rgba(22,163,74,0.3)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 8 }}>
                <h3 style={{ fontSize: 15, fontWeight: 700, color: '#15803d', margin: 0 }}>Completed</h3>
                <span style={{ fontSize: 12, color: TEXT.muted }}>
                  {event.completed_by_name ? `by ${event.completed_by_name} ` : ''}{event.completed_at ? `on ${fmtDate(event.completed_at)}` : ''}
                </span>
              </div>
              {summary ? (
                <div style={{ fontSize: 13, color: TEXT.body, display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {(summary.changes || []).map((c, i) => <div key={i}>✓ {c}</div>)}
                  {(summary.changes || []).length === 0 && <div>No changes were needed.</div>}
                  {(summary.conflicts || []).map((c, i) => <div key={`c${i}`} style={{ color: '#b91c1c' }}>✕ {c}</div>)}
                  {(summary.outstanding_assets || []).length > 0 && (
                    <div style={{ color: '#b91c1c' }}>Assets still with the employee: {(summary.outstanding_assets || []).join(', ')}</div>
                  )}
                  {(summary.pending_checklist_items || []).length > 0 && (
                    <div style={{ color: '#B45309' }}>Checklist items left open: {(summary.pending_checklist_items || []).join('; ')}</div>
                  )}
                  {summary.forced && <div style={{ color: '#B45309' }}>Completed with open items — reason: {summary.force_reason}</div>}
                  {(summary.warnings || []).map((w, i) => <div key={`w${i}`} style={{ color: '#92400E' }}>⚠ {w}</div>)}
                </div>
              ) : (
                <p style={{ fontSize: 13, color: TEXT.muted, margin: 0 }}>Completion details are visible to HR.</p>
              )}
            </div>
          )}

          <div style={sectionStyle}>
            <h3 style={{ fontSize: 15, fontWeight: 700, color: TEXT.heading, margin: '0 0 14px' }}>Details</h3>
            {editing && form && meta ? (
              <>
                {event.event_type === 'joining' && !event.user_id && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 16 }}>
                    <div style={{ flex: '1 1 240px', maxWidth: 340 }}>
                      <label style={{ display: 'block', fontSize: 11, fontWeight: 600, letterSpacing: '.04em', textTransform: 'uppercase', color: TEXT.muted, marginBottom: 6 }}>Full name</label>
                      <input style={{ width: '100%', padding: '10px 12px', borderRadius: 10, border: `1px solid ${BORDER.normal}`, fontSize: 13.5, boxSizing: 'border-box' }} value={form.candidate_name} onChange={(e) => setForm({ ...form, candidate_name: e.target.value })} />
                    </div>
                    <div style={{ flex: '1 1 260px', maxWidth: 340 }}>
                      <label style={{ display: 'block', fontSize: 11, fontWeight: 600, letterSpacing: '.04em', textTransform: 'uppercase', color: TEXT.muted, marginBottom: 6 }}>Work email</label>
                      <input style={{ width: '100%', padding: '10px 12px', borderRadius: 10, border: `1px solid ${BORDER.normal}`, fontSize: 13.5, boxSizing: 'border-box' }} value={form.candidate_email} onChange={(e) => setForm({ ...form, candidate_email: e.target.value })} />
                    </div>
                  </div>
                )}
                <EventFields type={event.event_type} form={form} setForm={setForm} meta={meta} subjectUserId={event.user_id} />
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 16 }}>
                  <button type="button" onClick={() => setEditing(false)} style={secondaryBtnStyle}>Discard</button>
                  <button type="button" disabled={saving} onClick={saveEdit} style={{ ...primaryBtnStyle, opacity: saving ? 0.7 : 1 }}>{saving ? 'Saving…' : 'Save changes'}</button>
                </div>
              </>
            ) : (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '16px 20px' }}>
                {event.event_type === 'exit' ? (
                  <>
                    <Info label="Exit type" value={event.exit_type ? EXIT_TYPE_LABELS[event.exit_type] || event.exit_type : null} />
                    {event.is_hr_view && <Info label="Resignation date" value={fmtDate(event.resignation_date)} />}
                    <Info label="Last working day" value={fmtDate(event.last_working_day || event.effective_date)} />
                    {event.is_hr_view && <Info label="Notice period" value={event.notice_period_days != null ? `${event.notice_period_days} days` : null} />}
                    <Info label="Handover to" value={event.handover_to_name} />
                    <Info label="Department" value={event.from_department_name} />
                    <Info label="Designation" value={event.from_designation_name} />
                    <Info label="Reporting manager" value={event.from_manager_name} />
                  </>
                ) : (
                  <>
                    <Info label={event.event_type === 'joining' ? 'Date of joining' : event.event_type === 'confirmation' ? 'Confirmation date' : 'Effective from'} value={fmtDate(event.effective_date)} />
                    {event.event_type !== 'confirmation' && (
                      <>
                        {move('Department', event.from_department_name, event.to_department_name)}
                        {move('Plant', event.from_branch_name, event.to_branch_name)}
                        {move('Designation', event.from_designation_name, event.to_designation_name)}
                        {move('Grade', event.from_grade_name, event.to_grade_name)}
                        {move('Reporting manager', event.from_manager_name, event.to_manager_name)}
                      </>
                    )}
                    {(event.event_type === 'transfer' || event.event_type === 'promotion') && <Info label="Successor" value={event.handover_to_name} />}
                  </>
                )}
                <Info label="Raised by" value={event.created_by_name ? `${event.created_by_name} · ${fmtDate(event.created_at)}` : fmtDate(event.created_at)} />
                {event.is_hr_view && event.exit_reason && <div style={{ flex: '1 1 100%' }}><Info label="Exit reason" value={event.exit_reason} /></div>}
                {event.is_hr_view && event.remarks && <div style={{ flex: '1 1 100%' }}><Info label="Remarks" value={event.remarks} /></div>}
              </div>
            )}
          </div>

          <ChecklistPanel event={event} meta={meta} isHr={isHr} onChanged={load} />

          {isHr && event.status === 'in_progress' && (
            <CompletionPanel key={`${event.id}-${event.updated_at}`} event={event} meta={meta} onDone={(ev) => { setEvent(ev); setError([]) }} />
          )}
          {isHr && event.status === 'draft' && (
            <div style={sectionStyle}>
              <p style={{ fontSize: 13, color: TEXT.muted, margin: 0 }}>This event is a draft — checklist owners haven&apos;t been notified yet. Use <b>Start checklist</b> when it&apos;s ready.</p>
            </div>
          )}
        </>
      )}

      <PromptDialog
        open={cancelOpen}
        title={`Cancel ${event?.event_no || 'event'}?`}
        message="The event and its checklist are kept, marked cancelled. An exit that is withdrawn puts the employee back to active."
        placeholder="Reason (required)…"
        confirmLabel="Cancel event"
        cancelLabel="Keep event"
        onCancel={() => setCancelOpen(false)}
        onConfirm={cancel}
      />
    </div>
  )
}
