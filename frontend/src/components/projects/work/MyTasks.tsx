'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { pmWorkApi } from '@/lib/api'
import { PmProjectTask } from '@/types'
import { TEXT } from '@/lib/theme'
import { extractErrorMessages } from '@/lib/validation'
import { ErrorBanner, sectionStyle, todayIso } from './pmUi'
import { TaskTable } from './DepartmentWork'
import { recordPath } from '@/lib/recordRef'

/** User's view: only the tasks assigned to them — overdue, due today, in
 * progress, blocked, then the rest. `departments` (a module's Ongoing
 * Projects tab) keeps only that module's tasks, like DepartmentWork. */
export default function MyTasks({ hideWhenEmpty = false, departments }: { hideWhenEmpty?: boolean; departments?: string[] }) {
  const router = useRouter()
  const [tasks, setTasks] = useState<PmProjectTask[]>([])
  const [includeClosed, setIncludeClosed] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | string[]>('')

  useEffect(() => {
    setLoading(true)
    pmWorkApi.myTasks({ include_closed: includeClosed })
      .then((d) => {
        const wanted = (departments || []).map((n) => n.trim().toLowerCase())
        const rows: PmProjectTask[] = Array.isArray(d) ? d : []
        setTasks(wanted.length ? rows.filter((t) => wanted.includes((t.department_name || '').trim().toLowerCase())) : rows)
      })
      .catch((err) => setError(extractErrorMessages(err, 'Failed to load your tasks.')))
      .finally(() => setLoading(false))
  }, [includeClosed]) // eslint-disable-line react-hooks/exhaustive-deps

  // Hidden while loading too, so an empty list doesn't flash a card.
  if (hideWhenEmpty && !error && !includeClosed && (loading || tasks.length === 0)) return null

  const t0 = todayIso()
  const open = tasks.filter((t) => !['done', 'cancelled'].includes(t.status))
  const used = new Set<number>()
  const take = (rows: PmProjectTask[]) => rows.filter((t) => !used.has(t.id) && used.add(t.id))
  const groups = [
    { title: 'Overdue', color: '#dc2626', rows: take(open.filter((t) => t.is_overdue)) },
    { title: 'Due today', color: '#c2410c', rows: take(open.filter((t) => t.due_date === t0)) },
    { title: 'Blocked', color: '#dc2626', rows: take(open.filter((t) => t.status === 'blocked')) },
    { title: 'In progress', color: '#2563eb', rows: take(open.filter((t) => t.status === 'in_progress')) },
    { title: 'To do', color: TEXT.muted, rows: take(open) },
    ...(includeClosed ? [{ title: 'Done / cancelled', color: TEXT.muted, rows: tasks.filter((t) => ['done', 'cancelled'].includes(t.status)) }] : []),
  ]

  return (
    <div data-tour="pm-mt-list" style={sectionStyle}>
      <ErrorBanner error={error} />
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
        <h2 style={{ fontSize: 17, fontWeight: 700, color: TEXT.heading, margin: 0 }}>My tasks</h2>
        <label data-tour="pm-mt-show-done" style={{ fontSize: 12.5, color: TEXT.secondary, display: 'flex', gap: 6, alignItems: 'center', cursor: 'pointer' }}>
          <input type="checkbox" checked={includeClosed} onChange={(e) => setIncludeClosed(e.target.checked)} /> Show finished
        </label>
      </div>
      {loading ? <p style={{ fontSize: 13, color: TEXT.muted, margin: 0 }}>Loading…</p> : tasks.length === 0 ? (
        <p style={{ fontSize: 13, color: TEXT.muted, margin: 0 }}>No project tasks assigned to you{departments?.length ? ` in ${departments.join(' / ')}` : ''}.</p>
      ) : groups.filter((g) => g.rows.length > 0).map((g) => (
        <div key={g.title} style={{ marginBottom: 16 }}>
          <p style={{ fontSize: 12, fontWeight: 700, letterSpacing: '.04em', textTransform: 'uppercase', color: g.color, margin: '0 0 6px' }}>{g.title} ({g.rows.length})</p>
          <TaskTable tasks={g.rows} onOpen={(t) => router.push(recordPath('/dashboard/projects/tasks', t))} showAssignee={false} showProject />
        </div>
      ))}
    </div>
  )
}
