'use client'

// R&D › R&D Tasks (renamed from My Tasks) — every R&D task on one page: Requirement
// tasks (given on a requirement R&D has accepted) and Prototype tasks (given on a
// Prototype / Research project). "Create Task" asks for the Type first; the tiles,
// the table and the grouped views all follow the same filters. PM tasks stay in
// Project Management › My Tasks. People without the "All R&D tasks & analytics"
// feature (and who are not heads) see only the tasks assigned to or created by them.

import Select from '@/components/shared/Select'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { rndApi, usersApi } from '@/lib/api'
import { DirectoryUser } from '@/types'
import { TEXT } from '@/lib/theme'
import { primaryBtnStyle, secondaryBtnStyle, inputStyle as sharedInputStyle } from '@/components/shared/ui'
import { FiltersButton, FiltersSheet } from '@/components/p2p/POTrackingShared'
import { sheetInput, sheetLabel } from '@/components/shared/FormSheet'
import DateField from '@/components/erp/DateField'
import RndNav from '@/components/rnd/RndNav'
import TaskCreateSheet from '@/components/rnd/TaskCreateSheet'
import RndTaskAnalyticsView, { TaskView } from '@/components/rnd/RndTaskAnalytics'
import { recordPath } from '@/lib/recordRef'
import { extractErrorMessages } from '@/lib/validation'
import { useCan } from '@/lib/permissions'
import { PRIORITY_OPTIONS, type Priority } from '@/lib/priority'
import type { RndTaskAnalytics, RndTaskFilters, RndTaskGroup, RndTaskRow } from '@/types/rndIntake'

const PAGE_SIZE = 100
const STATUS_OPTIONS = [
  { value: 'pending', label: 'Pending (open, not overdue)' },
  { value: 'overdue', label: 'Overdue' },
  { value: 'completed', label: 'Completed' },
  { value: 'cancelled', label: 'Cancelled' },
]
const BAND_OPTIONS = [
  { value: '0', label: '0% — not started' },
  { value: '1-49', label: '1–49%' },
  { value: '50-99', label: '50–99%' },
  { value: '100', label: '100% — done' },
]

// Shared 34px control scale; list filters keep their own width.
const inputStyle: React.CSSProperties = { ...sharedInputStyle, width: 'auto', background: 'rgba(255,255,255,.7)' }

type Draft = { parent: string; user: string; department: string; type: string; status: string; priority: string; from: string; to: string; band: string }
const EMPTY: Draft = { parent: '', user: '', department: '', type: '', status: '', priority: '', from: '', to: '', band: '' }

/** Draft → the API filters. parent = "requirement:<id>" or "project:<id>". */
function toFilters(d: Draft, q: string): RndTaskFilters {
  const f: RndTaskFilters = {}
  const [kind, id] = d.parent.split(':')
  if (kind === 'requirement' && id) f.requirement_id = Number(id)
  if (kind === 'project' && id) f.rnd_project_id = Number(id)
  if (d.user) f.assigned_to_id = Number(d.user)
  if (d.department) f.department = d.department
  if (d.type === 'requirement' || d.type === 'prototype') f.type = d.type
  if (d.status) f.status = d.status
  if (d.priority === 'standard' || d.priority === 'urgent') f.priority = d.priority as Priority
  if (d.from) f.due_from = d.from
  if (d.to) f.due_to = d.to
  if (d.band) f.progress_band = d.band as RndTaskFilters['progress_band']
  if (q.trim()) f.q = q.trim()
  return f
}

