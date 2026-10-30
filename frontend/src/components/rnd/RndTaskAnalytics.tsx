'use client'

// R&D › R&D Tasks — summary tiles (Total, Pending, Completed, Overdue, Average
// progress) and the views over the SAME filtered set: By task (the table), By
// person and By project / requirement (grouped, with progress bars). The page
// owns the filters and the data; this component only draws it.
//   Completed = completed tasks · Overdue = open and due before today (IST) ·
//   Pending = open and not overdue · Cancelled tasks are left out of the tiles
//   and of progress. Project progress = average of its non-cancelled tasks.

import { TEXT, BORDER } from '@/lib/theme'
import { formatDate } from '@/lib/format'
import { Pill, RowCount, TableScroll, chipBtnStyle, thStyle, tdStyle, numThStyle, numTdStyle } from '@/components/shared/ui'
import { priorityLabel, priorityTone } from '@/lib/priority'
import type { RndTaskAnalytics, RndTaskGroup, RndTaskRow } from '@/types/rndIntake'

export type TaskView = 'task' | 'person' | 'project'

const natural = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true })

function Bar({ value }: { value: number }) {
  // ui-audit-ignore-next-line custom-pill — progress bar track, not a pill
  return <span style={{ flex: 1, minWidth: 60, height: 8, borderRadius: 999, background: '#eef2f7', overflow: 'hidden', display: 'block' }}><span style={{ display: 'block', height: '100%', width: `${Math.max(0, Math.min(100, value))}%`, background: '#16a34a', borderRadius: 999 }} /></span>
}
export function ProgressCell({ value }: { value: number }) {
  return <span style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 110 }}><Bar value={value} /><span style={{ fontSize: 12, color: TEXT.body, width: 36, textAlign: 'right' }}>{Math.round(value)}%</span></span>
}

function Tile({ label, value, hex, tour }: { label: string; value: string; hex: string; tour: string }) {
  return (
    <div data-tour={tour} style={{ flex: '1 1 140px', minWidth: 130, padding: '12px 16px', borderRadius: 14, background: '#fff', border: `1px solid ${BORDER.light}`, borderLeft: `4px solid ${hex}`, boxShadow: '0 2px 8px rgba(15,23,42,0.05)' }}>
      <p style={{ fontSize: 11, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: 0 }}>{label}</p>
      <p style={{ fontSize: 24, fontWeight: 700, color: TEXT.heading, margin: '2px 0 0' }}>{value}</p>
    </div>
  )
}

const WORK_LABEL: Record<string, string> = { not_started: 'Not started', in_progress: 'In progress', on_hold: 'On hold' }
const WORK_HEX: Record<string, string> = { not_started: '#78716c', in_progress: '#7C3AED', on_hold: '#D97706' }

/** One chip for where a task stands: cancelled / completed / overdue / the assignee's work status. */
export function rowState(t: RndTaskRow): { label: string; hex: string } {
  if (t.status === 'cancelled') return { label: 'Cancelled', hex: '#78716c' }
  if (t.status !== 'open') return { label: 'Completed', hex: '#16A34A' }
  if (t.days_overdue > 0) return { label: 'Overdue', hex: '#DC2626' }
  return { label: WORK_LABEL[t.work_status] || 'Open', hex: WORK_HEX[t.work_status] || '#2563EB' }
}

export function taskSort(a: RndTaskRow, b: RndTaskRow) {
  return natural(a.parent.ref || '', b.parent.ref || '') || a.id - b.id
}

/** Display name + stable key of an analytics group (person row or project / requirement row). */
export function groupLabel(g: RndTaskGroup): string {
  if (g.kind) return g.title ? `${g.ref} — ${g.title}` : (g.ref || '')
  return g.name || ''
}
function groupKey(g: RndTaskGroup): string {
  return g.kind ? `${g.kind}-${g.id ?? `${g.source}-${g.record_id}`}` : `user-${g.user_id}`
}

