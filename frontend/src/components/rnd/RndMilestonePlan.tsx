'use client'

import Select from '@/components/shared/Select'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Calendar, CaretDown, Check, Clock, Flag, Gear, ListChecks, Package, Paperclip, PencilSimple, Plus, Star, Target, Trash, Truck, User, WarningCircle } from '@phosphor-icons/react'
import type { Icon as PhosphorIcon } from '@phosphor-icons/react'
import { rndApi } from '@/lib/api'
import { RndMilestone, RndProjectDetail, RndTask } from '@/types'
import { extractErrorMessages } from '@/lib/validation'
import DateField from '@/components/erp/DateField'
import SearchableSelect from '@/components/erp/SearchableSelect'
import ConfirmDialog from '@/components/erp/ConfirmDialog'
import { PermissionAction, useCan } from '@/lib/permissions'
import { useAssigneeFilter } from '@/hooks/useAssigneeFilter'
import { FormSheet, Req, SHEET, SheetColumns, SheetError, SheetIcon, SheetSection, sheetBtn, sheetHint, sheetInput, sheetLabel } from '@/components/shared/FormSheet'
import TasksBoard, { TaskApi, TaskLabels } from './TasksBoard'
import { pillStyle } from '@/components/shared/ui'

/* Project Plan & Milestones for an R&D (Prototype / Research) project — the
 * same plan as Project Management (components/projects/work/ProjectPlan.tsx):
 * a timeline of milestones, each with a responsible person and an expected
 * achievable date; open one to work its tasks. The tasks inside a milestone
 * are R&D project tasks (TasksBoard), so the R&D task flow — complete,
 * ask for approval, extend, reopen — stays as it is. */

const { INK, BODY, MUTED, LINE, SOFT, BLUE } = SHEET
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
// Same icon set and colours as PM milestones (backend RND_MILESTONE_ICONS).
const MS_ICONS = ['flag', 'target', 'star', 'gear', 'truck', 'box', 'check', 'calendar', 'clip', 'user'] as const
type MsIcon = typeof MS_ICONS[number]
const ICON_COLOR: Record<MsIcon, string> = {
  flag: '#2563eb', target: '#e11d48', star: '#f59e0b', gear: '#0284c7', truck: '#ea580c',
  box: '#7c3aed', check: '#16a34a', calendar: '#0d9488', clip: '#475569', user: '#db2777',
}
const ICON_LABEL: Record<MsIcon, string> = {
  flag: 'Milestone', target: 'Goal', star: 'Key', gear: 'Engineering', truck: 'Dispatch',
  box: 'Material', check: 'Approval', calendar: 'Event', clip: 'Documents', user: 'People',
}
const tint = (c: string) => ({ c, soft: `${c}0f`, mid: `${c}29` })
const colOf = (m: { color?: string | null } | null | undefined, i: number) => (m?.color ? tint(m.color) : colorOf(i))
const msIcon = (m: { icon?: string | null } | null | undefined): MsIcon => ((m?.icon && (MS_ICONS as readonly string[]).includes(m.icon)) ? m.icon as MsIcon : 'flag')

