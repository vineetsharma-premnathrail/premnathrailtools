'use client'

import Select from '@/components/shared/Select'
import { normalizePriority } from '@/lib/priority'
import { Fragment, useCallback, useEffect, useMemo, useState } from 'react'
import { Calendar, CaretDown, CaretLeft, CaretRight, CaretUp, ChatCircle, Check, Clock, ClockCounterClockwise, Flag, Gear, LinkSimple, ListChecks, MagnifyingGlass, Package, Paperclip, PencilSimple, Plus, Star, Tag, Target, Trash, Truck, User, WarningCircle, X } from '@phosphor-icons/react'
import type { Icon as PhosphorIcon } from '@phosphor-icons/react'
import { pmOngoingApi, projectsApi } from '@/lib/api'
import { PmDeptSubtask, PmDeptTask, PmProject, PmTaskActivity } from '@/types'
import { extractErrorMessages } from '@/lib/validation'
import DateField from '@/components/erp/DateField'
import SearchableSelect from '@/components/erp/SearchableSelect'
import ConfirmDialog from '@/components/erp/ConfirmDialog'
import TaskActivity from './TaskActivity'
import { ErrorBanner, usePmFeature } from './pmUi'
import { useAssigneeFilter } from '@/hooks/useAssigneeFilter'
import { FileDropZone, FormSheet, Optional, Req, SHEET, SheetColumns, SheetIcon, SheetSection, sheetBtn, sheetHint, sheetInput, sheetLabel } from '@/components/shared/FormSheet'
import { chipBtnStyle, RowCount, pillStyle } from '@/components/shared/ui'
import { useFormDraft } from '@/lib/formDraft'
import DraftBanner from '@/components/shared/DraftBanner'

/* ── Look ─────────────────────────────────────────────────────────────── */

const { INK, BODY, MUTED, LINE, SOFT, BLUE } = SHEET
// One colour per milestone, in timeline order (cycles).
const PALETTE = [
  { c: '#2563eb', soft: '#eff6ff', mid: '#dbeafe' },
  { c: '#0284c7', soft: '#f0f9ff', mid: '#e0f2fe' },
  { c: '#16a34a', soft: '#f0fdf4', mid: '#dcfce7' },
  { c: '#f59e0b', soft: '#fffbeb', mid: '#fef3c7' },
  { c: '#7c3aed', soft: '#f5f3ff', mid: '#ede9fe' },
  { c: '#e11d48', soft: '#fff1f2', mid: '#ffe4e6' },
  { c: '#0d9488', soft: '#f0fdfa', mid: '#ccfbf1' },
]
const colorOf = (i: number) => PALETTE[i % PALETTE.length]
// Colours / icons a milestone can be given (backend PM_MILESTONE_COLORS / PM_MILESTONE_ICONS).
const MS_ICONS = ['flag', 'target', 'star', 'gear', 'truck', 'box', 'check', 'calendar', 'clip', 'user'] as const
// Every icon has its own colour — picking the icon gives the milestone that colour.
const ICON_COLOR: Record<typeof MS_ICONS[number], string> = {
  flag: '#2563eb', target: '#e11d48', star: '#f59e0b', gear: '#0284c7', truck: '#ea580c',
  box: '#7c3aed', check: '#16a34a', calendar: '#0d9488', clip: '#475569', user: '#db2777',
}
const ICON_LABEL: Record<typeof MS_ICONS[number], string> = {
  flag: 'Milestone', target: 'Goal', star: 'Key', gear: 'Engineering', truck: 'Dispatch',
  box: 'Material', check: 'Approval', calendar: 'Event', clip: 'Documents', user: 'People',
}
const addDays = (iso: string, n: number) => {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number)
  const t = new Date(Date.UTC(y, m - 1, d + n))
  return t.toISOString().slice(0, 10)
}
const tint = (c: string) => ({ c, soft: `${c}0f`, mid: `${c}29` })
/** A milestone's colour: the one picked on the form, else the palette by timeline position. */
const colOf = (m: { color?: string | null } | null | undefined, i: number) => (m?.color ? tint(m.color) : colorOf(i))
const msIcon = (m: { icon?: string | null } | null | undefined): IconName => ((m?.icon && (MS_ICONS as readonly string[]).includes(m.icon)) ? m.icon as IconName : 'flag')
const PRIORITY: Record<string, { text: string; c: string; bg: string }> = {
  standard: { text: 'Standard', c: '#475569', bg: '#f1f5f9' },
  urgent: { text: 'Urgent', c: '#be123c', bg: '#ffe4e6' },
}
const SUB_STATUS = [['todo', 'To Do'], ['in_progress', 'In Progress'], ['on_hold', 'On Hold'], ['done', 'Done']] as const

const card: React.CSSProperties = { background: '#fff', border: `1px solid ${LINE}`, borderRadius: 14, boxShadow: '0 1px 3px rgba(15,23,42,0.05)' }
const th: React.CSSProperties = { textAlign: 'left', padding: '10px 12px', fontSize: 11.5, fontWeight: 600, color: MUTED, borderBottom: `1px solid ${LINE}`, background: SOFT, whiteSpace: 'nowrap' }
const td: React.CSSProperties = { padding: '11px 12px', fontSize: 13, color: BODY, borderBottom: `1px solid ${LINE}`, verticalAlign: 'middle' }

// The shared sheet buttons, plus a 'danger' look the kit doesn't have.
function btn(kind: 'primary' | 'secondary' | 'danger' | 'ghost', color = BLUE, disabled = false): React.CSSProperties {
  if (kind === 'danger') return { ...sheetBtn('secondary', color, disabled), border: '1px solid #fecdd3', background: '#fff1f2', color: '#be123c' }
  return sheetBtn(kind, color, disabled)
}

type IconName = 'flag' | 'check' | 'plus' | 'calendar' | 'user' | 'search' | 'x' | 'edit' | 'up' | 'down' | 'left' | 'right' | 'list' | 'clip' | 'clock' | 'alert' | 'target' | 'trash'
  | 'star' | 'gear' | 'truck' | 'box' | 'tag' | 'link' | 'history' | 'chat'
function Icon({ name, size = 16, color = 'currentColor' }: { name: IconName; size?: number; color?: string }) {
  const p: Record<IconName, PhosphorIcon> = {
    flag: Flag, check: Check, plus: Plus, calendar: Calendar, user: User, search: MagnifyingGlass, x: X, edit: PencilSimple,
    up: CaretUp, down: CaretDown, left: CaretLeft, right: CaretRight, list: ListChecks, clip: Paperclip, clock: Clock,
    alert: WarningCircle, target: Target, trash: Trash, star: Star, gear: Gear, truck: Truck, box: Package, tag: Tag,
    link: LinkSimple, history: ClockCounterClockwise, chat: ChatCircle,
  }
  const Glyph = p[name]
  return <Glyph size={size} color={color} aria-hidden style={{ flexShrink: 0 }} />
}