function GroupTable({ rows, nameHeader, showDept, onOpen, tour }: { rows: RndTaskGroup[]; nameHeader: string; showDept?: boolean; onOpen?: (g: RndTaskGroup) => void; tour: string }) {
  const sorted = [...rows].sort((a, b) => natural(groupLabel(a), groupLabel(b)))
  const cols = showDept ? 7 : 6
  return (
    <TableScroll minWidth={760}>
      <table data-tour={tour} style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            <th style={thStyle}>{nameHeader}<RowCount count={rows.length} /></th>
            {showDept && <th style={thStyle}>Department</th>}
            <th style={numThStyle}>Tasks</th><th style={numThStyle}>Pending</th><th style={numThStyle}>Completed</th><th style={numThStyle}>Overdue</th>
            <th style={{ ...thStyle, width: 180 }}>Progress</th>
          </tr>
        </thead>
        <tbody>
          {sorted.length === 0 ? (
            <tr><td colSpan={cols} style={{ ...tdStyle, textAlign: 'center', color: TEXT.muted, padding: 20 }}>No tasks match these filters.</td></tr>
          ) : sorted.map((g) => (
            <tr key={groupKey(g)} onClick={onOpen ? () => onOpen(g) : undefined} style={{ cursor: onOpen ? 'pointer' : 'default' }}>
              <td style={{ ...tdStyle, fontWeight: 600, color: TEXT.heading }}>{groupLabel(g)}</td>
              {showDept && <td style={tdStyle}>{g.department || '—'}</td>}
              <td style={numTdStyle}>{g.total}</td><td style={numTdStyle}>{g.pending}</td><td style={numTdStyle}>{g.completed}</td>
              <td style={{ ...numTdStyle, color: g.overdue ? '#DC2626' : TEXT.body, fontWeight: g.overdue ? 700 : 400 }}>{g.overdue}</td>
              <td style={tdStyle}><ProgressCell value={g.progress} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </TableScroll>
  )
}

export default function RndTaskAnalyticsView({ rows, total, analytics, view, onView, onOpenTask, onOpenGroup, page, pageSize, onPage }: {
  rows: RndTaskRow[] | null
  /** Tasks matching the filters (all pages). */
  total: number
  analytics: RndTaskAnalytics | null
  view: TaskView
  onView: (v: TaskView) => void
  onOpenTask: (t: RndTaskRow) => void
  onOpenGroup: (g: RndTaskGroup) => void
  page: number
  pageSize: number
  onPage: (p: number) => void
}) {
  const t = analytics?.totals
  const VIEWS: { key: TaskView; label: string }[] = [{ key: 'task', label: 'By task' }, { key: 'person', label: 'By person' }, { key: 'project', label: 'By project / requirement' }]
  const sorted = [...(rows || [])].sort(taskSort)
  const pages = Math.max(1, Math.ceil(total / pageSize))

  return (
    <div>
      <div data-tour="rnd-tasks-tiles" style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
        <Tile tour="rnd-tasks-tile-total" label="Total" value={t ? String(t.total) : '—'} hex="#2563EB" />
        <Tile tour="rnd-tasks-tile-pending" label="Pending" value={t ? String(t.pending) : '—'} hex="#D97706" />
        <Tile tour="rnd-tasks-tile-completed" label="Completed" value={t ? String(t.completed) : '—'} hex="#16A34A" />
        <Tile tour="rnd-tasks-tile-overdue" label="Overdue" value={t ? String(t.overdue) : '—'} hex="#DC2626" />
        <Tile tour="rnd-tasks-tile-progress" label="Average progress" value={t ? `${Math.round(t.avg_progress)}%` : '—'} hex="#7C3AED" />
      </div>

      <div data-tour="rnd-tasks-views" className="hide-scrollbar" style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
        {VIEWS.map((v) => <button key={v.key} type="button" onClick={() => onView(v.key)} style={chipBtnStyle(view === v.key)}>{v.label}</button>)}
      </div>

      {view === 'person' && <GroupTable tour="rnd-tasks-by-person" rows={analytics?.by_user || []} nameHeader="Person" showDept onOpen={undefined} />}
      {view === 'project' && <GroupTable tour="rnd-tasks-by-project" rows={analytics?.by_project || []} nameHeader="Project / requirement" onOpen={onOpenGroup} />}
      {view === 'task' && (
        <>
          <TableScroll minWidth={1180}>
            <table data-tour="rnd-tasks-table" style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  {['Task', 'Type', 'Project / Requirement', 'Assignee', 'Department', 'Priority', 'Status', 'Progress', 'Start', 'Due', 'Completed on', 'Days overdue'].map((h, i) => (
                    <th key={h} style={h === 'Days overdue' ? numThStyle : thStyle}>{h}{i === 0 && <RowCount count={total} />}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows === null ? (
                  <tr><td colSpan={12} style={{ ...tdStyle, textAlign: 'center', color: TEXT.muted, padding: 20 }}>Loading…</td></tr>
                ) : sorted.length === 0 ? (
                  <tr><td colSpan={12} style={{ ...tdStyle, textAlign: 'center', color: TEXT.muted, padding: 20 }}>No tasks match these filters.</td></tr>
                ) : sorted.map((r) => {
                  const st = rowState(r)
                  const pt = priorityTone(r.priority)
                  const inactive = r.status !== 'open'
                  return (
                    <tr key={r.key} onClick={() => onOpenTask(r)} style={{ cursor: 'pointer', opacity: inactive ? 0.72 : 1 }}>
                      <td style={{ ...tdStyle, fontWeight: 600, color: TEXT.heading, minWidth: 200 }}>
                        {r.title}
                        {r.requirement_changed && r.status === 'open' && <div style={{ fontSize: 11.5, color: '#9a3412', fontWeight: 600 }}>Requirement changed since this task was created</div>}
                      </td>
                      <td style={tdStyle}><Pill label={r.type === 'requirement' ? 'Requirement' : 'Prototype'} hex={r.type === 'requirement' ? '#FF6A2A' : '#2563EB'} /></td>
                      <td style={tdStyle}>
                        <div style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>{r.parent.ref}</div>
                        {r.parent.title && <div style={{ fontSize: 12, color: TEXT.muted }}>{r.parent.title}</div>}
                      </td>
                      <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>{r.assignee?.name || '—'}</td>
                      <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>{r.assignee?.department || '—'}</td>
                      <td style={tdStyle}><Pill label={priorityLabel(r.priority)} hex={pt.color} /></td>
                      <td style={tdStyle}><Pill label={st.label} hex={st.hex} /></td>
                      <td style={tdStyle} title={r.progress_from_checklist ? 'Follows the ticked checklist steps' : undefined}><ProgressCell value={r.progress_percent} /></td>
                      <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>{r.start_date ? formatDate(r.start_date) : '—'}</td>
                      <td style={{ ...tdStyle, whiteSpace: 'nowrap', color: r.days_overdue > 0 && r.status === 'open' ? '#DC2626' : TEXT.body, fontWeight: r.days_overdue > 0 && r.status === 'open' ? 700 : 400 }}>{formatDate(r.due_date)}</td>
                      <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>{r.closed_at && r.status !== 'cancelled' ? formatDate(r.closed_at) : '—'}</td>
                      <td style={{ ...numTdStyle, color: r.days_overdue > 0 && r.status === 'open' ? '#DC2626' : TEXT.body }}>{r.status === 'open' && r.days_overdue > 0 ? r.days_overdue : '—'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </TableScroll>
          {pages > 1 && (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 10, marginTop: 10 }}>
              <span style={{ fontSize: 12.5, color: TEXT.muted }}>Page {page} of {pages} · {total} tasks</span>
              <button type="button" disabled={page <= 1} onClick={() => onPage(page - 1)} style={{ ...chipBtnStyle(false), opacity: page <= 1 ? 0.5 : 1 }}>← Previous</button>
              <button type="button" disabled={page >= pages} onClick={() => onPage(page + 1)} style={{ ...chipBtnStyle(false), opacity: page >= pages ? 0.5 : 1 }}>Next →</button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