type IconName = MsIcon | 'plus' | 'edit' | 'trash' | 'list' | 'clock' | 'alert' | 'down'
function Icon({ name, size = 16, color = 'currentColor' }: { name: IconName; size?: number; color?: string }) {
  const p: Record<IconName, PhosphorIcon> = {
    flag: Flag, target: Target, star: Star, gear: Gear, truck: Truck, box: Package, check: Check, calendar: Calendar, clip: Paperclip, user: User,
    plus: Plus, edit: PencilSimple, trash: Trash, list: ListChecks, clock: Clock, alert: WarningCircle, down: CaretDown,
  }
  const Glyph = p[name]
  return <Glyph size={size} color={color} aria-hidden style={{ flexShrink: 0 }} />
}

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
const addDays = (iso: string, n: number) => {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10)
}
const initials = (name?: string | null) => (name || '?').split(' ').filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase()
const AV_COLORS = ['#2563eb', '#16a34a', '#db2777', '#7c3aed', '#ea580c', '#0891b2']
function Avatar({ name, size = 28 }: { name?: string | null; size?: number }) {
  const c = AV_COLORS[(name || '').length % AV_COLORS.length]
  return <span title={name || ''} style={{ width: size, height: size, borderRadius: '50%', background: `${c}1a`, color: c, border: `1px solid ${c}33`, fontSize: size * 0.38, fontWeight: 700, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{initials(name)}</span>
}
const MS_STATE: Record<string, { text: string; c: string; bg: string }> = {
  todo: { text: 'Not Started', c: '#475569', bg: '#f1f5f9' },
  in_progress: { text: 'In Progress', c: '#1d4ed8', bg: '#dbeafe' },
  blocked: { text: 'On Hold', c: '#b45309', bg: '#fef3c7' },
  done: { text: 'Achieved', c: '#15803d', bg: '#dcfce7' },
  cancelled: { text: 'Cancelled', c: '#78716c', bg: '#f5f5f4' },
}
const isOpen = (m: RndMilestone) => ['todo', 'in_progress', 'blocked'].includes(m.status)
const pctOf = (m: RndMilestone) => (m.status === 'done' ? 100 : m.tasks_total ? Math.round(m.tasks_done * 100 / m.tasks_total) : 0)

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
const card: React.CSSProperties = { background: '#fff', border: `1px solid ${LINE}`, borderRadius: 14, boxShadow: '0 1px 3px rgba(15,23,42,0.05)' }

type Person = { id: number; name: string; department?: string | null; designation?: string | null; team_role: string }
type MsForm = {
  id?: number; title: string; description: string; assignee_id: string; start_date: string; due_date: string
  status: string; blocker_reason: string; color: string; icon: string; co_owner_ids: string[]
}

export default function RndMilestonePlan({ project, userId, isManager, taskApi, labels }: {
  project: RndProjectDetail
  userId: number
  /** Project lead / admin. */
  isManager: boolean
  /** The project's task API — scoped to one milestone here. */
  taskApi: TaskApi
  labels: TaskLabels
}) {
  const { canFeature } = useCan()
  const f = (feature: string, action: PermissionAction) => canFeature('rnd', 'projects', feature, action)
  const allowOwner = useAssigneeFilter('rnd:projects.milestones')
  const [rows, setRows] = useState<RndMilestone[]>([])
  const [loose, setLoose] = useState(0)
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState<string | string[]>('')
  const [selId, setSelId] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [people, setPeople] = useState<Person[] | null>(null)
  const [msForm, setMsForm] = useState<MsForm | null>(null)
  const [formError, setFormError] = useState<string | string[]>('')
  const [reason, setReasonState] = useState<{ m: RndMilestone; action: 'reopen' | 'cancel' } | null>(null)
  const [reasonText, setReasonText] = useState('')
  const [reasonError, setReasonError] = useState<string | string[]>('')
  const setReason = (r: typeof reason) => { setReasonState(r); setReasonText(''); setReasonError('') }
  const [delMs, setDelMs] = useState<RndMilestone | null>(null)
  const [stats, setStats] = useState({ total: 0, done: 0, pending: 0, overdue: 0 })

  const canAdd = isManager && f('milestones', 'create')
  const load = useCallback(() => {
    rndApi.listMilestones(project.id)
      .then((d) => { setRows(Array.isArray(d) ? d : []); setError('') })
      .catch((err) => setError(extractErrorMessages(err, 'Could not load the milestones — reload the page.')))
      .finally(() => setLoaded(true))
    // Task totals (and tasks saved before milestones existed) — what this person can see.
    if (f('tasks', 'view')) {
      rndApi.listProjectTasks(project.id).then((ts: RndTask[]) => {
        const top = ts.filter((t) => !t.parent_task_id && t.status !== 'cancelled')
        const done = (t: RndTask) => t.status === 'closed' || t.status === 'submitted'
        setStats({ total: top.length, done: top.filter(done).length, pending: top.filter((t) => !done(t)).length, overdue: top.filter((t) => t.is_overdue).length })
        setLoose(ts.filter((t) => !t.milestone_id).length)
      }).catch(() => { /* the totals are a summary; the milestones above still show */ })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.id])
  useEffect(() => { load() }, [load])

  // Timeline order: by expected date; cancelled ones last.
  const ms = useMemo(() => [...rows].sort((a, b) =>
    (a.status === 'cancelled' ? 1 : 0) - (b.status === 'cancelled' ? 1 : 0) || a.due_date.localeCompare(b.due_date) || a.id - b.id), [rows])
  const sel = ms.find((m) => m.id === selId) || null
  const live = ms.filter((m) => m.status !== 'cancelled')
  const overall = live.length ? Math.round(live.reduce((n, m) => n + pctOf(m), 0) / live.length) : 0
  const replace = (m: RndMilestone) => setRows((rs) => rs.map((x) => (x.id === m.id ? m : x)))

  const needPeople = () => {
    if (!people) rndApi.milestonePeople(project.id).then(setPeople).catch((err) => setFormError(extractErrorMessages(err, 'Could not load the project team.')))
  }
  const suggestedStart = () => {
    const today = new Date().toISOString().slice(0, 10)
    const ends = rows.filter((x) => x.status !== 'cancelled').map((x) => x.due_date).sort()
    const base = ends.length ? addDays(ends[ends.length - 1], 1) : (project.start_date || today)
    return base > today ? base : today
  }
  const openMs = (m?: RndMilestone) => {
    setFormError('')
    setMsForm(m
      ? { id: m.id, title: m.title, description: m.description || '', assignee_id: String(m.assignee_id), start_date: m.start_date || '', due_date: m.due_date,
          status: m.status, blocker_reason: m.blocker_reason || '', color: m.color || '', icon: m.icon || '', co_owner_ids: (m.co_owner_ids || []).map(String) }
      : { title: '', description: '', assignee_id: '', start_date: suggestedStart(), due_date: '', status: 'todo', blocker_reason: '', color: ICON_COLOR.flag, icon: 'flag', co_owner_ids: [] })
    needPeople()
  }
  const saveMs = async () => {
    if (!msForm) return
    const missing: string[] = []
    if (!msForm.title.trim()) missing.push('Milestone name is required.')
    if (!msForm.due_date) missing.push('Expected achievable date (End Date) is required.')
    if (!msForm.assignee_id) missing.push('Pick the person responsible for the milestone.')
    if (msForm.start_date && msForm.due_date && msForm.start_date > msForm.due_date) missing.push('Start date is after the end date.')
    if (msForm.status === 'blocked' && !msForm.blocker_reason.trim()) missing.push('Say why the milestone is on hold.')
    if (missing.length) { setFormError(missing); return }
    setBusy(true)
    setFormError('')
    const formStatus = (['todo', 'in_progress', 'blocked'].includes(msForm.status) ? msForm.status : undefined) as 'todo' | 'in_progress' | 'blocked' | undefined
    const payload = {
      title: msForm.title.trim(), description: msForm.description.trim() || null, assignee_id: Number(msForm.assignee_id),
      start_date: msForm.start_date || null, due_date: msForm.due_date, status: formStatus, blocker_reason: msForm.blocker_reason.trim() || null,
      color: msForm.color || null, icon: msForm.icon || null,
      co_owner_ids: msForm.co_owner_ids.filter((x) => x !== msForm.assignee_id).map(Number),
    }
    try {
      const saved = msForm.id ? await rndApi.editMilestone(project.id, msForm.id, payload) : await rndApi.createMilestone(project.id, payload)
      if (msForm.id) replace(saved)
      else { setRows((rs) => [...rs, saved]); setSelId(saved.id) }
      setMsForm(null)
    } catch (err) {
      setFormError(extractErrorMessages(err, 'Could not save the milestone.'))
    } finally { setBusy(false) }
  }
  const achieve = async (m: RndMilestone) => {
    setBusy(true)
    setError('')
    try { replace(await rndApi.milestoneStatus(project.id, m.id, 'done')) } catch (err) { setError(extractErrorMessages(err, `Could not mark '${m.title}' achieved.`)) } finally { setBusy(false) }
  }
  const submitReason = async () => {
    const r = reason
    if (!r) return
    const v = reasonText.trim()
    if (!v) { setReasonError(`Say why '${r.m.title}' is being ${r.action === 'reopen' ? 'reopened' : 'cancelled'}.`); return }
    setBusy(true)
    setReasonError('')
    try { replace(await rndApi.milestoneStatus(project.id, r.m.id, r.action, v)); setReason(null) }
    catch (err) { setReasonError(extractErrorMessages(err, `Could not ${r.action} '${r.m.title}'.`)) }
    finally { setBusy(false) }
  }
  const deleteMs = async (m: RndMilestone) => {
    setBusy(true)
    setError('')
    try {
      await rndApi.deleteMilestone(project.id, m.id)
      setRows((rs) => rs.filter((x) => x.id !== m.id))
      if (selId === m.id) setSelId(null)
    } catch (err) { setError(extractErrorMessages(err, `Could not delete '${m.title}'.`)) } finally { setBusy(false) }
  }

  const ownerOpts = msForm
    ? (people || []).filter((p) => allowOwner(p.id) || [msForm.assignee_id, ...msForm.co_owner_ids].includes(String(p.id)))
        .map((p) => ({ value: String(p.id), label: `${p.name}${p.department ? ` — ${p.department}` : p.designation ? ` — ${p.designation}` : ''}${p.team_role === 'lead' ? ' (lead)' : ''}` }))
    : []
  const personName = (id: string) => people?.find((p) => String(p.id) === id)?.name
  const rights = {
    create: f('tasks', 'create'), edit: f('tasks', 'edit'), approve: f('tasks', 'approve'), cancel: f('tasks', 'cancel'),
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'stretch', gap: 16, flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 320px' }}>
          <h2 style={{ fontSize: 22, fontWeight: 800, color: INK, margin: 0, letterSpacing: '-0.01em' }}>Project Plan &amp; Milestones</h2>
          <p style={{ fontSize: 13.5, color: MUTED, margin: '4px 0 0' }}>{project.project_number} · {project.title} — {live.length} milestone{live.length === 1 ? '' : 's'}</p>
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
            <button type="button" data-tour="rnd-ms-add-btn" onClick={() => openMs()} style={sheetBtn('primary', BLUE)}><Icon name="plus" size={16} /> Add Milestone</button>
          </div>
        )}
      </div>
      <SheetError error={error} />
      {!loaded && <p style={{ fontSize: 13.5, color: MUTED, margin: 0 }}>Loading the milestones…</p>}

      {loaded && ms.length === 0 && (
        <div style={{ ...card, padding: '48px 20px', textAlign: 'center' }}>
          <span style={{ display: 'inline-flex', width: 56, height: 56, borderRadius: 16, background: '#eff6ff', alignItems: 'center', justifyContent: 'center' }}><Icon name="flag" size={28} color={BLUE} /></span>
          <h3 style={{ fontSize: 18, fontWeight: 700, color: INK, margin: '12px 0 4px' }}>No milestones yet</h3>
          <p style={{ fontSize: 13.5, color: MUTED, margin: '0 0 16px' }}>
            {canAdd
              ? 'Lay out the project as milestones — each with a responsible person and an expected date — then add tasks inside each one.'
              : 'A project lead lays out the plan as milestones; their tasks then show here.'}
          </p>
          {canAdd && <button type="button" onClick={() => openMs()} style={sheetBtn('primary', BLUE)}><Icon name="plus" size={16} /> Add Milestone</button>}
        </div>
      )}

      {ms.length > 0 && (
        <>
          {/* Timeline */}
          <div data-tour="rnd-ms-timeline" style={{ ...card, padding: '18px 8px 14px', overflowX: 'auto' }}>
            <div style={{ display: 'flex', minWidth: ms.length * 170, position: 'relative' }}>
              <div style={{ position: 'absolute', left: `${50 / ms.length}%`, right: `${50 / ms.length}%`, top: 78, height: 4, borderRadius: 4,
                background: ms.length > 1 ? `linear-gradient(90deg, ${ms.map((x, i) => colOf(x, i).c).join(', ')})` : colOf(ms[0], 0).c }} />
              {ms.map((m, i) => {
                const col = colOf(m, i)
                const active = m.id === selId
                return (
                  // ui-audit-ignore-next-line custom-button — timeline stop (label + diamond), not a pill button
                  <button key={m.id} type="button" onClick={() => setSelId(active ? null : m.id)}
                    style={{ flex: 1, minWidth: 170, background: 'none', border: 'none', cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '0 6px', fontFamily: 'inherit', opacity: m.status === 'cancelled' ? 0.5 : 1 }}>
                    <span style={{ padding: '7px 12px', borderRadius: 10, background: active ? col.mid : SOFT, border: `1px solid ${active ? col.c : LINE}`, textAlign: 'center', maxWidth: '100%', minHeight: 50, boxSizing: 'border-box' }}>
                      <span style={{ display: 'block', fontSize: 13, fontWeight: 700, color: INK, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 160 }}>{m.title}</span>
                      <span style={{ display: 'block', fontSize: 12, color: m.is_overdue ? '#be123c' : BODY, marginTop: 2 }}>{fmt(m.due_date)}</span>
                    </span>
                    <span style={{ height: 14, borderLeft: `2px dotted ${col.c}`, margin: '0 0 1px' }} />
                    <span style={{ width: 22, height: 22, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', zIndex: 1 }}>
                      {m.status === 'done'
                        ? <span style={{ width: 22, height: 22, borderRadius: '50%', background: col.c, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 0 0 4px #fff' }}><Icon name="check" size={13} color="#fff" /></span>
                        : <span style={{ width: active ? 18 : 15, height: active ? 18 : 15, transform: 'rotate(45deg)', borderRadius: 3, background: col.c, boxShadow: `0 0 0 4px #fff, 0 0 0 ${active ? 7 : 5}px ${col.c}33` }} />}
                    </span>
                  </button>
                )
              })}
            </div>
          </div>

          {!sel ? (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 14 }}>
              {ms.map((m, i) => <MilestoneCard key={m.id} m={m} n={i + 1} col={colOf(m, i)} onOpen={() => setSelId(m.id)} />)}
            </div>
          ) : (
            <MilestonePanel
              m={sel} n={ms.indexOf(sel) + 1} col={colOf(sel, ms.indexOf(sel))} busy={busy}
              mayEdit={sel.can_edit && f('milestones', 'edit')}
              mayAchieve={sel.can_work && isOpen(sel) && f('milestone_status', 'approve')}
              mayReopen={sel.can_edit && sel.status === 'done' && f('milestone_status', 'edit')}
              mayCancel={sel.can_edit && isOpen(sel) && f('milestone_status', 'cancel')}
              mayDelete={sel.can_delete && f('milestones', 'delete')}
              onClose={() => setSelId(null)}
              onEdit={() => openMs(sel)}
              onAchieve={() => achieve(sel)}
              onReason={(action) => setReason({ m: sel, action })}
              onDelete={() => setDelMs(sel)}
            >
              {f('tasks', 'view') ? (
                <TasksBoard
                  key={sel.id}
                  api={{
                    ...taskApi,
                    list: async () => (await taskApi.list()).filter((t) => t.milestone_id === sel.id),
                    create: (p, parentId) => taskApi.create({ ...p, milestone_id: sel.id }, parentId),
                  }}
                  userId={userId} canManage={isManager} labels={labels}
                  canCreate={sel.can_plan && rights.create}
                  rights={rights}
                  reloadKey={sel.id}
                  onTasksChange={() => load()}
                />
              ) : (
                <p style={{ fontSize: 13, color: MUTED, margin: 0 }}>Your role can&apos;t see project tasks (R&amp;D › Prototype / Research › Project tasks).</p>
              )}
            </MilestonePanel>
          )}

          {sel && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {ms.map((m, i) => m.id === sel.id ? null : (
                // ui-audit-ignore-next-line custom-button — whole milestone summary row (card), not a pill button
                <button key={m.id} type="button" onClick={() => setSelId(m.id)}
                  style={{ ...card, display: 'flex', alignItems: 'center', gap: 14, padding: '11px 16px', cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit', flexWrap: 'wrap', opacity: m.status === 'cancelled' ? 0.55 : 1 }}>
                  <span style={{ width: 26, height: 26, borderRadius: '50%', background: colOf(m, i).c, color: '#fff', fontSize: 12.5, fontWeight: 700, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>{i + 1}</span>
                  <span style={{ flex: '1 1 180px', fontSize: 14, fontWeight: 600, color: INK }}>{m.title}</span>
                  <span style={{ flex: '0 1 130px', fontSize: 13, color: BODY }}>{fmt(m.due_date)}</span>
                  <span style={{ flex: '1 1 160px', maxWidth: 220 }}><Bar value={pctOf(m)} color={colOf(m, i).c} /></span>
                  <span style={{ fontSize: 13, fontWeight: 700, color: INK, width: 44 }}>{pctOf(m)}%</span>
                  <span style={{ fontSize: 12.5, color: MUTED, width: 80 }}>{m.tasks_done} / {m.tasks_total} Tasks</span>
                  <Icon name="down" size={16} color={MUTED} />
                </button>
              ))}
            </div>
          )}

          {f('tasks', 'view') && (
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
          )}
        </>
      )}

      {/* Tasks given before the project had milestones. */}
      {loose > 0 && f('tasks', 'view') && (
        <div data-tour="rnd-ms-loose-tasks" style={{ ...card, padding: 18 }}>
          <h3 style={{ fontSize: 15, fontWeight: 700, color: INK, margin: '0 0 4px' }}>Tasks not in a milestone</h3>
          <p style={{ fontSize: 12.5, color: MUTED, margin: '0 0 12px' }}>Given before this project had milestones. New tasks are added inside a milestone.</p>
          <TasksBoard
            api={{ ...taskApi, list: async () => (await taskApi.list()).filter((t) => !t.milestone_id) }}
            userId={userId} canManage={isManager} labels={labels} canCreate={false} rights={rights}
            reloadKey={project.id}
            onTasksChange={(ts) => setLoose(ts.length)}
          />
        </div>
      )}

      {/* Create / edit milestone — same form as Project Management */}
      {msForm && (
        <FormSheet icon="flag" iconColor={BLUE} title={msForm.id ? 'Edit Milestone' : 'Create Milestone'} subtitle={msForm.id ? 'Change the milestone details.' : `Add a new milestone to ${project.project_number}'s plan.`}
          onClose={() => setMsForm(null)} busy={busy}
          footer={<>
            <button type="button" onClick={() => setMsForm(null)} disabled={busy} style={sheetBtn('secondary', INK, busy)}>Cancel</button>
            <button type="button" data-tour="rnd-ms-form-save" onClick={saveMs} disabled={busy} style={sheetBtn('primary', '#16a34a', busy)}><SheetIcon name={msForm.id ? 'check' : 'plus'} size={16} />{busy ? 'Saving…' : msForm.id ? 'Save Milestone' : 'Create Milestone'}</button>
          </>}>
          {(() => {
            const col = msForm.color ? tint(msForm.color) : colorOf(msForm.id ? ms.findIndex((x) => x.id === msForm.id) : ms.length)
            const days = daysFromToday(msForm.due_date)
            const editingClosed = !!msForm.id && !['todo', 'in_progress', 'blocked'].includes(msForm.status)
            const st = MS_STATE[msForm.status] || MS_STATE.todo
            return (
              <SheetColumns left={<>
                  <SheetError error={formError} />
                  <SheetSection icon="list" title="Basic Information">
                    <label style={sheetLabel}>Milestone Name <Req /></label>
                    <input style={sheetInput} value={msForm.title} onChange={(e) => setMsForm({ ...msForm, title: e.target.value })} placeholder="Enter milestone name (e.g. Concept design, Prototype build, Field trial)" autoFocus />
                    <label style={{ ...sheetLabel, marginTop: 14 }}>Description</label>
                    <textarea style={{ ...sheetInput, minHeight: 72, resize: 'vertical' }} value={msForm.description} onChange={(e) => setMsForm({ ...msForm, description: e.target.value })}
                      placeholder="What 'achieved' means for this milestone — the deliverable or completion criteria" />
                  </SheetSection>
                  <SheetSection icon="calendar" title="Schedule">
                    <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
                      <div style={{ flex: '1 1 160px', minWidth: 0 }}>
                        <label style={sheetLabel}>Start Date</label>
                        <DateField value={msForm.start_date} onChange={(v) => setMsForm({ ...msForm, start_date: v })} />
                      </div>
                      <div style={{ flex: '1 1 160px', minWidth: 0 }}>
                        <label style={sheetLabel}>End Date <Req /></label>
                        <DateField value={msForm.due_date} onChange={(v) => setMsForm({ ...msForm, due_date: v })} />
                      </div>
                      <div style={{ flex: '0 1 120px', minWidth: 0 }}>
                        <label style={sheetLabel}>From today</label>
                        <div style={{ ...sheetInput, background: SOFT, color: days !== null && days < 0 ? '#be123c' : BODY }}>{days === null ? '—' : days < 0 ? `${-days} days ago` : `${days} days`}</div>
                      </div>
                    </div>
                    <p style={sheetHint}>Start date is filled in after the last milestone — change it if needed. End date = the expected achievable date. Tasks in this milestone can&apos;t be due after it.{project.target_end_date ? ` The project's target end is ${fmt(project.target_end_date)}.` : ''}</p>
                  </SheetSection>
                  <SheetSection icon="flag" title="Status">
                    {editingClosed ? (
                      <div style={{ ...sheetInput, background: SOFT }}>{st.text} — use Reopen on the milestone to change it.</div>
                    ) : (
                      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                        <div style={{ flex: '0 1 200px', minWidth: 0 }}>
                          <Select style={sheetInput} value={msForm.status} onChange={(e) => setMsForm({ ...msForm, status: e.target.value })}>
                            <option value="todo">Not Started</option>
                            <option value="in_progress">In Progress</option>
                            <option value="blocked">On Hold</option>
                          </Select>
                        </div>
                        {msForm.status === 'blocked' && (
                          <div style={{ flex: '1 1 220px', minWidth: 0 }}>
                            <input style={sheetInput} value={msForm.blocker_reason} onChange={(e) => setMsForm({ ...msForm, blocker_reason: e.target.value })} placeholder="Why is it on hold? *" />
                          </div>
                        )}
                      </div>
                    )}
                    <p style={sheetHint}>Achieved and Cancelled are set with the buttons on the milestone.</p>
                  </SheetSection>
                  <SheetSection icon="user" title="Responsibility">
                    <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                      <div style={{ flex: '1 1 220px', minWidth: 0 }}>
                        <label style={sheetLabel}>Responsible Person <Req /></label>
                        <SearchableSelect value={msForm.assignee_id} onChange={(v) => setMsForm({ ...msForm, assignee_id: v, co_owner_ids: msForm.co_owner_ids.filter((x) => x !== v) })} options={ownerOpts} placeholder={people ? 'Search a person…' : 'Loading the project team…'} />
                      </div>
                      <div style={{ flex: '1 1 220px', minWidth: 0 }}>
                        <label style={sheetLabel}>More Responsible People <span style={{ color: MUTED, fontWeight: 400 }}>(optional)</span></label>
                        <MultiPick values={msForm.co_owner_ids} onChange={(v) => setMsForm({ ...msForm, co_owner_ids: v })}
                          options={ownerOpts.filter((o) => o.value !== msForm.assignee_id)} placeholder="Add a person…" />
                      </div>
                    </div>
                    <p style={sheetHint}>Only people on the project team (Project Leads / Team Members) are listed. Everyone here is notified, can add the milestone&apos;s tasks and mark it achieved once its tasks are done.</p>
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
                  <SheetSection icon="search" title="Preview" color={col.c}>
                    <div style={{ borderRadius: 14, background: col.soft, border: `1px solid ${col.mid}`, padding: 14 }}>
                      <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                        <span style={{ width: 32, height: 32, borderRadius: 9, background: col.c, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><Icon name={msIcon(msForm)} size={17} color="#fff" /></span>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 15, fontWeight: 700, color: INK, wordBreak: 'break-word' }}>{msForm.title.trim() || 'Milestone Name'}</div>
                          <div style={{ fontSize: 12, color: BODY, marginTop: 2 }}>{msForm.start_date ? `${fmt(msForm.start_date)} → ` : 'By '}{msForm.due_date ? fmt(msForm.due_date) : '—'}</div>
                        </div>
                        <Chip text={st.text} c={st.c} bg={st.bg} dot />
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12 }}>
                        <Avatar name={personName(msForm.assignee_id) || '?'} size={24} />
                        <span style={{ fontSize: 12.5, color: BODY }}>{[personName(msForm.assignee_id) || 'Responsible person', ...msForm.co_owner_ids.filter((x) => x !== msForm.assignee_id).map((x) => personName(x)).filter(Boolean)].join(', ')}</span>
                      </div>
                    </div>
                  </SheetSection>
                  <p style={{ fontSize: 12.5, color: MUTED, margin: 0 }}>Attachments, updates and approvals go on the milestone&apos;s tasks.</p>
                </>} />
            )
          })()}
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
            <SheetError error={reasonError} />
            <label style={sheetLabel}>{reason.action === 'reopen' ? 'Why is it being reopened?' : 'Why is it being cancelled?'} <Req /></label>
            <textarea style={{ ...sheetInput, minHeight: 80, resize: 'vertical' }} value={reasonText} onChange={(e) => setReasonText(e.target.value)} autoFocus
              placeholder={reason.action === 'reopen' ? 'e.g. Test results failed — prototype needs a redesign' : 'e.g. Scope dropped after the feasibility review'} />
            <p style={sheetHint}>{reason.action === 'reopen' ? 'The responsible people will see this.' : 'Its open tasks must be cancelled first. The record is kept in History.'}</p>
          </div>
        </FormSheet>
      )}
      <ConfirmDialog
        open={!!delMs}
        title="Delete milestone"
        message={`Delete '${delMs?.title}'? It has no tasks, so nothing else is lost. The deletion is kept in History.`}
        confirmLabel="Delete milestone"
        danger
        onConfirm={() => { const m = delMs; setDelMs(null); if (m) deleteMs(m) }}
        onCancel={() => setDelMs(null)}
      />
    </div>
  )
}

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
              <button type="button" aria-label="Remove" onClick={() => onChange(values.filter((x) => x !== v))} style={{ border: 'none', background: 'none', cursor: 'pointer', padding: 0, color: '#1d4ed8', display: 'inline-flex' }}><SheetIcon name="x" size={12} /></button>
            </span>
          ))}
        </div>
      )}
      <SearchableSelect value="" onChange={(v) => { if (v && !values.includes(v)) onChange([...values, v]) }}
        options={options.filter((o) => !values.includes(o.value))} placeholder={placeholder} />
    </div>
  )
}

