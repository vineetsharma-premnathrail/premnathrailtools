'use client'

import { Fragment, useCallback, useEffect, useState } from 'react'
import { pmOngoingApi } from '@/lib/api'
import { PmDeptTask } from '@/types'
import { TEXT, BORDER } from '@/lib/theme'
import { formatDate } from '@/lib/format'
import { extractErrorMessages } from '@/lib/validation'
import DateField from '@/components/erp/DateField'
import SearchableSelect from '@/components/erp/SearchableSelect'
import PromptDialog from '@/components/erp/PromptDialog'
import ConfirmDialog from '@/components/erp/ConfirmDialog'
import TaskActivity from './TaskActivity'
import { useAssigneeFilter } from '@/hooks/useAssigneeFilter'
import MilestoneDetail, { milestonePercent, topTasks } from './MilestoneDetail'
import {
  ErrorBanner, FlagPill, Pill, ProgressBar, TASK_HEX, TASK_LABELS, linkBtn, sectionStyle, tdStyle, thStyle, todayIso, usePmFeature,
} from './pmUi'
import { FileDropZone, FormSheet, Optional, Req, SHEET, SheetIcon, SheetSection, sheetBtn, sheetHint, sheetInput, sheetLabel } from '@/components/shared/FormSheet'
import { RowCount } from '@/components/shared/ui'

type Person = { id: number; name: string; designation?: string | null; department?: string | null }
type SubForm = { task: PmDeptTask; title: string; assignee_id: string; due_date: string; remark: string; files: File[] }
const OPEN = ['todo', 'in_progress', 'blocked']

/** Milestone progress, worked out from the work itself (never typed in):
 * Done = 100 %; otherwise the share of its sub-tasks ticked off; none = 0 %. */
export function taskPercent(t: PmDeptTask): number {
  return milestonePercent(t)
}

/** Project progress = average of its milestones' progress; cancelled ones don't count. */
export function progressOf(tasks: PmDeptTask[]): { percent: number; total: number; done: number; open: number } {
  const live = tasks.filter((t) => t.status !== 'cancelled')
  return {
    percent: live.length ? Math.round(live.reduce((n, t) => n + taskPercent(t), 0) / live.length) : 0,
    total: live.length,
    done: live.filter((t) => t.status === 'done').length,
    open: live.filter((t) => OPEN.includes(t.status)).length,
  }
}

// Everyone a sub-task can go to — loaded once per page.
let peopleCache: Promise<Person[]> | null = null
function loadPeople() {
  if (!peopleCache) peopleCache = pmOngoingApi.everyone().catch((e) => { peopleCache = null; throw e })
  return peopleCache
}

/** One milestone as a card — name, responsible person, expected date,
 * status and task progress; the corner arrow opens it. */
function MilestoneCard({ t, onOpen }: { t: PmDeptTask; onOpen: () => void }) {
  const [hover, setHover] = useState(false)
  const own = topTasks(t)
  const done = own.filter((s) => s.status === 'done').length
  const accent = TASK_HEX[t.status] || '#0f766e'
  return (
    <div role="button" tabIndex={0} onClick={onOpen} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen() } }}
      onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      title="Open milestone"
      style={{
        position: 'relative', overflow: 'hidden', cursor: 'pointer', borderRadius: 10, padding: '20px 20px 16px',
        background: '#f1f5f9', border: `1px solid ${BORDER.light}`, opacity: t.status === 'cancelled' ? 0.6 : 1,
        boxShadow: hover ? '0 10px 24px rgba(15,23,42,0.12)' : '0 1px 2px rgba(15,23,42,0.04)',
        transform: hover ? 'translateY(-2px)' : 'none', transition: 'box-shadow .15s, transform .15s',
      }}>
      <div aria-hidden style={{
        position: 'absolute', top: 0, right: 0, width: hover ? 46 : 40, height: hover ? 46 : 40, background: '#0f766e',
        borderBottomLeftRadius: '100%', display: 'flex', alignItems: 'flex-start', justifyContent: 'flex-end',
        padding: '7px 9px 0 0', color: '#fff', fontSize: 15, fontWeight: 700, transition: 'width .15s, height .15s',
      }}>→</div>
      <h4 style={{ fontSize: 16, fontWeight: 600, color: TEXT.heading, margin: '0 36px 6px 0', lineHeight: 1.3 }}>{t.title}</h4>
      <div style={{ fontSize: 13, color: TEXT.secondary, lineHeight: 1.6 }}>
        <div>Responsible: <b style={{ color: TEXT.body }}>{t.assignee_name || '—'}</b>{t.department_name ? ` · ${t.department_name}` : ''}</div>
        <div>Expected by: <b style={{ color: t.is_overdue ? '#dc2626' : TEXT.body }}>{formatDate(t.due_date)}</b></div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', margin: '10px 0 8px' }}>
        <Pill value={t.status} labels={TASK_LABELS} hex={TASK_HEX} />
        {t.is_overdue && <FlagPill text="Overdue" color="#dc2626" />}
      </div>
      {t.status !== 'cancelled' && <ProgressBar value={taskPercent(t)} width="100%" />}
      <div style={{ fontSize: 12, color: TEXT.muted, marginTop: 4, borderTop: `2px solid ${accent}22`, paddingTop: 6 }}>
        {own.length ? `${done} / ${own.length} tasks done` : 'No tasks yet'}
      </div>
    </div>
  )
}

