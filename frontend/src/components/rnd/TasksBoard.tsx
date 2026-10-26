'use client'

// Task board shared by R&D requirement tasks and R&D project tasks — the two
// backends return the same RndTask shape; each caller passes a TaskApi.
//  * Manager (R&D head / project lead): creates tasks (task, assignee,
//    priority, start / due date, status, task details, checklist, files),
//    decides approval requests, can cancel a task or
//    reopen a completed one. The creator of a task can also edit it.
//  * Assignee: works on it, posts updates (remarks + any files) and completes
//    it themselves (remarks + files). While working they can "ask for
//    approval" on something task-related (a drawing, material, deviation) —
//    the person who gave the task approves or rejects it and the task stays
//    open. Once the due date has passed, they must give a reason and a new
//    completion date — which becomes the new due date — or a delay reason
//    when completing. They can also split their task into sub-tasks, which
//    they then review like a manager.
//  * Requirement tasks are shared across departments (R&D + the departments
//    the requirement is shared with): anyone who can open it creates tasks
//    (`canCreate`), each task carries its department, and `departmentFilter`
//    adds the All · My department · per-department chips.

import Select from '@/components/shared/Select'
import { useEffect, useState } from 'react'
import { ArrowCounterClockwise, Calendar, ChatCenteredText, Check, Clock, PencilSimple, Plus, ShieldCheck, X } from '@phosphor-icons/react'
import { RndPerson, RndTask, RndTaskApproval, RndTaskCreateInput, RndTaskEditInput, RndTaskPriority, RndTaskWorkStatus, RndWorkDepartment, RndWorkDocument } from '@/types'
import { TEXT, BORDER } from '@/lib/theme'
import { formatDate, formatDateTime } from '@/lib/format'
import SearchableSelect from '@/components/erp/SearchableSelect'
import DateField from '@/components/erp/DateField'
import { dangerBtnStyle, smallSecondaryBtnStyle, btnBase, smallBtnSize, chipBtnStyle, RowCount, inputStyle as sharedInputStyle, pillStyle } from '@/components/shared/ui'
import { FormSheet, SheetColumns, SheetSection, SheetIcon, SheetIconName, FileDropZone, Optional, Req, SHEET, sheetBtn, sheetInput, sheetLabel, sheetHint, SheetError } from '@/components/shared/FormSheet'
import { extractErrorMessages } from '@/lib/validation'
import { useAuthStore } from '@/store/authStore'

export type TaskInput = RndTaskCreateInput

export interface TaskApi {
  list: () => Promise<RndTask[]>
  /** Who a top-level task can be assigned to (loaded only for managers). */
  people: () => Promise<RndPerson[]>
  /** Who a sub-task can be assigned to — omit to turn sub-tasks off. */
  team?: () => Promise<RndPerson[]>
  create: (p: TaskInput, parentTaskId?: number) => Promise<RndTask>
  /** Omit to turn editing off. */
  edit?: (taskId: number, p: RndTaskEditInput) => Promise<RndTask>
  /** Tick / untick a checklist step or change the work status of an open task. */
  progress: (taskId: number, p: { work_status?: RndTaskWorkStatus; item_id?: string; done?: boolean }) => Promise<RndTask>
  extend: (taskId: number, reason: string, newDueDate: string) => Promise<RndTask>
  /** Assignee completes the task themselves. */
  complete: (taskId: number, p: { remarks: string; delay_reason?: string; files: File[] }) => Promise<RndTask>
  /** Assignee's progress note (remarks + files) — the task stays open. */
  update: (taskId: number, p: { remarks: string; files: File[] }) => Promise<RndTask>
  /** Assignee asks the task's reviewer to approve something — the task stays open. */
  requestApproval: (taskId: number, p: { request: string; files: File[] }) => Promise<RndTask>
  decideApproval: (approvalId: number, decision: 'approve' | 'reject', remarks?: string) => Promise<RndTask>
  withdrawApproval: (approvalId: number) => Promise<RndTask>
  reopen: (taskId: number, remarks: string, newDueDate?: string) => Promise<RndTask>
  cancel: (taskId: number, remarks: string) => Promise<RndTask>
  openDoc: (d: RndWorkDocument) => Promise<void>
}

export interface TaskLabels {
  /** "head" on requirements, "lead" on projects — used in hint text. */
  manager: string
  dueDate: string
  assignPlaceholder: string
  emptyManager: string
  emptyOther: string
}

const STATUS_LABELS: Record<string, string> = { open: 'Open', submitted: 'Completed', closed: 'Completed', cancelled: 'Cancelled' }
const PRIORITY_LABELS: Record<RndTaskPriority, string> = { low: 'Low', medium: 'Medium', high: 'High', urgent: 'Urgent' }
const PRIORITY_HEX: Record<RndTaskPriority, string> = { low: '#64748b', medium: '#2563EB', high: '#EA580C', urgent: '#DC2626' }
// How the open work stands — set by the assignee; the workflow status above stays separate.
const WORK_LABELS: Record<RndTaskWorkStatus, string> = { not_started: 'Not started', in_progress: 'In progress', on_hold: 'On hold' }
const WORK_HEX: Record<RndTaskWorkStatus, string> = { not_started: '#78716c', in_progress: '#7C3AED', on_hold: '#D97706' }
// Activity feed: what each event reads as, and its colour.
const EVENT_META: Record<string, { verb: string; hex: string; bubble: string }> = {
  created: { verb: 'assigned this task', hex: '#2563EB', bubble: 'Brief' },
  update: { verb: 'posted an update', hex: '#7C3AED', bubble: 'Update' },
  completed: { verb: 'completed the task', hex: '#16A34A', bubble: 'Completion note' },
  extended: { verb: 'moved the due date', hex: '#D97706', bubble: 'Reason' },
  reopened: { verb: 'reopened the task', hex: '#B45309', bubble: 'What still needs to be done' },
  cancelled: { verb: 'cancelled the task', hex: '#78716c', bubble: 'Reason' },
  edited: { verb: 'edited the task', hex: '#78716c', bubble: 'Changes' },
  approval_requested: { verb: 'asked for approval', hex: '#D97706', bubble: 'Request' },
  approved: { verb: 'approved the request', hex: '#16A34A', bubble: 'Remarks' },
  rejected: { verb: 'rejected the request', hex: '#DC2626', bubble: 'Reason' },
  approval_withdrawn: { verb: 'withdrew the approval request', hex: '#78716c', bubble: '' },
  progress: { verb: 'updated progress', hex: '#7C3AED', bubble: '' },
  // older entries
  submitted: { verb: 'marked it done', hex: '#16A34A', bubble: 'Completion note' },
  closed: { verb: 'closed the task', hex: '#16A34A', bubble: 'Remarks' },
}

type IconName = 'check' | 'note' | 'shield' | 'clock' | 'plus' | 'pencil' | 'undo' | 'x' | 'calendar'

function Icon({ name, size = 14 }: { name: IconName; size?: number }) {
  const c = { size }
  switch (name) {
    case 'check': return <Check {...c} />
    case 'note': return <ChatCenteredText {...c} />
    case 'shield': return <ShieldCheck {...c} />
    case 'clock': return <Clock {...c} />
    case 'plus': return <Plus {...c} />
    case 'pencil': return <PencilSimple {...c} />
    case 'undo': return <ArrowCounterClockwise {...c} />
    case 'x': return <X {...c} />
    case 'calendar': return <Calendar {...c} />
  }
}

/** Task action button. primary = the main next step; active = its form is open below. */
function ActionBtn({ icon, label, onClick, variant = 'ghost', active = false, disabled = false, title, tour }: {
  icon: IconName; label: string; onClick: () => void; variant?: 'primary' | 'ghost' | 'warn' | 'danger'
  active?: boolean; disabled?: boolean; title?: string; tour?: string
}) {
  const tone = { primary: '#16A34A', ghost: '#57534e', warn: '#DC2626', danger: '#DC2626' }[variant]
  const style: React.CSSProperties = variant === 'primary'
    ? { background: active ? '#15803d' : '#16A34A', color: '#fff', border: '1px solid #16A34A', boxShadow: '0 4px 12px rgba(22,163,74,0.25)' }
    : variant === 'danger'
      ? { background: active ? 'rgba(220,38,38,0.08)' : 'transparent', color: tone, border: '1px solid transparent' }
      : { background: active ? 'rgba(255,122,69,0.1)' : 'rgba(255,255,255,0.8)', color: active ? '#c2410c' : tone, border: `1px solid ${active ? 'rgba(255,122,69,0.45)' : variant === 'warn' ? 'rgba(220,38,38,0.35)' : BORDER.normal}` }
  return (
    <button type="button" data-tour={tour} onClick={onClick} disabled={disabled} title={title}
      style={{ ...btnBase, ...smallBtnSize, gap: 6,
        cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.45 : 1, whiteSpace: 'nowrap', transition: 'background 120ms ease', ...style }}>
      <Icon name={icon} />{label}
    </button>
  )
}

const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase()).join('') || '?'

/** "Today, 15:49" / "Yesterday, 15:49" / "08 Oct 2026, 15:49". */
function whenLabel(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const time = d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false })
  const day = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  if (day === today) return `Today, ${time}`
  if (day === today - 86400000) return `Yesterday, ${time}`
  return `${d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}, ${time}`
}