/* ── Helpers ──────────────────────────────────────────────────────────── */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
function fmt(iso?: string | null, withYear = true) {
  if (!iso) return '—'
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number)
  if (!y || !m || !d) return '—'
  return `${String(d).padStart(2, '0')} ${MONTHS[m - 1]}${withYear ? ` ${y}` : ''}`
}
function daysFromToday(iso?: string | null) {
  if (!iso) return null
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number)
  const now = new Date()
  return Math.round((Date.UTC(y, m - 1, d) - Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())) / 86400000)
}
function dueText(iso?: string | null, done = false) {
  if (done) return 'Achieved'
  const n = daysFromToday(iso)
  if (n === null) return ''
  if (n < 0) return `Overdue by ${-n} day${n === -1 ? '' : 's'}`
  if (n === 0) return 'Due today'
  return `${n} day${n === 1 ? '' : 's'} left`
}
const initials = (name?: string | null) => (name || '?').split(' ').filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase()
const AV_COLORS = ['#2563eb', '#16a34a', '#db2777', '#7c3aed', '#ea580c', '#0891b2']
function Avatar({ name, size = 28 }: { name?: string | null; size?: number }) {
  const c = AV_COLORS[(name || '').length % AV_COLORS.length]
  return <span title={name || ''} style={{ width: size, height: size, borderRadius: '50%', background: `${c}1a`, color: c, border: `1px solid ${c}33`, fontSize: size * 0.38, fontWeight: 700, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{initials(name)}</span>
}

const tasksOf = (m: PmDeptTask) => m.subtasks.filter((s) => !s.parent_id)
const kidsOf = (m: PmDeptTask, id: number) => m.subtasks.filter((s) => s.parent_id === id)
// Milestone progress counts ALL its tasks (the server sends the totals — a person only sees their own tasks).
const msTotal = (m: PmDeptTask) => m.tasks_total ?? tasksOf(m).length
const msDone = (m: PmDeptTask) => m.tasks_done ?? tasksOf(m).filter((s) => s.status === 'done').length
function msPercent(m: PmDeptTask) {
  if (m.status === 'done') return 100
  return msTotal(m) ? Math.round(msDone(m) * 100 / msTotal(m)) : 0
}
function taskPercent(m: PmDeptTask, s: PmDeptSubtask) {
  if (s.status === 'done') return 100
  if (typeof s.progress === 'number') return s.progress
  const k = kidsOf(m, s.id)
  return k.length ? Math.round(k.filter((x) => x.status === 'done').length * 100 / k.length) : 0
}
type TaskState = 'completed' | 'in_progress' | 'pending' | 'overdue' | 'on_hold'
function taskState(m: PmDeptTask, s: PmDeptSubtask): TaskState {
  if (s.status === 'done') return 'completed'
  if (s.is_overdue) return 'overdue'
  if (s.status === 'on_hold') return 'on_hold'
  return s.status === 'in_progress' || kidsOf(m, s.id).some((k) => k.status === 'done') ? 'in_progress' : 'pending'
}
const STATE: Record<TaskState, { text: string; c: string; bg: string }> = {
  completed: { text: 'Completed', c: '#15803d', bg: '#dcfce7' },
  in_progress: { text: 'In Progress', c: '#1d4ed8', bg: '#dbeafe' },
  pending: { text: 'To Do', c: '#475569', bg: '#f1f5f9' },
  overdue: { text: 'Overdue', c: '#be123c', bg: '#ffe4e6' },
  on_hold: { text: 'On Hold', c: '#b45309', bg: '#fef3c7' },
}
const MS_STATE: Record<string, { text: string; c: string; bg: string }> = {
  todo: { text: 'Not Started', c: '#475569', bg: '#f1f5f9' },
  in_progress: { text: 'In Progress', c: '#1d4ed8', bg: '#dbeafe' },
  blocked: { text: 'On Hold', c: '#b45309', bg: '#fef3c7' },
  done: { text: 'Achieved', c: '#15803d', bg: '#dcfce7' },
  cancelled: { text: 'Cancelled', c: '#78716c', bg: '#f5f5f4' },
}
function Chip({ text, c, bg, dot = false }: { text: string; c: string; bg: string; dot?: boolean }) {
  return <span style={{ ...pillStyle(c), gap: 5, background: bg, fontSize: 11.5, fontWeight: 600 }}>{dot && <span style={{ width: 6, height: 6, borderRadius: '50%', background: c }} />}{text}</span>
}
function Bar({ value, color = BLUE, height = 8 }: { value: number; color?: string; height?: number }) {
  const v = Math.max(0, Math.min(100, value || 0))
  return (
    <div style={{ height, borderRadius: 999, background: '#e2e8f0', overflow: 'hidden', width: '100%' }}>
      <div style={{ width: `${v}%`, height: '100%', borderRadius: 999, background: v >= 100 ? '#16a34a' : color, transition: 'width .3s' }} />
    </div>
  )
}
/** SheetSection with this page's own icon set — only for the 'target' icon, which the shared kit lacks. */
function TargetSection({ title, children, color = BLUE }: { title: string; children: React.ReactNode; color?: string }) {
  return (
    <div style={{ marginBottom: 22 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <Icon name="target" size={18} color={color} />
        <h4 style={{ fontSize: 15, fontWeight: 700, color: INK, margin: 0 }}>{title}</h4>
      </div>
      {children}
    </div>
  )
}

type Person = { id: number; name: string; designation?: string | null; department?: string | null }
let peopleCache: Promise<Person[]> | null = null
function loadPeople() {
  if (!peopleCache) peopleCache = pmOngoingApi.everyone().catch((e) => { peopleCache = null; throw e })
  return peopleCache
}
const personLabel = (p: Person) => `${p.name}${p.department ? ` — ${p.department}` : p.designation ? ` — ${p.designation}` : ''}`

type MsForm = {
  id?: number; title: string; description: string; assignee_id: string; start_date: string; due_date: string
  status: string; blocker_reason: string; color: string; icon: string; co_owner_ids: string[]
}
type TaskForm = {
  msId: number; id?: number; parentId?: number | null; title: string; description: string; assignee_id: string; collaborator_ids: string[]
  start_date: string; due_date: string; priority: string; status: string
  labels: string[]; checklist: string[]; files: File[]
}

/* ── Page ─────────────────────────────────────────────────────────────── */

type MyView = 'given' | 'subs' | 'gave'
// My Tasks: which of the viewer's milestones a tab shows (one milestone, one tab).
const MY_VIEWS: { k: MyView; t: string; help: string; test: (m: PmDeptTask) => boolean }[] = [
  { k: 'given', t: 'Given to me', help: 'Milestones you are responsible for — split them into tasks and mark them achieved.', test: (m) => !!m.mine },
  { k: 'subs', t: 'My tasks in others’ milestones', help: 'Milestones someone else gave, where a task is yours — open it to work your task.', test: (m) => !m.mine && !!m.has_my_subtask && !m.given_by_me },
  { k: 'gave', t: 'Milestones I gave', help: 'Follow-up: who has each one, its tasks and progress.', test: (m) => !!m.given_by_me && !m.mine },
]

/** Project Plan & Milestones: a timeline of the project's milestones, each
 * with one responsible person and an expected achievable date. Open a
 * milestone to work its tasks; open a task for its sub-tasks, remarks and
 * files. The person a task is assigned to can split it into sub-tasks.
 * Without a project it is My Tasks: the viewer's milestones across every
 * project, in the same design (tabs: given to me / my tasks / I gave). */
export default function ProjectPlan({ project }: { project?: PmProject }) {
  const mineMode = !project
  const [rows, setRows] = useState<PmDeptTask[]>([])
  const [includeClosed, setIncludeClosed] = useState(false)
  const [myView, setMyView] = useState<MyView | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState<string | string[]>('')
  const [people, setPeople] = useState<Person[] | null>(null)
  // Role "Assign to" rules (Role & Permissions › Project Management › Overview) — the server refuses others on save.
  const allowOwner = useAssigneeFilter('projects:overview.milestones')
  const allowAssignee = useAssigneeFilter('projects:overview.tasks')
  const [selId, setSelId] = useState<number | null>(null)
  const [taskId, setTaskId] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [msForm, setMsForm] = useState<MsForm | null>(null)
  const [taskForm, setTaskForm] = useState<TaskForm | null>(null)
  const [formError, setFormError] = useState<string | string[]>('')
  // New milestone / new task (or sub-task) forms survive a refresh; they are filled back in when the Add button is pressed again.
  const msDraft = useFormDraft(msForm && !msForm.id ? `projects-plan-milestone-new-${project?.id ?? 0}` : null, msForm,
    (d) => { if (d) setMsForm({ ...d, co_owner_ids: d.co_owner_ids ?? [] }) })
  const taskDraft = useFormDraft(taskForm && !taskForm.id ? `projects-plan-task-new-${project?.id ?? 0}-${taskForm.msId}-${taskForm.parentId ?? 0}` : null, taskForm,
    (d) => { if (d) setTaskForm({ ...d, collaborator_ids: d.collaborator_ids ?? [], labels: d.labels ?? [], checklist: d.checklist?.length ? d.checklist : [''], files: [] }) })
  const [reason, setReasonState] = useState<{ m: PmDeptTask; action: 'reopen' | 'cancel' } | null>(null)
  const [reasonText, setReasonText] = useState('')
  const [reasonError, setReasonError] = useState<string | string[]>('')
  const setReason = (r: { m: PmDeptTask; action: 'reopen' | 'cancel' } | null) => { setReasonState(r); setReasonText(''); setReasonError('') }
  const [delMs, setDelMs] = useState<PmDeptTask | null>(null)
  const [delTask, setDelTask] = useState<{ m: PmDeptTask; s: PmDeptSubtask } | null>(null)
  const pmf = usePmFeature()
  // Projects › Overview › Milestones › Create (core/features/projects.py) on top of the PM rule.
  const canAdd = !!project && project.can_manage && !['closed', 'cancelled'].includes(project.status) && pmf('milestones', 'create')

  const projectId = project?.id
  const load = useCallback(() => {
    (projectId ? projectsApi.projectTasks(projectId) : pmOngoingApi.my(includeClosed))
      .then((d: PmDeptTask[]) => { setRows(Array.isArray(d) ? d : []); setError('') })
      .catch((err) => setError(extractErrorMessages(err, mineMode ? 'Could not load your tasks — reload the page.' : 'Could not load the milestones — reload the page.')))
      .finally(() => setLoaded(true))
  }, [projectId, includeClosed, mineMode])
  useEffect(() => { load() }, [load])
  const needPeople = () => { if (!people) loadPeople().then(setPeople).catch((err) => setFormError(extractErrorMessages(err, 'Could not load the people list.'))) }

  // My Tasks: the open tab (the first one with milestones until the user picks one).
  const viewCounts = Object.fromEntries(MY_VIEWS.map((v) => [v.k, rows.filter(v.test).length])) as Record<MyView, number>
  const view: MyView = myView ?? MY_VIEWS.find((v) => viewCounts[v.k] > 0)?.k ?? 'given'
  const viewDef = MY_VIEWS.find((v) => v.k === view)!
  // Timeline order: by expected date; cancelled ones last.
  const ms = useMemo(() => (mineMode ? rows.filter(viewDef.test) : [...rows]).sort((a, b) =>
    (a.status === 'cancelled' ? 1 : 0) - (b.status === 'cancelled' ? 1 : 0) || (a.due_date || '9999').localeCompare(b.due_date || '9999') || a.id - b.id), [rows, mineMode, viewDef])
  const sel = ms.find((m) => m.id === selId) || null
  const replace = (m: PmDeptTask) => setRows((rs) => rs.map((x) => (x.id === m.id ? m : x)))

  const live = ms.filter((m) => m.status !== 'cancelled')
  const allTasks = live.flatMap((m) => tasksOf(m).map((s) => ({ m, s })))
  const stats = {
    total: allTasks.length,
    done: allTasks.filter(({ s }) => s.status === 'done').length,
    pending: allTasks.filter(({ s }) => s.status !== 'done').length,
    overdue: allTasks.filter(({ s }) => s.status !== 'done' && s.is_overdue).length,
  }
  const overall = live.length ? Math.round(live.reduce((n, m) => n + msPercent(m), 0) / live.length) : 0

  const run = async (fn: () => Promise<PmDeptTask>, fallback: string, onErr: (e: string | string[]) => void = setError) => {
    setBusy(true)
    onErr('')
    try { replace(await fn()); return true } catch (err) { onErr(extractErrorMessages(err, fallback)); return false } finally { setBusy(false) }
  }

  /* Reopen / cancel a milestone — the reason is required; errors stay in the popup. */
  const submitReason = async () => {
    const r = reason
    if (!r) return
    const v = reasonText.trim()
    if (!v) { setReasonError(`Say why '${r.m.title}' is being ${r.action === 'reopen' ? 'reopened' : 'cancelled'}.`); return }
    if (await run(() => pmOngoingApi.taskStatus(r.m.id, { action: r.action, reason: v }), `Could not ${r.action} '${r.m.title}'.`, setReasonError)) setReason(null)
  }

  /* Milestone create / edit */
  // New milestone starts the day after the last one ends; the first one on
  // the project's start date (never before today). Editable on the form.
  const suggestedStart = () => {
    const today = new Date().toISOString().slice(0, 10)
    const ends = rows.filter((x) => x.status !== 'cancelled' && x.due_date).map((x) => x.due_date as string).sort()
    const base = ends.length ? addDays(ends[ends.length - 1], 1) : (project?.start_date || today)
    return base > today ? base : today
  }
  const openMs = (m?: PmDeptTask) => {
    setFormError('')
    setMsForm(m
      ? { id: m.id, title: m.title, description: m.description || '', assignee_id: m.assignee_id ? String(m.assignee_id) : '', start_date: m.start_date || '',
          due_date: m.due_date || '', status: m.status, blocker_reason: m.blocker_reason || '', color: m.color || '', icon: m.icon || '', co_owner_ids: (m.co_owner_ids || []).map(String) }
      : { title: '', description: '', assignee_id: '', start_date: suggestedStart(), due_date: '', status: 'todo', blocker_reason: '', color: ICON_COLOR.flag, icon: 'flag', co_owner_ids: [] })
    needPeople()
  }
  const saveMs = async () => {
    if (!msForm) return
    const missing: string[] = []
    if (!msForm.title.trim()) missing.push('Milestone name is required.')
    if (!msForm.due_date) missing.push('Expected achievable date is required.')
    if (!msForm.assignee_id) missing.push('Pick the person responsible for the milestone.')
    if (msForm.start_date && msForm.due_date && msForm.start_date > msForm.due_date) missing.push('Start date is after the end date.')
    if (msForm.status === 'blocked' && !msForm.blocker_reason.trim()) missing.push('Say why the milestone is on hold.')
    if (missing.length) { setFormError(missing); return }
    setBusy(true)
    setFormError('')
    const formStatus = ['todo', 'in_progress', 'blocked'].includes(msForm.status) ? msForm.status : undefined
    const payload = {
      title: msForm.title.trim(), description: msForm.description.trim() || null, assignee_id: Number(msForm.assignee_id),
      start_date: msForm.start_date || null, due_date: msForm.due_date, status: formStatus, blocker_reason: msForm.blocker_reason.trim() || null,
      color: msForm.color || null, icon: msForm.icon || null,
      co_owner_ids: msForm.co_owner_ids.filter((x) => x !== msForm.assignee_id).map(Number),
    }
    // My Tasks has no project of its own: a milestone is edited in its project (created only inside one).
    const pid = project?.id ?? rows.find((x) => x.id === msForm.id)?.project_id
    if (!pid) { setFormError('This milestone has no project — open it from its project to change it.'); setBusy(false); return }
    try {
      const saved: PmDeptTask = msForm.id ? await projectsApi.editProjectTask(pid, msForm.id, payload) : await projectsApi.createProjectTask(pid, payload)
      if (msForm.id) replace(saved)
      else { msDraft.clear(); setRows((rs) => [...rs, saved]); setSelId(saved.id); setTaskId(null) }
      setMsForm(null)
    } catch (err) {
      setFormError(extractErrorMessages(err, 'Could not save the milestone.'))
    } finally { setBusy(false) }
  }
  const deleteMs = async (m: PmDeptTask) => {
    setBusy(true)
    setError('')
    try {
      await projectsApi.deleteProjectTask(project?.id ?? m.project_id, m.id)
      setRows((rs) => rs.filter((x) => x.id !== m.id))
      if (selId === m.id) { setSelId(null); setTaskId(null) }
    } catch (err) { setError(extractErrorMessages(err, `Could not delete '${m.title}'.`)) } finally { setBusy(false) }
  }

  /* Task create / edit (also sub-tasks) */
  const openTask = (m: PmDeptTask, opts: { task?: PmDeptSubtask; parent?: PmDeptSubtask } = {}) => {
    setFormError('')
    const t = opts.task
    setTaskForm({
      msId: m.id, id: t?.id, parentId: opts.parent?.id ?? t?.parent_id ?? null, title: t?.title || '', description: t?.description || '',
      assignee_id: t?.assignee_id ? String(t.assignee_id) : '', collaborator_ids: (t?.collaborator_ids || []).map(String),
      start_date: t?.start_date || '', due_date: t?.due_date || '', priority: normalizePriority(t?.priority), status: t?.status || 'todo',
      labels: t?.labels || [], checklist: [''], files: [],
    })
    needPeople()
  }
  const saveTask = async () => {
    const f = taskForm
    if (!f) return
    const m = rows.find((x) => x.id === f.msId)
    if (!m) { setTaskForm(null); return }
    const what = f.parentId ? 'Sub-task' : 'Task'
    const missing: string[] = []
    if (!f.title.trim()) missing.push(`${what} name is required.`)
    if (!f.assignee_id) missing.push('Pick the person it is assigned to.')
    if (!f.due_date) missing.push('Due date is required.')
    if (f.start_date && f.due_date && f.start_date > f.due_date) missing.push('Start date is after the due date.')
    if (missing.length) { setFormError(missing); return }
    setBusy(true)
    setFormError('')
    const payload = {
      title: f.title.trim(), description: f.description.trim() || null, assignee_id: Number(f.assignee_id),
      collaborator_ids: f.collaborator_ids.map(Number), start_date: f.start_date || null, due_date: f.due_date,
      priority: f.priority, status: f.status, labels: f.labels,
    }
    let saved: PmDeptTask
    try {
      saved = f.id ? await pmOngoingApi.editSubtask(f.id, payload)
        : f.parentId ? await pmOngoingApi.addChildSubtask(f.parentId, payload)
          : await pmOngoingApi.addSubtask(m.id, payload)
    } catch (err) {
      setFormError(extractErrorMessages(err, `Could not save the ${what.toLowerCase()}.`))
      setBusy(false)
      return
    }
    replace(saved)
    if (!f.id) taskDraft.clear()
    // New task: its checklist, first remark and files go on it now.
    const problems: string[] = []
    if (!f.id) {
      const before = new Set(m.subtasks.map((s) => s.id))
      const created = saved.subtasks.find((s) => !before.has(s.id))
      if (created) {
        for (const item of f.checklist.map((c) => c.trim()).filter(Boolean)) {
          try { saved = await pmOngoingApi.addChildSubtask(created.id, { title: item }) } catch (err) { problems.push(`Checklist item '${item}': ${extractErrorMessages(err, 'not added')}`) }
        }
        if (f.files.length) {
          try { await pmOngoingApi.addSubFiles(created.id, f.files) } catch (err) { problems.push(`Files: ${extractErrorMessages(err, 'not attached')}`) }
          try { saved = await pmOngoingApi.task(m.id) } catch { /* counts refresh on next load */ }
        }
        replace(saved)
      }
    }
    setBusy(false)
    setTaskForm(null)
    if (problems.length) setError([`'${f.title.trim()}' was saved, but:`, ...problems, 'Open the task to add them again.'])
  }

  const formMs = taskForm ? rows.find((x) => x.id === taskForm.msId) : null
  const formParent = taskForm?.parentId && formMs ? formMs.subtasks.find((s) => s.id === taskForm.parentId) : null
  const formLimit = formParent ? (formParent.due_date || formMs?.due_date) : formMs?.due_date
  // People already on the record stay listed so the current value still shows.
  const optsFor = (allow: (id: number) => boolean, keep: string[]) =>
    (people || []).filter((p) => allow(p.id) || keep.includes(String(p.id))).map((p) => ({ value: String(p.id), label: personLabel(p) }))
  const ownerOpts = msForm ? optsFor(allowOwner, [msForm.assignee_id, ...msForm.co_owner_ids]) : []
  const assigneeOpts = taskForm ? optsFor(allowAssignee, [taskForm.assignee_id, ...taskForm.collaborator_ids]) : []
  const personName = (id: string) => people?.find((p) => String(p.id) === id)?.name

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'stretch', gap: 16, flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 320px' }}>
          <h2 style={{ fontSize: 26, fontWeight: 800, color: INK, margin: 0, letterSpacing: '-0.01em' }}>{project ? <>Project Plan &amp; Milestones</> : 'My Tasks'}</h2>
          <p style={{ fontSize: 14, color: MUTED, margin: '4px 0 0' }}>{project
            ? `${project.project_code} · ${project.name} — ${live.length} milestone${live.length === 1 ? '' : 's'}`
            : viewDef.help}</p>
        </div>
        {ms.length > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: '0 1 240px', minWidth: 180, alignSelf: 'center' }} title="Overall progress of the live milestones">
            <span style={{ fontSize: 12, fontWeight: 600, color: MUTED, whiteSpace: 'nowrap' }}>Progress</span>
            <Bar value={overall} height={6} />
            <span style={{ fontSize: 13, fontWeight: 700, color: INK }}>{overall}%</span>
          </div>
        )}
        {canAdd && (
          <div style={{ display: 'flex', alignItems: 'center' }}>
            <button type="button" data-tour="pm-tasks-add-btn" onClick={() => openMs()} style={btn('primary', BLUE)}><Icon name="plus" size={16} /> Add Milestone</button>
          </div>
        )}
      </div>
      {mineMode && (
        <div data-tour="pm-mt-list" style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', borderBottom: `1px solid ${LINE}` }}>
          {MY_VIEWS.map((v) => (
            <button key={v.k} type="button" onClick={() => { setMyView(v.k); setSelId(null); setTaskId(null) }}
              style={{ ...tabStyle(view === v.k, BLUE), display: 'inline-flex', alignItems: 'center', gap: 7 }}>
              {v.t}
              <span style={{ ...pillStyle(MUTED), fontSize: 11.5, padding: '1px 8px', background: view === v.k ? '#dbeafe' : SOFT, color: view === v.k ? BLUE : MUTED }}>{loaded ? viewCounts[v.k] : '…'}</span>
            </button>
          ))}
          <label data-tour="pm-mt-show-done" style={{ marginLeft: 'auto', fontSize: 12.5, color: BODY, display: 'flex', gap: 6, alignItems: 'center', cursor: 'pointer', paddingBottom: 6 }}>
            <input type="checkbox" checked={includeClosed} onChange={(e) => { setIncludeClosed(e.target.checked); setSelId(null); setTaskId(null) }} /> Show finished
          </label>
        </div>
      )}
      <ErrorBanner error={error} />
      {!loaded && <p style={{ fontSize: 13.5, color: MUTED, margin: 0 }}>{mineMode ? 'Loading your milestones and tasks…' : 'Loading the milestones…'}</p>}

      {loaded && !error && ms.length === 0 && mineMode && (
        <div style={{ ...card, padding: '40px 20px', textAlign: 'center' }}>
          <span style={{ display: 'inline-flex', width: 56, height: 56, borderRadius: 16, background: '#eff6ff', alignItems: 'center', justifyContent: 'center' }}><Icon name="flag" size={28} color={BLUE} /></span>
          <h3 style={{ fontSize: 18, fontWeight: 700, color: INK, margin: '12px 0 4px' }}>Nothing here right now</h3>
          <p style={{ fontSize: 13.5, color: MUTED, margin: 0 }}>{view === 'given' ? 'No milestone is with you.' : view === 'subs' ? 'No task of yours in anyone else’s milestone.' : 'You haven’t given any milestone that is still open.'}{includeClosed ? '' : ' Tick “Show finished” to see finished ones.'}</p>
        </div>
      )}

      {loaded && !error && ms.length === 0 && !mineMode && (
        <div style={{ ...card, padding: '48px 20px', textAlign: 'center' }}>
          <span style={{ display: 'inline-flex', width: 56, height: 56, borderRadius: 16, background: '#eff6ff', alignItems: 'center', justifyContent: 'center' }}><Icon name="flag" size={28} color={BLUE} /></span>
          <h3 style={{ fontSize: 18, fontWeight: 700, color: INK, margin: '12px 0 4px' }}>No milestones yet</h3>
          <p style={{ fontSize: 13.5, color: MUTED, margin: '0 0 16px' }}>Lay out the project as milestones — each with a responsible person and an expected date — then add tasks inside each one.</p>
          {canAdd && <button type="button" onClick={() => openMs()} style={btn('primary', BLUE)}><Icon name="plus" size={16} /> Add Milestone</button>}
        </div>
      )}

      {ms.length > 0 && (
        <>
          {/* Timeline */}
          <div data-tour="pm-tasks-table" style={{ ...card, padding: '18px 8px 14px', overflowX: 'auto' }}>
            <div style={{ display: 'flex', minWidth: ms.length * 170, position: 'relative' }}>
              <div style={{ position: 'absolute', left: `${50 / ms.length}%`, right: `${50 / ms.length}%`, top: 78, height: 4, borderRadius: 4,
                background: ms.length > 1 ? `linear-gradient(90deg, ${ms.map((x, i) => colOf(x, i).c).join(', ')})` : colOf(ms[0], 0).c }} />
              {ms.map((m, i) => {
                const col = colOf(m, i)
                const active = m.id === selId
                const done = m.status === 'done'
                return (
                  <button key={m.id} type="button" onClick={() => { setSelId(active ? null : m.id); setTaskId(null) }}
                    style={{ flex: 1, minWidth: 170, background: 'none', border: 'none', cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '0 6px', fontFamily: 'inherit', opacity: m.status === 'cancelled' ? 0.5 : 1 }}>
                    <span style={{ padding: '7px 12px', borderRadius: 10, background: active ? col.mid : SOFT, border: `1px solid ${active ? col.c : LINE}`, textAlign: 'center', maxWidth: '100%', minHeight: 50, boxSizing: 'border-box' }}>
                      <span style={{ display: 'block', fontSize: 13, fontWeight: 700, color: INK, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 160 }}>{m.title}</span>
                      <span style={{ display: 'block', fontSize: 12, color: m.is_overdue ? '#be123c' : BODY, marginTop: 2 }}>{fmt(m.due_date)}</span>
                    </span>
                    <span style={{ height: 14, borderLeft: `2px dotted ${col.c}`, margin: '0 0 1px' }} />
                    <span style={{ width: 22, height: 22, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', zIndex: 1 }}>
                      {done
                        ? <span style={{ width: 22, height: 22, borderRadius: '50%', background: col.c, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 0 0 4px #fff' }}><Icon name="check" size={13} color="#fff" /></span>
                        : <span style={{ width: active ? 18 : 15, height: active ? 18 : 15, transform: 'rotate(45deg)', borderRadius: 3, background: col.c, boxShadow: `0 0 0 4px #fff, 0 0 0 ${active ? 7 : 5}px ${col.c}33` }} />}
                    </span>
                  </button>
                )
              })}
            </div>
          </div>

          {/* Overview cards, or the opened milestone */}
          {!sel ? (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 14 }}>
              {ms.map((m, i) => <MilestoneCard key={m.id} m={m} n={i + 1} col={colOf(m, i)} showProject={mineMode} onOpen={() => { setSelId(m.id); setTaskId(null) }} />)}
            </div>
          ) : (
            <MilestonePanel
              m={sel} n={ms.indexOf(sel) + 1} col={colOf(sel, ms.indexOf(sel))} busy={busy} showProject={mineMode}
              taskId={taskId} setTaskId={setTaskId}
              onClose={() => { setSelId(null); setTaskId(null) }}
              onEdit={() => openMs(sel)}
              onAchieve={() => run(() => pmOngoingApi.taskStatus(sel.id, { action: 'done' }), `Could not mark '${sel.title}' achieved.`)}
              onReason={(action) => setReason({ m: sel, action })}
              onDelete={() => setDelMs(sel)}
              onAddTask={(parent) => openTask(sel, { parent })}
              onEditTask={(task) => openTask(sel, { task })}
              onRemoveTask={(s) => setDelTask({ m: sel, s })}
              onToggle={(s, done) => run(() => pmOngoingApi.subtaskStatus(s.id, done), `Could not update '${s.title}'.`)}
              onCounts={(id, remarks, files) => replace({ ...sel, subtasks: sel.subtasks.map((x) => (x.id === id ? { ...x, remarks_count: remarks, files_count: files } : x)) })}
              onStatus={(s, status) => run(() => pmOngoingApi.editSubtask(s.id, { status }), `Could not change the status of '${s.title}'.`)}
              onAddChecklist={(task, title) => run(() => pmOngoingApi.addChildSubtask(task.id, { title }), `Could not add '${title}' to the checklist.`)}
            />
          )}

          {/* The other milestones, collapsed */}
          {sel && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {ms.map((m, i) => m.id === sel.id ? null : (
                // ui-audit-ignore-next-line custom-button — whole milestone summary row (card), not a pill button
                <button key={m.id} type="button" onClick={() => { setSelId(m.id); setTaskId(null) }}
                  style={{ ...card, display: 'flex', alignItems: 'center', gap: 14, padding: '11px 16px', cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit', flexWrap: 'wrap', opacity: m.status === 'cancelled' ? 0.55 : 1 }}>
                  <span style={{ width: 26, height: 26, borderRadius: '50%', background: colOf(m, i).c, color: '#fff', fontSize: 12.5, fontWeight: 700, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>{i + 1}</span>
                  <span style={{ flex: '1 1 180px', fontSize: 14, fontWeight: 600, color: INK }}>{m.title}</span>
                  <span style={{ flex: '0 1 130px', fontSize: 13, color: BODY }}>{fmt(m.due_date)}</span>
                  <span style={{ flex: '1 1 160px', maxWidth: 220 }}><Bar value={msPercent(m)} color={colOf(m, i).c} /></span>
                  <span style={{ fontSize: 13, fontWeight: 700, color: INK, width: 44 }}>{msPercent(m)}%</span>
                  <span style={{ fontSize: 12.5, color: MUTED, width: 80 }}>{msDone(m)} / {msTotal(m)} Tasks</span>
                  <Icon name="down" size={16} color={MUTED} />
                </button>
              ))}
            </div>
          )}

          {/* Totals */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 12 }}>
            {[
              { n: stats.total, t: 'Total Tasks', icon: 'list' as IconName, c: BLUE },
              { n: stats.done, t: 'Completed', icon: 'check' as IconName, c: '#16a34a' },
              { n: stats.pending, t: 'Pending', icon: 'clock' as IconName, c: '#0284c7' },
              { n: stats.overdue, t: 'Overdue', icon: 'alert' as IconName, c: '#e11d48' },
            ].map((x) => (
              <div key={x.t} style={{ ...card, padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 12 }}>
                <span style={{ width: 40, height: 40, borderRadius: '50%', background: x.c, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}><Icon name={x.icon} size={20} color="#fff" /></span>
                <div>
                  <div style={{ fontSize: 24, fontWeight: 800, color: INK, lineHeight: 1 }}>{x.n}</div>
                  <div style={{ fontSize: 12.5, color: MUTED, marginTop: 3 }}>{x.t}</div>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {/* Create / edit milestone */}
      {msForm && (
      <FormSheet icon="flag" iconColor={BLUE} title={msForm.id ? 'Edit Milestone' : 'Create Milestone'} subtitle={msForm.id ? 'Change the milestone details.' : 'Add a new milestone to your project plan.'}
        onClose={() => setMsForm(null)} busy={busy}
        footer={<>
          <button type="button" onClick={() => setMsForm(null)} disabled={busy} style={sheetBtn('secondary', INK, busy)}>Cancel</button>
          <button type="button" onClick={saveMs} disabled={busy} style={sheetBtn('primary', '#16a34a', busy)}><SheetIcon name={msForm.id ? 'check' : 'plus'} size={16} />{busy ? 'Saving…' : msForm.id ? 'Save Milestone' : 'Create Milestone'}</button>
        </>}>
        {(() => {
          const col = msForm.color ? tint(msForm.color) : colorOf(msForm.id ? ms.findIndex((x) => x.id === msForm.id) : ms.length)
          const days = daysFromToday(msForm.due_date)
          const editingClosed = !!msForm.id && !['todo', 'in_progress', 'blocked'].includes(msForm.status)
          return (
            <SheetColumns left={<>
                <DraftBanner draft={msDraft} />
                <ErrorBanner error={formError} />
                <SheetSection icon="list" title="Basic Information">
                  <label style={sheetLabel}>Milestone Name <Req /></label>
                  <input style={sheetInput} value={msForm.title} onChange={(e) => setMsForm({ ...msForm, title: e.target.value })} placeholder="Enter milestone name (e.g. Design release, Testing, Dispatch)" autoFocus />
                  <label style={{ ...sheetLabel, marginTop: 14 }}>Description</label>
                  <textarea style={{ ...sheetInput, minHeight: 72, resize: 'vertical' }} value={msForm.description} onChange={(e) => setMsForm({ ...msForm, description: e.target.value })}
                    placeholder="What 'achieved' means for this milestone — the deliverable or completion criteria" />
                </SheetSection>
                <SheetSection icon="calendar" title="Schedule">
                  <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
                    <div style={{ flex: '1 1 160px' }}>
                      <label style={sheetLabel}>Start Date <span style={{ color: MUTED, fontWeight: 400 }}>(auto — change if needed)</span></label>
                      <DateField value={msForm.start_date} onChange={(v) => setMsForm({ ...msForm, start_date: v })} />
                    </div>
                    <div style={{ flex: '1 1 160px' }}>
                      <label style={sheetLabel}>End Date <Req /></label>
                      <DateField value={msForm.due_date} onChange={(v) => setMsForm({ ...msForm, due_date: v })} />
                    </div>
                    <div style={{ flex: '0 1 120px' }}>
                      <label style={sheetLabel}>From today</label>
                      <div style={{ ...sheetInput, background: SOFT, color: days !== null && days < 0 ? '#be123c' : BODY }}>{days === null ? '—' : days < 0 ? `${-days} days ago` : `${days} days`}</div>
                    </div>
                  </div>
                  <p style={sheetHint}>End date = the expected achievable date. Tasks can&apos;t start before the start date or be due after the end date.</p>
                </SheetSection>
                <TargetSection title="Status">
                  {editingClosed ? (
                    <div style={{ ...sheetInput, background: SOFT }}>{(MS_STATE[msForm.status] || MS_STATE.todo).text} — use Reopen on the milestone to change it.</div>
                  ) : (
                    <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                      <div style={{ flex: '0 1 200px' }}>
                        <Select style={sheetInput} value={msForm.status} onChange={(e) => setMsForm({ ...msForm, status: e.target.value })}>
                          <option value="todo">Not Started</option>
                          <option value="in_progress">In Progress</option>
                          <option value="blocked">On Hold</option>
                        </Select>
                      </div>
                      {msForm.status === 'blocked' && (
                        <div style={{ flex: '1 1 220px' }}>
                          <input style={sheetInput} value={msForm.blocker_reason} onChange={(e) => setMsForm({ ...msForm, blocker_reason: e.target.value })} placeholder="Why is it on hold? *" />
                        </div>
                      )}
                    </div>
                  )}
                  <p style={sheetHint}>Achieved and Cancelled are set with the buttons on the milestone.</p>
                </TargetSection>
                <SheetSection icon="user" title="Responsibility">
                  <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                    <div style={{ flex: '1 1 220px' }}>
                      <label style={sheetLabel}>Responsible Person <Req /></label>
                      <SearchableSelect value={msForm.assignee_id} onChange={(v) => setMsForm({ ...msForm, assignee_id: v, co_owner_ids: msForm.co_owner_ids.filter((x) => x !== v) })} options={ownerOpts} placeholder={people ? 'Search a person…' : 'Loading people…'} />
                    </div>
                    <div style={{ flex: '1 1 220px' }}>
                      <label style={sheetLabel}>More Responsible People <span style={{ color: MUTED, fontWeight: 400 }}>(optional)</span></label>
                      <MultiPick values={msForm.co_owner_ids} onChange={(v) => setMsForm({ ...msForm, co_owner_ids: v })}
                        options={ownerOpts.filter((o) => o.value !== msForm.assignee_id)} placeholder="Add a person…" />
                    </div>
                  </div>
                  <p style={sheetHint}>Everyone here is notified, sees it in My Tasks, can add its tasks and mark it achieved, and is reminded on the date. The first person&apos;s department is shown on the milestone.</p>
                </SheetSection>
              </>} right={<>
                <SheetSection icon="star" title="Icons" color={col.c}>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 8 }}>
                    {MS_ICONS.map((ic) => {
                      const c = ICON_COLOR[ic]
                      const on = msForm.icon === ic
                      return (
                        // ui-audit-ignore-next-line custom-button — icon swatch tile in the milestone icon picker, not a pill button
                        <button key={ic} type="button" aria-label={ICON_LABEL[ic]} aria-pressed={on} title={ICON_LABEL[ic]} onClick={() => setMsForm({ ...msForm, icon: ic, color: c })}
                          style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, padding: '8px 2px', borderRadius: 12, cursor: 'pointer', fontFamily: 'inherit',
                            border: `1.5px solid ${on ? c : 'transparent'}`, background: on ? `${c}14` : 'transparent', boxShadow: on ? `0 4px 12px ${c}26` : 'none' }}>
                          <span style={{ width: 38, height: 38, borderRadius: 11, background: on ? c : `${c}1a`, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
                            <Icon name={ic} size={19} color={on ? '#fff' : c} />
                          </span>
                        </button>
                      )
                    })}
                  </div>
                  <p style={{ fontSize: 12, color: MUTED, margin: '8px 0 0' }}>The icon&apos;s colour becomes the milestone&apos;s colour on the timeline and cards.</p>
                </SheetSection>
                <TargetSection title="Preview" color={col.c}>
                  <div style={{ borderRadius: 14, background: col.soft, border: `1px solid ${col.mid}`, padding: 14 }}>
                    <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                      <span style={{ width: 32, height: 32, borderRadius: 9, background: col.c, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><Icon name={msIcon(msForm)} size={17} color="#fff" /></span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 15, fontWeight: 700, color: INK, wordBreak: 'break-word' }}>{msForm.title.trim() || 'Milestone Name'}</div>
                        <div style={{ fontSize: 12, color: BODY, marginTop: 2 }}>{msForm.start_date ? `${fmt(msForm.start_date)} → ` : 'By '}{msForm.due_date ? fmt(msForm.due_date) : '—'}</div>
                      </div>
                      <Chip text={(MS_STATE[msForm.status] || MS_STATE.todo).text} c={(MS_STATE[msForm.status] || MS_STATE.todo).c} bg={(MS_STATE[msForm.status] || MS_STATE.todo).bg} dot />
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12 }}>
                      <Avatar name={personName(msForm.assignee_id) || '?'} size={24} />
                      <span style={{ fontSize: 12.5, color: BODY }}>{[personName(msForm.assignee_id) || 'Responsible person', ...msForm.co_owner_ids.filter((x) => x !== msForm.assignee_id).map((x) => personName(x)).filter(Boolean)].join(', ')}</span>
                    </div>
                  </div>
                </TargetSection>
                <p style={{ fontSize: 12.5, color: MUTED, margin: 0 }}>Attachments and remarks go on the milestone&apos;s tasks.</p>
              </>} />
          )
        })()}
      </FormSheet>
      )}

      {/* Create / edit task or sub-task */}
      {taskForm && (
      <FormSheet icon="check" iconColor={BLUE}
        title={taskForm.id ? (taskForm.parentId ? 'Edit Sub-task' : 'Edit Task') : taskForm.parentId ? 'Add Sub-task' : 'Create Task'}
        subtitle={taskForm.parentId ? `Part of task '${formParent?.title || ''}'.` : 'Add a task under this milestone and assign it.'}
        onClose={() => setTaskForm(null)} busy={busy}
        footer={<>
          <button type="button" onClick={() => setTaskForm(null)} disabled={busy} style={sheetBtn('secondary', INK, busy)}>Cancel</button>
          <button type="button" onClick={saveTask} disabled={busy} style={sheetBtn('primary', BLUE, busy)}><SheetIcon name={taskForm.id ? 'check' : 'plus'} size={16} />{busy ? 'Saving…' : taskForm.id ? 'Save' : taskForm.parentId ? 'Add Sub-task' : 'Create Task'}</button>
        </>}>
        {formMs && (
          <SheetColumns left={<>
              <DraftBanner draft={taskDraft} />
              <ErrorBanner error={formError} />
              <SheetSection icon="list" title="Basic Information">
                <label style={sheetLabel}>{taskForm.parentId ? 'Sub-task' : 'Task'} Name <Req /></label>
                <input style={sheetInput} value={taskForm.title} onChange={(e) => setTaskForm({ ...taskForm, title: e.target.value })} placeholder="Enter task name (e.g. Frame GA drawing)" autoFocus />
                <label style={{ ...sheetLabel, marginTop: 14 }}>Description</label>
                <textarea style={{ ...sheetInput, minHeight: 72, resize: 'vertical' }} value={taskForm.description} onChange={(e) => setTaskForm({ ...taskForm, description: e.target.value })} placeholder="What to do, what to hand back, anything they should know…" />
                <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 12 }}>
                  <div style={{ flex: '1 1 180px' }}><label style={sheetLabel}>Project</label><div style={{ ...sheetInput, background: SOFT }}>{project?.name ?? formMs.project_name ?? formMs.project_code ?? '—'}</div></div>
                  <div style={{ flex: '1 1 180px' }}><label style={sheetLabel}>Milestone</label><div style={{ ...sheetInput, background: SOFT, display: 'flex', alignItems: 'center', gap: 8 }}><span style={{ width: 10, height: 10, transform: 'rotate(45deg)', borderRadius: 2, background: colOf(formMs, ms.findIndex((x) => x.id === formMs.id)).c }} />{formMs.title}</div></div>
                </div>
                {formParent && <p style={{ fontSize: 12.5, color: MUTED, margin: '8px 0 0' }}>Parent task: <b style={{ color: INK }}>{formParent.title}</b></p>}
              </SheetSection>
              <SheetSection icon="user" title="Assignment">
                <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                  <div style={{ flex: '1 1 220px' }}>
                    <label style={sheetLabel}>Assignee <Req /></label>
                    <SearchableSelect value={taskForm.assignee_id} onChange={(v) => setTaskForm({ ...taskForm, assignee_id: v, collaborator_ids: taskForm.collaborator_ids.filter((x) => x !== v) })} options={assigneeOpts} placeholder={people ? 'Search a person…' : 'Loading people…'} />
                  </div>
                  <div style={{ flex: '1 1 220px' }}>
                    <label style={sheetLabel}>Collaborators</label>
                    <MultiPick values={taskForm.collaborator_ids} onChange={(v) => setTaskForm({ ...taskForm, collaborator_ids: v })}
                      options={assigneeOpts.filter((o) => o.value !== taskForm.assignee_id)} placeholder="Add a person…" />
                  </div>
                </div>
                <p style={sheetHint}>The assignee owns it. Collaborators are notified, see it in My Tasks and can add comments and files.</p>
              </SheetSection>
              <SheetSection icon="calendar" title="Schedule & Status">
                <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                  <div style={{ flex: '1 1 150px' }}><label style={sheetLabel}>Start Date</label><DateField value={taskForm.start_date} onChange={(v) => setTaskForm({ ...taskForm, start_date: v })} /></div>
                  <div style={{ flex: '1 1 150px' }}><label style={sheetLabel}>Due Date <Req /></label><DateField value={taskForm.due_date} onChange={(v) => setTaskForm({ ...taskForm, due_date: v })} /></div>
                </div>
                {formLimit && <p style={sheetHint}>Must be due by {fmt(formLimit)} — the {formParent ? 'task' : 'milestone'}&apos;s date.</p>}
                <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 12 }}>
                  <div style={{ flex: '1 1 130px' }}>
                    <label style={sheetLabel}>Priority</label>
                    <Select style={sheetInput} value={taskForm.priority} onChange={(e) => setTaskForm({ ...taskForm, priority: e.target.value })}>
                      {Object.entries(PRIORITY).map(([k, v]) => <option key={k} value={k}>{v.text}</option>)}
                    </Select>
                  </div>
                  <div style={{ flex: '1 1 140px' }}>
                    <label style={sheetLabel}>Status</label>
                    <Select style={sheetInput} value={taskForm.status} onChange={(e) => setTaskForm({ ...taskForm, status: e.target.value })}>
                      {SUB_STATUS.map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                    </Select>
                  </div>
                </div>
              </SheetSection>
            </>} right={<>
              <SheetSection icon="tag" title="Labels / Tags" extra={<Optional />}>
                <LabelInput labels={taskForm.labels} onChange={(labels) => setTaskForm({ ...taskForm, labels })} />
              </SheetSection>
              {!taskForm.id && !taskForm.parentId && (
                <SheetSection icon="list" title="Checklist" extra={<Optional />}>
                  {taskForm.checklist.map((c, i) => (
                    <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
                      <span style={{ width: 16, height: 16, borderRadius: 4, border: `1.5px solid ${LINE}`, flexShrink: 0 }} />
                      <input style={{ ...sheetInput, padding: '8px 10px' }} value={c} placeholder={`Checklist item ${i + 1}…`}
                        onChange={(e) => setTaskForm({ ...taskForm, checklist: taskForm.checklist.map((x, j) => (j === i ? e.target.value : x)) })} />
                      {taskForm.checklist.length > 1 && <button type="button" aria-label="Remove" onClick={() => setTaskForm({ ...taskForm, checklist: taskForm.checklist.filter((_, j) => j !== i) })} style={btn('ghost', MUTED)}><Icon name="x" size={14} /></button>}
                    </div>
                  ))}
                  <button type="button" onClick={() => setTaskForm({ ...taskForm, checklist: [...taskForm.checklist, ''] })} style={btn('secondary')}><Icon name="plus" size={14} /> Add item</button>
                  <p style={{ fontSize: 11.5, color: MUTED, margin: '6px 0 0' }}>Steps to tick off — they belong to this task&apos;s assignee and due date.</p>
                </SheetSection>
              )}
              {!taskForm.id && (
                <SheetSection icon="clip" title="Attachments" extra={<Optional />}>
                  <FileDropZone files={taskForm.files} onChange={(files) => setTaskForm({ ...taskForm, files })} />
                </SheetSection>
              )}
            </>} />
        )}
      </FormSheet>
      )}

      {reason && (
        <FormSheet width={580} icon={reason.action === 'reopen' ? 'undo' : 'x'} iconColor={reason.action === 'reopen' ? '#b45309' : '#e11d48'}
          title={reason.action === 'reopen' ? 'Reopen milestone' : 'Cancel milestone'} subtitle={`Milestone '${reason.m.title}'`}
          onClose={() => setReason(null)} busy={busy}
          footer={<>
            <button type="button" onClick={() => setReason(null)} disabled={busy} style={sheetBtn('secondary', INK, busy)}>Close</button>
            <button type="button" onClick={submitReason} disabled={busy || !reasonText.trim()} style={sheetBtn('primary', reason.action === 'reopen' ? '#b45309' : '#e11d48', busy || !reasonText.trim())}>
              <SheetIcon name={reason.action === 'reopen' ? 'undo' : 'x'} size={16} />{busy ? 'Saving…' : reason.action === 'reopen' ? 'Reopen' : 'Cancel milestone'}
            </button>
          </>}>
          <div style={{ padding: '20px 24px' }}>
            <ErrorBanner error={reasonError} />
            <label style={sheetLabel}>{reason.action === 'reopen' ? 'Why is it being reopened?' : 'Why is it being cancelled?'} <Req /></label>
            <textarea style={{ ...sheetInput, minHeight: 80, resize: 'vertical' }} value={reasonText} onChange={(e) => setReasonText(e.target.value)} autoFocus
              placeholder={reason.action === 'reopen' ? 'e.g. Customer rejected the drawing — revision needed' : 'e.g. Scope dropped by the customer'} />
            <p style={sheetHint}>{reason.action === 'reopen' ? 'The responsible person will see this.' : 'Its record is kept.'}</p>
          </div>
        </FormSheet>
      )}
      <ConfirmDialog
        open={!!delMs}
        title="Delete milestone"
        message={`Delete '${delMs?.title}'? Its tasks, sub-tasks, remarks and files are removed too, and this can't be undone. The deletion is kept in History. To stop the work but keep its record, use Cancel instead.`}
        confirmLabel="Delete milestone"
        danger
        onConfirm={() => { const m = delMs; setDelMs(null); if (m) deleteMs(m) }}
        onCancel={() => setDelMs(null)}
      />
      <ConfirmDialog
        open={!!delTask}
        title={delTask?.s.parent_id ? 'Remove sub-task' : 'Remove task'}
        message={`Remove '${delTask?.s.title}'?${delTask && !delTask.s.parent_id && kidsOf(delTask.m, delTask.s.id).length ? ' Its checklist is removed too.' : ''} This is kept in History.`}
        confirmLabel="Remove"
        danger
        onConfirm={async () => {
          const d = delTask
          setDelTask(null)
          if (d && await run(() => pmOngoingApi.deleteSubtask(d.s.id), `Could not remove '${d.s.title}'.`) && taskId === d.s.id) setTaskId(null)
        }}
        onCancel={() => setDelTask(null)}
      />
    </div>
  )
}

/* ── Pieces ───────────────────────────────────────────────────────────── */

/** Pick several values from a long list: a searchable select adds, chips remove. */
function MultiPick({ values, onChange, options, placeholder }: { values: string[]; onChange: (v: string[]) => void; options: { value: string; label: string }[]; placeholder: string }) {
  const byValue = new Map(options.map((o) => [o.value, o.label]))
  return (
    <div>
      {values.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 6 }}>
          {values.map((v) => (
            <span key={v} style={{ ...pillStyle('#1d4ed8'), gap: 4, fontSize: 12, fontWeight: 500, padding: '4px 8px 4px 10px', background: '#eff6ff', maxWidth: '100%', whiteSpace: 'normal' }}>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{byValue.get(v) || `#${v}`}</span>
              <button type="button" aria-label="Remove" onClick={() => onChange(values.filter((x) => x !== v))} style={{ border: 'none', background: 'none', cursor: 'pointer', padding: 0, color: '#1d4ed8', display: 'inline-flex' }}><Icon name="x" size={12} /></button>
            </span>
          ))}
        </div>
      )}
      <SearchableSelect value="" onChange={(v) => { if (v && !values.includes(v)) onChange([...values, v]) }}
        options={options.filter((o) => !values.includes(o.value))} placeholder={placeholder} />
    </div>
  )
}

