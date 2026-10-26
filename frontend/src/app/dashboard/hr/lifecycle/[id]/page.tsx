'use client'

import { useCallback, useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useProtectedPage } from '@/hooks/useAuth'
import { canActOnTab } from '@/lib/tabAccess'
import { useCan } from '@/lib/permissions'
import { hrApi } from '@/lib/api'
import { HrLifecycleEvent, HrLifecycleMeta } from '@/types'
import { TEXT, GLASS, SHADOWS } from '@/lib/theme'
import { extractErrorMessages } from '@/lib/validation'
import { dangerBtnStyle, primaryBtnStyle, secondaryBtnStyle, pillStyle, DetailCard, DetailGroup, DetailRow } from '@/components/shared/ui'
import PromptDialog from '@/components/erp/PromptDialog'
import { FormSheet, SheetSection, SheetIcon, SHEET, sheetBtn, sheetInput, sheetLabel } from '@/components/shared/FormSheet'
import HrNav from '@/components/hr/HrNav'
import EventFields, { EventFormState, EXIT_TYPE_LABELS, eventToForm, formToPayload } from '@/components/hr/lifecycle/EventFields'
import ChecklistPanel from '@/components/hr/lifecycle/ChecklistPanel'
import CompletionPanel from '@/components/hr/lifecycle/CompletionPanel'
import ScheduledEventPanel from '@/components/hr/lifecycle/ScheduledEventPanel'
import { recordPath, useRecordId } from '@/lib/recordRef'
import InvalidRecordLink from '@/components/erp/InvalidRecordLink'

const TYPE_LABELS: Record<string, string> = { joining: 'Joining', confirmation: 'Confirmation', transfer: 'Transfer', promotion: 'Promotion', exit: 'Exit' }
const TYPE_HEX: Record<string, string> = { joining: '#16A34A', confirmation: '#0891B2', transfer: '#2563EB', promotion: '#7C3AED', exit: '#DC2626' }
const STATUS_LABELS: Record<string, string> = { draft: 'Draft', in_progress: 'In Progress', scheduled: 'Scheduled', completed: 'Completed', cancelled: 'Cancelled' }
const STATUS_HEX: Record<string, string> = { draft: '#78716C', in_progress: '#F59E0B', scheduled: '#7C3AED', completed: '#16A34A', cancelled: '#94A3B8' }

const sectionStyle: React.CSSProperties = {
  borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur,
  border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), padding: 20, marginBottom: 20,
}
const errorBox: React.CSSProperties = { padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }
const badge = (hex: string): React.CSSProperties => pillStyle(hex)
const fmtDate = (d: string | null) => (d ? d.slice(0, 10).split('-').reverse().join('/') : '—')

