'use client'

// R&D › My Tasks — every task assigned to me, in one list:
//  * Ongoing Projects   — Project Management milestone tasks (pm-work)
//  * Prototype / Research — tasks on R&D projects
//  * Requirements       — tasks on CRM requirements sent to R&D
// Each source is loaded on its own, so a missing permission on one only
// hides that category instead of breaking the page.

import { useEffect, useState } from 'react'
import { MagnifyingGlass } from '@phosphor-icons/react'
import { useRouter } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { pmWorkApi, rndApi } from '@/lib/api'
import { PmProjectTask, RndTask } from '@/types'
import { TEXT, GLASS, SHADOWS, BORDER } from '@/lib/theme'
import { chipBtnStyle, RowCount, pillStyle } from '@/components/shared/ui'
import { formatDate } from '@/lib/format'
import RndNav from '@/components/rnd/RndNav'
import { recordPath } from '@/lib/recordRef'

type Category = 'ongoing' | 'prototype' | 'requirement'
type Row = {
  key: string
  category: Category
  title: string
  ref: string
  refTitle: string | null
  due: string | null
  assignedAt: string | null
  assignedBy: string | null
  status: string
  statusHex: string
  overdue: boolean
  done: boolean
  href: string
}

const CATEGORY_LABELS: Record<Category, string> = { ongoing: 'Ongoing Project', prototype: 'Prototype / Research', requirement: 'Requirement' }
const CATEGORY_HEX: Record<Category, string> = { ongoing: '#7C3AED', prototype: '#2563EB', requirement: '#FF6A2A' }
const PM_STATUS_LABELS: Record<string, string> = { todo: 'To do', in_progress: 'In progress', blocked: 'Blocked', done: 'Done', cancelled: 'Cancelled' }
const PM_STATUS_HEX: Record<string, string> = { todo: '#78716c', in_progress: '#2563EB', blocked: '#DC2626', done: '#16A34A', cancelled: '#78716c' }
const RND_STATUS_LABELS: Record<string, string> = { open: 'Open', submitted: 'Completed', closed: 'Completed', cancelled: 'Cancelled' }
const RND_STATUS_HEX: Record<string, string> = { open: '#2563EB', submitted: '#16A34A', closed: '#16A34A', cancelled: '#78716c' }

const FILTERS: { key: '' | Category; label: string }[] = [
  { key: '', label: 'All' },
  { key: 'ongoing', label: 'Ongoing Projects' },
  { key: 'prototype', label: 'Prototype / Research' },
  { key: 'requirement', label: 'Requirements' },
]

const tableWrap: React.CSSProperties = {
  borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur,
  border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), overflow: 'auto', maxHeight: 'calc(100vh - 320px)',
}
const thStyle: React.CSSProperties = { textAlign: 'left', padding: '10px 14px', fontSize: 11, fontWeight: 600, letterSpacing: '.03em', textTransform: 'uppercase', color: TEXT.muted, position: 'sticky', top: 0, background: '#fdf1e6', zIndex: 1 }
const tdStyle: React.CSSProperties = { padding: '10px 14px', fontSize: 13, color: TEXT.body, borderTop: `1px solid ${BORDER.light}` }

function pill(label: string, hex: string) {
  return <span style={pillStyle(hex)}>{label}</span>
}

function fromPm(t: PmProjectTask): Row {
  const done = t.status === 'done' || t.status === 'cancelled'
  return {
    key: `pm-${t.id}`, category: 'ongoing', title: t.title,
    ref: t.project_code || t.project_name || `Project #${t.project_id}`,
    refTitle: [t.project_code ? t.project_name : null, t.milestone_title].filter(Boolean).join(' · ') || null,
    due: t.due_date || null, assignedAt: t.created_at || null, assignedBy: null, status: PM_STATUS_LABELS[t.status] || t.status, statusHex: PM_STATUS_HEX[t.status] || '#78716c',
    overdue: t.is_overdue, done, href: recordPath('/dashboard/projects/tasks', t),
  }
}

