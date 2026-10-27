'use client'

import Select from '@/components/shared/Select'
import { useEffect, useMemo, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { useAssigneeFilter } from '@/hooks/useAssigneeFilter'
import { designApi } from '@/lib/api'
import { DesignLookupOption, DesignRequestDetail } from '@/types'
import { TEXT, GLASS, SHADOWS, BORDER } from '@/lib/theme'
import DesignNav from '@/components/design/DesignNav'
import SearchableSelect from '@/components/erp/SearchableSelect'
import DateField from '@/components/erp/DateField'
import ConfirmDialog from '@/components/erp/ConfirmDialog'
import { secondaryBtnStyle, dangerBtnStyle, primaryBtnStyle, smallSecondaryBtnStyle, RowCount, Pill, DetailCard, DetailSummary, DetailGroup, DetailRow } from '@/components/shared/ui'
import { PRIORITY_LABELS, REQUEST_SOURCE_LABELS, REQUEST_STATUS_LABELS, toOptions } from '@/components/design/designMeta'
import { useDesignFeature } from '@/components/design/useDesignFeature'
import { useDesignMe } from '@/components/design/useDesignMe'
import { FormSheet, SheetColumns, SheetSection, SheetIcon, Optional, Req, SHEET, sheetBtn, sheetInput, sheetLabel, sheetHint, SheetError } from '@/components/shared/FormSheet'
import { DANGER_RED } from '@/components/design/DesignSheets'
import ReasonSheet from '@/components/shared/ReasonSheet'
import { extractErrorMessages } from '@/lib/validation'
import { formatDate, formatDateTime } from '@/lib/format'
import { recordHref, recordPath, useRecordId } from '@/lib/recordRef'
import InvalidRecordLink from '@/components/erp/InvalidRecordLink'
import OrderProjectPicker, { OrderProjectChip, OrderProjectValue } from '@/components/sales/ProjectUnitPicker'

const STATUS_HEX: Record<string, string> = {
  open: '#2563EB', accepted: '#7C3AED', in_progress: '#0f766e', on_hold: '#b45309', completed: '#16A34A', cancelled: '#a8a29e',
}
const PRIORITY_HEX: Record<string, string> = { low: '#78716c', medium: '#2563EB', high: '#b45309', urgent: '#DC2626' }
const DELIVERABLE_LABELS: Record<string, string> = {
  draft: 'Draft', in_review: 'In check', in_approval: 'In approval', approved: 'Awaiting customer', released: 'Released',
  revising: 'Released · revising', obsolete: 'Obsolete', customer_rejected: 'Customer rejected',
}
const DELIVERABLE_HEX: Record<string, string> = {
  draft: '#78716c', in_review: '#2563EB', in_approval: '#7C3AED', approved: '#0891b2', released: '#16A34A', revising: '#0f766e',
  obsolete: '#DC2626', customer_rejected: '#DC2626',
}
const EVENT_LABELS: Record<string, string> = {
  request_created: 'raised the request', drawing_milestone_due: 'drawing-approval billing milestone fell due', request_updated: 'updated the details', request_accept: 'accepted the request',
  request_start: 'started work', request_hold: 'put it on hold', request_resume: 'resumed work', request_complete: 'completed the request',
  request_cancel: 'cancelled the request', request_reopen: 'reopened the request', requirement_revised: 'revised the requirement',
  requirement_reviewed: 'reviewed the revised requirement', waiting_on_design: 'set it waiting on Design',
  waiting_on_requester: 'set it waiting on the requester', document_created: 'created a drawing for it', bom_created: 'created a BOM for it',
  comment: 'commented',
}
const EVENT_HEX: Record<string, string> = {
  request_complete: '#16A34A', request_accept: '#7C3AED', request_start: '#0f766e', request_hold: '#b45309', request_cancel: '#DC2626',
  requirement_revised: '#DC2626', requirement_reviewed: '#2563EB', waiting_on_requester: '#b45309', document_created: '#16A34A',
  bom_created: '#16A34A', comment: '#FF6A2A',
}

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '9px 12px', borderRadius: 10, border: `1px solid ${BORDER.normal}`,
  background: 'rgba(255,255,255,.7)', fontSize: 13, outline: 'none', color: TEXT.body, boxSizing: 'border-box',
}
const sectionStyle: React.CSSProperties = {
  borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur,
  border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), padding: 20, marginBottom: 16,
}
const sectionTitle: React.CSSProperties = { fontSize: 12, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.secondary, margin: '0 0 14px' }
const primaryBtn: React.CSSProperties = primaryBtnStyle
const thStyle: React.CSSProperties = { textAlign: 'left', padding: '8px 10px', fontSize: 11, fontWeight: 600, letterSpacing: '.03em', textTransform: 'uppercase', color: TEXT.muted, background: '#fdf1e6' }
const tdStyle: React.CSSProperties = { padding: '9px 10px', fontSize: 12.5, color: TEXT.body, borderTop: `1px solid ${BORDER.light}`, verticalAlign: 'top' }
const hintStyle: React.CSSProperties = { fontSize: 12, color: TEXT.muted, margin: '6px 0 0' }

