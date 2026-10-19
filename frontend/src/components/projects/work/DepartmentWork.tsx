'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/hooks/useAuth'
import { pmWorkApi } from '@/lib/api'
import { PmDepartmentProject, PmProjectMilestone, PmProjectTask, PmWorkContext, PmWorkloadRow } from '@/types'
import { TEXT } from '@/lib/theme'
import { formatDate } from '@/lib/format'
import { extractErrorMessages } from '@/lib/validation'
import { recordPath } from '@/lib/recordRef'
import {
  ErrorBanner, FlagPill, MILESTONE_HEX, MILESTONE_LABELS, PRIORITY_HEX, PRIORITY_LABELS, PROJECT_HEX, PROJECT_LABELS, Pill,
  ProgressBar, TASK_HEX, TASK_LABELS, actionBtn, inputStyle, sectionStyle, tdStyle, thStyle, todayIso,
} from './pmUi'

/** Shared task table — milestone workspace, department work and My Tasks. */
export function TaskTable({ tasks, onOpen, showAssignee = true, showProject = false, actions }: {
  tasks: PmProjectTask[]
  onOpen: (task: PmProjectTask) => void
  showAssignee?: boolean
  showProject?: boolean
  actions?: (t: PmProjectTask) => React.ReactNode
}) {
  const cols = ['Task', ...(showProject ? ['Project / WBS'] : []), ...(showAssignee ? ['Assigned to'] : []), 'Status', 'Priority', 'Due', 'Progress', ...(actions ? [''] : [])]
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 720 }}>
        <thead><tr>{cols.map((c) => <th key={c} style={thStyle}>{c}</th>)}</tr></thead>
        <tbody>
          {tasks.map((t) => (
            <tr key={t.id} onClick={() => onOpen(t)} style={{ cursor: 'pointer', opacity: t.status === 'cancelled' ? 0.55 : 1 }}>
              <td style={tdStyle}>
                <span style={{ fontWeight: 600, color: TEXT.heading }}>{t.title}</span>
                {t.status === 'blocked' && t.blocker_reason && <div style={{ fontSize: 12, color: '#b91c1c' }}>Blocked: {t.blocker_reason}</div>}
                {t.status === 'cancelled' && t.cancel_reason && <div style={{ fontSize: 12, color: TEXT.muted }}>Cancelled: {t.cancel_reason}</div>}
              </td>
              {showProject && <td style={tdStyle}>{t.project_code}<div style={{ fontSize: 12, color: TEXT.muted }}>{t.milestone_title}</div></td>}
              {showAssignee && <td style={tdStyle}>{t.assignee_name || '—'}</td>}
              <td style={tdStyle}>
                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                  <Pill value={t.status} labels={TASK_LABELS} hex={TASK_HEX} />
                  {t.is_overdue && <FlagPill text="Overdue" color="#dc2626" />}
                </div>
              </td>
              <td style={tdStyle}><Pill value={t.priority} labels={PRIORITY_LABELS} hex={PRIORITY_HEX} /></td>
              <td style={{ ...tdStyle, color: t.is_overdue ? '#dc2626' : TEXT.body }}>{formatDate(t.due_date)}</td>
              <td style={tdStyle}>
                <ProgressBar value={t.progress_percent} width={60} />
                {t.subtasks_total > 0 && <div style={{ fontSize: 11.5, color: TEXT.muted }}>{t.subtasks_done}/{t.subtasks_total} sub-tasks</div>}
              </td>
              {actions && <td style={tdStyle}>{actions(t)}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** The Projects tab inside each department module (Design, Electrical,
 * Hydraulic, R&D, ...): every ongoing project the user works on, with the
 * milestones they lead (or their department owns) and the ones they assist
 * on, plus — for leads and heads — team workload and open team tasks.
 * Assistants see only the milestone name, its date and their own open
 * tasks, not its progress. Renders nothing for someone on no milestone.
 *
 * `departments` = the department name(s) this module belongs to (R&D tab →
 * ['R&D']): the tab then shows only those departments' milestones and
 * tasks, even for an admin or someone heading several departments. Left
 * out (Project Management › Department Work) it shows all of the user's. */
export default function DepartmentWork({ departments, between }: { departments?: string[]; between?: React.ReactNode } = {}) {
  const router = useRouter()
  const { user } = useAuth()
  const [ctx, setCtx] = useState<PmWorkContext | null>(null)
  const [deptId, setDeptId] = useState<number | undefined>(undefined)
  const [projects, setProjects] = useState<PmDepartmentProject[]>([])
  const [workload, setWorkload] = useState<PmWorkloadRow[]>([])
  const [tasks, setTasks] = useState<PmProjectTask[]>([])
  const [showClosed, setShowClosed] = useState(false)
  const [error, setError] = useState<string | string[]>('')

  useEffect(() => {
    pmWorkApi.me().then((c: PmWorkContext) => {
      setCtx(c)
      const wanted = (departments || []).map((n) => n.trim().toLowerCase())
      const own = c.departments.filter((d) => d.is_head && (!wanted.length || wanted.includes(d.name.trim().toLowerCase())))
      if (own.length === 1) setDeptId(own[0].id)
    }).catch((err) => setError(extractErrorMessages(err, 'Failed to load your departments.')))
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // This module's departments (several when a name exists twice, e.g. per plant).
  const names = useMemo(() => (departments || []).map((n) => n.trim().toLowerCase()), [departments])
  const inModule = useCallback((name?: string | null) => !names.length || names.includes((name || '').trim().toLowerCase()), [names])
  const moduleDepts = useMemo(() => (ctx?.departments || []).filter((d) => inModule(d.name)), [ctx, inModule])

  useEffect(() => {
    if (!ctx || (ctx.departments.length === 0 && !ctx.lead_milestone_count && !ctx.member_milestone_count)) return
    // In a module tab, team workload is summed over that module's departments.
    const workloadIds = deptId ? [deptId] : names.length ? moduleDepts.map((d) => d.id) : [undefined]
    const loadWorkload = Promise.all((workloadIds.length ? workloadIds : [undefined]).map((id) => pmWorkApi.workload(id)))
      .then((lists: PmWorkloadRow[][]) => {
        const byUser = new Map<string, PmWorkloadRow>()
        for (const w of lists.flat()) {
          const k = String(w.user_id ?? w.name)
          const cur = byUser.get(k)
          byUser.set(k, cur ? { ...cur, open: cur.open + w.open, in_progress: cur.in_progress + w.in_progress, blocked: cur.blocked + w.blocked,
            overdue: cur.overdue + w.overdue, hours: cur.hours + w.hours, logged: cur.logged + w.logged } : w)
        }
        return Array.from(byUser.values())
      })
    Promise.all([pmWorkApi.departmentProjects(deptId), loadWorkload, pmWorkApi.departmentTasks({ department_id: deptId })])
      .then(([p, w, t]: [PmDepartmentProject[], PmWorkloadRow[], PmProjectTask[]]) => {
        setProjects(p
          .map((x) => ({ ...x, milestones: x.milestones.filter((m) => inModule(m.department_name)) }))
          .map((x) => ({ ...x, open_milestones: x.milestones.filter((m) => !['achieved', 'cancelled'].includes(m.status)).length }))
          .filter((x) => x.milestones.length > 0))
        setWorkload(w)
        setTasks(t.filter((task) => inModule(task.department_name)))
        setError('')
      })
      .catch((err) => setError(extractErrorMessages(err, 'Failed to load department work.')))
  }, [ctx, deptId, names, moduleDepts, inModule])

  const onAny = !!ctx && (ctx.departments.length > 0 || ctx.lead_milestone_count > 0 || ctx.member_milestone_count > 0)
  const leads = !!ctx && (ctx.departments.length > 0 || ctx.lead_milestone_count > 0)
  if (!ctx) return error ? <ErrorBanner error={error} /> : null
  if (!onAny) return (
    <>
      <ErrorBanner error={error} />
      {between}
      <div style={sectionStyle}><p style={{ fontSize: 13, color: TEXT.muted, margin: 0 }}>You are not on any WBS here yet. When a project manager makes you a WBS lead or assistant, it shows up on this page.</p></div>
    </>
  )

  const shown = projects.filter((p) => showClosed || p.open_milestones > 0)
  const nextStep = (s: string) => ({ not_started: 'Create & assign tasks', in_progress: 'Team working', submitted: 'Waiting for management', achieved: 'Accepted', cancelled: 'Cancelled' } as Record<string, string>)[s] || ''
  const stepText = (m: PmProjectMilestone) => m.is_locked ? (m.waiting_reason ? `Waits for ${m.waiting_reason}` : `Waits for step ${m.waiting_for_sequence}`) : m.my_role === 'member' ? `${m.task_count} open task(s) for you` : nextStep(m.status)
  const blockedFirst = [...tasks].sort((a, b) => Number(b.status === 'blocked') - Number(a.status === 'blocked') || Number(b.is_overdue) - Number(a.is_overdue))
  const canOpenProject = !!user?.apps?.includes('projects')
  const teamEmpty = workload.length === 0 && tasks.length === 0

  return (
    <div>
      <ErrorBanner error={error} />
      <div data-tour="pm-dw-projects" style={sectionStyle}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 4 }}>
          <h2 style={{ fontSize: 17, fontWeight: 700, color: TEXT.heading, margin: 0 }}>My projects</h2>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            {moduleDepts.length > 1 && (
              <select data-tour="pm-dw-dept-filter" style={{ ...inputStyle, width: 200 }} value={deptId ?? ''} onChange={(e) => setDeptId(e.target.value ? Number(e.target.value) : undefined)}>
                <option value="">{names.length ? 'All' : 'All my departments'}</option>
                {moduleDepts.map((d) => <option key={d.id} value={d.id}>{d.name} (#{d.id})</option>)}
              </select>
            )}
            <label data-tour="pm-dw-show-finished" style={{ fontSize: 12.5, color: TEXT.secondary, display: 'flex', gap: 6, alignItems: 'center', cursor: 'pointer' }}>
              <input type="checkbox" checked={showClosed} onChange={(e) => setShowClosed(e.target.checked)} /> Show finished
            </label>
          </div>
        </div>
        {shown.length === 0 ? <p style={{ fontSize: 13, color: TEXT.muted, margin: '8px 0 0' }}>No open WBS elements for you.</p> : shown.map((p) => (
          <div key={p.project.id} style={{ borderTop: '1px solid rgba(0,0,0,0.07)', paddingTop: 12, marginTop: 12 }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 6 }}>
              {canOpenProject ? (
                <a href="#" onClick={(e) => { e.preventDefault(); router.push(recordPath('/dashboard/projects', p.project)) }} style={{ fontSize: 14, fontWeight: 700, color: LINK, textDecoration: 'none' }}>{p.project.project_code}</a>
              ) : <strong style={{ fontSize: 14, color: TEXT.heading }}>{p.project.project_code}</strong>}
              <span style={{ fontSize: 13, color: TEXT.secondary }}>{p.project.name}</span>
              <Pill value={p.project.status} labels={PROJECT_LABELS} hex={PROJECT_HEX} />
              <span style={{ fontSize: 12, color: TEXT.muted, marginLeft: 'auto' }}>PM {p.project.project_manager_name || '—'} · handover {formatDate(p.project.target_handover_date)}</span>
            </div>
            {p.project.status === 'on_hold' && <p style={{ fontSize: 12.5, color: '#b45309', margin: '0 0 8px' }}>On hold: {p.project.hold_reason}</p>}
            <div style={{ overflowX: 'auto' }}>
              <div style={{ minWidth: 720 }}>
                {p.milestones.filter((m) => showClosed || !['achieved', 'cancelled'].includes(m.status)).map((m) => (
                  <WbsRow key={m.id} m={m} hint={stepText(m)} onOpen={() => router.push(recordPath('/dashboard/projects/milestones', m))} />
                ))}
              </div>
            </div>
          </div>
        ))}
      </div>

      {between}

      {leads && (teamEmpty ? (
        <div data-tour="pm-dw-workload" style={sectionStyle}>
          <h2 style={{ fontSize: 16, fontWeight: 700, color: TEXT.heading, margin: '0 0 4px' }}>Team</h2>
          <p style={{ fontSize: 13, color: TEXT.muted, margin: 0 }}>No open team tasks. Open a WBS above and assign its tasks — workload and open tasks show up here.</p>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 20 }}>
          <div data-tour="pm-dw-workload" style={{ ...sectionStyle, marginBottom: 0 }}>
            <h2 style={{ fontSize: 16, fontWeight: 700, color: TEXT.heading, margin: '0 0 12px' }}>Team workload</h2>
            {workload.length === 0 ? <p style={{ fontSize: 13, color: TEXT.muted, margin: 0 }}>No open tasks.</p> : (
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr>{['Person', 'Open', 'In progress', 'Blocked', 'Overdue', 'Est. h', 'Logged h'].map((h) => <th key={h} style={thStyle}>{h}</th>)}</tr></thead>
                <tbody>
                  {workload.map((w) => (
                    <tr key={w.user_id ?? 0}>
                      <td style={tdStyle}>{w.name}</td>
                      <td style={tdStyle}>{w.open}</td>
                      <td style={tdStyle}>{w.in_progress}</td>
                      <td style={{ ...tdStyle, color: w.blocked ? '#dc2626' : TEXT.body }}>{w.blocked}</td>
                      <td style={{ ...tdStyle, color: w.overdue ? '#dc2626' : TEXT.body }}>{w.overdue}</td>
                      <td style={tdStyle}>{w.hours ? w.hours.toFixed(1) : '—'}</td>
                      <td style={tdStyle}>{w.logged ? w.logged.toFixed(1) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
          <div data-tour="pm-dw-team-tasks" style={{ ...sectionStyle, marginBottom: 0 }}>
            <h2 style={{ fontSize: 16, fontWeight: 700, color: TEXT.heading, margin: '0 0 12px' }}>Open team tasks ({tasks.length})</h2>
            {tasks.length === 0 ? <p style={{ fontSize: 13, color: TEXT.muted, margin: 0 }}>No open tasks.</p> :
              <TaskTable tasks={blockedFirst} showProject onOpen={(t) => router.push(recordPath('/dashboard/projects/tasks', t))} />}
          </div>
        </div>
      ))}
    </div>
  )
}

const LINK = '#2563eb'
const WBS_COLS = 'minmax(220px, 1fr) 150px 130px 110px 190px'

/** Days from today to an ISO date (negative = past). */
function daysUntil(iso?: string | null): number | null {
  if (!iso) return null
  return Math.round((new Date(iso).getTime() - new Date(todayIso()).getTime()) / 86400000)
}

/** One WBS line on My projects: name | status | progress | due | next step. */
function WbsRow({ m, hint, onOpen }: { m: PmProjectMilestone; hint: string; onOpen: () => void }) {
  const [hover, setHover] = useState(false)
  const open = !['achieved', 'cancelled'].includes(m.status)
  const days = daysUntil(m.target_date)
  const dueColor = !open ? TEXT.muted : m.is_overdue || (days !== null && days < 0) ? '#dc2626' : days !== null && days <= 3 ? '#c2410c' : TEXT.secondary
  // The department is already in the title when the WBS is named after it.
  const sameAsDept = (m.title || '').trim().toLowerCase() === (m.department_name || '').trim().toLowerCase()
  const role = m.my_role === 'member' ? `assistant · lead ${m.lead_name || '—'}` : `lead ${m.lead_name || '—'}`
  const needsPlan = m.my_role !== 'member' && m.status === 'not_started' && !m.is_locked
  return (
    <div onClick={onOpen} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      style={{ display: 'grid', gridTemplateColumns: WBS_COLS, gap: 12, alignItems: 'center', padding: '9px 10px', borderRadius: 10, cursor: 'pointer', background: hover ? 'rgba(0,0,0,0.035)' : 'transparent' }}>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 13.5, fontWeight: 600, color: hover ? LINK : TEXT.heading }}>
          <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.04em', textTransform: 'uppercase', color: TEXT.muted, marginRight: 8 }}>Step {m.sequence}</span>
          {m.title}
        </div>
        <div style={{ fontSize: 11.5, color: TEXT.muted }}>{sameAsDept ? role : `${m.department_name} · ${role}`}</div>
      </div>
      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
        <Pill value={m.status} labels={MILESTONE_LABELS} hex={MILESTONE_HEX} />
        {m.is_overdue && <FlagPill text="Overdue" color="#dc2626" />}
        {m.is_at_risk && <FlagPill text="At risk" color="#f59e0b" />}
        {m.is_locked && <FlagPill text="Locked" color="#64748b" />}
      </div>
      <div>
        {m.my_role === 'member' || (m.status === 'not_started' && !m.progress_percent)
          ? <span style={{ fontSize: 12, color: TEXT.muted }}>—</span>
          : <ProgressBar value={m.progress_percent} width={60} />}
      </div>
      <span style={{ fontSize: 12, color: dueColor, fontWeight: dueColor === TEXT.secondary || dueColor === TEXT.muted ? 500 : 700 }}>
        Due {formatDate(m.target_date)}
      </span>
      <div style={{ textAlign: 'right' }}>
        {needsPlan
          ? <button type="button" onClick={(e) => { e.stopPropagation(); onOpen() }} style={{ ...actionBtn('primary'), padding: '6px 12px', fontSize: 12 }}>Create &amp; assign tasks</button>
          : <span style={{ fontSize: 12, fontWeight: 600, color: TEXT.muted }}>{hint}</span>}
      </div>
    </div>
  )
}