/** Free-text labels: type and press Enter (or comma). */
function LabelInput({ labels, onChange }: { labels: string[]; onChange: (l: string[]) => void }) {
  const [text, setText] = useState('')
  const add = () => {
    const t = text.trim().replace(/,$/, '').trim()
    if (t && !labels.some((l) => l.toLowerCase() === t.toLowerCase()) && labels.length < 10) onChange([...labels, t.slice(0, 30)])
    setText('')
  }
  return (
    <div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: labels.length ? 6 : 0 }}>
        {labels.map((l) => (
          <span key={l} style={{ ...pillStyle('#6d28d9'), gap: 4, fontSize: 12, fontWeight: 500, padding: '4px 8px 4px 10px', background: '#f5f3ff' }}>
            {l}
            <button type="button" aria-label={`Remove ${l}`} onClick={() => onChange(labels.filter((x) => x !== l))} style={{ border: 'none', background: 'none', cursor: 'pointer', padding: 0, color: '#6d28d9', display: 'inline-flex' }}><Icon name="x" size={12} /></button>
          </span>
        ))}
      </div>
      <input style={sheetInput} value={text} onChange={(e) => setText(e.target.value)} onBlur={add} placeholder={labels.length >= 10 ? 'At most 10 labels' : 'Type a label and press Enter'}
        disabled={labels.length >= 10} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); add() } }} />
    </div>
  )
}