/** Project milestones as a table; click a row for its details, who gave it,
 * its sub-tasks, remarks and files.
 * - mode "pm" (project's Milestones tab): the project manager edits, cancels
 *   and reopens.
 * - mode "mine" (My Tasks): the owner starts it, splits it into sub-tasks for
 *   anyone and marks it done; each person ticks their own sub-task.
 * Buttons also follow can_* from the server. */
export function DeptTaskTable({ tasks, onChanged, mode, onEdit, onDelete, layout = 'table', openId, onOpen, showDepartment = true, showProject = false }: {
  tasks: PmDeptTask[]
  onChanged: (t: PmDeptTask) => void
  mode: 'pm' | 'mine'
  onEdit?: (t: PmDeptTask) => void
  /** PM mode: deletes the milestone; throws with the server's reason on failure. */
  onDelete?: (t: PmDeptTask) => Promise<void>
  /** 'cards': milestone cards; clicking one opens it (tasks, edit, delete) in place. */
  layout?: 'table' | 'cards'
  /** Cards: the opened milestone, when the page tracks it (null = the card grid). */
  openId?: number | null
  onOpen?: (id: number | null) => void
  showDepartment?: boolean
  showProject?: boolean
}) {
  // Milestone actions: record rules (can_*) AND the role's features (core/features/projects.py).
  const pmf = usePmFeature()
  const [expanded, setExpanded] = useState<Set<number>>(new Set())
  const [openSubs, setOpenSubs] = useState<Set<number>>(new Set())
  const [busy, setBusy] = useState<number | null>(null)
  const [error, setError] = useState<string | string[]>('')
  const [sub, setSub] = useState<SubForm | null>(null)
  const [subError, setSubError] = useState<string | string[]>('')
  const [people, setPeople] = useState<Person[] | null>(null)
  // Role "Assign to" rule (Role & Permissions › Project Management › Overview › Tasks); the server refuses others on save.
  const allowAssignee = useAssigneeFilter('projects:overview.tasks')
  const [reasonFor, setReasonFor] = useState<{ task: PmDeptTask; action: 'reopen' | 'cancel' } | null>(null)
  const [deleteFor, setDeleteFor] = useState<PmDeptTask | null>(null)
  const [innerOpenId, setInnerOpenId] = useState<number | null>(null)
  const selectedId = openId !== undefined ? openId : innerOpenId
  const setSelectedId = onOpen ?? setInnerOpenId

  const doDelete = async (t: PmDeptTask) => {
    if (!onDelete) return
    setBusy(t.id)
    setError('')
    try { await onDelete(t) } catch (err) { setError(extractErrorMessages(err, `Could not delete '${t.title}'.`)) } finally { setBusy(null) }
  }

  const toggle = (id: number) => setExpanded((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n })
  const toggleSub = (id: number) => setOpenSubs((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n })

  const run = async (key: number, fn: () => Promise<PmDeptTask>, fallback: string, onErr = setError) => {
    setBusy(key)
    onErr('')
    try { onChanged(await fn()); return true } catch (err) { onErr(extractErrorMessages(err, fallback)); return false } finally { setBusy(null) }
  }

  const openSub = (t: PmDeptTask) => {
    setSubError('')
    setSub({ task: t, title: '', assignee_id: '', due_date: '', remark: '', files: [] })
    if (!people) loadPeople().then(setPeople).catch((err) => setSubError(extractErrorMessages(err, 'Could not load the people list.')))
  }

  const saveSub = async () => {
    if (!sub) return
    const missing: string[] = []
    if (!sub.title.trim()) missing.push('Task name is required.')
    if (!sub.assignee_id) missing.push('Pick the person who will do it.')
    if (!sub.due_date) missing.push('Due date is required.')
    if (missing.length) { setSubError(missing); return }
    const t = sub.task
    setBusy(t.id)
    setSubError('')
    let created: PmDeptTask
    try {
      created = await pmOngoingApi.addSubtask(t.id, { title: sub.title.trim(), assignee_id: Number(sub.assignee_id), due_date: sub.due_date })
    } catch (err) {
      setSubError(extractErrorMessages(err, 'Could not add the task.'))
      setBusy(null)
      return
    }
    // The new sub-task is the one with the highest id; its remark and files go on it.
    const newSub = created.subtasks.reduce((a, b) => (b.id > a.id ? b : a), created.subtasks[0])
    const problems: string[] = []
    let remarks = 0
    let files = 0
    if (sub.remark.trim()) {
      try { remarks = (await pmOngoingApi.addSubRemark(newSub.id, sub.remark.trim())).remarks.length } catch (err) { problems.push(`The remark was not saved: ${extractErrorMessages(err, 'unknown error')}`) }
    }
    if (sub.files.length) {
      try { files = (await pmOngoingApi.addSubFiles(newSub.id, sub.files)).files.length } catch (err) { problems.push(`The files were not attached: ${extractErrorMessages(err, 'unknown error')}`) }
    }
    onChanged({ ...created, subtasks: created.subtasks.map((x) => (x.id === newSub.id ? { ...x, remarks_count: remarks, files_count: files } : x)) })
    setBusy(null)
    setExpanded((s) => new Set(s).add(t.id))
    setSub(null)
    if (problems.length) setError([`Task '${newSub.title}' was added, but:`, ...problems, 'Open the task to add them again.'])
  }

  const actionsFor = (t: PmDeptTask) => {
    const isBusy = busy === t.id
    const open = OPEN.includes(t.status)
    return mode === 'pm'
                ? <>
                    {t.can_plan && <button type="button" disabled={isBusy} onClick={() => openSub(t)} style={linkBtn('#4f46e5', isBusy)}>+ Task</button>}
                    {t.can_edit && onEdit && pmf('milestones', 'edit') && <button type="button" disabled={isBusy} onClick={() => onEdit(t)} style={linkBtn('#4f46e5', isBusy)}>Edit</button>}
                    {t.status === 'done' && onEdit && t.can_edit && pmf('milestone_status', 'edit') && <button type="button" disabled={isBusy} onClick={() => setReasonFor({ task: t, action: 'reopen' })} style={linkBtn('#b45309', isBusy)}>Reopen</button>}
                    {t.can_edit && open && onEdit && pmf('milestone_status', 'cancel') && <button type="button" disabled={isBusy} onClick={() => setReasonFor({ task: t, action: 'cancel' })} style={linkBtn('#dc2626', isBusy)}>Cancel</button>}
                    {t.can_delete && onDelete && <button type="button" disabled={isBusy} onClick={() => setDeleteFor(t)} style={linkBtn('#991b1b', isBusy)}>Delete</button>}
                  </>
                : <>
                    {t.can_work && t.status === 'todo' && <button type="button" disabled={isBusy} onClick={() => run(t.id, () => pmOngoingApi.taskStatus(t.id, { action: 'start' }), `Could not start '${t.title}'.`)} style={linkBtn('#4f46e5', isBusy)}>Start</button>}
                    {t.can_plan && <button type="button" disabled={isBusy} onClick={() => openSub(t)} style={linkBtn('#4f46e5', isBusy)}>+ Task</button>}
                    {t.can_work && open && pmf('milestone_status', 'approve') && <button type="button" disabled={isBusy} onClick={() => run(t.id, () => pmOngoingApi.taskStatus(t.id, { action: 'done' }), `Could not finish '${t.title}'.`)} style={linkBtn('#16a34a', isBusy)}>Mark done</button>}
                  </>
  }

  const detailFor = (t: PmDeptTask) => {
    const isBusy = busy === t.id
    return (
      <>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 18px', fontSize: 12.5, color: TEXT.secondary, margin: '8px 0' }}>
                          <span>Given by <b style={{ color: TEXT.body }}>{t.created_by_name || '—'}</b>{t.created_at ? ` on ${formatDate(t.created_at)}` : ''}</span>
                          <span>Responsible <b style={{ color: TEXT.body }}>{t.assignee_name || '—'}</b>{t.department_name ? ` (${t.department_name})` : ''}</span>
                          {t.project_code && <span>Project <b style={{ color: TEXT.body }}>{t.project_code}</b> {t.project_name}</span>}
                          <span>Expected by <b style={{ color: t.is_overdue ? '#dc2626' : TEXT.body }}>{formatDate(t.due_date)}</b></span>
                        </div>
                        {t.description && <p style={{ fontSize: 12.5, color: TEXT.body, margin: '0 0 8px', whiteSpace: 'pre-wrap' }}>{t.description}</p>}
                        {t.subtasks.length === 0 ? (
                          <p style={{ fontSize: 12.5, color: TEXT.muted, margin: '6px 0' }}>
                            No tasks yet.{t.can_plan ? ' Use + Task to create the tasks of this milestone, each with a person and a due date. Remarks and attachments go on each task.' : ''}
                          </p>
                        ) : (
                          <>
                          <p style={{ fontSize: 12, color: TEXT.muted, margin: '6px 0 2px' }}>Click a task for its remarks and attachments.</p>
                          <table style={{ width: '100%', borderCollapse: 'collapse', margin: '4px 0' }}>
                            <tbody>
                              {[...t.subtasks].sort((x, y) => ((x.parent_id ?? x.id) - (y.parent_id ?? y.id)) || ((x.parent_id ? 1 : 0) - (y.parent_id ? 1 : 0)) || (x.id - y.id)).map((s) => {
                                const subOpen = openSubs.has(s.id)
                                const cell: React.CSSProperties = { padding: '6px 8px', fontSize: 12.5, borderBottom: subOpen ? 'none' : `1px solid ${BORDER.light}` }
                                return (
                                  <Fragment key={s.id}>
                                    <tr onClick={() => toggleSub(s.id)} style={{ cursor: 'pointer', background: s.mine ? 'rgba(79,70,229,0.05)' : undefined }} title="Click for remarks and attachments">
                                      <td style={{ ...cell, width: 28 }} onClick={(e) => e.stopPropagation()}>
                                        {s.can_toggle
                                          ? <input type="checkbox" checked={s.status === 'done'} disabled={isBusy}
                                              onChange={(e) => run(t.id, () => pmOngoingApi.subtaskStatus(s.id, e.target.checked), `Could not update '${s.title}'.`)}
                                              title="Tick when done" />
                                          : <span style={{ color: s.status === 'done' ? '#16a34a' : TEXT.muted, fontWeight: 700 }}>{s.status === 'done' ? '✓' : '○'}</span>}
                                      </td>
                                      <td style={{ ...cell, color: TEXT.heading, fontWeight: 600 }}>
                                        <span style={{ color: TEXT.muted, fontWeight: 400, marginRight: 6 }}>{subOpen ? '▾' : '▸'}</span>
                                        {s.parent_id ? <span style={{ color: TEXT.muted, fontWeight: 400 }}>↳ </span> : null}<span style={{ textDecoration: s.status === 'done' ? 'line-through' : 'none' }}>{s.title}</span>
                                        {(s.remarks_count > 0 || s.files_count > 0) && (
                                          <span style={{ fontSize: 11.5, color: TEXT.muted, fontWeight: 400, marginLeft: 8 }}>
                                            {[s.remarks_count > 0 ? `${s.remarks_count} remark${s.remarks_count > 1 ? 's' : ''}` : '', s.files_count > 0 ? `${s.files_count} file${s.files_count > 1 ? 's' : ''}` : ''].filter(Boolean).join(' · ')}
                                          </span>
                                        )}
                                      </td>
                                      <td style={{ ...cell, color: TEXT.secondary }}>
                                        {s.mine ? <b style={{ color: '#4f46e5' }}>You</b> : (s.assignee_name || '—')}
                                        {s.created_by_name && <div style={{ fontSize: 11, color: TEXT.muted }}>from {s.created_by_name}</div>}
                                      </td>
                                      <td style={{ ...cell, whiteSpace: 'nowrap', color: s.is_overdue ? '#dc2626' : TEXT.muted }}>{s.due_date ? `Due ${formatDate(s.due_date)}` : ''}</td>
                                      <td style={{ ...cell, textAlign: 'right' }} onClick={(e) => e.stopPropagation()}>
                                        {s.can_delete && <button type="button" disabled={isBusy} onClick={() => run(t.id, () => pmOngoingApi.deleteSubtask(s.id), `Could not remove '${s.title}'.`)} style={linkBtn('#dc2626', isBusy)}>Remove</button>}
                                      </td>
                                    </tr>
                                    {subOpen && (
                                      <tr>
                                        <td style={{ borderBottom: `1px solid ${BORDER.light}` }} />
                                        <td colSpan={4} style={{ padding: '0 8px 10px', borderBottom: `1px solid ${BORDER.light}` }}>
                                          <TaskActivity taskId={t.id} subtaskId={s.id} compact
                                            onCounts={(remarks, files) => onChanged({ ...t, subtasks: t.subtasks.map((x) => (x.id === s.id ? { ...x, remarks_count: remarks, files_count: files } : x)) })} />
                                        </td>
                                      </tr>
                                    )}
                                  </Fragment>
                                )
                              })}
                            </tbody>
                          </table>
                          </>
                        )}
      </>
    )
  }

  const dialogs = (
    <>
      {sub && (
        <FormSheet width={580} icon="plus" title="Add Task" subtitle={`Part of milestone '${sub.task.title}'.`} onClose={() => setSub(null)} busy={busy !== null}
          footer={<>
            <button type="button" onClick={() => setSub(null)} disabled={busy !== null} style={sheetBtn('secondary', SHEET.INK, busy !== null)}>Cancel</button>
            <button type="button" onClick={saveSub} disabled={busy !== null} style={sheetBtn('primary', SHEET.BLUE, busy !== null)}><SheetIcon name="plus" size={16} />{busy !== null ? 'Adding…' : 'Add task'}</button>
          </>}>
          <div style={{ padding: '20px 24px' }}>
            <ErrorBanner error={subError} />
            <SheetSection icon="list" title="Task">
              <label style={sheetLabel}>Task <Req /></label>
              <input style={sheetInput} value={sub.title} onChange={(e) => setSub({ ...sub, title: e.target.value })} placeholder="e.g. Frame drawing" autoFocus />
            </SheetSection>
            <SheetSection icon="user" title="Assignment & Schedule">
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                <div style={{ flex: '1 1 240px', maxWidth: 340 }}>
                  <label style={sheetLabel}>Assigned to <Req /></label>
                  <SearchableSelect value={sub.assignee_id} onChange={(v) => setSub({ ...sub, assignee_id: v })}
                    options={(people || []).filter((p) => allowAssignee(p.id)).map((p) => ({ value: String(p.id), label: `${p.name}${p.department ? ` — ${p.department}` : p.designation ? ` — ${p.designation}` : ''}` }))}
                    placeholder={people ? 'Search a person…' : 'Loading people…'} />
                </div>
                <div style={{ flex: '0 1 170px', minWidth: 150 }}>
                  <label style={sheetLabel}>Due date <Req /></label>
                  <DateField value={sub.due_date} onChange={(v) => setSub({ ...sub, due_date: v })} />
                </div>
              </div>
              <p style={sheetHint}>Milestone expected by {formatDate(sub.task.due_date)} — the task can&apos;t be due later. The person is reminded the day before and on the due date.</p>
            </SheetSection>
            <SheetSection icon="chat" title="Remarks & Attachments" extra={<Optional />}>
              <label style={sheetLabel}>Remarks</label>
              <textarea style={{ ...sheetInput, minHeight: 64, resize: 'vertical' }} value={sub.remark} onChange={(e) => setSub({ ...sub, remark: e.target.value })} placeholder="Instructions for the person — what to do, what to hand back" />
              <label style={{ ...sheetLabel, marginTop: 14 }}>Attachments</label>
              <FileDropZone files={sub.files} onChange={(f) => setSub({ ...sub, files: f })} />
            </SheetSection>
          </div>
        </FormSheet>
      )}

      <PromptDialog
        open={!!reasonFor}
        title={reasonFor?.action === 'reopen' ? 'Reopen milestone' : 'Cancel milestone'}
        message={reasonFor?.action === 'reopen' ? `Why is '${reasonFor?.task.title}' being reopened? Its owner will see this.` : `Why is '${reasonFor?.task.title}' being cancelled?`}
        confirmLabel={reasonFor?.action === 'reopen' ? 'Reopen' : 'Cancel milestone'}
        danger={reasonFor?.action === 'cancel'}
        requireValue
        onConfirm={(v) => { const r = reasonFor; setReasonFor(null); if (r) run(r.task.id, () => pmOngoingApi.taskStatus(r.task.id, { action: r.action, reason: v }), `Could not ${r.action} '${r.task.title}'.`) }}
        onCancel={() => setReasonFor(null)}
      />

      <ConfirmDialog
        open={!!deleteFor}
        title="Delete milestone"
        message={`Delete '${deleteFor?.title}'? Its sub-tasks, remarks and files are removed too, and this can't be undone. The deletion is kept in History. To stop the work but keep its record, use Cancel instead.`}
        confirmLabel="Delete milestone"
        danger
        onConfirm={() => { const t = deleteFor; setDeleteFor(null); if (t) doDelete(t) }}
        onCancel={() => setDeleteFor(null)}
      />
    </>
  )

  if (tasks.length === 0) return null
  if (layout === 'cards') {
    const sel = tasks.find((t) => t.id === selectedId)
    if (sel) {
      return <MilestoneDetail t={sel} onBack={() => setSelectedId(null)} onChanged={onChanged} onEdit={onEdit} onDelete={onDelete} />
    }
    return (
      <div>
        <ErrorBanner error={error} />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))', gap: 14 }}>
          {tasks.map((t) => <MilestoneCard key={t.id} t={t} onOpen={() => setSelectedId(t.id)} />)}
        </div>
        {dialogs}
      </div>
    )
  }

  const cols = ['', 'Milestone', ...(showProject ? ['Project'] : []), ...(showDepartment ? ['Department'] : []),
    mode === 'pm' ? 'Responsible' : 'Given by', mode === 'pm' ? 'Expected by' : 'Due', 'Status', 'Progress', '']

  return (
    <div>
      <ErrorBanner error={error} />
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 760 }}>
          <thead><tr>{cols.map((c, i) => <th key={i} style={{ ...thStyle, ...(i === 0 ? { width: 28, padding: '10px 4px 10px 12px' } : {}) }}>{c}{i === 1 && <RowCount count={tasks.length} />}</th>)}</tr></thead>
          <tbody>
            {tasks.map((t) => {
              const isOpen = expanded.has(t.id)
              const open = OPEN.includes(t.status)
              const subsDone = t.subtasks.filter((s) => s.status === 'done').length
              const actions = actionsFor(t)
              return (
                <Fragment key={t.id}>
                  <tr onClick={() => toggle(t.id)} style={{ cursor: 'pointer', opacity: t.status === 'cancelled' ? 0.55 : 1 }} title="Click for details">
                    <td style={{ ...tdStyle, padding: '10px 4px 10px 12px', color: TEXT.muted }}>{isOpen ? '▾' : '▸'}</td>
                    <td style={tdStyle}>
                      <span style={{ fontWeight: 600, color: TEXT.heading }}>{t.title}</span>
                      {mode === 'mine' && !t.mine && t.has_my_subtask && <div style={{ marginTop: 3 }}><FlagPill text="A task is yours" color="#4f46e5" /></div>}
                      {t.status === 'cancelled' && t.cancel_reason && <div style={{ fontSize: 12, color: TEXT.muted }}>Cancelled: {t.cancel_reason}</div>}
                      {open && t.reopen_reason && <div style={{ fontSize: 12, color: '#b45309' }}>Reopened: {t.reopen_reason}</div>}
                      {(t.remarks_count > 0 || t.files_count > 0) && (
                        <div style={{ fontSize: 11.5, color: TEXT.muted, marginTop: 2 }}>
                          {[t.remarks_count > 0 ? `${t.remarks_count} remark${t.remarks_count > 1 ? 's' : ''}` : '', t.files_count > 0 ? `${t.files_count} file${t.files_count > 1 ? 's' : ''}` : ''].filter(Boolean).join(' · ')}
                        </div>
                      )}
                    </td>
                    {showProject && (
                      <td style={tdStyle}>
                        <span style={{ fontSize: 11.5, fontWeight: 700, color: TEXT.muted, letterSpacing: '.04em' }}>{t.project_code}</span>
                        <div style={{ fontSize: 12.5, color: TEXT.body }}>{t.project_name}</div>
                      </td>
                    )}
                    {showDepartment && <td style={tdStyle}>{t.department_name || '—'}</td>}
                    <td style={tdStyle}>{mode === 'pm' ? (t.assignee_name || '—') : (t.created_by_name || '—')}</td>
                    <td style={{ ...tdStyle, whiteSpace: 'nowrap', color: t.is_overdue ? '#dc2626' : TEXT.body }}>{formatDate(t.due_date)}</td>
                    <td style={tdStyle}>
                      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                        <Pill value={t.status} labels={TASK_LABELS} hex={TASK_HEX} />
                        {t.is_overdue && <FlagPill text="Overdue" color="#dc2626" />}
                      </div>
                    </td>
                    <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>
                      {t.status === 'cancelled' ? '—' : <ProgressBar value={taskPercent(t)} width={80} />}
                      <div style={{ fontSize: 11.5, color: TEXT.muted }}>{t.subtasks.length ? `${subsDone} / ${t.subtasks.length} tasks` : 'No tasks'}</div>
                    </td>
                    <td style={{ ...tdStyle, textAlign: 'right', whiteSpace: 'nowrap' }} onClick={(e) => e.stopPropagation()}>{actions}</td>
                  </tr>
                  {isOpen && (
                    <tr>
                      <td style={{ ...tdStyle, borderTop: 'none', padding: 0 }} />
                      <td colSpan={cols.length - 1} style={{ ...tdStyle, borderTop: 'none', paddingTop: 0, background: 'rgba(0,0,0,0.015)' }}>
                        {detailFor(t)}
                      </td>
                    </tr>
                  )}
                </Fragment>
              )
            })}
          </tbody>
        </table>
      </div>

      {dialogs}
    </div>
  )
}