function badge(label: string, hex: string) {
  return (
    <Pill label={label} hex={hex} />
  )
}

type StatusPrompt = 'hold' | 'cancel' | 'reopen' | null
type StatusConfirm = 'accept' | 'start' | 'resume' | 'complete' | null

const PROMPT_TEXT: Record<Exclude<StatusPrompt, null>, { title: string; message: string; placeholder: string; label: string; danger: boolean }> = {
  hold: { title: 'Put the request on hold', message: 'Work stops until it is resumed. The requester is told why.', placeholder: 'Reason — e.g. waiting for customer GA approval', label: 'Put on Hold', danger: false },
  cancel: { title: 'Cancel the request', message: 'Design stops work on it. The requester is told why. It can be reopened later.', placeholder: 'Reason — e.g. tender dropped by BD', label: 'Cancel Request', danger: true },
  reopen: { title: 'Reopen the request', message: 'It goes back to In progress.', placeholder: 'Reason — e.g. customer asked for an extra variant', label: 'Reopen', danger: false },
}
const CONFIRM_TEXT: Record<Exclude<StatusConfirm, null>, { title: string; label: string; done: string }> = {
  accept: { title: 'Accept this request?', label: 'Accept', done: 'accepted' },
  start: { title: 'Start work?', label: 'Start', done: 'started' },
  resume: { title: 'Resume work?', label: 'Resume', done: 'resumed' },
  complete: { title: 'Mark the request completed?', label: 'Complete', done: 'completed' },
}