function fromRnd(t: RndTask, category: 'prototype' | 'requirement'): Row {
  const done = t.status !== 'open'
  // Assigned = when it became mine: the last reassignment, else when it was created.
  const reassigned = [...t.events].reverse().find((e) => e.action === 'edited' && (e.remarks || '').includes('Assignee:'))
  return {
    key: `${category}-${t.id}`, category, title: t.title,
    ref: t.requirement_ref || `#${t.record_id}`, refTitle: t.requirement_title || null,
    due: t.due_date, assignedAt: reassigned?.at || t.created_at, assignedBy: reassigned?.by || t.created_by,
    status: t.pending_approval ? 'Approval pending' : (RND_STATUS_LABELS[t.status] || t.status),
    statusHex: t.pending_approval ? '#D97706' : (RND_STATUS_HEX[t.status] || '#78716c'),
    overdue: t.is_overdue, done,
    href: category === 'prototype' ? `${recordPath('/dashboard/rnd/projects', t, 'record_id')}#tasks` : `${recordPath(`/dashboard/rnd/requirements/${t.source}`, t, 'record_id')}?tab=tasks`,
  }
}

export default function RndMyTasksPage() {
  const { isAuthorized, isLoading } = useRequireApp('rnd')
  const router = useRouter()
  const [rows, setRows] = useState<Row[] | null>(null)
  const [unavailable, setUnavailable] = useState<string[]>([])
  const [filter, setFilter] = useState<'' | Category>('')
  const [showDone, setShowDone] = useState(false)
  const [query, setQuery] = useState('')

  useEffect(() => {
    if (!isAuthorized) return
    const sources: { label: string; load: () => Promise<Row[]> }[] = [
      { label: 'Ongoing Projects', load: async () => ((await pmWorkApi.myTasks({ include_closed: showDone })) as PmProjectTask[] || []).map(fromPm) },
      { label: 'Prototype / Research', load: async () => (await rndApi.myProjectTasks(showDone)).map((t) => fromRnd(t, 'prototype')) },
      { label: 'Requirements', load: async () => (await rndApi.myTasks(showDone)).map((t) => fromRnd(t, 'requirement')) },
    ]
    Promise.allSettled(sources.map((s) => s.load())).then((results) => {
      const all: Row[] = []
      const failed: string[] = []
      results.forEach((r, i) => (r.status === 'fulfilled' ? all.push(...r.value) : failed.push(sources[i].label)))
      // Open first: overdue, then by due date (no date last); finished at the bottom.
      all.sort((a, b) => Number(a.done) - Number(b.done) || Number(b.overdue) - Number(a.overdue) || (a.due || '9999').localeCompare(b.due || '9999'))
      setRows(all)
      setUnavailable(failed)
    })
  }, [isAuthorized, showDone])

  if (isLoading || !isAuthorized) return null

  // Any word must appear in the task, project / requirement, giver, status or a date (16/10/2026, 16-10-2026, 2026-10-16).
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  const matches = (r: Row) => {
    const dates = [r.due, r.assignedAt?.slice(0, 10)].filter(Boolean).flatMap((d) => [d as string, formatDate(d as string), formatDate(d as string).replace(/\//g, '-')])
    const text = [r.title, r.ref, r.refTitle, r.assignedBy, r.status, CATEGORY_LABELS[r.category], r.overdue && !r.done ? 'overdue' : '', ...dates].filter(Boolean).join(' ').toLowerCase()
    return words.every((w) => text.includes(w))
  }
  const list = (rows || []).filter((r) => (!filter || r.category === filter) && matches(r))
  const count = (c: '' | Category) => (rows || []).filter((r) => (!c || r.category === c) && !r.done).length
  const overdue = (rows || []).filter((r) => r.overdue && !r.done).length

  return (
    <div>
      <RndNav />
      <div data-tour="rnd-mytasks-header" style={{ marginBottom: 16 }}>
        <p style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 4px' }}>R&amp;D Module</p>
        <h1 style={{ fontSize: 24, fontWeight: 700, color: TEXT.heading, margin: 0 }}>My Tasks</h1>
        <p style={{ fontSize: 13, color: TEXT.muted, margin: '4px 0 0' }}>
          Everything assigned to you — ongoing projects, prototypes / research and requirements.
          {overdue > 0 && <> <strong style={{ color: '#DC2626' }}>{overdue} overdue</strong> — open them to give a reason and a new date.</>}
        </p>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 14 }}>
        <div data-tour="rnd-mytasks-filter" className="hide-scrollbar" style={{ display: 'flex', gap: 4, padding: 4, borderRadius: 999, background: 'rgba(0,0,0,0.05)', overflowX: 'auto', maxWidth: '100%' }}>
          {FILTERS.map((f) => (
            <button key={f.key || 'all'} type="button" onClick={() => setFilter(f.key)}
              style={chipBtnStyle(filter === f.key)}>
              {f.label}{rows ? ` (${count(f.key)})` : ''}
            </button>
          ))}
        </div>
        <label style={{ fontSize: 12.5, color: TEXT.secondary, display: 'flex', gap: 6, alignItems: 'center', cursor: 'pointer' }}>
          <input type="checkbox" checked={showDone} onChange={(e) => { setRows(null); setShowDone(e.target.checked) }} /> Show completed
        </label>
      </div>

      <div data-tour="rnd-mytasks-search" style={{ position: 'relative', maxWidth: 460, marginBottom: 14 }}>
        <span style={{ position: 'absolute', left: 11, top: '50%', transform: 'translateY(-50%)', color: TEXT.muted, display: 'flex' }}>
          <MagnifyingGlass size={15} />
        </span>
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search task, project / requirement, person or date"
          style={{ width: '100%', padding: '9px 30px 9px 34px', borderRadius: 10, border: `1px solid ${BORDER.normal}`, background: 'rgba(255,255,255,.7)', fontSize: 13, outline: 'none', color: TEXT.body, boxSizing: 'border-box' }} />
        {query && (
          <button type="button" onClick={() => setQuery('')} title="Clear search"
            style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: TEXT.muted, fontSize: 16, lineHeight: 1 }}>×</button>
        )}
      </div>

      {unavailable.length > 0 && (
        <p style={{ fontSize: 12.5, color: TEXT.muted, margin: '0 0 12px' }}>
          Not shown: {unavailable.join(', ')} — you don&apos;t have access to that part of R&amp;D, or it couldn&apos;t be loaded. Reload to try again.
        </p>
      )}

      <div data-tour="rnd-mytasks-table" style={tableWrap}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 920 }}>
          <thead>
            <tr>{['Category', 'Task', 'Project / Requirement', 'Assigned', 'Due', 'Status', ''].map((h, hi) => <th key={h} style={thStyle}>{h}{hi === 0 && <RowCount count={list.length} />}</th>)}</tr>
          </thead>
          <tbody>
            {rows === null ? (
              <tr><td colSpan={7} style={{ ...tdStyle, textAlign: 'center', color: TEXT.muted }}>Loading…</td></tr>
            ) : list.length === 0 ? (
              <tr><td colSpan={7} style={{ ...tdStyle, textAlign: 'center', color: TEXT.muted }}>{words.length ? `No task matches “${query.trim()}”.` : showDone ? 'No tasks.' : 'No open tasks — you are all caught up.'}</td></tr>
            ) : list.map((r) => (
              <tr key={r.key} onClick={() => router.push(r.href)} style={{ cursor: 'pointer', opacity: r.done ? 0.65 : 1 }}>
                <td style={tdStyle}>{pill(CATEGORY_LABELS[r.category], CATEGORY_HEX[r.category])}</td>
                <td style={{ ...tdStyle, fontWeight: 600, color: TEXT.heading }}>{r.title}</td>
                <td style={tdStyle}>
                  <div style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>{r.ref}</div>
                  {r.refTitle && <div style={{ fontSize: 12, color: TEXT.muted }}>{r.refTitle}</div>}
                </td>
                <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>
                  {r.assignedAt ? formatDate(r.assignedAt) : '—'}
                  {r.assignedBy && <div style={{ fontSize: 12, color: TEXT.muted }}>by {r.assignedBy}</div>}
                </td>
                <td style={{ ...tdStyle, whiteSpace: 'nowrap', color: r.overdue && !r.done ? '#DC2626' : TEXT.body, fontWeight: r.overdue && !r.done ? 700 : 400 }}>
                  {r.due ? formatDate(r.due) : '—'}{r.overdue && !r.done ? ' · overdue' : ''}
                </td>
                <td style={tdStyle}>{pill(r.status, r.statusHex)}</td>
                <td onClick={(e) => e.stopPropagation()} style={tdStyle}>
                  <span onClick={() => router.push(r.href)} style={{ fontSize: 12, fontWeight: 600, color: '#FF6A2A', cursor: 'pointer' }}>Open</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