function MilestoneCard({ m, n, col, onOpen }: { m: RndMilestone; n: number; col: typeof PALETTE[number]; onOpen: () => void }) {
  const [hover, setHover] = useState(false)
  const pct = pctOf(m)
  const st = MS_STATE[m.status] || MS_STATE.todo
  return (
    <div role="button" tabIndex={0} onClick={onOpen} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen() } }}
      onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      style={{ background: col.soft, border: `1px solid ${hover ? col.c : col.mid}`, borderRadius: 16, padding: 18, cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 12,
        boxShadow: hover ? `0 12px 28px ${col.c}22` : 'none', transition: 'box-shadow .15s, border-color .15s', opacity: m.status === 'cancelled' ? 0.6 : 1 }}>
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
        <span style={{ width: 34, height: 34, borderRadius: '50%', background: col.c, color: '#fff', fontWeight: 700, fontSize: 15, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{n}</span>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 16.5, fontWeight: 700, color: INK, lineHeight: 1.25, wordBreak: 'break-word' }}>{m.title}</div>
          <div style={{ fontSize: 13, color: m.is_overdue ? '#be123c' : BODY, marginTop: 4 }}>{m.start_date ? `${fmt(m.start_date, false)} → ${fmt(m.due_date)}` : `Due ${fmt(m.due_date)}`}</div>
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <Chip text={st.text} c={st.c} bg={st.bg} dot />
        {m.is_overdue && <Chip text={dueText(m.due_date)} c="#be123c" bg="#ffe4e6" />}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 7, minHeight: 60 }}>
        {m.tasks.length === 0 && <span style={{ fontSize: 13, color: MUTED }}>No tasks yet — open to add tasks.</span>}
        {m.tasks.slice(0, 5).map((s) => (
          <span key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13.5, color: BODY }}>
            <span style={{ width: 18, height: 18, borderRadius: '50%', background: s.done ? col.c : '#fff', border: `1.5px solid ${col.c}`, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{s.done && <Icon name="check" size={11} color="#fff" />}</span>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.title}</span>
          </span>
        ))}
        {m.tasks.length > 5 && <span style={{ fontSize: 12.5, color: col.c, fontWeight: 600 }}>+{m.tasks.length - 5} more</span>}
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