/** Task activity as a timeline, newest first: who did what, when, and what they wrote. */
function ActivityFeed({ events, userName }: { events: RndTask['events']; userName?: string }) {
  const items = [...events].reverse()
  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      {items.map((e, i) => {
        const meta = EVENT_META[e.action] || { verb: e.action, hex: '#78716c', bubble: '' }
        const last = i === items.length - 1
        const self = !!userName && e.by === userName
        return (
          <div key={i} style={{ display: 'flex', gap: 12 }}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flex: 'none', width: 30 }}>
              {/* ui-audit-ignore-next-line custom-pill — round avatar initials, not a pill */}
              <span title={e.by} style={{ width: 30, height: 30, borderRadius: 9999, background: `${meta.hex}1a`, color: meta.hex, border: `1.5px solid ${meta.hex}55`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700 }}>
                {initials(e.by)}
              </span>
              {!last && <span style={{ flex: 1, width: 2, background: BORDER.light, margin: '4px 0' }} />}
            </div>
            <div style={{ flex: 1, minWidth: 0, paddingBottom: last ? 0 : 14 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', alignItems: 'baseline', paddingTop: 5 }}>
                <span style={{ fontSize: 13, color: TEXT.body }}>
                  <strong style={{ color: TEXT.heading }}>{e.by}</strong>{self && <span style={{ color: TEXT.muted, fontWeight: 500 }}> (you)</span>} <span style={{ color: meta.hex, fontWeight: 600 }}>{meta.verb}</span>
                </span>
                <span title={e.at ? formatDateTime(e.at) : undefined} style={{ fontSize: 11.5, color: TEXT.muted, whiteSpace: 'nowrap' }}>{whenLabel(e.at)}</span>
              </div>
              {(e.old_due_date || e.new_due_date) && (
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
                  {e.old_due_date && e.new_due_date ? (
                    <span style={{ ...pillStyle('#b45309'), fontSize: 11.5, fontWeight: 600, padding: '3px 10px' }}>
                      Due <span style={{ textDecoration: 'line-through', opacity: 0.7 }}>{formatDate(e.old_due_date)}</span> → {formatDate(e.new_due_date)}
                    </span>
                  ) : e.new_due_date && (
                    <span style={{ ...pillStyle('#1d4ed8'), fontSize: 11.5, fontWeight: 600, padding: '3px 10px' }}>Due {formatDate(e.new_due_date)}</span>
                  )}
                </div>
              )}
              {e.remarks && (
                <div style={{ marginTop: 6, padding: '8px 12px', borderRadius: '4px 12px 12px 12px', background: 'rgba(255,255,255,0.75)', border: `1px solid ${BORDER.light}`, borderLeft: `3px solid ${meta.hex}` }}>
                  {meta.bubble && <p style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 2px' }}>{meta.bubble}</p>}
                  <p style={{ fontSize: 13, color: TEXT.body, margin: 0, whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>{e.remarks}</p>
                </div>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}
const APPROVAL_LABELS: Record<string, string> = { pending: 'Waiting for decision', approved: 'Approved', rejected: 'Rejected', withdrawn: 'Withdrawn' }
const APPROVAL_HEX: Record<string, string> = { pending: '#D97706', approved: '#16A34A', rejected: '#DC2626', withdrawn: '#78716c' }

// Shared 34px control scale; list filters keep their own width.
const inputStyle: React.CSSProperties = { ...sharedInputStyle, background: 'rgba(255,255,255,.7)' }
const smallLabel: React.CSSProperties = { fontSize: 11, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 4px' }
const smallBtn: React.CSSProperties = smallSecondaryBtnStyle

const todayIso = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function DocChips({ docs, onOpen }: { docs: RndWorkDocument[]; onOpen: (d: RndWorkDocument) => void }) {
  return (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
      {docs.map((d) => (
        <button key={d.id} type="button" onClick={() => onOpen(d)} title={d.uploaded_by ? `Uploaded by ${d.uploaded_by}` : 'Open document'}
          style={chipBtnStyle(false)}>
          📄 {d.name}
        </button>
      ))}
    </div>
  )
}

/** Approval requests on a task: the reviewer approves / rejects pending ones, the requester can withdraw. */
function ApprovalList({ approvals, canDecide, userId, api, onChanged, onOpen }: {
  approvals: RndTaskApproval[]
  canDecide: boolean
  userId: number
  api: TaskApi
  onChanged: (t: RndTask) => void
  onOpen: (d: RndWorkDocument) => void
}) {
  const [remarks, setRemarks] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | string[]>('')

  const act = async (fn: () => Promise<RndTask>, fallback: string) => {
    setBusy(true)
    setError('')
    try {
      onChanged(await fn())
      setRemarks('')
    } catch (err) {
      setError(extractErrorMessages(err, fallback))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div data-tour="rnd-task-approvals" style={{ marginTop: 12 }}>
      <p style={smallLabel}>Approval requests</p>
      <SheetError error={error} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {approvals.map((a) => {
          const hex = APPROVAL_HEX[a.status]
          const pending = a.status === 'pending'
          return (
            <div key={a.id} style={{ padding: '10px 12px', borderRadius: 10, border: `1px solid ${pending ? 'rgba(217,119,6,0.35)' : BORDER.light}`, background: pending ? 'rgba(217,119,6,0.05)' : 'rgba(255,255,255,0.5)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 12, color: TEXT.muted }}>{a.requested_by}{a.requested_by_id === userId ? ' (you)' : ''} · {formatDateTime(a.requested_at)}</span>
                <span style={pillStyle(hex)}>{APPROVAL_LABELS[a.status] || a.status}</span>
              </div>
              <p style={{ fontSize: 13, color: TEXT.body, margin: '6px 0 0', whiteSpace: 'pre-wrap' }}>{a.request}</p>
              {a.documents.length > 0 && <div style={{ marginTop: 6 }}><DocChips docs={a.documents} onOpen={onOpen} /></div>}
              {(a.status === 'approved' || a.status === 'rejected') && (
                <p style={{ fontSize: 12.5, color: TEXT.muted, margin: '6px 0 0' }}>
                  {a.status === 'approved' ? 'Approved' : 'Rejected'} by {a.decided_by} · {formatDateTime(a.decided_at)}{a.decision_remarks ? ` — ${a.decision_remarks}` : ''}
                </p>
              )}
              {pending && canDecide && (
                <div style={{ marginTop: 8 }}>
                  <textarea style={{ ...inputStyle, minHeight: 44, marginBottom: 8 }} value={remarks} onChange={(e) => setRemarks(e.target.value)} placeholder="Remarks (required to reject)" />
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <button type="button" disabled={busy} onClick={() => act(() => api.decideApproval(a.id, 'approve', remarks.trim() || undefined), 'Could not approve.')} style={{ ...smallBtn, color: '#16A34A', border: '1px solid rgba(22,163,74,0.4)' }}>Approve</button>
                    <button type="button" disabled={busy} onClick={() => { if (!remarks.trim()) { setError('Enter why you reject it — the assignee needs to know what to change.'); return } act(() => api.decideApproval(a.id, 'reject', remarks.trim()), 'Could not reject.') }} style={{ ...dangerBtnStyle, padding: '6px 12px', fontSize: 12 }}>Reject</button>
                  </div>
                </div>
              )}
              {pending && !canDecide && a.requested_by_id === userId && (
                <button type="button" disabled={busy} onClick={() => act(() => api.withdrawApproval(a.id), 'Could not withdraw the request.')} style={{ ...smallBtn, marginTop: 8 }}>Withdraw request</button>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

type DraftStep = { id?: string; text: string; done?: boolean }

/** Checklist editor in the task form: steps in order, add with Enter, remove with ×. */
function ChecklistEditor({ steps, onChange }: { steps: DraftStep[]; onChange: (s: DraftStep[]) => void }) {
  const [draft, setDraft] = useState('')
  const add = () => {
    const text = draft.trim()
    if (!text) return
    onChange([...steps, { text }])
    setDraft('')
  }
  return (
    <div>
      {steps.map((st, i) => (
        <div key={st.id || `new-${i}`} style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
          <span title={st.done ? 'Already ticked' : undefined} style={{ width: 16, height: 16, borderRadius: 4, flexShrink: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            border: `1.5px solid ${st.done ? '#16A34A' : SHEET.LINE}`, background: st.done ? '#16A34A' : 'transparent' }}>
            {st.done && <SheetIcon name="check" size={11} color="#fff" />}
          </span>
          <input style={{ ...sheetInput, padding: '8px 10px' }} value={st.text} maxLength={300} placeholder={`Checklist item ${i + 1}…`}
            onChange={(e) => onChange(steps.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)))} />
          <button type="button" aria-label="Remove step" onClick={() => onChange(steps.filter((_, j) => j !== i))} style={sheetBtn('ghost', SHEET.MUTED)}><SheetIcon name="x" size={14} /></button>
        </div>
      ))}
      <div style={{ display: 'flex', gap: 8 }}>
        <input style={{ ...sheetInput, padding: '8px 10px' }} value={draft} maxLength={300} onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add() } }}
          placeholder="Add a step, e.g. GA drawing issued — press Enter" />
        <button type="button" onClick={add} disabled={!draft.trim()} style={sheetBtn('secondary', SHEET.BLUE, !draft.trim())}><SheetIcon name="plus" size={14} /> Add</button>
      </div>
    </div>
  )
}

// A requirement's assignee list has one row per person and department, so the
// picker value carries both ("design:12"); project pickers use the bare id.
const personKey = (p: { id: number; department?: string }) => (p.department ? `${p.department}:${p.id}` : String(p.id))
const parsePersonKey = (key: string): { id: number; department?: RndWorkDepartment } => {
  const [a, b] = key.split(':')
  return b === undefined ? { id: Number(a) } : { id: Number(b), department: a as RndWorkDepartment }
}
const DEPT_HEX: Record<string, string> = { rnd: '#16A34A', design: '#7C3AED', electrical: '#D97706', hydraulic: '#0891B2' }

/** One popup form for a new task, a new sub-task and editing a task (no files when editing) — same layout as PM's Create Task. */
function TaskForm({
  mode, people, labels, onSubmit, onCancel, initial, maxDue, parentTitle,
}: {
  mode: 'create' | 'subtask' | 'edit'
  people: RndPerson[]
  labels: TaskLabels
  onSubmit: (p: TaskInput) => Promise<void>
  onCancel: () => void
  initial?: Pick<RndTask, 'title' | 'assigned_to_id' | 'due_date' | 'remarks' | 'priority' | 'start_date' | 'work_status' | 'checklist' | 'department' | 'parent_task_id'>
  maxDue?: string
  /** Sub-task: the main task it belongs to. */
  parentTitle?: string
}) {
  const [title, setTitle] = useState(initial?.title || '')
  const [assignee, setAssignee] = useState(initial ? personKey({ id: initial.assigned_to_id, department: people.some((p) => p.department) ? initial.department : undefined }) : '')
  const [due, setDue] = useState(initial?.due_date || '')
  const [remarks, setRemarks] = useState(initial?.remarks || '')
  const [priority, setPriority] = useState<RndTaskPriority>(initial?.priority || 'medium')
  const [start, setStart] = useState(initial?.start_date || '')
  const [workStatus, setWorkStatus] = useState<RndTaskWorkStatus>(initial?.work_status || 'not_started')
  const [steps, setSteps] = useState<DraftStep[]>(() => (initial?.checklist || []).map((c) => ({ id: c.id, text: c.text, done: c.done })))
  const [files, setFiles] = useState<File[]>([])
  const [error, setError] = useState<string | string[]>('')
  const [saving, setSaving] = useState(false)

  const submit = async () => {
    if (!title.trim()) { setError('Give the task a title — what should be done.'); return }
    if (!assignee) { setError('Pick who should do this task.'); return }
    if (!due) { setError(`Set the ${labels.dueDate}.`); return }
    if (due < todayIso() && due !== initial?.due_date) { setError(`${labels.dueDate} is in the past — pick today or a later date.`); return }
    if (maxDue && due > maxDue) { setError(`A sub-task can't be due after its main task (${formatDate(maxDue)}).`); return }
    if (start && start > due) { setError(`Start date ${formatDate(start)} is after the ${labels.dueDate} ${formatDate(due)} — the task must start on or before it is due.`); return }
    const checklist = steps.map((st) => ({ ...st, text: st.text.trim() })).filter((st) => st.text)
    setSaving(true)
    setError('')
    try {
      const who = parsePersonKey(assignee)
      await onSubmit({
        title: title.trim(), assigned_to_id: who.id, department: who.department, due_date: due, remarks: remarks.trim() || undefined,
        priority, start_date: start || undefined, work_status: workStatus, checklist, files,
      })
    } catch (err) {
      setError(extractErrorMessages(err, `Could not save the task.`))
    } finally {
      setSaving(false)
    }
  }

  const isSub = mode === 'subtask' || !!initial?.parent_task_id
  const noun = isSub ? 'Sub-task' : 'Task'
  const sheetTitle = mode === 'edit' ? `Edit ${noun}` : mode === 'subtask' ? 'Add Sub-task' : 'Create Task'
  const submitLabel = mode === 'edit' ? 'Save' : mode === 'subtask' ? 'Add Sub-task' : 'Create Task'
  const subtitle = parentTitle ? `Part of task '${parentTitle}'.` : mode === 'edit' ? 'Change the task — the assignee sees the change in its activity.' : 'Give work to a person and set when it is due.'

  return (
    <FormSheet tour="rnd-task-form" icon={mode === 'edit' ? 'edit' : 'check'} title={sheetTitle} subtitle={subtitle} onClose={onCancel} busy={saving}
      footer={<>
        <button type="button" onClick={onCancel} disabled={saving} style={sheetBtn('secondary', SHEET.INK, saving)}>Cancel</button>
        <button type="button" onClick={submit} disabled={saving} style={sheetBtn('primary', SHEET.BLUE, saving)}><SheetIcon name={mode === 'edit' ? 'check' : 'plus'} size={16} />{saving ? 'Saving…' : submitLabel}</button>
      </>}>
      <SheetColumns
        left={<>
          <SheetError error={error} />
          <SheetSection icon="list" title="Basic Information">
            <label style={sheetLabel}>{noun} Name <Req /></label>
            <input style={sheetInput} value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} placeholder="Enter task name (e.g. Feasibility + GA drawing for 600 mm platform)" autoFocus />
            <label style={{ ...sheetLabel, marginTop: 14 }}>Description</label>
            <textarea style={{ ...sheetInput, minHeight: 72, resize: 'vertical' }} value={remarks} onChange={(e) => setRemarks(e.target.value)} placeholder="What exactly you need back, references, constraints…" />
            {parentTitle && <p style={{ fontSize: 12.5, color: SHEET.MUTED, margin: '8px 0 0' }}>Parent task: <b style={{ color: SHEET.INK }}>{parentTitle}</b></p>}
          </SheetSection>
          <SheetSection icon="user" title="Assignment">
            <label style={sheetLabel}>Assignee <Req /></label>
            <SearchableSelect value={assignee} onChange={setAssignee} placeholder={labels.assignPlaceholder}
              options={people.map((p) => ({ value: personKey(p), label: `${p.department_label ? `${p.department_label} · ` : ''}${p.name}${p.designation ? ` — ${p.designation}` : ''}` }))} />
            <p style={sheetHint}>The assignee is notified, posts updates and completes it; you review it and decide their approval requests.</p>
          </SheetSection>
          <SheetSection icon="calendar" title="Schedule & Status">
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              <div style={{ flex: '1 1 150px' }}><label style={sheetLabel}>Start Date</label><DateField value={start} onChange={setStart} /></div>
              <div style={{ flex: '1 1 150px' }}><label style={sheetLabel}>{labels.dueDate} <Req /></label><DateField value={due} onChange={setDue} /></div>
            </div>
            {maxDue && <p style={sheetHint}>Must be due by {formatDate(maxDue)} — the main task&apos;s date.</p>}
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 12 }}>
              <div style={{ flex: '1 1 130px' }}>
                <label style={sheetLabel}>Priority</label>
                <Select style={sheetInput} value={priority} onChange={(e) => setPriority(e.target.value as RndTaskPriority)}>
                  {(Object.keys(PRIORITY_LABELS) as RndTaskPriority[]).map((k) => <option key={k} value={k}>{PRIORITY_LABELS[k]}</option>)}
                </Select>
              </div>
              <div style={{ flex: '1 1 140px' }}>
                <label style={sheetLabel}>Status</label>
                <Select style={sheetInput} value={workStatus} onChange={(e) => setWorkStatus(e.target.value as RndTaskWorkStatus)}>
                  {(Object.keys(WORK_LABELS) as RndTaskWorkStatus[]).map((k) => <option key={k} value={k}>{WORK_LABELS[k]}</option>)}
                </Select>
              </div>
            </div>
          </SheetSection>
        </>}
        right={<>
          <SheetSection icon="list" title="Checklist" extra={<Optional />}>
            <ChecklistEditor steps={steps} onChange={setSteps} />
            <p style={{ fontSize: 11.5, color: SHEET.MUTED, margin: '6px 0 0' }}>Steps the assignee ticks off — all must be ticked to complete the task.</p>
          </SheetSection>
          {mode !== 'edit' && (
            <SheetSection icon="clip" title="Attachments" extra={<Optional />}>
              <FileDropZone files={files} onChange={setFiles} />
            </SheetSection>
          )}
        </>}
      />
    </FormSheet>
  )
}

/* ── Task table + task view — same layout as PM's milestone tasks ─────── */

type Panel = '' | 'extend' | 'complete' | 'update' | 'approval' | 'reopen' | 'cancel' | 'edit' | 'subtask'
type Tab = 'overview' | 'subtasks' | 'files' | 'approvals' | 'activity'

const { INK, BODY, MUTED, LINE, SOFT, BLUE } = SHEET
const card: React.CSSProperties = { background: '#fff', border: `1px solid ${LINE}`, borderRadius: 14, boxShadow: '0 1px 3px rgba(15,23,42,0.05)' }
const th: React.CSSProperties = { textAlign: 'left', padding: '10px 12px', fontSize: 11.5, fontWeight: 600, color: MUTED, borderBottom: `1px solid ${LINE}`, background: SOFT, whiteSpace: 'nowrap' }
const td: React.CSSProperties = { padding: '11px 12px', fontSize: 13, color: BODY, borderBottom: `1px solid ${LINE}`, verticalAlign: 'middle' }

/** A flat underline tab — every border side set explicitly so the app-wide button element style doesn't show through. */
function tabStyle(active: boolean): React.CSSProperties {
  return {
    display: 'inline-flex', alignItems: 'center', gap: 6, padding: '10px 12px', marginBottom: -1,
    borderTop: '0', borderLeft: '0', borderRight: '0', borderBottom: `2px solid ${active ? BLUE : 'transparent'}`,
    borderRadius: 0, background: 'transparent', backgroundColor: 'transparent', boxShadow: 'none', transform: 'none', outline: 'none',
    cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap', fontSize: 13, fontWeight: active ? 700 : 600, color: active ? BLUE : MUTED,
  }
}

/** Where a task stands, as one chip: cancelled / completed / overdue / approval pending / the assignee's work status. */
function taskState(t: RndTask): { text: string; c: string; bg: string } {
  if (t.status === 'cancelled') return { text: 'Cancelled', c: '#57534e', bg: '#f5f5f4' }
  if (t.status !== 'open') return { text: 'Completed', c: '#15803d', bg: '#dcfce7' }
  if (t.is_overdue) return { text: 'Overdue', c: '#be123c', bg: '#ffe4e6' }
  if (t.pending_approval) return { text: 'Approval pending', c: '#b45309', bg: '#fef3c7' }
  const w = t.work_status || 'not_started'
  return { text: WORK_LABELS[w], c: WORK_HEX[w], bg: `${WORK_HEX[w]}1a` }
}
const isDoneTask = (t: RndTask) => t.status === 'closed' || t.status === 'submitted'
const taskPercent = (t: RndTask) => (isDoneTask(t) ? 100 : t.checklist?.length ? Math.round((t.checklist_done * 100) / t.checklist.length) : 0)
const docCount = (t: RndTask) => t.brief_documents.length + t.work_documents.length + (t.approvals || []).reduce((n, a) => n + a.documents.length, 0)

function Chip({ text, c, bg }: { text: string; c: string; bg: string }) {
  return <span style={{ ...pillStyle(c), fontSize: 11.5, padding: '3px 9px', background: bg }}>{text}</span>
}
function Bar({ value, color = BLUE }: { value: number; color?: string }) {
  // ui-audit-ignore-next-line custom-pill — progress bar track, not a pill
  return <span style={{ flex: 1, minWidth: 40, height: 8, borderRadius: 999, background: '#eef2f7', overflow: 'hidden', display: 'block' }}><span style={{ display: 'block', height: '100%', width: `${Math.max(0, Math.min(100, value))}%`, background: color, borderRadius: 999 }} /></span>
}
const AV_COLORS = ['#2563eb', '#16a34a', '#db2777', '#7c3aed', '#ea580c', '#0891b2']
function Avatar({ name, size = 26 }: { name?: string | null; size?: number }) {
  const n = name || '?'
  const c = AV_COLORS[[...n].reduce((a, ch) => a + ch.charCodeAt(0), 0) % AV_COLORS.length]
  return <span title={n} style={{ width: size, height: size, borderRadius: '50%', background: c, color: '#fff', fontSize: size * 0.4, fontWeight: 700, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{initials(n)}</span>
}
function Box({ icon, title, color, extra, children }: { icon: SheetIconName; title: string; color: string; extra?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div style={{ border: `1px solid ${LINE}`, borderRadius: 12, padding: '12px 14px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}><SheetIcon name={icon} size={16} color={color} /><span style={{ fontSize: 14, fontWeight: 700, color: INK }}>{title}</span>{extra}</div>
      {children}
    </div>
  )
}
function InfoRows({ rows }: { rows: [string, React.ReactNode][] }) {
  return (
    <>
      {rows.map(([k, v]) => (
        <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 0', fontSize: 13, color: BODY }}>
          <span style={{ width: 96, color: MUTED, flexShrink: 0 }}>{k}</span><span style={{ minWidth: 0, wordBreak: 'break-word' }}>{v}</span>
        </div>
      ))}
    </>
  )
}

/** What each action popup is called and does. */
const PANEL_META: Record<'extend' | 'complete' | 'update' | 'approval' | 'reopen' | 'cancel', { title: string; icon: SheetIconName; color: string; submit: string; busy: string }> = {
  complete: { title: 'Complete Task', icon: 'check', color: '#16A34A', submit: 'Complete task', busy: 'Completing…' },
  update: { title: 'Add Update', icon: 'chat', color: '#7C3AED', submit: 'Post update', busy: 'Posting…' },
  approval: { title: 'Ask for Approval', icon: 'shield', color: '#D97706', submit: 'Send for approval', busy: 'Sending…' },
  extend: { title: 'Need More Time', icon: 'clock', color: '#D97706', submit: 'Save new date', busy: 'Saving…' },
  reopen: { title: 'Reopen Task', icon: 'undo', color: '#B45309', submit: 'Reopen task', busy: 'Reopening…' },
  cancel: { title: 'Cancel Task', icon: 'x', color: '#DC2626', submit: 'Cancel task', busy: 'Cancelling…' },
}

/** Role-level task rights (the module's Tasks feature: create / edit / approve / cancel)
 *  on top of the record rules (assignee, creator, head). Missing = allowed. */
export interface TaskRights { create?: boolean; edit?: boolean; approve?: boolean; cancel?: boolean }
const ALL_RIGHTS: Required<TaskRights> = { create: true, edit: true, approve: true, cancel: true }

/** One task opened: header with its actions, then Overview · Sub-tasks · Files · Approvals · Activity tabs. */
function TaskView({
  task, all, userId, canManage, rights = ALL_RIGHTS, api, labels, people, team, startPanel, onChanged, onCreated, onOpen, onClose, prevId, nextId,
}: {
  task: RndTask
  all: RndTask[]
  userId: number
  canManage: boolean
  rights?: Required<TaskRights>
  api: TaskApi
  labels: TaskLabels
  people: RndPerson[]
  team: RndPerson[]
  startPanel?: Panel
  onChanged: (t: RndTask) => void
  onCreated: () => void
  onOpen: (id: number) => void
  onClose: () => void
  prevId?: number
  nextId?: number
}) {
  const user = useAuthStore((st) => st.user)
  const userName = user?.name || user?.email || undefined
  const mine = task.assigned_to_id === userId
  const isSub = !!task.parent_task_id
  const parent = isSub ? all.find((t) => t.id === task.parent_task_id) : undefined
  const subtasks = all.filter((t) => t.parent_task_id === task.id)
  // The creator reviews their task (a sub-task's creator is the main task's assignee); managers review every task.
  const canReview = canManage || task.created_by_id === userId
  // Ticking steps / changing the work status: the assignee or whoever reviews the task (with the role's edit right).
  const canProgress = mine || (canReview && rights.edit)
  const isOpen = task.status === 'open'
  const isDone = isDoneTask(task)
  const canEdit = !!api.edit && canReview && rights.edit && isOpen
  const canSplit = !!api.team && mine && !isSub && isOpen && rights.create
  const approvals = task.approvals || []
  const checklist = task.checklist || []
  const unticked = checklist.filter((c) => !c.done)
  const openSubs = subtasks.filter((s) => s.status === 'open')
  const priority: RndTaskPriority = task.priority || 'medium'
  const workStatus: RndTaskWorkStatus = task.work_status || 'not_started'
  const state = taskState(task)
  const dueMissed = task.due_date < todayIso()

  const [tab, setTab] = useState<Tab>('overview')
  const [panel, setPanel] = useState<Panel>(startPanel || '')
  const [text, setText] = useState('')
  const [delayReason, setDelayReason] = useState('')
  const [date, setDate] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const [error, setError] = useState<string | string[]>('')
  const [viewError, setViewError] = useState<string | string[]>('')
  const [busy, setBusy] = useState(false)

  const openDoc = async (d: RndWorkDocument) => {
    try { await api.openDoc(d) } catch (err) { setViewError(extractErrorMessages(err, `Could not open "${d.name}".`)) }
  }
  const choose = (p: Panel) => { setPanel(p); setText(''); setDelayReason(''); setDate(''); setFiles([]); setError('') }

  const run = async (fn: () => Promise<RndTask>, fallback: string) => {
    setBusy(true)
    setError('')
    try {
      const t = await fn()
      setPanel('')
      onChanged(t)
    } catch (err) {
      setError(extractErrorMessages(err, fallback))
    } finally {
      setBusy(false)
    }
  }
  // Checklist ticks / status change — straight on the task, no popup.
  const progress = async (body: { work_status?: RndTaskWorkStatus; item_id?: string; done?: boolean }, fallback: string) => {
    setBusy(true)
    setViewError('')
    try { onChanged(await api.progress(task.id, body)) } catch (err) { setViewError(extractErrorMessages(err, fallback)) } finally { setBusy(false) }
  }

  const doExtend = () => {
    if (!text.trim()) { setError('Enter the reason the task isn’t complete by its due date.'); return }
    if (!date) { setError('Pick the new completion date.'); return }
    if (date <= task.due_date) { setError(`The new completion date must be after the current due date (${formatDate(task.due_date)}).`); return }
    run(() => api.extend(task.id, text.trim(), date), 'Could not save the new completion date.')
  }
  const doComplete = () => {
    if (openSubs.length) { setError(`${openSubs.length} sub-task(s) are still open — they must be completed or cancelled first.`); return }
    if (task.pending_approval) { setError('Your approval request is still waiting for a decision — wait for it or withdraw it first.'); return }
    if (unticked.length) { setError(`${unticked.length} checklist step(s) are not ticked yet: ${unticked.slice(0, 3).map((c) => `“${c.text}”`).join(', ')}. Tick them off on the Overview tab before completing.`); return }
    if (!text.trim()) { setError('Describe what you did before completing the task.'); return }
    if (task.is_overdue && !delayReason.trim()) { setError('This task is past its due date — enter the reason for the delay.'); return }
    run(() => api.complete(task.id, { remarks: text.trim(), delay_reason: delayReason.trim() || undefined, files }), 'Could not complete the task.')
  }
  const doApproval = () => {
    if (!text.trim()) { setError('Write what you need approved — e.g. the drawing, material or deviation and why.'); return }
    run(() => api.requestApproval(task.id, { request: text.trim(), files }), 'Could not send the approval request.')
  }
  const doUpdate = () => {
    if (!text.trim()) { setError('Write the update — what you did or found so far.'); return }
    run(() => api.update(task.id, { remarks: text.trim(), files }), 'Could not post the update.')
  }
  const doReopen = () => {
    if (!text.trim()) { setError('Enter what still needs to be done.'); return }
    if (dueMissed && !date) { setError('The due date has passed — set a new due date.'); return }
    run(() => api.reopen(task.id, text.trim(), date || undefined), 'Could not reopen the task.')
  }
  const doCancel = () => {
    if (!text.trim()) { setError('Enter why the task is cancelled.'); return }
    run(() => api.cancel(task.id, text.trim()), 'Could not cancel the task.')
  }
  const submitPanel = { extend: doExtend, complete: doComplete, update: doUpdate, approval: doApproval, reopen: doReopen, cancel: doCancel }

  const tabs: { k: Tab; t: string; n?: string; icon: SheetIconName }[] = [
    { k: 'overview', t: 'Overview', icon: 'list' },
    ...(!isSub && (subtasks.length > 0 || canSplit) ? [{ k: 'subtasks' as Tab, t: 'Sub-tasks', n: `${subtasks.filter(isDoneTask).length}/${subtasks.length}`, icon: 'check' as SheetIconName }] : []),
    { k: 'files', t: 'Files', n: String(docCount(task)), icon: 'clip' },
    { k: 'approvals', t: 'Approvals', n: String(approvals.length), icon: 'shield' },
    { k: 'activity', t: 'Activity', n: String(task.events.length), icon: 'history' },
  ]
  const fileGroups: [string, RndWorkDocument[]][] = [
    ['Attached when the task was given', task.brief_documents],
    ['Work & updates from the assignee', task.work_documents],
    ['With approval requests', approvals.flatMap((a) => a.documents)],
  ]
  const meta = panel && panel !== 'edit' && panel !== 'subtask' ? PANEL_META[panel] : null

  return (
    <div style={{ ...card, flex: '3 1 560px', minWidth: 0 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: '16px 18px 10px', flexWrap: 'wrap' }}>
        <span style={{ width: 34, height: 34, borderRadius: '50%', background: isDone ? '#16a34a' : '#e2e8f0', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><SheetIcon name="check" size={18} color={isDone ? '#fff' : MUTED} /></span>
        <div style={{ flex: '1 1 240px', minWidth: 0 }}>
          {parent && (
            <button type="button" onClick={() => onOpen(parent.id)} style={{ ...sheetBtn('ghost', '#7C3AED'), padding: 0, fontSize: 12, marginBottom: 2 }}>
              <SheetIcon name="left" size={13} /> Sub-task of “{parent.title}”
            </button>
          )}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <h3 style={{ fontSize: 19, fontWeight: 700, color: INK, margin: 0, wordBreak: 'break-word' }}>{task.title}</h3>
            <Chip text={state.text} c={state.c} bg={state.bg} />
          </div>
          <div style={{ fontSize: 12.5, color: MUTED, marginTop: 6 }}>
            Given by <b style={{ color: BODY }}>{task.created_by}</b>{task.created_by_id === userId ? ' (you)' : ''}{task.created_at ? ` on ${formatDate(task.created_at)}` : ''}
            {task.department_label ? ` · ${task.department_label}` : ''}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
          {canEdit && <button type="button" data-tour="rnd-task-edit-btn" disabled={busy} onClick={() => choose('edit')} style={sheetBtn('secondary', INK, busy)}><SheetIcon name="edit" size={15} /> Edit</button>}
          <button type="button" aria-label="Previous task" disabled={prevId === undefined} onClick={() => prevId !== undefined && onOpen(prevId)} style={{ ...sheetBtn('secondary', INK, prevId === undefined), padding: '8px 9px' }}><SheetIcon name="left" size={15} /></button>
          <button type="button" aria-label="Next task" disabled={nextId === undefined} onClick={() => nextId !== undefined && onOpen(nextId)} style={{ ...sheetBtn('secondary', INK, nextId === undefined), padding: '8px 9px' }}><SheetIcon name="right" size={15} /></button>
          <button type="button" aria-label="Close task" title="Back to the task table" onClick={onClose} style={sheetBtn('ghost', MUTED)}><SheetIcon name="x" size={18} /></button>
        </div>
      </div>

      {/* Actions — the assignee's work on the left, the giver's controls on the right; only what this person may do. */}
      {(isOpen || (isDone && canReview)) && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', padding: '8px 18px 12px' }}>
          {mine && isOpen && (
            <>
              <ActionBtn tour="rnd-task-complete-btn" icon="check" label="Complete task" variant="primary" onClick={() => choose('complete')} />
              <ActionBtn tour="rnd-task-update-btn" icon="note" label="Add update" onClick={() => choose('update')} />
              <ActionBtn tour="rnd-task-approval-btn" icon="shield" label={task.pending_approval ? 'Approval pending' : 'Ask for approval'}
                disabled={!!task.pending_approval} title={task.pending_approval ? 'Your request is waiting for a decision' : 'Ask the person who gave this task to approve something'}
                onClick={() => choose('approval')} />
              <ActionBtn icon="clock" label={task.is_overdue ? 'Reason & new date' : 'Need more time'} variant={task.is_overdue ? 'warn' : 'ghost'} onClick={() => choose('extend')} />
            </>
          )}
          <span style={{ flex: '1 1 0', minWidth: 8 }} />
          {isOpen && canProgress && (
            <Select title="Work status — how the task stands" aria-label="Work status" value={workStatus} disabled={busy}
              onChange={(e) => progress({ work_status: e.target.value as RndTaskWorkStatus }, 'Could not change the status.')}
              style={{ fontSize: 12.5, fontWeight: 700, padding: '6px 10px', borderRadius: 999, border: `1.5px solid ${WORK_HEX[workStatus]}55`, background: `${WORK_HEX[workStatus]}1a`, color: WORK_HEX[workStatus], cursor: 'pointer' }}>
              {(Object.keys(WORK_LABELS) as RndTaskWorkStatus[]).map((k) => <option key={k} value={k}>{WORK_LABELS[k]}</option>)}
            </Select>
          )}
          {canSplit && <ActionBtn tour="rnd-task-subtask-btn" icon="plus" label="Sub-task" onClick={() => choose('subtask')} />}
          {canReview && rights.edit && isDone && <ActionBtn icon="undo" label="Reopen" onClick={() => choose('reopen')} />}
          {canReview && rights.cancel && isOpen && <ActionBtn icon="x" label="Cancel task" variant="danger" onClick={() => choose('cancel')} />}
        </div>
      )}

      {mine && isOpen && task.is_overdue && (
        <div style={{ margin: '0 18px 12px', padding: '10px 12px', borderRadius: 10, background: 'rgba(220,38,38,0.07)', border: '1px solid rgba(220,38,38,0.25)', color: '#b91c1c', fontSize: 12.5 }}>
          This task was due on {formatDate(task.due_date)}. Use “Reason &amp; new date” to give the reason and your new completion date, or complete it with a delay reason.
        </div>
      )}
      {viewError && <div style={{ padding: '0 18px' }}><SheetError error={viewError} /></div>}

      {/* Tabs */}
      <div role="tablist" style={{ display: 'flex', flexWrap: 'wrap', gap: 2, padding: '0 12px', borderBottom: `1px solid ${LINE}` }}>
        {tabs.map((x) => (
          <button key={x.k} role="tab" aria-selected={tab === x.k} type="button" onClick={() => setTab(x.k)} style={tabStyle(tab === x.k)}>
            <SheetIcon name={x.icon} size={14} color={tab === x.k ? BLUE : MUTED} />{x.t}
            {x.n !== undefined && (
              <span style={{ ...pillStyle(MUTED), justifyContent: 'center', padding: '0 6px', minWidth: 18, textAlign: 'center', background: tab === x.k ? `${BLUE}1a` : '#f1f5f9', color: tab === x.k ? BLUE : MUTED }}>{x.n}</span>
            )}
          </button>
        ))}
      </div>

      <div style={{ padding: 18 }}>
        {tab === 'overview' && (
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'flex-start' }}>
            <div style={{ flex: '2 1 320px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 14 }}>
              <Box icon="list" title="Description" color={BLUE}>
                <div style={{ fontSize: 13, color: task.remarks ? BODY : MUTED, whiteSpace: 'pre-wrap', background: SOFT, borderRadius: 10, padding: '10px 12px' }}>{task.remarks || 'No description.'}</div>
              </Box>
              <div data-tour="rnd-task-checklist">
                <Box icon="check" title={`Checklist (${checklist.length})`} color="#16a34a"
                  extra={checklist.length > 0 ? <span style={{ marginLeft: 'auto', fontSize: 12, color: MUTED }}>{task.checklist_done} / {checklist.length} completed</span> : undefined}>
                  {checklist.length === 0 && <p style={{ fontSize: 12.5, color: MUTED, margin: 0 }}>No checklist steps.{canEdit ? ' Add them with Edit.' : ''}</p>}
                  {checklist.map((c) => {
                    const tickable = isOpen && canProgress && !busy
                    return (
                      <label key={c.id} title={c.done && c.done_by ? `Ticked by ${c.done_by}${c.done_at ? ` · ${formatDateTime(c.done_at)}` : ''}` : undefined}
                        style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 2px', borderTop: `1px solid ${LINE}`, cursor: tickable ? 'pointer' : 'default' }}>
                        <input type="checkbox" checked={c.done} disabled={!tickable} aria-label={`Tick ${c.text}`}
                          style={{ width: 16, height: 16, accentColor: '#16a34a', flexShrink: 0 }}
                          onChange={(e) => progress({ item_id: c.id, done: e.target.checked }, 'Could not update the checklist.')} />
                        <span style={{ flex: 1, minWidth: 0, fontSize: 13, color: c.done ? MUTED : INK, textDecoration: c.done ? 'line-through' : 'none', wordBreak: 'break-word' }}>{c.text}</span>
                        {c.done && c.done_by && <span style={{ fontSize: 11, color: MUTED }}>{c.done_by}</span>}
                      </label>
                    )
                  })}
                </Box>
              </div>
              {task.events.length > 0 && (
                <Box icon="history" title="Latest activity" color="#7C3AED"
                  extra={task.events.length > 1 ? <button type="button" onClick={() => setTab('activity')} style={{ ...sheetBtn('ghost', BLUE), marginLeft: 'auto', padding: 0, fontSize: 12 }}>See all ({task.events.length})</button> : undefined}>
                  <ActivityFeed events={task.events.slice(-1)} userName={userName} />
                </Box>
              )}
            </div>
            <div style={{ flex: '1 1 230px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 14 }}>
              <Box icon="list" title="Task Information" color="#7c3aed">
                <InfoRows rows={[
                  ['Status', <Chip key="s" text={state.text} c={state.c} bg={state.bg} />],
                  ['Priority', <Chip key="p" text={PRIORITY_LABELS[priority]} c={PRIORITY_HEX[priority]} bg={`${PRIORITY_HEX[priority]}1a`} />],
                  ['Assignee', <span key="a" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><Avatar name={task.assigned_to} size={22} />{mine ? 'You' : task.assigned_to}</span>],
                  ...(task.department_label ? [['Department', task.department_label] as [string, React.ReactNode]] : []),
                  ['Start Date', task.start_date ? formatDate(task.start_date) : '—'],
                  ['Due Date', <span key="d" style={{ color: task.is_overdue ? '#be123c' : BODY, fontWeight: task.is_overdue ? 600 : 400 }}>{formatDate(task.due_date)}{task.due_date !== task.original_due_date ? ` (re-dated ${task.extensions}×, was ${formatDate(task.original_due_date)})` : ''}</span>],
                  ...(task.closed_at ? [[task.status === 'cancelled' ? 'Cancelled' : 'Completed', formatDate(task.closed_at)] as [string, React.ReactNode]] : []),
                ]} />
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 0', fontSize: 13 }}>
                  <span style={{ width: 96, color: MUTED, flexShrink: 0 }}>Progress</span><Bar value={taskPercent(task)} color="#16a34a" /><span style={{ fontWeight: 700, color: INK }}>{taskPercent(task)}%</span>
                </div>
              </Box>
              <Box icon="flag" title="Related Items" color={BLUE}>
                <InfoRows rows={[
                  ...(task.requirement_ref ? [['Requirement', `${task.requirement_ref}${task.requirement_title ? ` — ${task.requirement_title}` : ''}`] as [string, React.ReactNode]] : []),
                  ...(parent ? [['Main task', <button key="pt" type="button" onClick={() => onOpen(parent.id)} style={{ ...sheetBtn('ghost', BLUE), padding: 0 }}>{parent.title}</button>] as [string, React.ReactNode]] : []),
                  ...(!isSub ? [['Sub-tasks', subtasks.length ? `${subtasks.filter(isDoneTask).length} of ${subtasks.length} completed` : 'None'] as [string, React.ReactNode]] : []),
                  ['Files', String(docCount(task))],
                  ['Approvals', approvals.length ? `${approvals.length}${task.pending_approval ? ' · 1 waiting' : ''}` : 'None'],
                ]} />
              </Box>
            </div>
          </div>
        )}

        {tab === 'subtasks' && (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 13, color: MUTED }}>The assignee splits the work; the main task completes once every sub-task is completed or cancelled.</span>
              {canSplit && <button type="button" onClick={() => choose('subtask')} style={{ ...sheetBtn('primary', BLUE), marginLeft: 'auto' }}><SheetIcon name="plus" size={15} /> Add Sub-task</button>}
            </div>
            {subtasks.length === 0 ? <p style={{ fontSize: 13, color: MUTED }}>No sub-tasks yet.</p> : (
              <div style={{ border: `1px solid ${LINE}`, borderRadius: 12, overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 560 }}>
                  <thead><tr><th style={th}>Sub-task <RowCount count={subtasks.length} /></th><th style={th}>Assignee</th><th style={th}>Due Date</th><th style={th}>Status</th><th style={{ ...th, width: 130 }}>Progress</th></tr></thead>
                  <tbody>
                    {subtasks.map((s) => {
                      const ss = taskState(s)
                      return (
                        <tr key={s.id} onClick={() => onOpen(s.id)} style={{ cursor: 'pointer' }}
                          onMouseEnter={(e) => { e.currentTarget.style.background = SOFT }} onMouseLeave={(e) => { e.currentTarget.style.background = '' }}>
                          <td style={{ ...td, fontWeight: 600, color: INK }}>{s.title}</td>
                          <td style={td}><span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}><Avatar name={s.assigned_to} size={24} />{s.assigned_to_id === userId ? <b style={{ color: BLUE }}>You</b> : s.assigned_to}</span></td>
                          <td style={{ ...td, whiteSpace: 'nowrap', color: s.is_overdue ? '#be123c' : BODY }}>{formatDate(s.due_date)}</td>
                          <td style={td}><Chip text={ss.text} c={ss.c} bg={ss.bg} /></td>
                          <td style={td}><span style={{ display: 'flex', alignItems: 'center', gap: 8 }}><Bar value={taskPercent(s)} color="#16a34a" /><span style={{ fontSize: 12, width: 34 }}>{taskPercent(s)}%</span></span></td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {tab === 'files' && (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 13, color: MUTED }}>Files given with the task, the assignee&apos;s work, and files sent with approval requests.</span>
              {mine && isOpen && <button type="button" onClick={() => choose('update')} style={{ ...sheetBtn('primary', BLUE), marginLeft: 'auto' }}><SheetIcon name="clip" size={15} /> Upload files</button>}
            </div>
            {docCount(task) === 0 ? <p style={{ fontSize: 13, color: MUTED }}>No files yet.{mine && isOpen ? ' Upload your work with “Upload files” — it is posted as an update.' : ''}</p> : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                {fileGroups.filter(([, d]) => d.length).map(([title, docs]) => (
                  <div key={title}><p style={smallLabel}>{title} ({docs.length})</p><DocChips docs={docs} onOpen={openDoc} /></div>
                ))}
              </div>
            )}
          </div>
        )}

        {tab === 'approvals' && (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 13, color: MUTED }}>Something task-related the assignee needs signed off — {task.created_by}{task.created_by_id === userId ? ' (you)' : ''} or the {labels.manager} decides; the task stays open.</span>
              {mine && isOpen && !task.pending_approval && <button type="button" onClick={() => choose('approval')} style={{ ...sheetBtn('primary', '#D97706'), marginLeft: 'auto' }}><SheetIcon name="shield" size={15} /> Ask for approval</button>}
            </div>
            {approvals.length === 0 ? <p style={{ fontSize: 13, color: MUTED, marginTop: 12 }}>No approval requests.</p> : (
              <ApprovalList approvals={approvals} canDecide={canReview && rights.approve && !mine} userId={userId} api={api} onChanged={onChanged} onOpen={openDoc} />
            )}
          </div>
        )}

        {tab === 'activity' && (
          <div data-tour="rnd-task-activity">
            {task.events.length === 0 ? <p style={{ fontSize: 13, color: MUTED }}>Nothing recorded yet.</p> : <ActivityFeed events={task.events} userName={userName} />}
          </div>
        )}
      </div>

      {/* Popups */}
      {panel === 'edit' && api.edit && (
        <TaskForm
          mode="edit" labels={labels}
          people={isSub ? team : people}
          initial={task}
          parentTitle={parent?.title}
          onCancel={() => setPanel('')}
          onSubmit={async (p) => {
            const t = await api.edit!(task.id, {
              title: p.title, remarks: p.remarks || null, due_date: p.due_date, assigned_to_id: p.assigned_to_id, department: p.department,
              priority: p.priority, start_date: p.start_date || null, work_status: p.work_status, checklist: p.checklist,
            })
            setPanel('')
            onChanged(t)
          }}
        />
      )}
      {panel === 'subtask' && (
        <TaskForm
          mode="subtask" parentTitle={task.title} labels={labels} people={team} maxDue={task.due_date}
          onCancel={() => setPanel('')}
          onSubmit={async (p) => { await api.create(p, task.id); setPanel(''); setTab('subtasks'); onCreated() }}
        />
      )}
      {meta && panel && panel !== 'edit' && panel !== 'subtask' && (
        <FormSheet width={580} icon={meta.icon} iconColor={meta.color} title={meta.title} subtitle={`Task '${task.title}'`} onClose={() => setPanel('')} busy={busy}
          footer={<>
            <button type="button" onClick={() => setPanel('')} disabled={busy} style={sheetBtn('secondary', INK, busy)}>Close</button>
            <button type="button" onClick={submitPanel[panel]} disabled={busy} style={sheetBtn('primary', meta.color, busy)}><SheetIcon name={meta.icon} size={16} />{busy ? meta.busy : meta.submit}</button>
          </>}>
          <div style={{ padding: '20px 24px' }}>
            <SheetError error={error} />
            {panel === 'extend' && (
              <>
                <label style={sheetLabel}>Reason it isn’t complete <Req /></label>
                <textarea style={{ ...sheetInput, minHeight: 70 }} value={text} onChange={(e) => setText(e.target.value)} placeholder="e.g. Waiting for RDSO drawing approval" autoFocus />
                <label style={{ ...sheetLabel, marginTop: 14 }}>New completion date <Req /></label>
                <DateField value={date} onChange={setDate} />
                <p style={sheetHint}>The new date becomes the task’s due date; the {labels.manager} is notified and the original date ({formatDate(task.original_due_date)}) stays on record.</p>
              </>
            )}
            {(panel === 'update' || panel === 'complete' || panel === 'approval') && (
              <>
                <label style={sheetLabel}>{panel === 'update' ? 'Update / remarks' : panel === 'complete' ? 'What you did' : 'What do you need approved?'} <Req /></label>
                <textarea style={{ ...sheetInput, minHeight: 80 }} value={text} onChange={(e) => setText(e.target.value)} autoFocus
                  placeholder={panel === 'update' ? 'Progress so far, findings, questions for the reviewer' : panel === 'complete' ? 'Result, assumptions, open points' : 'e.g. Approve EN24 instead of EN8 for the axle — EN8 fails the fatigue check (calc attached)'} />
                {panel === 'complete' && task.is_overdue && (
                  <>
                    <label style={{ ...sheetLabel, marginTop: 14 }}>Reason for the delay <Req /> <span style={{ fontWeight: 400, color: MUTED }}>(was due {formatDate(task.due_date)})</span></label>
                    <textarea style={{ ...sheetInput, minHeight: 56 }} value={delayReason} onChange={(e) => setDelayReason(e.target.value)} />
                  </>
                )}
                {panel === 'complete' && (unticked.length > 0 || openSubs.length > 0) && (
                  <p style={{ fontSize: 12.5, color: '#b45309', margin: '10px 0 0' }}>
                    {unticked.length > 0 && `${unticked.length} checklist step(s) still unticked. `}{openSubs.length > 0 && `${openSubs.length} sub-task(s) still open. `}They must be done first.
                  </p>
                )}
                <label style={{ ...sheetLabel, marginTop: 14 }}>{panel === 'complete' ? 'Attach work' : 'Attach documents'} <span style={{ fontWeight: 400, color: MUTED }}>(optional)</span></label>
                <FileDropZone files={files} onChange={setFiles} />
                <p style={sheetHint}>
                  {panel === 'update' && 'The task stays open; the person who assigned it is notified. Use “Complete task” when the work is finished.'}
                  {panel === 'complete' && 'The task is closed and the person who assigned it is notified. They can reopen it if something is missing.'}
                  {panel === 'approval' && `Goes to ${task.created_by}${task.created_by_id === userId ? ' (you)' : ''} (and the ${labels.manager}). The task stays open while they decide.`}
                </p>
              </>
            )}
            {panel === 'reopen' && (
              <>
                <label style={sheetLabel}>What still needs to be done <Req /></label>
                <textarea style={{ ...sheetInput, minHeight: 70 }} value={text} onChange={(e) => setText(e.target.value)} autoFocus />
                <label style={{ ...sheetLabel, marginTop: 14 }}>New due date {dueMissed ? <Req /> : <span style={{ fontWeight: 400, color: MUTED }}>(optional)</span>}</label>
                <DateField value={date} onChange={setDate} />
              </>
            )}
            {panel === 'cancel' && (
              <>
                <label style={sheetLabel}>Why is it cancelled? <Req /></label>
                <textarea style={{ ...sheetInput, minHeight: 70 }} value={text} onChange={(e) => setText(e.target.value)} autoFocus />
                {openSubs.length > 0 && <p style={{ fontSize: 12.5, color: '#b91c1c', margin: '8px 0 0' }}>Its {openSubs.length} open sub-task(s) will be cancelled too.</p>}
                <p style={sheetHint}>The task and its history are kept; the assignee is notified.</p>
              </>
            )}
          </div>
        </FormSheet>
      )}
    </div>
  )
}

type Filter = 'all' | 'pending' | 'completed' | 'overdue' | 'mine' | 'given'

export default function TasksBoard({ api, userId, canManage, canCreate = canManage, rights: rightsIn, departmentFilter, labels, reloadKey, onTasksChange }: {
  api: TaskApi
  userId: number
  /** Head / lead: create top-level tasks and review every task. */
  canManage: boolean
  /** Create top-level tasks (defaults to canManage). */
  canCreate?: boolean
  /** Role-level rights from the module's Tasks feature (default: all allowed). */
  rights?: TaskRights
  /** Department chips: All · My department · one per department. */
  departmentFilter?: { options: { key: string; label: string }[]; mine: string[] }
  labels: TaskLabels
  /** Change to reload (e.g. when the caller's record changes). */
  reloadKey?: string | number
  /** Called with the list after every load / change (e.g. to refresh milestone progress). */
  onTasksChange?: (tasks: RndTask[]) => void
}) {
  const [tasks, setTasks] = useState<RndTask[] | null>(null)
  const [people, setPeople] = useState<RndPerson[]>([])
  const [team, setTeam] = useState<RndPerson[]>([])
  const [error, setError] = useState<string | string[]>('')
  const [creating, setCreating] = useState(false)
  const [query, setQuery] = useState('')
  const [dept, setDept] = useState<string>('all')
  const [filter, setFilter] = useState<Filter>('all')
  const [open, setOpen] = useState<{ id: number; panel?: Panel } | null>(null)
  const rights: Required<TaskRights> = { ...ALL_RIGHTS, ...rightsIn }

  const load = () => api.list()
    .then(setTasks)
    .catch((err) => { setTasks([]); setError(extractErrorMessages(err, 'Could not load the tasks.')) })

  useEffect(() => {
    load()
    if (canCreate) api.people().then(setPeople).catch(() => setPeople([]))
    if (api.team) api.team().then(setTeam).catch(() => setTeam([]))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reloadKey, canCreate])

  useEffect(() => {
    if (tasks && onTasksChange) onTasksChange(tasks)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tasks])

  const list = tasks || []
  const ids = new Set(list.map((t) => t.id))
  // Open work first (overdue, then soonest due); completed / cancelled sink to the bottom, latest finished first.
  const finished = (t: RndTask) => t.status !== 'open'
  const order = (a: RndTask, b: RndTask) =>
    Number(finished(a)) - Number(finished(b))
    || (finished(a)
      ? (b.closed_at || b.created_at || '').localeCompare(a.closed_at || a.created_at || '')
      : Number(b.is_overdue) - Number(a.is_overdue) || a.due_date.localeCompare(b.due_date) || a.id - b.id)
  // Search: any word must appear in the title, task details, checklist, the assignee's name (not who gave it), status, priority or a date
  // (due, original due, assigned — typed as 16/10/2026, 16-10-2026, 2026-10-16 or just "16/10").
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  const haystack = (t: RndTask) => {
    const dates = [t.due_date, t.original_due_date, t.created_at?.slice(0, 10), t.closed_at?.slice(0, 10)]
      .filter(Boolean).flatMap((d) => [d as string, formatDate(d as string), formatDate(d as string).replace(/\//g, '-')])
    return [t.title, t.remarks, t.assigned_to, STATUS_LABELS[t.status], t.is_overdue ? 'overdue' : '',
      PRIORITY_LABELS[t.priority || 'medium'], t.status === 'open' ? WORK_LABELS[t.work_status || 'not_started'] : '',
      ...(t.checklist || []).map((c) => c.text), ...dates]
      .filter(Boolean).join(' ').toLowerCase()
  }
  const inDept = (t: RndTask, key: string) =>
    key === 'all' || (key === 'mine' ? (departmentFilter?.mine || []).includes(t.department || 'rnd') : (t.department || 'rnd') === key)
  const inFilter = (t: RndTask, f: Filter) =>
    f === 'all' || (f === 'pending' ? t.status === 'open' : f === 'completed' ? isDoneTask(t) : f === 'overdue' ? t.is_overdue
      : f === 'mine' ? t.assigned_to_id === userId : t.created_by_id === userId)
  const matches = (t: RndTask) => words.every((w) => haystack(t).includes(w)) && inDept(t, dept) && inFilter(t, filter)
  const narrowed = words.length > 0 || dept !== 'all' || filter !== 'all'
  // A sub-task sits under its main task; if the main task isn't visible to this user, it shows on its own.
  // A main task shows when it or one of its sub-tasks matches.
  const rows: { t: RndTask; depth: number; n: number }[] = []
  let n = 0
  for (const r of list.filter((t) => !t.parent_task_id || !ids.has(t.parent_task_id)).sort(order)) {
    const kids = list.filter((t) => t.parent_task_id === r.id).sort(order)
    const shownKids = narrowed ? kids.filter(matches) : kids
    if (narrowed && !matches(r) && !shownKids.length) continue
    n += 1
    rows.push({ t: r, depth: 0, n })
    shownKids.forEach((k) => rows.push({ t: k, depth: 1, n }))
  }
  const deptList = list.filter((t) => inDept(t, dept))
  const chips: { k: Filter; t: string; c: number }[] = [
    { k: 'all', t: 'All', c: deptList.length },
    { k: 'pending', t: 'Pending', c: deptList.filter((t) => inFilter(t, 'pending')).length },
    { k: 'completed', t: 'Completed', c: deptList.filter((t) => inFilter(t, 'completed')).length },
    { k: 'overdue', t: 'Overdue', c: deptList.filter((t) => inFilter(t, 'overdue')).length },
    { k: 'mine', t: 'Assigned to me', c: deptList.filter((t) => inFilter(t, 'mine')).length },
    { k: 'given', t: 'Given by me', c: deptList.filter((t) => inFilter(t, 'given')).length },
  ]
  const replace = (nt: RndTask) => setTasks((l) => (l || []).map((x) => (x.id === nt.id ? nt : x)))
  const openTask = open ? list.find((t) => t.id === open.id) : undefined
  // Prev / next walk the rows as listed (the open task may be outside the filter — then the whole list).
  const walk = rows.some((r) => r.t.id === open?.id) ? rows.map((r) => r.t.id) : list.map((t) => t.id)
  const at = open ? walk.indexOf(open.id) : -1

  const addBtn = canCreate && (
    <button type="button" data-tour="rnd-task-new-btn" onClick={() => setCreating(true)} style={sheetBtn('primary', BLUE)}><SheetIcon name="plus" size={16} /> Add Task</button>
  )

  return (
    <div data-tour="rnd-req-tasks">
      <SheetError error={error} />
      {creating && (
        <TaskForm
          mode="create" labels={labels} people={people}
          onCancel={() => setCreating(false)}
          onSubmit={async (p) => { const t = await api.create(p); setCreating(false); await load(); setOpen({ id: t.id }) }}
        />
      )}

      {/* Toolbar: status chips, search, Add Task */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 16, fontWeight: 700, color: BLUE }}><SheetIcon name="list" size={18} color={BLUE} />Tasks ({list.length})</span>
        {list.length > 0 && (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {chips.filter((c) => c.k === 'all' || c.c > 0 || filter === c.k).map((c) => (
              <button key={c.k} type="button" onClick={() => setFilter(c.k)} style={{ ...chipBtnStyle(filter === c.k), borderColor: filter === c.k ? BLUE : LINE, background: filter === c.k ? '#eff6ff' : '#fff', color: filter === c.k ? BLUE : BODY }}>{c.t} ({c.c})</button>
            ))}
          </div>
        )}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginLeft: 'auto', flexWrap: 'wrap' }}>
          {list.length > 0 && (
            <div data-tour="rnd-task-search" style={{ position: 'relative', width: 280, maxWidth: '100%' }}>
              <span style={{ position: 'absolute', left: 10, top: 10 }}><SheetIcon name="search" size={15} color={MUTED} /></span>
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search task, person, status or date…" title="Search task, person, priority, status or a date (e.g. 16/10/2026)"
                style={{ ...sheetInput, padding: '8px 28px 8px 32px' }} />
              {query && <button type="button" onClick={() => setQuery('')} aria-label="Clear search" style={{ ...sheetBtn('ghost', MUTED), position: 'absolute', right: 2, top: 3 }}><SheetIcon name="x" size={14} /></button>}
            </div>
          )}
          {addBtn}
        </div>
      </div>
      {departmentFilter && list.length > 0 && (
        <div data-tour="rnd-task-dept-chips" style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12, alignItems: 'center' }}>
          <span style={{ fontSize: 12, color: MUTED, marginRight: 2 }}>Department:</span>
          {[{ key: 'all', label: 'All' }, ...(departmentFilter.mine.length ? [{ key: 'mine', label: 'My department' }] : []), ...departmentFilter.options].map((c) => {
            const active = dept === c.key
            return (
              <button key={c.key} type="button" onClick={() => setDept(c.key)} style={{ ...chipBtnStyle(active), borderColor: active ? (DEPT_HEX[c.key] || BLUE) : LINE, background: active ? `${DEPT_HEX[c.key] || BLUE}14` : '#fff', color: active ? (DEPT_HEX[c.key] || BLUE) : BODY }}>
                {c.label} ({list.filter((t) => inDept(t, c.key)).length})
              </button>
            )
          })}
        </div>
      )}

      {tasks === null ? (
        <p style={{ fontSize: 13, color: MUTED }}>Loading…</p>
      ) : tasks.length === 0 ? (
        <div style={{ border: `1.5px dashed #bfdbfe`, borderRadius: 14, padding: '36px 16px', textAlign: 'center', background: '#f8fbff' }}>
          <SheetIcon name="list" size={28} color={BLUE} />
          <div style={{ fontSize: 15, fontWeight: 700, color: INK, marginTop: 8 }}>No tasks yet</div>
          <div style={{ fontSize: 13, color: MUTED, margin: '4px 0 14px' }}>{canCreate ? labels.emptyManager.replace('“+ New task”', '“Add Task”') : labels.emptyOther}</div>
          {addBtn}
        </div>
      ) : openTask ? (
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'flex-start' }}>
          {/* List */}
          <div style={{ ...card, flex: '1 1 240px', maxWidth: 320, overflow: 'hidden' }}>
            {(rows.length ? rows : [{ t: openTask, depth: 0, n: 1 }]).map(({ t, depth, n: num }) => {
              const active = t.id === openTask.id
              const ss = taskState(t)
              return (
                // ui-audit-ignore-next-line custom-button — task list row in the split view (navigation row), not a pill button
                <button key={t.id} type="button" onClick={() => setOpen({ id: t.id })}
                  style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', textAlign: 'left', padding: `10px 12px 10px ${depth ? 28 : 12}px`, borderTop: '0', borderRight: '0', borderBottom: `1px solid ${LINE}`, borderLeft: `3px solid ${active ? BLUE : 'transparent'}`, borderRadius: 0, boxShadow: 'none', transform: 'none', background: active ? '#eff6ff' : '#fff', color: INK, cursor: 'pointer', fontFamily: 'inherit' }}>
                  <span style={{ width: 22, height: 22, borderRadius: '50%', background: isDoneTask(t) ? '#16a34a' : '#e2e8f0', color: BODY, fontSize: 11, fontWeight: 700, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    {isDoneTask(t) ? <SheetIcon name="check" size={12} color="#fff" /> : depth ? '↳' : num}
                  </span>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: 'block', fontSize: 13, fontWeight: 600, color: INK, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.title}</span>
                    <span style={{ display: 'inline-block', marginTop: 3 }}><Chip text={ss.text} c={ss.c} bg={ss.bg} /></span>
                  </span>
                  <span style={{ fontSize: 11.5, color: t.is_overdue ? '#be123c' : MUTED, whiteSpace: 'nowrap' }}>{formatDate(t.due_date)}</span>
                </button>
              )
            })}
          </div>
          <TaskView key={openTask.id} task={openTask} all={list} userId={userId} canManage={canManage} rights={rights} api={api} labels={labels} people={people} team={team}
            startPanel={open?.panel}
            onChanged={(nt) => { replace(nt); if (nt.status === 'cancelled') load() }} onCreated={load}
            onOpen={(id) => setOpen({ id })} onClose={() => setOpen(null)}
            prevId={at > 0 ? walk[at - 1] : undefined} nextId={at >= 0 && at < walk.length - 1 ? walk[at + 1] : undefined} />
        </div>
      ) : (
        <div style={{ border: `1px solid ${LINE}`, borderRadius: 12, overflowX: 'auto', background: '#fff' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 900 }}>
            <thead>
              <tr>
                <th style={{ ...th, width: 36, whiteSpace: 'nowrap' }}># <RowCount count={rows.length} /></th>
                <th style={th}>Task Name</th>
                <th style={th}>Assignee</th>
                <th style={th}>Given by</th>
                <th style={th}>Priority</th>
                <th style={th}>Due Date</th>
                <th style={th}>Status</th>
                <th style={{ ...th, width: 140 }}>Progress</th>
                <th style={{ ...th, textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr><td colSpan={9} style={{ ...td, textAlign: 'center', color: MUTED, padding: 24 }}>
                  {query.trim() ? `No task matches “${query.trim()}”.` : 'No tasks match these filters.'}{' '}
                  <button type="button" onClick={() => { setQuery(''); setFilter('all'); setDept('all') }} style={{ ...sheetBtn('ghost', BLUE), padding: 0, display: 'inline' }}>Clear filters</button>
                </td></tr>
              )}
              {rows.map(({ t, depth, n: num }) => {
                const ss = taskState(t)
                const kids = list.filter((k) => k.parent_task_id === t.id)
                const files = docCount(t)
                const canEditRow = !!api.edit && rights.edit && t.status === 'open' && (canManage || t.created_by_id === userId)
                const pr = t.priority || 'medium'
                return (
                  <tr key={t.id} onClick={() => setOpen({ id: t.id })} style={{ cursor: 'pointer', background: depth ? '#fcfcfd' : undefined }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = SOFT }} onMouseLeave={(e) => { e.currentTarget.style.background = depth ? '#fcfcfd' : '' }}>
                    <td style={{ ...td, color: MUTED }}>{depth ? '' : num}</td>
                    <td style={{ ...td, paddingLeft: depth ? 32 : 12 }}>
                      <div style={{ fontWeight: 600, color: INK }}>{depth ? <span style={{ color: '#7C3AED', marginRight: 6 }}>↳</span> : null}{t.title}</div>
                      <div style={{ display: 'flex', gap: 10, fontSize: 11.5, color: MUTED, marginTop: 2, flexWrap: 'wrap', alignItems: 'center' }}>
                        {t.department_label && <span style={{ ...pillStyle(DEPT_HEX[t.department || 'rnd'] || '#57534e'), fontSize: 'inherit', fontWeight: 600, padding: '1px 7px', background: `${DEPT_HEX[t.department || 'rnd'] || '#57534e'}14` }}>{t.department_label}</span>}
                        {kids.length > 0 && <span>Sub-tasks {kids.filter(isDoneTask).length}/{kids.length}</span>}
                        {t.checklist?.length > 0 && <span>☑ {t.checklist_done}/{t.checklist.length}</span>}
                        {files > 0 && <span>📎 {files}</span>}
                        {t.pending_approval && <span style={{ color: '#b45309', fontWeight: 600 }}>Approval waiting</span>}
                      </div>
                    </td>
                    <td style={td}><span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}><Avatar name={t.assigned_to} size={26} />{t.assigned_to_id === userId ? <b style={{ color: BLUE }}>You</b> : t.assigned_to}</span></td>
                    <td style={td}>{t.created_by_id === userId ? 'You' : t.created_by}</td>
                    <td style={td}><Chip text={PRIORITY_LABELS[pr]} c={PRIORITY_HEX[pr]} bg={`${PRIORITY_HEX[pr]}1a`} /></td>
                    <td style={{ ...td, whiteSpace: 'nowrap', color: t.is_overdue ? '#be123c' : BODY, fontWeight: t.is_overdue ? 600 : 400 }}>{formatDate(t.due_date)}</td>
                    <td style={td}><Chip text={ss.text} c={ss.c} bg={ss.bg} /></td>
                    <td style={td}><span style={{ display: 'flex', alignItems: 'center', gap: 8 }}><Bar value={taskPercent(t)} color="#16a34a" /><span style={{ fontSize: 12, color: BODY, width: 34 }}>{taskPercent(t)}%</span></span></td>
                    <td style={{ ...td, textAlign: 'right', whiteSpace: 'nowrap' }} onClick={(e) => e.stopPropagation()}>
                      {canEditRow && <button type="button" title="Edit" aria-label={`Edit ${t.title}`} onClick={() => setOpen({ id: t.id, panel: 'edit' })} style={sheetBtn('ghost', MUTED)}><SheetIcon name="edit" size={15} /></button>}
                      <button type="button" title="Open" aria-label={`Open ${t.title}`} onClick={() => setOpen({ id: t.id })} style={sheetBtn('ghost', BLUE)}><SheetIcon name="right" size={15} /></button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
