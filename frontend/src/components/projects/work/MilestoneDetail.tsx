'use client'

import { Fragment, useState } from 'react'
import { pmOngoingApi } from '@/lib/api'
import { PmDeptSubtask, PmDeptTask } from '@/types'
import { TEXT, BORDER } from '@/lib/theme'
import { formatDate } from '@/lib/format'
import { extractErrorMessages } from '@/lib/validation'
import DateField from '@/components/erp/DateField'
import SearchableSelect from '@/components/erp/SearchableSelect'
import PromptDialog from '@/components/erp/PromptDialog'
import ConfirmDialog from '@/components/erp/ConfirmDialog'
import TaskActivity from './TaskActivity'
import { useAssigneeFilter } from '@/hooks/useAssigneeFilter'
import { ErrorBanner, FlagPill, Pill, TASK_HEX, TASK_LABELS, actionBtn, linkBtn, usePmFeature } from './pmUi'
import { FormSheet, Req, SHEET, SheetIcon, SheetSection, sheetBtn, sheetHint, sheetInput, sheetLabel } from '@/components/shared/FormSheet'
import { RowCount } from '@/components/shared/ui'
import { useFormDraft } from '@/lib/formDraft'
import DraftBanner from '@/components/shared/DraftBanner'

type Person = { id: number; name: string; designation?: string | null; department?: string | null }
type NewTask = { parentId: number | null; title: string; assignee_id: string; due_date: string; limit?: string | null }

let peopleCache: Promise<Person[]> | null = null
function loadPeople() {
  if (!peopleCache) peopleCache = pmOngoingApi.everyone().catch((e) => { peopleCache = null; throw e })
  return peopleCache
}

const OPEN = ['todo', 'in_progress', 'blocked']
const SUB_LABELS: Record<string, string> = { todo: 'To do', done: 'Done' }
const SUB_HEX: Record<string, string> = { todo: '#64748b', done: '#16a34a' }

/** The milestone's own tasks (sub-tasks of tasks are rows with parent_id). */
export const topTasks = (t: PmDeptTask) => t.subtasks.filter((s) => !s.parent_id)
export function milestonePercent(t: PmDeptTask): number {
  if (t.status === 'done') return 100
  const tasks = topTasks(t)
  return tasks.length ? Math.round(tasks.filter((s) => s.status === 'done').length * 100 / tasks.length) : 0
}

const eyebrow: React.CSSProperties = { fontSize: 11, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: TEXT.muted, margin: 0 }
const card: React.CSSProperties = { background: '#fff', border: `1px solid ${BORDER.light}`, borderRadius: 12 }
const th: React.CSSProperties = { textAlign: 'left', padding: '10px 14px', fontSize: 11, fontWeight: 700, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, background: '#f8fafc', borderBottom: `1px solid ${BORDER.light}`, whiteSpace: 'nowrap', position: 'sticky', top: 0, zIndex: 1 }
const td: React.CSSProperties = { padding: '12px 14px', fontSize: 13, color: TEXT.body, borderBottom: `1px solid ${BORDER.light}`, verticalAlign: 'middle' }

function Bar({ value, height = 10 }: { value: number; height?: number }) {
  const v = Math.max(0, Math.min(100, value))
  return (
    <div style={{ height, borderRadius: 999, background: 'rgba(15,23,42,0.08)', overflow: 'hidden' }}>
      <div style={{ width: `${v}%`, height: '100%', borderRadius: 999, background: v >= 100 ? '#16a34a' : 'linear-gradient(90deg,#6366f1,#8b5cf6)', transition: 'width .3s' }} />
    </div>
  )
}

function Info({ label, value, sub, danger }: { label: string; value: React.ReactNode; sub?: React.ReactNode; danger?: boolean }) {
  return (
    <div style={{ ...card, padding: '12px 16px', flex: '1 1 200px', minWidth: 0 }}>
      <p style={eyebrow}>{label}</p>
      <div style={{ fontSize: 14.5, fontWeight: 600, color: danger ? '#dc2626' : TEXT.heading, marginTop: 4 }}>{value}</div>
      {sub && <div style={{ fontSize: 12, color: danger ? '#dc2626' : TEXT.muted, marginTop: 2 }}>{sub}</div>}
    </div>
  )
}