function MilestonePanel({ m, n, col, busy, mayEdit, mayAchieve, mayReopen, mayCancel, mayDelete, onClose, onEdit, onAchieve, onReason, onDelete, children }: {
  m: RndMilestone; n: number; col: typeof PALETTE[number]; busy: boolean
  mayEdit: boolean; mayAchieve: boolean; mayReopen: boolean; mayCancel: boolean; mayDelete: boolean
  onClose: () => void; onEdit: () => void; onAchieve: () => void; onReason: (a: 'reopen' | 'cancel') => void; onDelete: () => void
  children: React.ReactNode
}) {
  const pct = pctOf(m)
  const st = MS_STATE[m.status] || MS_STATE.todo
  const open = isOpen(m)
  return (
    <div data-tour="rnd-ms-panel" style={{ background: '#fff', border: `1.5px solid ${col.c}55`, borderRadius: 18, boxShadow: `0 10px 30px ${col.c}14` }}>
      <div style={{ background: col.soft, padding: '18px 20px', display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap', borderBottom: `1px solid ${col.mid}`, borderRadius: '18px 18px 0 0' }}>
        <span title={`Milestone ${n}`} style={{ width: 44, height: 44, borderRadius: 12, background: col.c, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><Icon name={msIcon(m)} size={22} color="#fff" /></span>
        <div style={{ flex: '1 1 300px', minWidth: 0 }}>
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
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><Avatar name={m.assignee_name} size={24} />Responsible: <b style={{ color: INK }}>{m.assignee_name || '—'}</b>{m.department_name ? ` (${m.department_name})` : ''}{m.co_owner_names.length ? ` + ${m.co_owner_names.join(', ')}` : ''}</span>
            <span>Given by <b style={{ color: INK }}>{m.created_by_name || '—'}</b>{m.created_at ? ` on ${fmt(m.created_at)}` : ''}</span>
            {m.status === 'done' && m.completed_by_name && <span>Achieved by <b style={{ color: INK }}>{m.completed_by_name}</b>{m.completed_at ? ` on ${fmt(m.completed_at)}` : ''}</span>}
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
          <div style={{ fontSize: 12.5, color: MUTED, marginTop: 4 }}>{m.tasks_done} / {m.tasks_total} Tasks Completed</div>
        </div>
        <button type="button" onClick={onClose} aria-label="Close milestone" title="Back to all milestones" style={sheetBtn('secondary', INK)}>← Back</button>
      </div>

      {(mayAchieve || mayEdit || mayReopen || mayCancel || mayDelete) && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', padding: '10px 20px', borderBottom: `1px solid ${LINE}`, background: '#fff' }}>
          {mayAchieve && <button type="button" data-tour="rnd-ms-achieve-btn" disabled={busy} onClick={onAchieve} title="Every task in it must be completed or cancelled first" style={{ ...sheetBtn('secondary', INK, busy), color: '#15803d' }}><Icon name="check" size={15} /> Mark achieved</button>}
          {mayEdit && <button type="button" data-tour="rnd-ms-edit-btn" disabled={busy} onClick={onEdit} style={sheetBtn('secondary', INK, busy)}><Icon name="edit" size={15} /> Edit milestone</button>}
          {mayReopen && <button type="button" disabled={busy} onClick={() => onReason('reopen')} style={{ ...sheetBtn('secondary', INK, busy), color: '#b45309' }}>Reopen</button>}
          {mayCancel && <button type="button" disabled={busy} onClick={() => onReason('cancel')} style={sheetBtn('secondary', INK, busy)}>Cancel milestone</button>}
          {mayDelete && <button type="button" disabled={busy} onClick={onDelete} style={{ ...sheetBtn('secondary', INK, busy), border: '1px solid #fecdd3', background: '#fff1f2', color: '#be123c', marginLeft: 'auto' }}><Icon name="trash" size={15} /> Delete</button>}
        </div>
      )}

      <div style={{ padding: 20 }}>{children}</div>
    </div>
  )
}