/** My Tasks — the viewer's own work only: milestones given to them, and
 * milestones where one of the sub-tasks is theirs. Click a row to see who
 * gave it, the details, sub-tasks, remarks and files. */
export default function MyWork() {
  const [rows, setRows] = useState<PmDeptTask[]>([])
  const [loaded, setLoaded] = useState(false)
  const [includeClosed, setIncludeClosed] = useState(false)
  const [error, setError] = useState<string | string[]>('')

  const load = useCallback(async (closed: boolean) => {
    try {
      setRows(await pmOngoingApi.my(closed))
      setError('')
    } catch (err) {
      setError(extractErrorMessages(err, 'Could not load your tasks — reload the page.'))
    } finally {
      setLoaded(true)
    }
  }, [])
  useEffect(() => { Promise.resolve().then(() => load(includeClosed)) }, [load, includeClosed])

  const replace = (t: PmDeptTask) => setRows((rs) => rs.map((x) => (x.id === t.id ? t : x)))
  const owned = rows.filter((t) => t.mine)
  const subOnly = rows.filter((t) => !t.mine && t.has_my_subtask)
  const given = rows.filter((t) => t.given_by_me && !t.mine && !t.has_my_subtask)
  const today = todayIso()
  const openOwned = owned.filter((t) => OPEN.includes(t.status))
  const mySubs = rows.flatMap((t) => t.subtasks.filter((s) => s.mine && s.status !== 'done'))
  const kpis = [
    { label: 'My milestones', value: openOwned.length, color: TEXT.heading },
    { label: 'My sub-tasks', value: mySubs.length, color: TEXT.heading },
    { label: 'Due today', value: openOwned.filter((t) => t.due_date === today).length + mySubs.filter((s) => s.due_date === today).length, color: '#c2410c' },
    { label: 'Overdue', value: openOwned.filter((t) => t.is_overdue).length + mySubs.filter((s) => s.is_overdue).length, color: '#dc2626' },
  ]

  return (
    <div>
      <div data-tour="pm-mt-summary" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12, marginBottom: 14 }}>
        {kpis.map((k) => (
          <div key={k.label} style={{ ...sectionStyle, marginBottom: 0, padding: 14 }}>
            <p style={{ fontSize: 11, fontWeight: 700, color: TEXT.muted, textTransform: 'uppercase', letterSpacing: '.04em', margin: '0 0 4px' }}>{k.label}</p>
            <p style={{ fontSize: 22, fontWeight: 800, color: k.value ? k.color : TEXT.muted, margin: 0 }}>{loaded ? k.value : '…'}</p>
          </div>
        ))}
      </div>
      <ErrorBanner error={error} />

      <div data-tour="pm-mt-list" style={sectionStyle}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
          <div>
            <h2 style={{ fontSize: 16, fontWeight: 700, color: TEXT.heading, margin: 0 }}>Milestones given to me</h2>
            <p style={{ fontSize: 12.5, color: TEXT.muted, margin: '2px 0 0' }}>Start, split into sub-tasks for anyone, and mark done. Click a row for who gave it and the details.</p>
          </div>
          <label data-tour="pm-mt-show-done" style={{ fontSize: 12.5, color: TEXT.secondary, display: 'flex', gap: 6, alignItems: 'center', cursor: 'pointer' }}>
            <input type="checkbox" checked={includeClosed} onChange={(e) => setIncludeClosed(e.target.checked)} /> Show finished
          </label>
        </div>
        {!loaded ? <p style={{ fontSize: 13, color: TEXT.muted, margin: 0 }}>Loading…</p>
          : owned.length === 0
            ? <p style={{ fontSize: 13, color: TEXT.muted, margin: 0 }}>No milestone is with you right now.</p>
            : <DeptTaskTable tasks={owned} onChanged={replace} mode="mine" showProject showDepartment={false} />}
      </div>

      {loaded && subOnly.length > 0 && (
        <div data-tour="pm-mt-subtasks" style={sectionStyle}>
          <h2 style={{ fontSize: 16, fontWeight: 700, color: TEXT.heading, margin: '0 0 2px' }}>Sub-tasks given to me</h2>
          <p style={{ fontSize: 12.5, color: TEXT.muted, margin: '0 0 12px' }}>Open the milestone to tick yours off (highlighted as &quot;You&quot;), add remarks or attach files.</p>
          <DeptTaskTable tasks={subOnly} onChanged={replace} mode="mine" showProject showDepartment={false} />
        </div>
      )}

      {loaded && given.length > 0 && (
        <div data-tour="pm-mt-given" style={sectionStyle}>
          <h2 style={{ fontSize: 16, fontWeight: 700, color: TEXT.heading, margin: '0 0 2px' }}>Milestones I gave</h2>
          <p style={{ fontSize: 12.5, color: TEXT.muted, margin: '0 0 12px' }}>Follow-up: who has each one, its sub-tasks and progress. You are reminded on its due date too.</p>
          <DeptTaskTable tasks={given} onChanged={replace} mode="pm" showProject />
        </div>
      )}
    </div>
  )
}