export default function HrLifecycleDetailPage() {
  const { isAuthorized, isLoading, user } = useProtectedPage()
  const router = useRouter()
  const params = useParams<{ id: string }>()
  const { id: idResolved, error: linkError } = useRecordId(params?.id)
  const id = idResolved ?? 0
  // HR-staff view only with the hr app AND the Lifecycle tab in the Permission Matrix.
  const isHr = canActOnTab('hr', 'lifecycle', user)
  const { can, canFeature } = useCan()
  // Changing the event / its checklist = 'edit'; completing it (applying the
  // promotion / transfer / exit) = 'approve' on HR › Lifecycle.
  const canEditLc = isHr && can('hr', 'lifecycle', 'edit')
  const canCompleteLc = isHr && can('hr', 'lifecycle', 'approve')

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
  if (linkError) return (<div><HrNav /><InvalidRecordLink message={linkError} listHref={backHref} listLabel="Back" /></div>)
  if (!id) return <div><HrNav /></div>

  const summary = event?.completion_summary
  // "From → To" for a field the event changes; just the current value when unchanged.
  const move = (label: string, from: string | null, to: string | null) => (
    <DetailRow label={label}>{to ? <>{from || '—'} <span style={{ color: TEXT.muted }}>→</span> <b>{to}</b></> : from}</DetailRow>
  )

  return (
    <div>
      <HrNav />

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, marginBottom: 20, flexWrap: 'wrap' }}>
        <div style={{ minWidth: 0 }}>
          <p style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 4px' }}>
            HR &amp; Administration · Lifecycle
          </p>
          <div data-tour="hr-lcd-header" style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <h1 style={{ fontSize: 24, fontWeight: 700, color: TEXT.heading, margin: 0 }}>{event ? event.event_no : 'Lifecycle event'}</h1>
            {event && <span data-tour="hr-lcd-type-badge" style={badge(TYPE_HEX[event.event_type])}>{TYPE_LABELS[event.event_type]}</span>}
            {event && <span data-tour="hr-lcd-status-badge" style={badge(STATUS_HEX[event.status])}>{STATUS_LABELS[event.status]}</span>}
          </div>
          {event && (
            <p style={{ fontSize: 13.5, color: TEXT.muted, margin: '4px 0 0' }}>
              <b style={{ color: TEXT.heading }}>{event.subject_name || '—'}</b>
              {event.employee_code ? ` · ${event.employee_code}` : ''}{event.subject_email ? ` · ${event.subject_email}` : ''}
              {isHr && event.user_id && (
                <span data-tour="hr-lcd-employee-link" onClick={() => router.push(recordPath('/dashboard/hr/employees', event, 'user_id'))} style={{ marginLeft: 8, color: '#FF6A2A', fontWeight: 600, cursor: 'pointer' }}>Employee record</span>
              )}
            </p>
          )}
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          {canEditLc && event && open && !editing && (
            <>
              {event.status === 'draft' && <button type="button" data-tour="hr-lcd-start-btn" onClick={start} style={primaryBtnStyle}>Start checklist</button>}
              <button type="button" data-tour="hr-lcd-edit-btn" onClick={() => { setForm(eventToForm(event)); setEditing(true) }} style={secondaryBtnStyle}>Edit details</button>
              <button type="button" data-tour="hr-lcd-cancel-btn" onClick={() => setCancelOpen(true)} style={dangerBtnStyle}>Cancel event</button>
            </>
          )}
          {canEditLc && event?.status === 'scheduled' && (
            <button type="button" onClick={() => setCancelOpen(true)} style={dangerBtnStyle}>Cancel event</button>
          )}
          <button data-tour="hr-lcd-back-btn" onClick={() => router.push(backHref)} type="button" style={secondaryBtnStyle}>← Back</button>
        </div>
      </div>

      {!editing && error.length > 0 && <div style={errorBox}>{error.join(' ')}</div>}

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
            <div data-tour="hr-lcd-completed-summary" style={{ ...sectionStyle, border: '1px solid rgba(22,163,74,0.3)' }}>
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

          {/* Read-only event details: one card, label–value rows grouped by meaning. */}
          <DetailCard tour="hr-lcd-details" style={{ paddingTop: 10 }}>
            {event.event_type === 'exit' ? (
              <DetailGroup title="Exit">
                <DetailRow label="Exit type">{event.exit_type ? EXIT_TYPE_LABELS[event.exit_type] || event.exit_type : null}</DetailRow>
                {event.is_hr_view && <DetailRow label="Resignation date">{event.resignation_date ? fmtDate(event.resignation_date) : null}</DetailRow>}
                <DetailRow label="Last working day">{(event.last_working_day || event.effective_date) ? fmtDate(event.last_working_day || event.effective_date) : null}</DetailRow>
                {event.is_hr_view && <DetailRow label="Notice period">{event.notice_period_days != null ? `${event.notice_period_days} days` : null}</DetailRow>}
                <DetailRow label="Handover to">{event.handover_to_name}</DetailRow>
                {event.is_hr_view && event.exit_reason && <DetailRow label="Exit reason">{event.exit_reason}</DetailRow>}
              </DetailGroup>
            ) : (
              <DetailGroup title={event.event_type === 'joining' ? 'Joining' : event.event_type === 'confirmation' ? 'Confirmation' : 'What changes'}>
                <DetailRow label={event.event_type === 'joining' ? 'Date of joining' : event.event_type === 'confirmation' ? 'Confirmation date' : 'Effective from'}>{event.effective_date ? fmtDate(event.effective_date) : null}</DetailRow>
                {event.event_type !== 'confirmation' && (
                  <>
                    {move('Department', event.from_department_name, event.to_department_name)}
                    {move('Plant', event.from_branch_name, event.to_branch_name)}
                    {move('Designation', event.from_designation_name, event.to_designation_name)}
                    {move('Grade', event.from_grade_name, event.to_grade_name)}
                    {move('Reporting manager', event.from_manager_name, event.to_manager_name)}
                  </>
                )}
                {(event.event_type === 'transfer' || event.event_type === 'promotion') && <DetailRow label="Successor">{event.handover_to_name}</DetailRow>}
              </DetailGroup>
            )}
            {event.event_type === 'exit' && (
              <DetailGroup title="Position at exit">
                <DetailRow label="Department">{event.from_department_name}</DetailRow>
                <DetailRow label="Designation">{event.from_designation_name}</DetailRow>
                <DetailRow label="Reporting manager">{event.from_manager_name}</DetailRow>
              </DetailGroup>
            )}
            <DetailGroup last>
              <DetailRow label="Raised by">{event.created_by_name ? `${event.created_by_name} · ${fmtDate(event.created_at)}` : fmtDate(event.created_at)}</DetailRow>
              {event.is_hr_view && event.remarks && <DetailRow label="Remarks">{event.remarks}</DetailRow>}
            </DetailGroup>
          </DetailCard>

          <ChecklistPanel event={event} meta={meta} isHr={canEditLc && canFeature('hr', 'lifecycle', 'checklist', 'edit')} onChanged={load} />

          {event.status === 'scheduled' && (
            <ScheduledEventPanel eventId={event.id} eventNo={event.event_no} effectiveDate={event.effective_date ?? null} canApply={canCompleteLc} onApplied={load} />
          )}
          {canCompleteLc && event.status === 'in_progress' && (
            <CompletionPanel key={`${event.id}-${event.updated_at}`} event={event} meta={meta} onDone={(ev) => { setEvent(ev); setError([]) }} />
          )}
          {isHr && event.status === 'draft' && (
            <div data-tour="hr-lcd-draft-note" style={sectionStyle}>
              <p style={{ fontSize: 13, color: TEXT.muted, margin: 0 }}>This event is a draft — checklist owners haven&apos;t been notified yet. Use <b>Start checklist</b> when it&apos;s ready.</p>
            </div>
          )}
        </>
      )}

      {editing && form && meta && event && (
        <FormSheet width={760} tour="hr-lcd-edit-sheet" icon="edit" iconColor={TYPE_HEX[event.event_type] || SHEET.BLUE}
          title={`Edit ${TYPE_LABELS[event.event_type] || 'lifecycle'} event`}
          subtitle="Changes apply to the event; the checklist already raised is kept."
          onClose={() => setEditing(false)} busy={saving}
          footer={<>
            <button type="button" data-tour="hr-lcd-edit-discard-btn" onClick={() => setEditing(false)} disabled={saving} style={sheetBtn('secondary', SHEET.INK, saving)}>Discard</button>
            <button type="button" data-tour="hr-lcd-edit-save-btn" disabled={saving} onClick={saveEdit} style={sheetBtn('primary', SHEET.BLUE, saving)}><SheetIcon name="check" size={16} />{saving ? 'Saving…' : 'Save changes'}</button>
          </>}>
          <div style={{ padding: '20px 24px' }}>
            {error.length > 0 && <div style={errorBox}>{error.join(' ')}</div>}
            {event.event_type === 'joining' && !event.user_id && (
              <SheetSection icon="user" title="New Joiner">
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
                  <div data-tour="hr-lcd-edit-candidate-name" style={{ flex: '1 1 240px', maxWidth: 340 }}>
                    <label style={sheetLabel}>Full name</label>
                    <input style={sheetInput} value={form.candidate_name} onChange={(e) => setForm({ ...form, candidate_name: e.target.value })} />
                  </div>
                  <div data-tour="hr-lcd-edit-candidate-email" style={{ flex: '1 1 260px', maxWidth: 340 }}>
                    <label style={sheetLabel}>Work email</label>
                    <input style={sheetInput} value={form.candidate_email} onChange={(e) => setForm({ ...form, candidate_email: e.target.value })} />
                  </div>
                </div>
              </SheetSection>
            )}
            <SheetSection icon="list" title="Details">
              <EventFields type={event.event_type} form={form} setForm={setForm} meta={meta} subjectUserId={event.user_id} />
            </SheetSection>
          </div>
        </FormSheet>
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