function MilestoneCard({ m, n, col, onOpen, showProject = false }: { m: PmDeptTask; n: number; col: typeof PALETTE[number]; onOpen: () => void; showProject?: boolean }) {
  const [hover, setHover] = useState(false)
  const ts = tasksOf(m)
  const pct = msPercent(m)
  const st = MS_STATE[m.status] || MS_STATE.todo
  return (
    <div role="button" tabIndex={0} onClick={onOpen} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen() } }}
      onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      style={{ background: col.soft, border: `1px solid ${hover ? col.c : col.mid}`, borderRadius: 16, padding: 18, cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 12,
        boxShadow: hover ? `0 12px 28px ${col.c}22` : 'none', transform: hover ? 'translateY(-2px)' : 'none', transition: 'all .15s', opacity: m.status === 'cancelled' ? 0.6 : 1 }}>
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
        <span style={{ width: 34, height: 34, borderRadius: '50%', background: col.c, color: '#fff', fontWeight: 700, fontSize: 15, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{n}</span>
        <div style={{ minWidth: 0 }}>
          {showProject && <div style={{ fontSize: 11.5, fontWeight: 700, color: col.c, letterSpacing: '.03em', marginBottom: 2 }}>{m.project_code}{m.project_name ? ` · ${m.project_name}` : ''}</div>}
          <div style={{ fontSize: 16.5, fontWeight: 700, color: INK, lineHeight: 1.25, wordBreak: 'break-word' }}>{m.title}</div>
          <div style={{ fontSize: 13, color: m.is_overdue ? '#be123c' : BODY, marginTop: 4 }}>{m.start_date ? `${fmt(m.start_date, false)} → ${fmt(m.due_date)}` : `Due ${fmt(m.due_date)}`}</div>
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <Chip text={st.text} c={st.c} bg={st.bg} dot />
        {m.is_overdue && <Chip text={dueText(m.due_date)} c="#be123c" bg="#ffe4e6" />}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 7, minHeight: 60 }}>
        {ts.length === 0 && <span style={{ fontSize: 13, color: MUTED }}>No tasks yet — open to add tasks.</span>}
        {ts.slice(0, 5).map((s) => (
          <span key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13.5, color: BODY }}>
            <span style={{ width: 18, height: 18, borderRadius: '50%', background: s.status === 'done' ? col.c : '#fff', border: `1.5px solid ${col.c}`, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{s.status === 'done' && <Icon name="check" size={11} color="#fff" />}</span>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.title}</span>
          </span>
        ))}
        {ts.length > 5 && <span style={{ fontSize: 12.5, color: col.c, fontWeight: 600 }}>+{ts.length - 5} more</span>}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}><Bar value={pct} color={col.c} /><span style={{ fontSize: 12.5, fontWeight: 700, color: INK }}>{pct}%</span></div>
      <div style={{ background: col.mid, borderRadius: 12, padding: '10px 12px', display: 'flex', gap: 10, alignItems: 'center', marginTop: 'auto' }}>
        <Icon name={msIcon(m)} size={18} color={col.c} />
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: INK }}>Responsible</div>
          <div style={{ fontSize: 13, color: BODY, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.assignee_name || '—'}{m.department_name ? ` · ${m.department_name}` : ''}</div>
        </div>
      </div>
    </div>
  )
}