export default function DesignRequestDetailPage() {
  const { isAuthorized, isLoading } = useRequireApp('design')
  const router = useRouter()
  const params = useParams()
  const { id, error: linkError } = useRecordId(params.id as string)
  // Role-level features (Design › Requests); buttons follow the server's allowed_actions.
  const designFeature = useDesignFeature()
  const seeRequirement = designFeature('project_work', 'technical_requirement', 'view')
  const seeDeliverables = designFeature('project_work', 'deliverables', 'view')
  const seeTimeline = designFeature('project_work', 'timeline', 'view')
  const me = useDesignMe(isAuthorized)

  const [req, setReq] = useState<DesignRequestDetail | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | string[]>('')
  const [success, setSuccess] = useState('')
  const [statusPrompt, setStatusPrompt] = useState<StatusPrompt>(null)
  const [statusConfirm, setStatusConfirm] = useState<StatusConfirm>(null)

  const [users, setUsers] = useState<DesignLookupOption[]>([])
  const [projects, setProjects] = useState<DesignLookupOption[]>([])
  const [machines, setMachines] = useState<DesignLookupOption[]>([])
  const [customers, setCustomers] = useState<DesignLookupOption[]>([])
  const [milestones, setMilestones] = useState<DesignLookupOption[]>([])

  const [editing, setEditing] = useState(false)
  const [edit, setEdit] = useState<Record<string, string>>({})
  const [editOp, setEditOp] = useState<OrderProjectValue | null>(null)
  // Errors shown inside the open popup (edit / revise / waiting).
  const [sheetError, setSheetError] = useState<string | string[]>('')
  const [reviseOpen, setReviseOpen] = useState(false)
  const [revise, setRevise] = useState({ requirement: '', change_note: '' })
  const [waitingOpen, setWaitingOpen] = useState(false)
  const [waiting, setWaiting] = useState<{ waiting_on: 'design' | 'requester'; note: string }>({ waiting_on: 'requester', note: '' })
  const [comment, setComment] = useState('')
  const [showHistory, setShowHistory] = useState(false)

  useEffect(() => {
    if (!isAuthorized || !id) return
    designApi.getRequest(id)
      .then(setReq)
      .catch((err) => setError(extractErrorMessages(err, 'Failed to load the design request.')))
  }, [isAuthorized, id])

  // Edit-form lookups load when the form first opens.
  useEffect(() => {
    if (!isAuthorized || !editing || users.length) return
    Promise.all([designApi.lookupUsers(), designApi.lookupProjects(), designApi.lookupMachines(), designApi.lookupCustomers()])
      .then(([u, p, m, c]) => { setUsers(u); setProjects(p); setMachines(m); setCustomers(c) })
      .catch((err) => setSheetError(extractErrorMessages(err, 'Failed to load the form options.')))
  }, [isAuthorized, editing, users.length])

  useEffect(() => {
    if (!isAuthorized || !editing || !edit.pm_project_id) return
    designApi.lookupMilestones(Number(edit.pm_project_id))
      .then(setMilestones)
      .catch((err) => setSheetError(extractErrorMessages(err, 'Failed to load the project\'s WBS elements.')))
  }, [isAuthorized, editing, edit.pm_project_id])

  // Role "Assign to" rule (Role & Permissions › Design › Requests › Accept & progress); the current lead stays listed.
  const allowLead = useAssigneeFilter('design:project_work.request_progress')
  const userOptions = useMemo(() => toOptions(users.filter((u) => u.id === req?.lead_designer_id || allowLead(u.id))
    .map((u) => ({ id: u.id, label: u.code ? `${u.label} — ${u.code}` : u.label })), 'Not assigned'), [users, req, allowLead])

  if (isLoading || !isAuthorized) return null
  if (linkError) return (<div><DesignNav /><InvalidRecordLink message={linkError} listHref="/dashboard/design/project-work" listLabel="Back to project work" /></div>)

  const can = (action: string) => !!req?.allowed_actions.includes(action)
  const active = !!req && ['open', 'accepted', 'in_progress', 'on_hold'].includes(req.status)
  const isTeam = !!me && me.role !== 'viewer'

  const act = async (fn: () => Promise<DesignRequestDetail>, fallback: string, done: string): Promise<boolean> => {
    setBusy(true)
    setError('')
    setSuccess('')
    try {
      setReq(await fn())
      setSuccess(done)
      return true
    } catch (err) {
      setError(extractErrorMessages(err, fallback))
      return false
    } finally {
      setBusy(false)
    }
  }

  // Same as act(), but the error stays inside the open popup.
  const sheetAct = async (fn: () => Promise<DesignRequestDetail>, fallback: string, done: string): Promise<boolean> => {
    setBusy(true)
    setSheetError('')
    setError('')
    setSuccess('')
    try {
      setReq(await fn())
      setSuccess(done)
      return true
    } catch (err) {
      setSheetError(extractErrorMessages(err, fallback))
      return false
    } finally {
      setBusy(false)
    }
  }

  const runStatusConfirm = async () => {
    const which = statusConfirm
    setStatusConfirm(null)
    if (!req || !which) return
    await act(() => designApi.requestStatus(req.id, which), `Couldn't ${which} the request.`, `${req.request_number} ${CONFIRM_TEXT[which].done}.`)
  }
  // ReasonSheet: throws on failure so the error shows inside the popup.
  const runStatusPrompt = async (value: string) => {
    const which = statusPrompt
    if (!req || !which) return
    const done = which === 'hold' ? 'put on hold' : which === 'cancel' ? 'cancelled' : 'reopened'
    setError('')
    setSuccess('')
    setReq(await designApi.requestStatus(req.id, which, value.trim()))
    setSuccess(`${req.request_number} ${done}.`)
    setStatusPrompt(null)
  }

  const startEdit = () => {
    if (!req) return
    setEdit({
      title: req.title, customer_id: req.customer_id ? String(req.customer_id) : '', pm_project_id: req.pm_project_id ? String(req.pm_project_id) : '',
      pm_milestone_id: req.pm_milestone_id ? String(req.pm_milestone_id) : '', erp_project_id: req.erp_project_id ? String(req.erp_project_id) : '',
      priority: req.priority, due_date: req.due_date || '', lead_designer_id: req.lead_designer_id ? String(req.lead_designer_id) : '',
    })
    setEditOp(req.order_project_id ? { projectId: req.order_project_id, elementId: req.order_project_element_id ?? null } : null)
    setSheetError('')
    setEditing(true)
  }
  const saveEdit = async () => {
    if (!req) return
    if ((edit.title || '').trim().length < 3) { setSheetError('The title needs at least 3 characters.'); return }
    const num = (v: string) => (v ? Number(v) : null)
    const ok = await sheetAct(() => designApi.updateRequest(req.id, {
      title: edit.title.trim(), customer_id: num(edit.customer_id), pm_project_id: num(edit.pm_project_id),
      pm_milestone_id: num(edit.pm_milestone_id), erp_project_id: num(edit.erp_project_id), priority: edit.priority,
      due_date: edit.due_date || null, lead_designer_id: num(edit.lead_designer_id),
      order_project_id: editOp?.projectId ?? null, order_project_element_id: editOp?.elementId ?? null,
    }), 'Saving the request failed.', 'Request updated.')
    if (ok) setEditing(false)
  }

  const openRevise = () => {
    if (!req) return
    setRevise({ requirement: req.requirement, change_note: '' })
    setSheetError('')
    setReviseOpen(true)
  }
  const saveRevise = async () => {
    if (!req) return
    if (revise.requirement.trim().length < 5) { setSheetError('The requirement needs at least 5 characters.'); return }
    if (revise.requirement.trim() === req.requirement.trim()) { setSheetError('The requirement text hasn\'t changed — edit it before saving a new revision.'); return }
    if (revise.change_note.trim().length < 3) { setSheetError('Say what changed and why (change note, at least 3 characters) — the lead designer reads it first.'); return }
    const ok = await sheetAct(() => designApi.reviseRequest(req.id, revise.requirement.trim(), revise.change_note.trim()),
      'Revising the requirement failed.', `Requirement revised to rev ${req.requirement_revision + 1} — ${req.lead_designer_name || 'the Design head'} is asked to review it.`)
    if (ok) setReviseOpen(false)
  }

  const openWaiting = () => {
    if (!req) return
    setWaiting({ waiting_on: req.waiting_on === 'design' ? 'requester' : 'design', note: '' })
    setSheetError('')
    setWaitingOpen(true)
  }
  const saveWaiting = async () => {
    if (!req) return
    if (waiting.waiting_on === 'requester' && !waiting.note.trim()) { setSheetError('Say what Design is waiting for from the requester.'); return }
    const ok = await sheetAct(() => designApi.requestWaiting(req.id, waiting.waiting_on, waiting.note.trim() || undefined), 'Updating who it waits on failed.',
      waiting.waiting_on === 'requester' ? `Waiting on ${req.requested_by_name || 'the requester'} — they have been notified.` : 'Back with Design.')
    if (ok) setWaitingOpen(false)
  }

  const postComment = async () => {
    if (!req || !comment.trim()) return
    const ok = await act(() => designApi.commentRequest(req.id, comment.trim()), 'Posting the comment failed.', 'Comment added.')
    if (ok) setComment('')
  }

  return (
    <div>
      <DesignNav />

      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, marginBottom: 16, flexWrap: 'wrap' }}>
        <div style={{ minWidth: 0 }}>
          <p style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 4px' }}>
            Design · Design Request
          </p>
          <h1 data-tour="design-req-header" style={{ fontSize: 24, fontWeight: 700, color: TEXT.heading, margin: 0 }}>
            {req ? req.request_number : 'Request'}
          </h1>
        </div>
        <button data-tour="design-req-back-btn" onClick={() => router.push('/dashboard/design/project-work')} type="button" style={secondaryBtnStyle}>← Back</button>
      </div>

      {error && (
        <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
          {Array.isArray(error) ? error.join(' ') : error}
        </div>
      )}
      {success && (
        <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(22,163,74,0.08)', border: '1px solid rgba(22,163,74,0.2)', color: '#15803d', fontSize: 13 }}>
          {success}
        </div>
      )}

      {req && (
        <>
          {/* What was asked, by whom, and where it stands: summary on top, then the request's details. */}
          <DetailCard tour="design-req-details">
            <DetailSummary
              title={req.title}
              meta={<span data-tour="design-req-subline" style={{ display: 'contents' }}>
                {badge(REQUEST_STATUS_LABELS[req.status] || req.status, STATUS_HEX[req.status] || '#78716c')}
                {badge(PRIORITY_LABELS[req.priority] || req.priority, PRIORITY_HEX[req.priority] || '#78716c')}
                <span style={{ color: req.is_overdue ? '#DC2626' : undefined, fontWeight: req.is_overdue ? 700 : 400 }}>
                  · Due {req.due_date ? formatDate(req.due_date) : 'not set'}{req.is_overdue ? ' · overdue' : ''}
                </span>
                {active && <span>· Waiting on <strong style={{ color: req.waiting_on === 'design' ? '#2563EB' : '#b45309' }}>{req.waiting_on === 'design' ? 'Design' : (req.requested_by_name || 'the requester')}</strong>{req.waiting_note ? ` — ${req.waiting_note}` : ''}</span>}
                <span>· Lead designer <strong style={{ color: TEXT.heading }}>{req.lead_designer_name || 'not assigned'}</strong></span>
              </span>}
              actions={can('edit') ? (
                <button type="button" data-tour="design-req-edit-btn" style={smallSecondaryBtnStyle} onClick={startEdit}>Edit details</button>
              ) : undefined}
            />
            <DetailGroup title="Request">
              <DetailRow label="Source">{REQUEST_SOURCE_LABELS[req.source] || req.source}</DetailRow>
              {req.crm_reference && <DetailRow label="CRM reference">{req.crm_reference}</DetailRow>}
              <DetailRow label="Raised by">{`${req.requested_by_name || '—'} · ${formatDate(req.created_at)}`}</DetailRow>
              {req.closed_at && <DetailRow label={req.status === 'cancelled' ? 'Cancelled' : 'Completed'}>{formatDateTime(req.closed_at)}</DetailRow>}
            </DetailGroup>
            <DetailGroup title="Linked to" last>
              {req.order_project_number && (
                <DetailRow label="Project">
                  <OrderProjectChip opNumber={req.order_project_number} elementNo={req.order_project_element_no} label={req.order_project_element_label}
                    onClick={() => router.push(recordPath('/dashboard/projects', req, 'order_project_id'))} />
                </DetailRow>
              )}
              <DetailRow label="Customer">{req.customer_name}</DetailRow>
              <DetailRow label="Project">{req.pm_project_label}</DetailRow>
              <DetailRow label="WBS">{req.pm_milestone_label}</DetailRow>
              {req.erp_project_label && <DetailRow label="Machine">{req.erp_project_label}</DetailRow>}
            </DetailGroup>
          </DetailCard>

          {req.changed_since_review && (
            <div style={{ padding: '12px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.25)', color: '#991b1b', fontSize: 13, display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
              <span style={{ flex: '1 1 320px' }}>
                <strong>Requirement changed since your review.</strong> It is now rev {req.requirement_revision}
                {req.requirement_revised_at ? ` (revised ${formatDateTime(req.requirement_revised_at)})` : ''} — read the change before continuing the design.
                {req.history[0]?.change_note ? <> Change note: “{req.history[0].change_note}”.</> : null}
              </span>
              {can('acknowledge') && (
                <button data-tour="design-req-reviewed-btn" disabled={busy} style={primaryBtn} onClick={() => act(() => designApi.acknowledgeRequest(req.id), 'Recording your review failed.', `Rev ${req.requirement_revision} marked as reviewed.`)}>
                  I&apos;ve reviewed it
                </button>
              )}
            </div>
          )}
          {req.status === 'on_hold' && req.close_reason && (
            <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.3)', color: '#92400E', fontSize: 13 }}>
              <strong>On hold:</strong> {req.close_reason}
            </div>
          )}
          {req.status === 'cancelled' && (
            <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
              <strong>Cancelled</strong>{req.closed_at ? ` on ${formatDate(req.closed_at)}` : ''}{req.close_reason ? `: ${req.close_reason}` : '.'}
            </div>
          )}

          {/* Action bar */}
          <div data-tour="design-req-actions" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
            {can('accept') && <button data-tour="design-req-accept-btn" disabled={busy} style={primaryBtn} onClick={() => setStatusConfirm('accept')}>Accept</button>}
            {can('start') && <button data-tour="design-req-start-btn" disabled={busy} style={primaryBtn} onClick={() => setStatusConfirm('start')}>Start Work</button>}
            {can('resume') && <button data-tour="design-req-resume-btn" disabled={busy} style={primaryBtn} onClick={() => setStatusConfirm('resume')}>Resume</button>}
            {can('complete') && <button data-tour="design-req-complete-btn" disabled={busy} style={primaryBtn} onClick={() => setStatusConfirm('complete')}>Mark Completed</button>}
            {can('set_waiting') && <button data-tour="design-req-waiting-btn" disabled={busy} style={secondaryBtnStyle} onClick={openWaiting}>{req.waiting_on === 'design' ? 'Waiting on Requester…' : 'Back with Design…'}</button>}
            {can('revise') && <button data-tour="design-req-revise-btn" disabled={busy} style={secondaryBtnStyle} onClick={openRevise}>Revise Requirement</button>}
            {can('hold') && <button data-tour="design-req-hold-btn" disabled={busy} style={secondaryBtnStyle} onClick={() => setStatusPrompt('hold')}>Put on Hold</button>}
            {can('reopen') && <button data-tour="design-req-reopen-btn" disabled={busy} style={secondaryBtnStyle} onClick={() => setStatusPrompt('reopen')}>Reopen</button>}
            {can('cancel') && <button data-tour="design-req-cancel-btn" disabled={busy} style={dangerBtnStyle} onClick={() => setStatusPrompt('cancel')}>Cancel Request</button>}
          </div>

          {reviseOpen && (
            <FormSheet width={640} tour="design-req-revise-panel" icon="edit" title={`Revise the requirement → rev ${req.requirement_revision + 1}`} busy={busy} onClose={() => setReviseOpen(false)}
              subtitle={`${req.request_number} — the lead designer and the Design head are notified and must confirm they've reviewed the change.`}
              footer={<>
                <button type="button" disabled={busy} style={sheetBtn('secondary', SHEET.INK, busy)} onClick={() => setReviseOpen(false)}>Cancel</button>
                <button type="button" data-tour="design-req-revise-save-btn" disabled={busy} style={sheetBtn('primary', SHEET.BLUE, busy)} onClick={saveRevise}>
                  <SheetIcon name="check" size={16} />{busy ? 'Saving…' : 'Save Revision'}
                </button>
              </>}>
              <div style={{ padding: '20px 24px' }}>
                <SheetError error={sheetError} />
                <SheetSection icon="list" title="Technical requirement">
                  <label style={sheetLabel}>Requirement <Req /></label>
                  <textarea style={{ ...sheetInput, minHeight: 160, resize: 'vertical' }} value={revise.requirement} onChange={(e) => setRevise({ ...revise, requirement: e.target.value })} autoFocus />
                </SheetSection>
                <SheetSection icon="chat" title="Change note">
                  <div data-tour="design-req-revise-note">
                    <label style={sheetLabel}>What changed and why <Req /></label>
                    <input style={sheetInput} value={revise.change_note} onChange={(e) => setRevise({ ...revise, change_note: e.target.value })} placeholder="e.g. Customer raised axle load from 20 t to 22.5 t (tender corrigendum 2)" />
                    <p style={sheetHint}>The lead designer reads this first, before the new requirement text.</p>
                  </div>
                </SheetSection>
              </div>
            </FormSheet>
          )}

          {waitingOpen && (
            <FormSheet width={580} tour="design-req-waiting-panel" icon="clock" title="Who is this waiting on?" busy={busy} onClose={() => setWaitingOpen(false)}
              subtitle={`${req.request_number} — when it waits on the requester they are notified with your note.`}
              footer={<>
                <button type="button" disabled={busy} style={sheetBtn('secondary', SHEET.INK, busy)} onClick={() => setWaitingOpen(false)}>Cancel</button>
                <button type="button" data-tour="design-req-waiting-save-btn" disabled={busy} style={sheetBtn('primary', SHEET.BLUE, busy)} onClick={saveWaiting}>
                  <SheetIcon name="check" size={16} />{busy ? 'Saving…' : 'Save'}
                </button>
              </>}>
              <div style={{ padding: '20px 24px' }}>
                <SheetError error={sheetError} />
                <SheetSection icon="users" title="Waiting on">
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {(['design', 'requester'] as const).map((w) => (
                      <label key={w} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13.5, color: SHEET.INK, cursor: 'pointer' }}>
                        <input type="radio" name="waiting" checked={waiting.waiting_on === w} onChange={() => setWaiting({ ...waiting, waiting_on: w })} />
                        {w === 'design' ? 'Design (work is with us)' : `Requester (${req.requested_by_name || 'the person who raised it'} owes us input)`}
                      </label>
                    ))}
                  </div>
                </SheetSection>
                <SheetSection icon="chat" title={waiting.waiting_on === 'requester' ? 'What Design needs' : 'Note'}>
                  <label style={sheetLabel}>{waiting.waiting_on === 'requester' ? <>What Design needs from them <Req /></> : <>Note <Optional /></>}</label>
                  <input style={sheetInput} value={waiting.note} onChange={(e) => setWaiting({ ...waiting, note: e.target.value })}
                    placeholder={waiting.waiting_on === 'requester' ? 'e.g. Customer track gauge and loading-gauge drawing' : 'Optional — e.g. inputs received on 06-10'} />
                </SheetSection>
              </div>
            </FormSheet>
          )}

          {editing && (
            <FormSheet tour="design-req-edit-panel" icon="edit" title="Edit request details" busy={busy} onClose={() => setEditing(false)}
              subtitle={`${req.request_number} — source and CRM reference are fixed once raised. Change the requirement with “Revise Requirement”.`}
              footer={<>
                <button type="button" disabled={busy} style={sheetBtn('secondary', SHEET.INK, busy)} onClick={() => setEditing(false)}>Cancel</button>
                <button type="button" data-tour="design-req-edit-save-btn" disabled={busy} style={sheetBtn('primary', SHEET.BLUE, busy)} onClick={saveEdit}>
                  <SheetIcon name="check" size={16} />{busy ? 'Saving…' : 'Save'}
                </button>
              </>}>
              <SheetColumns
                left={<>
                  <SheetError error={sheetError} />
                  <SheetSection icon="doc" title="Request">
                    <div style={{ marginBottom: 14 }}>
                      <label style={sheetLabel}>Title <Req /></label>
                      <input style={sheetInput} value={edit.title} onChange={(e) => setEdit({ ...edit, title: e.target.value })} autoFocus />
                    </div>
                    <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                      <div style={{ flex: '0 1 130px', minWidth: 120 }}>
                        <label style={sheetLabel}>Priority</label>
                        <Select style={sheetInput} value={edit.priority} onChange={(e) => setEdit({ ...edit, priority: e.target.value })}>
                          {Object.entries(PRIORITY_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                        </Select>
                      </div>
                      <div style={{ flex: '0 1 170px', minWidth: 150 }}>
                        <label style={sheetLabel}>Due date <Optional /></label>
                        <DateField value={edit.due_date} onChange={(v) => setEdit({ ...edit, due_date: v })} />
                      </div>
                    </div>
                  </SheetSection>
                  <SheetSection icon="user" title="Lead designer">
                    <SearchableSelect value={edit.lead_designer_id} onChange={(v) => setEdit({ ...edit, lead_designer_id: v })} options={userOptions} />
                    <p style={sheetHint}>Accepting the request needs a lead designer.</p>
                  </SheetSection>
                </>}
                right={
                  <SheetSection icon="link" title="Links">
                    <div style={{ marginBottom: 14 }}><label style={sheetLabel}>Project <Optional /></label><OrderProjectPicker value={editOp} requireElement={false} onChange={(v) => setEditOp(v)} /></div>
                    <div style={{ marginBottom: 14 }}><label style={sheetLabel}>Customer <Optional /></label><SearchableSelect value={edit.customer_id} onChange={(v) => setEdit({ ...edit, customer_id: v })} options={toOptions(customers, 'None')} /></div>
                    <div style={{ marginBottom: 14 }}><label style={sheetLabel}>Project <Optional /></label><SearchableSelect value={edit.pm_project_id} onChange={(v) => { setMilestones([]); setEdit({ ...edit, pm_project_id: v, pm_milestone_id: '' }) }} options={toOptions(projects, 'None')} /></div>
                    <div style={{ marginBottom: 14 }}>
                      <label style={sheetLabel}>WBS <Optional /></label>
                      <SearchableSelect value={edit.pm_milestone_id} onChange={(v) => setEdit({ ...edit, pm_milestone_id: v })} options={toOptions(milestones, 'None')}
                        placeholder={edit.pm_project_id ? 'Select WBS…' : 'Pick a project first'} disabled={!edit.pm_project_id} />
                    </div>
                    <div><label style={sheetLabel}>Machine <Optional /></label><SearchableSelect value={edit.erp_project_id} onChange={(v) => setEdit({ ...edit, erp_project_id: v })} options={toOptions(machines, 'None')} /></div>
                  </SheetSection>
                }
              />
            </FormSheet>
          )}

          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'flex-start' }}>
            {/* Left: requirement + deliverables */}
            <div style={{ flex: '2 1 560px', minWidth: 0, display: 'flex', flexDirection: 'column' }}>
              {seeRequirement && (<div data-tour="design-req-requirement" style={sectionStyle}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
                  <p style={{ ...sectionTitle, margin: 0, flex: 1 }}>Technical requirement · rev {req.requirement_revision}</p>
                  {req.history.length > 1 && (
                    <button type="button" data-tour="design-req-history-btn" style={{ ...smallSecondaryBtnStyle }} onClick={() => setShowHistory((v) => !v)}>
                      {showHistory ? 'Hide' : 'Show'} revision history ({req.history.length})
                    </button>
                  )}
                </div>
                <p style={{ fontSize: 13.5, color: TEXT.body, margin: 0, whiteSpace: 'pre-wrap', lineHeight: 1.55 }}>{req.requirement}</p>
                {req.requirement_revision > 0 && (
                  <p style={{ ...hintStyle, marginTop: 10 }}>
                    Last revised {formatDateTime(req.requirement_revised_at)}.{' '}
                    {req.changed_since_review ? <span style={{ color: '#DC2626', fontWeight: 600 }}>Not yet reviewed by Design.</span> : `Reviewed by Design (rev ${req.reviewed_revision}).`}
                  </p>
                )}
                {showHistory && (
                  <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {req.history.map((h) => (
                      <div key={h.id} style={{ padding: '10px 12px', borderRadius: 10, border: `1px solid ${BORDER.light}`, background: 'rgba(255,255,255,.55)' }}>
                        <p style={{ fontSize: 12.5, color: TEXT.heading, fontWeight: 700, margin: 0 }}>
                          Rev {h.revision}{h.revision === req.requirement_revision ? ' (current)' : ''}
                          <span style={{ fontWeight: 400, color: TEXT.muted }}> · {h.revised_by_name || '—'} · {formatDateTime(h.created_at)}</span>
                        </p>
                        {h.change_note && <p style={{ fontSize: 12.5, color: '#b45309', margin: '3px 0 0' }}>{h.change_note}</p>}
                        <p style={{ fontSize: 12.5, color: TEXT.secondary, margin: '6px 0 0', whiteSpace: 'pre-wrap' }}>{h.requirement}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>)}

              {seeDeliverables && (<div data-tour="design-req-deliverables" style={sectionStyle}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
                  <p style={{ ...sectionTitle, margin: 0, flex: 1 }}>Deliverables · {req.released_count} / {req.document_count} released</p>
                  {isTeam && active && (
                    <>
                      <button type="button" data-tour="design-req-new-drawing-btn" style={{ ...smallSecondaryBtnStyle }} onClick={() => router.push(recordHref('/dashboard/design/documents/new', req, 'id', undefined, 'request_id'))}>+ New drawing for this request</button>
                      <button type="button" data-tour="design-req-new-bom-btn" style={{ ...smallSecondaryBtnStyle }} onClick={() => router.push(recordHref('/dashboard/design/boms/new', req, 'id', undefined, 'request_id'))}>+ New BOM</button>
                    </>
                  )}
                </div>
                {req.deliverables.length === 0 ? (
                  <p style={{ fontSize: 13, color: TEXT.muted, margin: 0 }}>No drawings or BOMs made for this request yet.</p>
                ) : (
                  <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 560 }}>
                      <thead><tr>{['Type', 'Number', 'Title', 'Released rev', 'Status'].map((h, hi) => <th key={h} style={thStyle}>{h}{hi === 0 && <RowCount count={req.deliverables.length} />}</th>)}</tr></thead>
                      <tbody>
                        {req.deliverables.map((d) => (
                          <tr key={`${d.kind}-${d.id}`} onClick={() => router.push(d.kind === 'bom' ? recordPath('/dashboard/design/boms', d) : recordPath('/dashboard/design/documents', d))} style={{ cursor: 'pointer' }}>
                            <td style={tdStyle}>{d.kind === 'bom' ? 'BOM' : 'Drawing'}</td>
                            <td style={{ ...tdStyle, fontWeight: 700, color: '#FF6A2A', whiteSpace: 'nowrap' }}>{d.number}</td>
                            <td style={{ ...tdStyle, maxWidth: 300 }}>{d.title}</td>
                            <td style={tdStyle}>{d.released_revision_label || <span style={{ color: TEXT.muted }}>—</span>}</td>
                            <td style={tdStyle}>{badge(DELIVERABLE_LABELS[d.status] || d.status, DELIVERABLE_HEX[d.status] || '#78716c')}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>)}
            </div>

            {/* Right: details + timeline */}
            <div style={{ flex: '1 1 320px', minWidth: 0, display: 'flex', flexDirection: 'column' }}>
              {seeTimeline && (<div data-tour="design-req-timeline" style={sectionStyle}>
                <p style={sectionTitle}>Timeline</p>
                {can('comment') && (
                  <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
                    <input style={inputStyle} value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Add a comment…"
                      onKeyDown={(e) => { if (e.key === 'Enter') postComment() }} />
                    <button type="button" disabled={busy || !comment.trim()} style={{ ...secondaryBtnStyle, whiteSpace: 'nowrap' }} onClick={postComment}>Post</button>
                  </div>
                )}
                <div style={{ display: 'flex', flexDirection: 'column', maxHeight: 560, overflowY: 'auto' }}>
                  {req.events.map((e) => {
                    const link = e.action === 'document_created' && e.document_id ? recordPath('/dashboard/design/documents', e, 'document_id')
                      : e.action === 'bom_created' && e.bom_id ? recordPath('/dashboard/design/boms', e, 'bom_id') : null
                    return (
                      <div key={e.id} style={{ display: 'flex', gap: 10, padding: '8px 0', borderTop: `1px solid ${BORDER.light}` }}>
                        <span style={{ width: 8, height: 8, borderRadius: '50%', marginTop: 6, flex: 'none', background: EVENT_HEX[e.action] || '#a8a29e' }} />
                        <div style={{ minWidth: 0 }}>
                          <p style={{ fontSize: 12.5, color: TEXT.body, margin: 0 }}>
                            <strong>{e.actor_name || 'System'}</strong> {EVENT_LABELS[e.action] || e.action.replace(/_/g, ' ')}
                          </p>
                          {e.comment && (
                            link ? <p onClick={() => router.push(link)} style={{ fontSize: 12.5, color: '#FF6A2A', fontWeight: 600, margin: '2px 0 0', cursor: 'pointer' }}>{e.comment}</p>
                              : <p style={{ fontSize: 12.5, color: TEXT.secondary, margin: '2px 0 0', whiteSpace: 'pre-wrap' }}>{e.comment}</p>
                          )}
                          <p style={{ fontSize: 11, color: TEXT.muted, margin: '2px 0 0' }}>{formatDateTime(e.created_at)}</p>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>)}
            </div>
          </div>
        </>
      )}

      <ConfirmDialog
        open={statusConfirm !== null}
        title={statusConfirm ? CONFIRM_TEXT[statusConfirm].title : ''}
        message={(() => {
          if (!req || !statusConfirm) return ''
          if (statusConfirm === 'accept') return req.lead_designer_name
            ? `${req.request_number} is accepted with ${req.lead_designer_name} as lead designer. The requester is notified.`
            : `${req.request_number} has no lead designer yet — assign one with “Edit” first, or accepting will be refused.`
          if (statusConfirm === 'complete') return req.document_count > req.released_count
            ? `${req.document_count - req.released_count} of ${req.document_count} deliverables aren't released yet. Complete ${req.request_number} anyway? The requester is notified.`
            : `${req.request_number} is marked completed and the requester is notified.`
          return `${req.request_number} moves to In progress. The requester is notified.`
        })()}
        confirmLabel={statusConfirm ? CONFIRM_TEXT[statusConfirm].label : 'OK'}
        danger={false}
        onConfirm={runStatusConfirm}
        onCancel={() => setStatusConfirm(null)}
      />
      {req && statusPrompt && (
        <ReasonSheet
          open
          tour={`design-req-${statusPrompt}-sheet`}
          icon={statusPrompt === 'hold' ? 'clock' : statusPrompt === 'cancel' ? 'x' : 'undo'}
          iconColor={PROMPT_TEXT[statusPrompt].danger ? DANGER_RED : statusPrompt === 'hold' ? '#b45309' : SHEET.BLUE}
          title={PROMPT_TEXT[statusPrompt].title}
          subtitle={`${req.request_number} — ${PROMPT_TEXT[statusPrompt].message}`}
          label="Reason"
          requireValue
          requiredMessage={`Give a reason to ${statusPrompt} ${req.request_number} — the requester is told why.`}
          placeholder={PROMPT_TEXT[statusPrompt].placeholder}
          confirmLabel={PROMPT_TEXT[statusPrompt].label}
          errorFallback={`Couldn't ${statusPrompt} the request.`}
          onConfirm={runStatusPrompt}
          onCancel={() => setStatusPrompt(null)}
        />
      )}
    </div>
  )
}