export default function RndTasksPage() {
  const { isAuthorized, isLoading } = useRequireApp('rnd')
  const { can, canFeature } = useCan()
  const router = useRouter()

  const [applied, setApplied] = useState<Draft>(EMPTY)
  const [draft, setDraft] = useState<Draft>(EMPTY)
  const [showFilters, setShowFilters] = useState(false)
  const [search, setSearch] = useState('')
  const [view, setView] = useState<TaskView>('task')
  const [page, setPage] = useState(1)
  const [rows, setRows] = useState<RndTaskRow[] | null>(null)
  const [total, setTotal] = useState(0)
  const [analytics, setAnalytics] = useState<RndTaskAnalytics | null>(null)
  const [error, setError] = useState<string | string[]>('')
  const [creating, setCreating] = useState(false)
  const [reload, setReload] = useState(0)

  // Filter pickers: people (with their department), requirements by R&D ID, projects by RND number.
  const [users, setUsers] = useState<DirectoryUser[]>([])
  const [reqs, setReqs] = useState<{ value: string; label: string }[]>([])
  const [projs, setProjs] = useState<{ value: string; label: string }[]>([])

  useEffect(() => {
    if (!isAuthorized) return
    usersApi.directory().then((d) => setUsers(Array.isArray(d) ? d : [])).catch(() => setUsers([]))
    rndApi.listRequirements().then((rows) => setReqs(rows.filter((r) => r.rd_number && r.requirement_id != null).sort((a, b) => (a.rd_number || '').localeCompare(b.rd_number || '', undefined, { numeric: true }))
      .map((r) => ({ value: `requirement:${r.requirement_id}`, label: r.rd_number || r.universal_id })))).catch(() => setReqs([]))
    rndApi.listProjects().then((rows: { id: number; project_number: string; title: string }[]) => setProjs((Array.isArray(rows) ? rows : [])
      .sort((a, b) => a.project_number.localeCompare(b.project_number, undefined, { numeric: true })).map((p) => ({ value: `project:${p.id}`, label: `${p.project_number} — ${p.title}` })))).catch(() => setProjs([]))
  }, [isAuthorized])

  const filters = useMemo(() => toFilters(applied, search), [applied, search])
  const filtersKey = JSON.stringify(filters)

  // Any change of filters / search goes back to page 1.
  useEffect(() => { Promise.resolve().then(() => setPage(1)) }, [filtersKey])

  const load = useCallback(() => {
    setError('')
    const f = { ...JSON.parse(filtersKey) as RndTaskFilters, page, page_size: PAGE_SIZE }
    // Tiles, table and grouped views all use the same filtered set.
    return Promise.all([rndApi.listRndTasks(f), rndApi.rndTaskAnalytics(JSON.parse(filtersKey) as RndTaskFilters)])
      .then(([list, an]) => { setRows(list.items); setTotal(list.total); setAnalytics(an) })
      .catch((err) => { setRows([]); setTotal(0); setAnalytics(null); setError(extractErrorMessages(err, 'Could not load the R&D tasks. Refresh the page; if it keeps failing, check you have R&D › R&D Tasks › View.')) })
  }, [filtersKey, page])

  useEffect(() => {
    if (!isAuthorized) return
    const t = setTimeout(() => { void load() }, 250)
    return () => clearTimeout(t)
  }, [isAuthorized, load, reload])

  if (isLoading || !isAuthorized) return null

  const departments = Array.from(new Set(users.map((u) => u.department).filter((d): d is string => !!d))).sort((a, b) => a.localeCompare(b))
  const sortedUsers = [...users].sort((a, b) => a.name.localeCompare(b.name))
  const activeCount = Object.values(applied).filter(Boolean).length
  const seesAll = canFeature('rnd', 'tasks', 'analytics', 'view')

  const openFilters = () => { setDraft(applied); setShowFilters(true) }
  const apply = () => { setApplied(draft); setShowFilters(false) }
  const clear = () => { setApplied(EMPTY); setDraft(EMPTY); setSearch(''); setShowFilters(false) }
  const set = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }))

  // Opens the task's parent through a signed ref — never a raw id; an edited link shows "Invalid link".
  const openTask = (t: RndTaskRow) => {
    const p = t.parent
    try {
      router.push(p.kind === 'requirement'
        ? `${recordPath(`/dashboard/rnd/requirements/${p.source || 'inquiry'}`, p, 'record_id')}?tab=tasks`
        : `${recordPath('/dashboard/rnd/projects', p)}?tab=tasks`)
    } catch (err) {
      setError(extractErrorMessages(err, 'Could not open this task — reload the page and try again.'))
    }
  }
  const openGroup = (g: RndTaskGroup) => {
    try {
      router.push(g.kind === 'requirement' ? recordPath(`/dashboard/rnd/requirements/${g.source || 'inquiry'}`, g, 'record_id') : recordPath('/dashboard/rnd/projects', g))
    } catch (err) {
      setError(extractErrorMessages(err, 'Could not open this record — reload the page and try again.'))
    }
  }

  return (
    <div>
      <RndNav />
      <div data-tour="rnd-tasks-header" style={{ marginBottom: 16, display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: TEXT.heading, margin: 0 }}>R&amp;D Tasks</h1>
          <p style={{ fontSize: 13, color: TEXT.muted, margin: '4px 0 0' }}>
            Tasks on requirements and on prototype / research projects — create, track and see progress.
            {!seesAll && ' You see the tasks assigned to you or created by you; R&D heads and people with “All R&D tasks & analytics” see every task.'}
          </p>
        </div>
      </div>

      {error && (
        <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
          {Array.isArray(error) ? error.join(' ') : error}
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
        {can('rnd', 'tasks', 'create') && (
          <button data-tour="rnd-tasks-create-btn" type="button" onClick={() => setCreating(true)} style={{ ...primaryBtnStyle, whiteSpace: 'nowrap' }}>+ Create Task</button>
        )}
        <input data-tour="rnd-tasks-search" aria-label="Search R&D tasks" style={{ ...inputStyle, flex: '1 1 240px', minWidth: 200 }}
          placeholder="Search task, R&D ID, project or person…" value={search} onChange={(e) => setSearch(e.target.value)} />
        <FiltersButton count={activeCount} onOpen={openFilters} tour="rnd-tasks-filter-btn" />
        {(activeCount > 0 || search) && <button type="button" onClick={clear} style={secondaryBtnStyle}>Clear</button>}
      </div>

      {showFilters && (
        <FiltersSheet subtitle="Narrow the tasks, tiles and grouped views together, then press Apply." tour="rnd-tasks-filter-sheet" applyTour="rnd-tasks-apply-btn"
          onClose={() => setShowFilters(false)} onClear={clear} onApply={apply}>
          <div>
            <label style={sheetLabel}>Project / requirement</label>
            <Select data-tour="rnd-tasks-f-parent" style={sheetInput} value={draft.parent} onChange={(e) => set({ parent: e.target.value })}>
              <option value="">All projects and requirements</option>
              {projs.length > 0 && <optgroup label="Prototype / Research">{projs.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</optgroup>}
              {reqs.length > 0 && <optgroup label="Requirements (R&D ID)">{reqs.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</optgroup>}
            </Select>
          </div>
          <div>
            <label style={sheetLabel}>Assigned user</label>
            <Select data-tour="rnd-tasks-f-user" style={sheetInput} value={draft.user} onChange={(e) => set({ user: e.target.value })}>
              <option value="">Everyone</option>
              {sortedUsers.map((u) => <option key={u.id} value={String(u.id)}>{u.name}</option>)}
            </Select>
          </div>
          <div>
            <label style={sheetLabel}>Department</label>
            <Select data-tour="rnd-tasks-f-department" style={sheetInput} value={draft.department} onChange={(e) => set({ department: e.target.value })}>
              <option value="">All departments</option>
              {departments.map((d) => <option key={d} value={d}>{d}</option>)}
            </Select>
          </div>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <div style={{ flex: '1 1 160px' }}>
              <label style={sheetLabel}>Type</label>
              <Select data-tour="rnd-tasks-f-type" style={sheetInput} value={draft.type} onChange={(e) => set({ type: e.target.value })}>
                <option value="">Requirement and Prototype</option>
                <option value="requirement">Requirement</option>
                <option value="prototype">Prototype</option>
              </Select>
            </div>
            <div style={{ flex: '1 1 160px' }}>
              <label style={sheetLabel}>Status</label>
              <Select data-tour="rnd-tasks-f-status" style={sheetInput} value={draft.status} onChange={(e) => set({ status: e.target.value })}>
                <option value="">All (cancelled hidden)</option>
                {STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </Select>
            </div>
            <div style={{ flex: '1 1 140px' }}>
              <label style={sheetLabel}>Priority</label>
              <Select data-tour="rnd-tasks-f-priority" style={sheetInput} value={draft.priority} onChange={(e) => set({ priority: e.target.value })}>
                <option value="">All priorities</option>
                {PRIORITY_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </Select>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <div style={{ flex: '1 1 160px' }}><label style={sheetLabel}>Due from</label><DateField value={draft.from} onChange={(v) => set({ from: v })} placeholder="Any" /></div>
            <div style={{ flex: '1 1 160px' }}><label style={sheetLabel}>Due to</label><DateField value={draft.to} onChange={(v) => set({ to: v })} placeholder="Any" /></div>
          </div>
          <div>
            <label style={sheetLabel}>Completion progress</label>
            <Select data-tour="rnd-tasks-f-band" style={sheetInput} value={draft.band} onChange={(e) => set({ band: e.target.value })}>
              <option value="">Any progress</option>
              {BAND_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </Select>
          </div>
        </FiltersSheet>
      )}

      <RndTaskAnalyticsView rows={rows} total={total} analytics={analytics} view={view} onView={setView}
        onOpenTask={openTask} onOpenGroup={openGroup} page={page} pageSize={PAGE_SIZE} onPage={setPage} />

      {creating && <TaskCreateSheet onClose={() => setCreating(false)} onCreated={() => { setCreating(false); setReload((n) => n + 1) }} />}
    </div>
  )
}