type Filter = 'all' | 'completed' | 'pending'

function MilestonePanel(props: {
  m: PmDeptTask; n: number; col: typeof PALETTE[number]; busy: boolean; showProject?: boolean
  taskId: number | null; setTaskId: (id: number | null) => void
  onClose: () => void; onEdit: () => void; onAchieve: () => void; onReason: (a: 'reopen' | 'cancel') => void; onDelete: () => void
  onAddTask: (parent?: PmDeptSubtask) => void; onEditTask: (s: PmDeptSubtask) => void; onRemoveTask: (s: PmDeptSubtask) => void
  onToggle: (s: PmDeptSubtask, done: boolean) => void; onCounts: (id: number, remarks: number, files: number) => void
  onStatus: (s: PmDeptSubtask, status: string) => void
  onAddChecklist: (task: PmDeptSubtask, title: string) => void
}) {
  const { m, n, col, busy, taskId, setTaskId } = props
  const pmf = usePmFeature()
  const [filter, setFilter] = useState<Filter>('all')
  const [q, setQ] = useState('')
  const ts = tasksOf(m)
  const doneN = ts.filter((s) => s.status === 'done').length
  const pct = msPercent(m)
  const st = MS_STATE[m.status] || MS_STATE.todo
  const open = ['todo', 'in_progress', 'blocked'].includes(m.status)
  const shown = ts.filter((s) => (filter === 'all' || (filter === 'completed' ? s.status === 'done' : s.status !== 'done')) && (!q.trim() || s.title.toLowerCase().includes(q.trim().toLowerCase())))
  const task = ts.find((s) => s.id === taskId) || null
  // Milestone actions: the server's record rules (can_*) AND the role's features.
  const mayAchieve = m.can_work && open && pmf('milestone_status', 'approve')
  const mayEdit = m.can_edit && pmf('milestones', 'edit')
  const mayReopen = m.can_edit && m.status === 'done' && pmf('milestone_status', 'edit')
  const mayCancel = m.can_edit && open && pmf('milestone_status', 'cancel')
  const chips: { k: Filter; t: string }[] = [
    { k: 'all', t: `All (${ts.length})` }, { k: 'completed', t: `Completed (${doneN})` }, { k: 'pending', t: `Pending (${ts.length - doneN})` },
  ]

  return (
    <div style={{ background: '#fff', border: `1.5px solid ${col.c}55`, borderRadius: 18, boxShadow: `0 10px 30px ${col.c}14`, overflow: 'hidden' }}>
      {/* Header */}
      <div style={{ background: col.soft, padding: '18px 20px', display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap', borderBottom: `1px solid ${col.mid}` }}>
        <span title={`Milestone ${n}`} style={{ width: 44, height: 44, borderRadius: 12, background: col.c, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><Icon name={msIcon(m)} size={22} color="#fff" /></span>
        <div style={{ flex: '1 1 300px', minWidth: 0 }}>
          {props.showProject && <div style={{ fontSize: 12, fontWeight: 700, color: col.c, letterSpacing: '.03em', marginBottom: 2 }}>{m.project_code}{m.project_name ? ` · ${m.project_name}` : ''}</div>}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <h3 style={{ fontSize: 21, fontWeight: 800, color: INK, margin: 0, wordBreak: 'break-word' }}>{m.title}</h3>
            <Chip text={st.text} c={st.c} bg={st.bg} dot />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', fontSize: 13, color: BODY, marginTop: 6 }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><Icon name="calendar" size={15} color={MUTED} />{m.start_date ? `${fmt(m.start_date)} → ${fmt(m.due_date)}` : `Expected by ${fmt(m.due_date)}`}</span>
            <span style={{ color: LINE }}>|</span>
            <span style={{ color: m.is_overdue ? '#be123c' : BODY, fontWeight: m.is_overdue ? 600 : 400 }}>{dueText(m.due_date, m.status === 'done')}</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap', fontSize: 13, color: BODY, marginTop: 8 }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><Avatar name={m.assignee_name} size={24} />Responsible: <b style={{ color: INK }}>{m.assignee_name || '—'}</b>{m.department_name ? ` (${m.department_name})` : ''}</span>
            <span>Given by <b style={{ color: INK }}>{m.created_by_name || '—'}</b>{m.created_at ? ` on ${fmt(m.created_at)}` : ''}</span>
          </div>
          {m.description && <div style={{ fontSize: 13, color: BODY, marginTop: 8, whiteSpace: 'pre-wrap' }}>{m.description}</div>}
          {m.status === 'blocked' && m.blocker_reason && <div style={{ fontSize: 12.5, color: '#b45309', marginTop: 6 }}>On hold: {m.blocker_reason}</div>}
          {m.status === 'cancelled' && m.cancel_reason && <div style={{ fontSize: 12.5, color: MUTED, marginTop: 6 }}>Cancelled: {m.cancel_reason}</div>}
          {open && m.reopen_reason && <div style={{ fontSize: 12.5, color: '#b45309', marginTop: 6 }}>Reopened: {m.reopen_reason}</div>}
        </div>
        <div style={{ flex: '1 1 260px', maxWidth: 380 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: INK, marginBottom: 6 }}>Milestone Progress</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Bar value={pct} color={col.c} height={10} />
            <span style={{ fontSize: 16, fontWeight: 800, color: INK }}>{pct}%</span>
          </div>
          <div style={{ fontSize: 12.5, color: MUTED, marginTop: 4 }}>{msDone(m)} / {msTotal(m)} Tasks Completed</div>
        </div>
        <button type="button" onClick={props.onClose} aria-label="Close milestone" title="Back to all milestones" style={btn('secondary')}>← Back</button>
      </div>

      {/* Milestone actions */}
      {(mayAchieve || mayEdit || mayReopen || mayCancel || m.can_delete) && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', padding: '10px 20px', borderBottom: `1px solid ${LINE}`, background: '#fff' }}>
          {mayAchieve && <button type="button" disabled={busy} onClick={props.onAchieve} style={{ ...btn('secondary', INK, busy), color: '#15803d' }}><Icon name="check" size={15} /> Mark achieved</button>}
          {mayEdit && <button type="button" disabled={busy} onClick={props.onEdit} style={btn('secondary', INK, busy)}><Icon name="edit" size={15} /> Edit milestone</button>}
          {mayReopen && <button type="button" disabled={busy} onClick={() => props.onReason('reopen')} style={{ ...btn('secondary', INK, busy), color: '#b45309' }}>Reopen</button>}
          {mayCancel && <button type="button" disabled={busy} onClick={() => props.onReason('cancel')} style={btn('secondary', INK, busy)}>Cancel milestone</button>}
          {m.can_delete && <button type="button" disabled={busy} onClick={props.onDelete} style={{ ...btn('danger', INK, busy), marginLeft: 'auto' }}><Icon name="trash" size={15} /> Delete</button>}
        </div>
      )}

      {/* Tasks */}
      <div style={{ padding: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 14 }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 16, fontWeight: 700, color: col.c }}><Icon name="list" size={18} color={col.c} />Tasks ({ts.length})</span>
          <div style={{ display: 'flex', gap: 6, marginLeft: 8, flexWrap: 'wrap' }}>
            {chips.map((c) => (
              <button key={c.k} type="button" onClick={() => setFilter(c.k)} style={{ ...chipBtnStyle(filter === c.k), ...(filter === c.k ? { background: col.c } : {}) }}>{c.t}</button>
            ))}
          </div>
          <div style={{ position: 'relative', flex: '1 1 180px', maxWidth: 260, marginLeft: 'auto' }}>
            <span style={{ position: 'absolute', left: 10, top: 9 }}><Icon name="search" size={15} color={MUTED} /></span>
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search tasks…" style={{ ...sheetInput, padding: '8px 10px 8px 32px' }} />
          </div>
          {m.can_plan && <button type="button" disabled={busy} onClick={() => props.onAddTask()} style={btn('primary', col.c, busy)}><Icon name="plus" size={16} /> Add Task</button>}
        </div>

        {ts.length === 0 ? (
          <div style={{ border: `1.5px dashed ${col.mid}`, borderRadius: 14, padding: '36px 16px', textAlign: 'center', background: col.soft }}>
            <Icon name="list" size={28} color={col.c} />
            <div style={{ fontSize: 15, fontWeight: 700, color: INK, marginTop: 8 }}>{msTotal(m) ? 'No tasks for you here' : 'No tasks yet'}</div>
            <div style={{ fontSize: 13, color: MUTED, margin: '4px 0 14px' }}>{msTotal(m)
              ? `This milestone has ${msTotal(m)} task${msTotal(m) === 1 ? '' : 's'}, none created by you or assigned to you — you see only your own tasks.`
              : 'Break this milestone into tasks — each with an assignee and a due date.'}</div>
            {m.can_plan && <button type="button" disabled={busy} onClick={() => props.onAddTask()} style={btn('primary', col.c, busy)}><Icon name="plus" size={16} /> Add Task</button>}
          </div>
        ) : task ? (
          <TaskSplit {...props} list={shown} task={task} />
        ) : (
          <div style={{ border: `1px solid ${LINE}`, borderRadius: 12, overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 860 }}>
              <thead>
                <tr>
                  <th style={{ ...th, width: 36 }}>#<RowCount count={shown.length} /></th>
                  <th style={th}>Task Name</th>
                  <th style={th}>Assignee</th>
                  <th style={th}>Priority</th>
                  <th style={th}>Created</th>
                  <th style={th}>Due Date</th>
                  <th style={th}>Status</th>
                  <th style={{ ...th, width: 150 }}>Progress</th>
                  <th style={{ ...th, textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {shown.length === 0 && <tr><td colSpan={9} style={{ ...td, textAlign: 'center', color: MUTED, padding: 24 }}>No tasks match.</td></tr>}
                {shown.map((s) => {
                  const state = STATE[taskState(m, s)]
                  const kids = kidsOf(m, s.id)
                  const p = taskPercent(m, s)
                  return (
                    <tr key={s.id} onClick={() => setTaskId(s.id)} style={{ cursor: 'pointer' }}
                      onMouseEnter={(e) => { e.currentTarget.style.background = SOFT }} onMouseLeave={(e) => { e.currentTarget.style.background = '' }}>
                      <td style={{ ...td, color: MUTED }}>{ts.indexOf(s) + 1}</td>
                      <td style={td}>
                        <div style={{ fontWeight: 600, color: INK }}>{s.title}</div>
                        {(kids.length > 0 || s.remarks_count > 0 || s.files_count > 0 || (s.labels?.length || 0) > 0) && (
                          <div style={{ display: 'flex', gap: 10, fontSize: 11.5, color: MUTED, marginTop: 2, flexWrap: 'wrap', alignItems: 'center' }}>
                            {(s.labels || []).map((l) => <span key={l} style={{ ...pillStyle('#6d28d9'), fontSize: 11.5, fontWeight: 500, padding: '1px 7px', background: '#f5f3ff' }}>{l}</span>)}
                            {kids.length > 0 && <span>☑ {kids.filter((k) => k.status === 'done').length}/{kids.length}</span>}
                            {s.remarks_count > 0 && pmf('task_comments', 'view') && <span>💬 {s.remarks_count}</span>}
                            {s.files_count > 0 && pmf('task_files', 'view') && <span>📎 {s.files_count}</span>}
                          </div>
                        )}
                      </td>
                      <td style={td}><span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}><Avatar name={s.assignee_name} size={26} />{s.mine ? <b style={{ color: BLUE }}>You</b> : (s.assignee_name || '—')}</span></td>
                      <td style={td}><Chip text={PRIORITY[normalizePriority(s.priority)].text} c={PRIORITY[normalizePriority(s.priority)].c} bg={PRIORITY[normalizePriority(s.priority)].bg} /></td>
                      <td style={{ ...td, whiteSpace: 'nowrap' }}>{fmt(s.created_at)}</td>
                      <td style={{ ...td, whiteSpace: 'nowrap', color: s.is_overdue ? '#be123c' : BODY, fontWeight: s.is_overdue ? 600 : 400 }}>{fmt(s.due_date)}</td>
                      <td style={td}><Chip text={state.text} c={state.c} bg={state.bg} /></td>
                      <td style={td}><span style={{ display: 'flex', alignItems: 'center', gap: 8 }}><Bar value={p} color={col.c} /><span style={{ fontSize: 12, color: BODY, width: 34 }}>{p}%</span></span></td>
                      <td style={{ ...td, textAlign: 'right', whiteSpace: 'nowrap' }} onClick={(e) => e.stopPropagation()}>
                        {s.can_delete && <button type="button" title="Remove" aria-label={`Remove ${s.title}`} disabled={busy} onClick={() => props.onRemoveTask(s)} style={btn('ghost', '#e11d48', busy)}><Icon name="trash" size={15} /></button>}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}

      </div>
    </div>
  )
}

/** A task opened: the task list on the left, the task on the right in tabs. */
type TaskTab = 'overview' | 'subtasks' | 'files' | 'comments' | 'log'
const TASK_TAB_FEATURE: Record<TaskTab, string> = {
  overview: '', subtasks: 'task_checklist', files: 'task_files', comments: 'task_comments', log: 'task_log',
}
function TaskSplit(props: Parameters<typeof MilestonePanel>[0] & { list: PmDeptSubtask[]; task: PmDeptSubtask }) {
  const { m, col, busy, task, list, setTaskId } = props
  const [tab, setTab] = useState<TaskTab>('overview')
  const ts = tasksOf(m)
  const kids = kidsOf(m, task.id)
  const state = STATE[taskState(m, task)]
  const pr = PRIORITY[normalizePriority(task.priority)]
  const p = taskPercent(m, task)
  const idx = ts.indexOf(task)
  const go = (d: number) => { const nx = ts[idx + d]; if (nx) { setTab('overview'); setTaskId(nx.id) } }
  const pmf = usePmFeature()
  // Status is saved through the task edit (tasks:edit on top of the record rule).
  const canStatus = (task.can_toggle || task.can_edit || task.mine || task.collab) && pmf('tasks', 'edit')
  const seeChecklist = pmf('task_checklist', 'view')
  const allTabs: { k: TaskTab; t: string; n?: string; icon: IconName }[] = [
    { k: 'overview', t: 'Overview', icon: 'list' },
    { k: 'subtasks', t: 'Checklist', n: kids.length ? `${kids.filter((k) => k.status === 'done').length}/${kids.length}` : '0', icon: 'check' },
    { k: 'files', t: 'Files', n: String(task.files_count), icon: 'clip' },
    { k: 'comments', t: 'Comments', n: String(task.remarks_count), icon: 'chat' },
    { k: 'log', t: 'Activity Log', icon: 'history' },
  ]
  const tabs = allTabs.filter((x) => x.k === 'overview' || pmf(TASK_TAB_FEATURE[x.k], 'view'))
  // A tab the role lacks (core/features/projects.py) falls back to Overview.
  const view: TaskTab = tabs.some((x) => x.k === tab) ? tab : 'overview'

  return (
    <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'flex-start' }}>
      {/* List */}
      <div style={{ ...card, flex: '1 1 240px', maxWidth: 320, overflow: 'hidden' }}>
        {list.map((s) => {
          const stt = STATE[taskState(m, s)]
          const active = s.id === task.id
          return (
            // ui-audit-ignore-next-line custom-button — sidebar task list row (selectable list item), not a pill button
            <button key={s.id} type="button" onClick={() => { setTab('overview'); setTaskId(s.id) }}
              style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', textAlign: 'left', padding: '10px 12px', borderTop: '0', borderRight: '0', borderBottom: `1px solid ${LINE}`, borderLeft: `3px solid ${active ? col.c : 'transparent'}`, borderRadius: 0, boxShadow: 'none', transform: 'none', background: active ? col.soft : '#fff', color: INK, cursor: 'pointer', fontFamily: 'inherit' }}>
              <span style={{ width: 22, height: 22, borderRadius: '50%', background: s.status === 'done' ? col.c : '#e2e8f0', color: s.status === 'done' ? '#fff' : BODY, fontSize: 11, fontWeight: 700, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{s.status === 'done' ? <Icon name="check" size={12} color="#fff" /> : ts.indexOf(s) + 1}</span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: 'block', fontSize: 13, fontWeight: 600, color: INK, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.title}</span>
                <span style={{ display: 'inline-block', marginTop: 3 }}><Chip text={stt.text} c={stt.c} bg={stt.bg} /></span>
              </span>
              <span style={{ fontSize: 11.5, color: s.is_overdue ? '#be123c' : MUTED, whiteSpace: 'nowrap' }}>{fmt(s.due_date, false)}</span>
            </button>
          )
        })}
      </div>

      {/* Task */}
      <div style={{ ...card, flex: '3 1 560px', minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: '16px 18px 10px', flexWrap: 'wrap' }}>
          <span style={{ width: 34, height: 34, borderRadius: '50%', background: task.status === 'done' ? '#16a34a' : '#e2e8f0', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><Icon name="check" size={18} color={task.status === 'done' ? '#fff' : MUTED} /></span>
          <div style={{ flex: '1 1 240px', minWidth: 0 }}>
            <h3 style={{ fontSize: 19, fontWeight: 700, color: INK, margin: 0, wordBreak: 'break-word' }}>{task.title}</h3>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginTop: 6, fontSize: 12.5, color: MUTED }}>
              <span>Created on {fmt(task.created_at)} by {task.created_by_name || '—'}</span>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
            {canStatus && (
              <StatusRadios value={task.status} disabled={busy} onChange={(v) => props.onStatus(task, v)} name={`task-status-${task.id}`} />
            )}
            {task.can_edit && <button type="button" disabled={busy} onClick={() => props.onEditTask(task)} style={btn('secondary', INK, busy)}><Icon name="edit" size={15} /> Edit</button>}
            <button type="button" aria-label="Previous task" disabled={idx <= 0} onClick={() => go(-1)} style={{ ...btn('secondary', INK, idx <= 0), padding: '8px 9px' }}><Icon name="left" size={15} /></button>
            <button type="button" aria-label="Next task" disabled={idx >= ts.length - 1} onClick={() => go(1)} style={{ ...btn('secondary', INK, idx >= ts.length - 1), padding: '8px 9px' }}><Icon name="right" size={15} /></button>
            <button type="button" aria-label="Close task" title="Back to the task table" onClick={() => setTaskId(null)} style={btn('ghost', MUTED)}><Icon name="x" size={18} /></button>
          </div>
        </div>

        {/* Tabs */}
        <div role="tablist" style={{ display: 'flex', flexWrap: 'wrap', gap: 2, padding: '0 12px', borderBottom: `1px solid ${LINE}` }}>
          {tabs.map((x) => (
            <button key={x.k} role="tab" aria-selected={view === x.k} type="button" onClick={() => setTab(x.k)} style={tabStyle(view === x.k, col.c)}>
              <Icon name={x.icon} size={14} color={view === x.k ? col.c : MUTED} />{x.t}
              {x.n !== undefined && (
                <span style={{ ...pillStyle(MUTED), justifyContent: 'center', padding: '0 6px', minWidth: 18, textAlign: 'center',
                  background: view === x.k ? `${col.c}1a` : '#f1f5f9', color: view === x.k ? col.c : MUTED }}>{x.n}</span>
              )}
            </button>
          ))}
        </div>

        <div style={{ padding: 18 }}>
          {view === 'overview' && (
            <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'flex-start' }}>
              <div style={{ flex: '2 1 320px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 14 }}>
                <Box icon="list" title="Description" color={BLUE}>
                  <div style={{ fontSize: 13, color: task.description ? BODY : MUTED, whiteSpace: 'pre-wrap', background: SOFT, borderRadius: 10, padding: '10px 12px' }}>{task.description || 'No description.'}</div>
                </Box>
                {seeChecklist && <Box icon="check" title={`Checklist (${kids.length})`} color="#16a34a"
                  extra={kids.length > 0 ? <span style={{ marginLeft: 'auto', fontSize: 12, color: MUTED }}>{kids.filter((k) => k.status === 'done').length} / {kids.length} completed</span> : undefined}>
                  <SubtaskList {...props} kids={kids} compact />
                </Box>}
              </div>
              <div style={{ flex: '1 1 230px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 14 }}>
                <Box icon="list" title="Task Information" color="#7c3aed">
                  {[
                    ['Status', <Chip key="s" text={state.text} c={state.c} bg={state.bg} />],
                    ['Priority', <Chip key="p" text={pr.text} c={pr.c} bg={pr.bg} />],
                    ['Assignee', <span key="a" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><Avatar name={task.assignee_name} size={22} />{task.mine ? 'You' : (task.assignee_name || '—')}</span>],
                    ['Collaborators', (task.collaborator_names?.length ? task.collaborator_names.join(', ') : '—')],
                    ['Start Date', fmt(task.start_date)],
                    ['Due Date', <span key="d" style={{ color: task.is_overdue ? '#be123c' : BODY }}>{fmt(task.due_date)}</span>],
                    ...(task.completed_at ? [['Completed', fmt(task.completed_at)]] as [string, React.ReactNode][] : []),
                  ].map(([k, v]) => (
                    <div key={k as string} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 0', fontSize: 13, color: BODY }}>
                      <span style={{ width: 92, color: MUTED, flexShrink: 0 }}>{k}</span><span style={{ minWidth: 0 }}>{v}</span>
                    </div>
                  ))}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 0', fontSize: 13 }}>
                    <span style={{ width: 92, color: MUTED, flexShrink: 0 }}>Progress</span><Bar value={p} color="#16a34a" /><span style={{ fontWeight: 700, color: INK }}>{p}%</span>
                  </div>
                </Box>
                <Box icon="tag" title="Labels / Tags" color="#f59e0b">
                  {task.labels?.length
                    ? <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>{task.labels.map((l) => <span key={l} style={{ ...pillStyle('#6d28d9'), fontSize: 12, fontWeight: 500, padding: '3px 10px', background: '#f5f3ff' }}>{l}</span>)}</div>
                    : <span style={{ fontSize: 12.5, color: MUTED }}>No labels.{task.can_edit ? ' Add them with Edit.' : ''}</span>}
                </Box>
                <Box icon="flag" title="Related Items" color={col.c}>
                  {[
                    ['Milestone', <span key="m" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontWeight: 600, color: INK }}><span style={{ width: 10, height: 10, transform: 'rotate(45deg)', borderRadius: 2, background: col.c }} />{m.title}</span>],
                    ['Responsible', m.assignee_name || '—'],
                  ].map(([k, v]) => (
                    <div key={k as string} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '5px 0', fontSize: 13, color: BODY }}>
                      <span style={{ width: 92, color: MUTED, flexShrink: 0 }}>{k}</span><span style={{ minWidth: 0 }}>{v}</span>
                    </div>
                  ))}
                </Box>
                {task.can_delete && <button type="button" disabled={busy} onClick={() => props.onRemoveTask(task)} style={btn('danger', INK, busy)}><Icon name="trash" size={15} /> Remove task</button>}
              </div>
            </div>
          )}
          {view === 'subtasks' && <SubtaskList {...props} kids={kids} />}
          {view === 'files' && <TaskActivity taskId={m.id} subtaskId={task.id} show="files" onCounts={(r, f) => props.onCounts(task.id, r, f)} />}
          {view === 'comments' && <TaskActivity taskId={m.id} subtaskId={task.id} show="remarks" onCounts={(r, f) => props.onCounts(task.id, r, f)} />}
          {view === 'log' && <ActivityLog key={`${task.id}-${task.status}-${task.progress}-${task.remarks_count}-${task.files_count}`} subtaskId={task.id} />}
        </div>
      </div>
    </div>
  )
}

/** A flat underline tab. Every border side, background, shadow, radius and
 * transform is set explicitly: the app-wide <button> style (globals.css)
 * otherwise shows through — and mixing the `border` shorthand with
 * `borderBottom` makes React drop sides on re-render. */
function tabStyle(active: boolean, color: string): React.CSSProperties {
  return {
    display: 'inline-flex', alignItems: 'center', gap: 6, padding: '10px 12px', marginBottom: -1,
    borderTop: '0', borderLeft: '0', borderRight: '0', borderBottom: `2px solid ${active ? color : 'transparent'}`,
    borderRadius: 0, background: 'transparent', backgroundColor: 'transparent', boxShadow: 'none', transform: 'none', outline: 'none',
    cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap', fontSize: 13, fontWeight: active ? 700 : 600, color: active ? color : MUTED,
  }
}

// One click sets the task's status. To Do is only where a new task starts — not something to pick.
const STATUS_RADIOS = [
  { k: 'in_progress', t: 'In Progress', c: '#1d4ed8', bg: '#dbeafe' },
  { k: 'on_hold', t: 'On Hold', c: '#b45309', bg: '#fef3c7' },
  { k: 'done', t: 'Done', c: '#15803d', bg: '#dcfce7' },
] as const
function StatusRadios({ value, onChange, disabled, name }: { value: string; onChange: (v: string) => void; disabled?: boolean; name: string }) {
  return (
    <div role="radiogroup" aria-label="Status" style={{ display: 'inline-flex', gap: 6, flexWrap: 'wrap' }}>
      {STATUS_RADIOS.map((o) => {
        const on = value === o.k
        return (
          <label key={o.k} style={{
            display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 12px', borderRadius: 999, fontSize: 13, fontWeight: 600,
            cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.6 : 1, userSelect: 'none',
            border: `1.5px solid ${on ? o.c : LINE}`, background: on ? o.bg : '#fff', color: on ? o.c : BODY,
          }}>
            <input type="radio" name={name} value={o.k} checked={on} disabled={disabled} onChange={() => !on && onChange(o.k)}
              style={{ margin: 0, accentColor: o.c, cursor: 'inherit' }} />
            {o.t}
          </label>
        )
      })}
    </div>
  )
}

function Box({ icon, title, color, extra, children }: { icon: IconName; title: string; color: string; extra?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div style={{ border: `1px solid ${LINE}`, borderRadius: 12, padding: '12px 14px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}><Icon name={icon} size={16} color={color} /><span style={{ fontSize: 14, fontWeight: 700, color: INK }}>{title}</span>{extra}</div>
      {children}
    </div>
  )
}

/** A task's checklist: lines to tick off — no person, dates or comments of their own. */
function SubtaskList(props: Parameters<typeof MilestonePanel>[0] & { task: PmDeptSubtask; kids: PmDeptSubtask[]; compact?: boolean }) {
  const { busy, task, kids, compact } = props
  const [text, setText] = useState('')
  const done = kids.filter((k) => k.status === 'done').length
  const add = () => {
    const t = text.trim()
    if (!t) return
    props.onAddChecklist(task, t)
    setText('')
  }
  return (
    <div>
      {kids.length > 0 && !compact && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
          <span style={{ fontSize: 12, color: MUTED, whiteSpace: 'nowrap' }}>{done} / {kids.length} done</span>
          <Bar value={done * 100 / kids.length} color="#16a34a" />
        </div>
      )}
      {kids.length === 0 && <p style={{ fontSize: 12.5, color: MUTED, margin: '0 0 8px' }}>No checklist items.</p>}
      {kids.map((k) => (
        <div key={k.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 2px', borderTop: `1px solid ${LINE}` }}>
          <input type="checkbox" checked={k.status === 'done'} disabled={!k.can_toggle || busy} onChange={(e) => props.onToggle(k, e.target.checked)}
            aria-label={`Tick ${k.title}`} style={{ width: 16, height: 16, accentColor: '#16a34a', cursor: k.can_toggle ? 'pointer' : 'not-allowed', flexShrink: 0 }} />
          <span style={{ flex: 1, minWidth: 0, fontSize: 13, color: k.status === 'done' ? MUTED : INK, textDecoration: k.status === 'done' ? 'line-through' : 'none', wordBreak: 'break-word' }}>{k.title}</span>
          {k.can_delete && <button type="button" aria-label={`Remove ${k.title}`} disabled={busy} onClick={() => props.onRemoveTask(k)} style={btn('ghost', MUTED, busy)}><Icon name="x" size={14} /></button>}
        </div>
      ))}
      {task.can_add_child && (
        <div style={{ display: 'flex', gap: 8, paddingTop: 10 }}>
          <input style={{ ...sheetInput, padding: '7px 10px' }} value={text} onChange={(e) => setText(e.target.value)} placeholder="Add a checklist item…"
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add() } }} />
          <button type="button" disabled={busy || !text.trim()} onClick={add} style={btn('secondary', INK, busy || !text.trim())}><Icon name="plus" size={14} /> Add</button>
        </div>
      )}
    </div>
  )
}

/** Everything that happened to one task — created, edited, status, dependencies — newest first. */
function ActivityLog({ subtaskId }: { subtaskId: number }) {
  const [rows, setRows] = useState<NonNullable<PmTaskActivity['log']> | null>(null)
  const [error, setError] = useState<string | string[]>('')
  useEffect(() => {
    pmOngoingApi.subActivity(subtaskId).then((d: PmTaskActivity) => setRows(d.log || []))
      .catch((err) => setError(extractErrorMessages(err, 'Could not load the activity log — open the tab again.')))
  }, [subtaskId])
  if (error) return <ErrorBanner error={error} />
  if (!rows) return <p style={{ fontSize: 12.5, color: MUTED }}>Loading…</p>
  if (!rows.length) return <p style={{ fontSize: 12.5, color: MUTED }}>Nothing recorded yet. Changes made from now on are listed here.</p>
  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      {rows.map((r, i) => (
        <div key={r.id} style={{ display: 'flex', gap: 12 }}>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <span style={{ width: 10, height: 10, borderRadius: '50%', background: r.to_status ? '#2563eb' : '#94a3b8', marginTop: 5 }} />
            {i < rows.length - 1 && <span style={{ flex: 1, width: 2, background: LINE }} />}
          </div>
          <div style={{ paddingBottom: 14, minWidth: 0 }}>
            <div style={{ fontSize: 13, color: INK, wordBreak: 'break-word' }}>{r.text}</div>
            <div style={{ fontSize: 11.5, color: MUTED, marginTop: 2 }}>{r.user_name || '—'} · {r.created_at ? `${fmt(r.created_at)} ${r.created_at.slice(11, 16)}` : ''}</div>
          </div>
        </div>
      ))}
    </div>
  )
}