function Avatar({ name }: { name?: string | null }) {
  const initials = (name || '?').split(' ').filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase()
  return <span style={{ width: 26, height: 26, borderRadius: '50%', background: 'rgba(99,102,241,0.12)', color: '#4f46e5', fontSize: 11, fontWeight: 700, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{initials}</span>
}

const overdueDays = (iso?: string | null) => {
  if (!iso) return 0
  const d = Math.floor((Date.now() - new Date(`${iso}T23:59:59`).getTime()) / 86400000)
  return d > 0 ? d : 0
}

/** One milestone opened: title, progress and Back; who gave it, who is
 * responsible and by when; the button to create its tasks; and the tasks
 * table. A task opens in a popup with its sub-tasks, remarks and files. */
export default function MilestoneDetail({ t, onBack, onChanged, onEdit, onDelete }: {
  t: PmDeptTask
  onBack: () => void
  onChanged: (t: PmDeptTask) => void
  onEdit?: (t: PmDeptTask) => void
  onDelete?: (t: PmDeptTask) => Promise<void>
}) {
  const [busy, setBusy] = useState(false)
  // Milestone actions: record rules (can_*) AND the role's features (core/features/projects.py).
  const pmf = usePmFeature()
  const [error, setError] = useState<string | string[]>('')
  const [people, setPeople] = useState<Person[] | null>(null)
  // Role "Assign to" rule (Role & Permissions › Project Management › Overview › Tasks); the server refuses others on save.
  const allowAssignee = useAssigneeFilter('projects:overview.tasks')
  const [form, setForm] = useState<NewTask | null>(null)
  const [formError, setFormError] = useState<string | string[]>('')
  const [openTaskId, setOpenTaskId] = useState<number | null>(null)
  const [openSubId, setOpenSubId] = useState<number | null>(null)
  const [reason, setReason] = useState<'reopen' | 'cancel' | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [removeFor, setRemoveFor] = useState<PmDeptSubtask | null>(null)

  const tasks = topTasks(t)
  const children = (id: number) => t.subtasks.filter((s) => s.parent_id === id)
  const doneCount = tasks.filter((s) => s.status === 'done').length
  const pct = milestonePercent(t)
  const open = OPEN.includes(t.status)
  const late = t.is_overdue ? overdueDays(t.due_date) : 0
  const task = t.subtasks.find((s) => s.id === openTaskId) || null

  const run = async (fn: () => Promise<PmDeptTask>, fallback: string, onErr: (e: string | string[]) => void = setError) => {
    setBusy(true)
    onErr('')
    try { onChanged(await fn()); return true } catch (err) { onErr(extractErrorMessages(err, fallback)); return false } finally { setBusy(false) }
  }

  // The typed part of the new task / sub-task form survives a refresh (the date limit comes from the milestone, so it is not kept).
  const draft = useFormDraft(form ? `projects-milestone-task-new-${t.id}-${form.parentId ?? 0}` : null,
    form ? { title: form.title, assignee_id: form.assignee_id, due_date: form.due_date } : null,
    (d) => { if (d) setForm((f) => (f ? { ...f, title: d.title ?? '', assignee_id: d.assignee_id ?? '', due_date: d.due_date ?? '' } : f)) })

  const openForm = (parent: PmDeptSubtask | null) => {
    setFormError('')
    setForm({ parentId: parent?.id ?? null, title: '', assignee_id: '', due_date: '', limit: parent ? (parent.due_date || t.due_date) : t.due_date })
    if (!people) loadPeople().then(setPeople).catch((err) => setFormError(extractErrorMessages(err, 'Could not load the people list.')))
  }

  const saveForm = async () => {
    if (!form) return
    const missing: string[] = []
    if (!form.title.trim()) missing.push(form.parentId ? 'Sub-task name is required.' : 'Task name is required.')
    if (!form.assignee_id) missing.push('Pick the person it is assigned to.')
    if (!form.due_date) missing.push('Due date is required.')
    if (missing.length) { setFormError(missing); return }
    const payload = { title: form.title.trim(), assignee_id: Number(form.assignee_id), due_date: form.due_date }
    const ok = await run(
      () => (form.parentId ? pmOngoingApi.addChildSubtask(form.parentId, payload) : pmOngoingApi.addSubtask(t.id, payload)),
      form.parentId ? 'Could not add the sub-task.' : 'Could not create the task.', setFormError,
    )
    if (ok) { draft.clear(); setForm(null) }
  }

  const removeRow = async (s: PmDeptSubtask) => {
    const ok = await run(() => pmOngoingApi.deleteSubtask(s.id), `Could not remove '${s.title}'.`)
    if (ok && s.id === openTaskId) setOpenTaskId(null)
  }

  const doDelete = async () => {
    if (!onDelete) return
    setBusy(true)
    setError('')
    try { await onDelete(t) } catch (err) { setError(extractErrorMessages(err, `Could not delete '${t.title}'.`)) } finally { setBusy(false) }
  }

  return (
    <div>
      {/* Row 1 — title · progress · back */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 20, flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 220px', minWidth: 0 }}>
          <p style={eyebrow}>Milestone</p>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginTop: 2 }}>
            <h2 style={{ fontSize: 22, fontWeight: 700, color: TEXT.heading, margin: 0, lineHeight: 1.25, wordBreak: 'break-word' }}>{t.title}</h2>
            <Pill value={t.status} labels={TASK_LABELS} hex={TASK_HEX} />
          </div>
        </div>
        <div style={{ flex: '1 1 260px', maxWidth: 420, minWidth: 220 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: TEXT.secondary }}>{tasks.length ? `${doneCount} of ${tasks.length} tasks done` : 'No tasks yet'}</span>
            <span style={{ fontSize: 18, fontWeight: 800, color: pct >= 100 ? '#16a34a' : TEXT.heading }}>{pct}%</span>
          </div>
          <Bar value={pct} />
        </div>
        <div style={{ flex: '1 1 120px', display: 'flex', justifyContent: 'flex-end' }}>
          <button type="button" onClick={onBack} style={actionBtn('secondary')}>← Back</button>
        </div>
      </div>
      {t.status === 'cancelled' && t.cancel_reason && <p style={{ fontSize: 12.5, color: TEXT.muted, margin: '8px 0 0' }}>Cancelled: {t.cancel_reason}</p>}
      {open && t.reopen_reason && <p style={{ fontSize: 12.5, color: '#b45309', margin: '8px 0 0' }}>Reopened: {t.reopen_reason}</p>}

      {/* Row 2 — details */}
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', margin: '18px 0' }}>
        <Info label="Given by" value={t.created_by_name || '—'} sub={t.created_at ? `on ${formatDate(t.created_at)}` : undefined} />
        <Info label="Responsible person" value={t.assignee_name || '—'} sub={t.department_name || undefined} />
        <Info label="Expected completion" value={formatDate(t.due_date)} danger={late > 0}
          sub={late > 0 ? `Overdue by ${late} day${late > 1 ? 's' : ''}` : t.status === 'done' && t.completed_at ? `Achieved ${formatDate(t.completed_at)}` : undefined} />
      </div>

      {/* Row 3 — actions */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
        {t.can_plan && <button type="button" disabled={busy} onClick={() => openForm(null)} style={actionBtn('primary', busy)}>+ Create task</button>}
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {t.can_work && open && pmf('milestone_status', 'approve') && <button type="button" disabled={busy} onClick={() => run(() => pmOngoingApi.taskStatus(t.id, { action: 'done' }), `Could not mark '${t.title}' achieved.`)} style={{ ...actionBtn('secondary', busy), color: '#15803d' }}>✓ Mark achieved</button>}
          {t.can_edit && onEdit && pmf('milestones', 'edit') && <button type="button" disabled={busy} onClick={() => onEdit(t)} style={actionBtn('secondary', busy)}>Edit milestone</button>}
          {t.can_edit && t.status === 'done' && pmf('milestone_status', 'edit') && <button type="button" disabled={busy} onClick={() => setReason('reopen')} style={{ ...actionBtn('secondary', busy), color: '#b45309' }}>Reopen</button>}
          {t.can_edit && open && pmf('milestone_status', 'cancel') && <button type="button" disabled={busy} onClick={() => setReason('cancel')} style={actionBtn('secondary', busy)}>Cancel milestone</button>}
          {t.can_delete && onDelete && <button type="button" disabled={busy} onClick={() => setConfirmDelete(true)} style={actionBtn('danger', busy)}>Delete</button>}
        </div>
      </div>
      <ErrorBanner error={error} />

      {/* Tasks */}
      <div style={{ ...card, overflow: 'hidden' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 14px', borderBottom: `1px solid ${BORDER.light}` }}>
          <h3 style={{ fontSize: 14.5, fontWeight: 700, color: TEXT.heading, margin: 0 }}>Tasks <span style={{ color: TEXT.muted, fontWeight: 600 }}>({tasks.length})</span></h3>
          {tasks.length > 0 && <span style={{ fontSize: 12, color: TEXT.muted }}>Click a task to open it</span>}
        </div>
        {tasks.length === 0 ? (
          <div style={{ padding: '32px 16px', textAlign: 'center' }}>
            <p style={{ fontSize: 14, fontWeight: 600, color: TEXT.heading, margin: 0 }}>No tasks yet</p>
            <p style={{ fontSize: 12.5, color: TEXT.muted, margin: '4px 0 12px' }}>Break this milestone into tasks, each with a person and a due date.</p>
            {t.can_plan && <button type="button" disabled={busy} onClick={() => openForm(null)} style={actionBtn('primary', busy)}>+ Create task</button>}
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 640 }}>
              <thead>
                <tr>
                  <th style={{ ...th, width: 44 }}>#<RowCount count={tasks.length} /></th>
                  <th style={th}>Task</th>
                  <th style={th}>Assigned to</th>
                  <th style={th}>Due date</th>
                  <th style={th}>Status</th>
                  <th style={th}>Sub-tasks</th>
                </tr>
              </thead>
              <tbody>
                {tasks.map((s, i) => {
                  const kids = children(s.id)
                  return (
                    <tr key={s.id} onClick={() => { setOpenSubId(null); setOpenTaskId(s.id) }} style={{ cursor: 'pointer', background: s.mine ? 'rgba(99,102,241,0.04)' : undefined }}
                      onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(99,102,241,0.06)' }}
                      onMouseLeave={(e) => { e.currentTarget.style.background = s.mine ? 'rgba(99,102,241,0.04)' : '' }}>
                      <td style={{ ...td, color: TEXT.muted, fontWeight: 600 }}>{i + 1}</td>
                      <td style={td}>
                        <span style={{ fontWeight: 600, color: TEXT.heading, textDecoration: s.status === 'done' ? 'line-through' : 'none' }}>{s.title}</span>
                        {(s.remarks_count > 0 || s.files_count > 0) && (
                          <div style={{ fontSize: 11.5, color: TEXT.muted, marginTop: 2 }}>
                            {[s.remarks_count > 0 ? `💬 ${s.remarks_count}` : '', s.files_count > 0 ? `📎 ${s.files_count}` : ''].filter(Boolean).join('  ')}
                          </div>
                        )}
                      </td>
                      <td style={td}>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                          <Avatar name={s.assignee_name} />
                          <span>{s.mine ? <b style={{ color: '#4f46e5' }}>You</b> : (s.assignee_name || '—')}</span>
                        </span>
                      </td>
                      <td style={{ ...td, whiteSpace: 'nowrap', color: s.is_overdue ? '#dc2626' : TEXT.body, fontWeight: s.is_overdue ? 600 : 400 }}>{formatDate(s.due_date)}</td>
                      <td style={td}>
                        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                          <Pill value={s.status} labels={SUB_LABELS} hex={SUB_HEX} />
                          {s.is_overdue && <FlagPill text="Overdue" color="#dc2626" />}
                        </div>
                      </td>
                      <td style={{ ...td, color: TEXT.muted, whiteSpace: 'nowrap' }}>{kids.length ? `${kids.filter((k) => k.status === 'done').length} / ${kids.length}` : '—'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* A task opened */}
      {task && (() => {
          const kids = children(task.id)
          return (
            <FormSheet width={780} icon="list" title={task.title} subtitle={`Task of milestone '${t.title}'.`} onClose={() => setOpenTaskId(null)} busy={busy}
              footer={<button type="button" onClick={() => setOpenTaskId(null)} disabled={busy} style={sheetBtn('secondary', SHEET.INK, busy)}>Close</button>}>
            <div style={{ padding: '20px 24px' }}>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', marginBottom: 14 }}>
                <Pill value={task.status} labels={SUB_LABELS} hex={SUB_HEX} />
                {task.is_overdue && <FlagPill text="Overdue" color="#dc2626" />}
              </div>

              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 14 }}>
                <Info label="Assigned to" value={<span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}><Avatar name={task.assignee_name} />{task.mine ? 'You' : (task.assignee_name || '—')}</span>} />
                <Info label="Due date" value={formatDate(task.due_date)} danger={task.is_overdue} sub={task.status === 'done' && task.completed_at ? `Done ${formatDate(task.completed_at)}` : undefined} />
                <Info label="Given by" value={task.created_by_name || '—'} sub={task.created_at ? `on ${formatDate(task.created_at)}` : undefined} />
              </div>

              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
                {task.can_toggle && (task.status === 'done'
                  ? <button type="button" disabled={busy} onClick={() => run(() => pmOngoingApi.subtaskStatus(task.id, false), `Could not reopen '${task.title}'.`)} style={actionBtn('secondary', busy)}>Mark not done</button>
                  : <button type="button" disabled={busy} onClick={() => run(() => pmOngoingApi.subtaskStatus(task.id, true), `Could not finish '${task.title}'.`)} style={{ ...actionBtn('primary', busy), background: '#16a34a' }}>✓ Mark done</button>)}
                {task.can_delete && <button type="button" disabled={busy} onClick={() => setRemoveFor(task)} style={{ ...actionBtn('danger', busy), marginLeft: 'auto' }}>Remove task</button>}
              </div>
              <ErrorBanner error={error} />

              {/* Sub-tasks */}
              <div style={{ ...card, marginBottom: 16 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', borderBottom: `1px solid ${BORDER.light}` }}>
                  <h4 style={{ fontSize: 13.5, fontWeight: 700, color: TEXT.heading, margin: 0 }}>Sub-tasks <span style={{ color: TEXT.muted, fontWeight: 600 }}>({kids.length})</span></h4>
                  {task.can_add_child && <button type="button" disabled={busy} onClick={() => openForm(task)} style={linkBtn('#4f46e5', busy)}>+ Add sub-task</button>}
                </div>
                {kids.length === 0 ? (
                  <p style={{ fontSize: 12.5, color: TEXT.muted, margin: 0, padding: '12px 14px' }}>
                    No sub-tasks.{task.can_add_child ? ' Split this task into smaller steps and assign each to a person.' : ''}
                  </p>
                ) : kids.map((k) => (
                  <Fragment key={k.id}>
                    <div onClick={() => setOpenSubId(openSubId === k.id ? null : k.id)} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 14px', borderBottom: `1px solid ${BORDER.light}`, cursor: 'pointer', flexWrap: 'wrap' }}>
                      <span onClick={(e) => e.stopPropagation()}>
                        {k.can_toggle
                          ? <input type="checkbox" checked={k.status === 'done'} disabled={busy} title="Tick when done"
                              onChange={(e) => run(() => pmOngoingApi.subtaskStatus(k.id, e.target.checked), `Could not update '${k.title}'.`)} />
                          : <span style={{ color: k.status === 'done' ? '#16a34a' : TEXT.muted, fontWeight: 700 }}>{k.status === 'done' ? '✓' : '○'}</span>}
                      </span>
                      <span style={{ flex: '1 1 160px', fontSize: 13, fontWeight: 600, color: TEXT.heading, textDecoration: k.status === 'done' ? 'line-through' : 'none' }}>
                        {k.title}
                        {(k.remarks_count > 0 || k.files_count > 0) && <span style={{ fontSize: 11.5, color: TEXT.muted, fontWeight: 400, marginLeft: 8 }}>{[k.remarks_count > 0 ? `💬 ${k.remarks_count}` : '', k.files_count > 0 ? `📎 ${k.files_count}` : ''].filter(Boolean).join('  ')}</span>}
                      </span>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12.5, color: TEXT.secondary }}><Avatar name={k.assignee_name} />{k.mine ? 'You' : (k.assignee_name || '—')}</span>
                      <span style={{ fontSize: 12.5, whiteSpace: 'nowrap', color: k.is_overdue ? '#dc2626' : TEXT.muted }}>Due {formatDate(k.due_date)}</span>
                      {k.can_delete && <button type="button" disabled={busy} onClick={(e) => { e.stopPropagation(); setRemoveFor(k) }} style={linkBtn('#dc2626', busy)}>Remove</button>}
                      <span style={{ color: TEXT.muted, fontSize: 12 }}>{openSubId === k.id ? '▾' : '▸'}</span>
                    </div>
                    {openSubId === k.id && (
                      <div style={{ padding: '4px 14px 12px 40px', borderBottom: `1px solid ${BORDER.light}`, background: '#fafafa' }}>
                        <TaskActivity taskId={t.id} subtaskId={k.id} compact
                          onCounts={(remarks, files) => onChanged({ ...t, subtasks: t.subtasks.map((x) => (x.id === k.id ? { ...x, remarks_count: remarks, files_count: files } : x)) })} />
                      </div>
                    )}
                  </Fragment>
                ))}
              </div>

              {/* Remarks + attachments of the task */}
              <div style={{ ...card, padding: '4px 14px 14px' }}>
                <TaskActivity taskId={t.id} subtaskId={task.id}
                  onCounts={(remarks, files) => onChanged({ ...t, subtasks: t.subtasks.map((x) => (x.id === task.id ? { ...x, remarks_count: remarks, files_count: files } : x)) })} />
              </div>
            </div>
            </FormSheet>
          )
        })()}

      {/* Create a task / a sub-task */}
      {form && (
        <FormSheet width={580} icon="plus" title={form.parentId ? 'Add Sub-task' : 'Create Task'}
          subtitle={form.parentId ? `Part of task '${task?.title || ''}'.` : `Part of milestone '${t.title}'.`} onClose={() => setForm(null)} busy={busy}
          footer={<>
            <button type="button" onClick={() => setForm(null)} disabled={busy} style={sheetBtn('secondary', SHEET.INK, busy)}>Cancel</button>
            <button type="button" onClick={saveForm} disabled={busy} style={sheetBtn('primary', SHEET.BLUE, busy)}><SheetIcon name="plus" size={16} />{busy ? 'Saving…' : form.parentId ? 'Add sub-task' : 'Create task'}</button>
          </>}>
          <div style={{ padding: '20px 24px' }}>
            <DraftBanner draft={draft} />
            <ErrorBanner error={formError} />
            <SheetSection icon="list" title="Basic Information">
              <label style={sheetLabel}>{form.parentId ? 'Sub-task name' : 'Task name'} <Req /></label>
              <input style={sheetInput} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder={form.parentId ? 'e.g. Check frame weld sizes' : 'e.g. Frame drawing'} autoFocus />
            </SheetSection>
            <SheetSection icon="user" title="Assignment & Schedule">
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                <div style={{ flex: '1 1 240px', maxWidth: 340 }}>
                  <label style={sheetLabel}>Assign to <Req /></label>
                  <SearchableSelect value={form.assignee_id} onChange={(v) => setForm({ ...form, assignee_id: v })}
                    options={(people || []).filter((p) => allowAssignee(p.id)).map((p) => ({ value: String(p.id), label: `${p.name}${p.department ? ` — ${p.department}` : p.designation ? ` — ${p.designation}` : ''}` }))}
                    placeholder={people ? 'Search a person…' : 'Loading people…'} />
                </div>
                <div style={{ flex: '0 1 170px', minWidth: 150 }}>
                  <label style={sheetLabel}>Due date <Req /></label>
                  <DateField value={form.due_date} onChange={(v) => setForm({ ...form, due_date: v })} />
                </div>
              </div>
              <p style={sheetHint}>
                {form.limit ? `Must be due by ${formatDate(form.limit)} (the ${form.parentId ? 'task' : 'milestone'}'s date). ` : ''}The person is notified and reminded on the due date. Add remarks and files after opening it.
              </p>
            </SheetSection>
          </div>
        </FormSheet>
      )}

      <PromptDialog
        open={!!reason}
        title={reason === 'reopen' ? 'Reopen milestone' : 'Cancel milestone'}
        message={reason === 'reopen' ? `Why is '${t.title}' being reopened? The responsible person will see this.` : `Why is '${t.title}' being cancelled? Its record is kept.`}
        confirmLabel={reason === 'reopen' ? 'Reopen' : 'Cancel milestone'}
        danger={reason === 'cancel'}
        requireValue
        onConfirm={(v) => { const r = reason; setReason(null); if (r) run(() => pmOngoingApi.taskStatus(t.id, { action: r, reason: v }), `Could not ${r} '${t.title}'.`) }}
        onCancel={() => setReason(null)}
      />
      <ConfirmDialog
        open={confirmDelete}
        title="Delete milestone"
        message={`Delete '${t.title}'? Its tasks, sub-tasks, remarks and files are removed too, and this can't be undone. The deletion is kept in History. To stop the work but keep its record, use Cancel milestone instead.`}
        confirmLabel="Delete milestone"
        danger
        onConfirm={() => { setConfirmDelete(false); doDelete() }}
        onCancel={() => setConfirmDelete(false)}
      />
      <ConfirmDialog
        open={!!removeFor}
        title={removeFor?.parent_id ? 'Remove sub-task' : 'Remove task'}
        message={`Remove '${removeFor?.title}'?${!removeFor?.parent_id && removeFor && children(removeFor.id).length ? ' Its sub-tasks are removed too.' : ''} This is kept in History.`}
        confirmLabel="Remove"
        danger
        onConfirm={() => { const s = removeFor; setRemoveFor(null); if (s) removeRow(s) }}
        onCancel={() => setRemoveFor(null)}
      />
    </div>
  )
}
