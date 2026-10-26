'use client'

// The whole hierarchy of a project (or one milestone) in one place:
// Project → milestones in step order → who got how many tasks → each task
// with its sub-tasks, files/drawings, comments (with @mentions), reasons
// (blocked / sent back / cancelled), status history with dates, and time —
// plus each milestone's evidence and team chat. Read-only: it answers "who
// did what, when, and why".

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { pmWorkApi, projectsApi } from '@/lib/api'
import { openAttachmentBlob } from '@/hooks/useAttachmentBlobUrl'
import { PmBreakdown, PmBreakdownMilestone, PmBreakdownTask, PmPersonSummary, PmProjectDocument } from '@/types'
import { TEXT } from '@/lib/theme'
import { formatDate, formatDateTime } from '@/lib/format'
import { extractErrorMessages } from '@/lib/validation'
import {
  ErrorBanner, FlagPill, MILESTONE_HEX, MILESTONE_LABELS, PRIORITY_HEX, PRIORITY_LABELS, Pill, ProgressBar, TASK_HEX, TASK_LABELS,
  sectionStyle, tdStyle, thStyle,
} from './pmUi'
import { MentionText } from './PmChat'
import { recordPath } from '@/lib/recordRef'
import { RowCount } from '@/components/shared/ui'

const small: React.CSSProperties = { fontSize: 11, fontWeight: 700, letterSpacing: '.04em', textTransform: 'uppercase', color: TEXT.muted, margin: '10px 0 4px' }
const line: React.CSSProperties = { fontSize: 12.5, color: TEXT.body, margin: '2px 0' }
const toggle: React.CSSProperties = { background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontSize: 12, color: TEXT.muted, width: 16 }

function PeopleTable({ rows }: { rows: PmPersonSummary[] }) {
  if (!rows.length) return <p style={{ fontSize: 12.5, color: TEXT.muted, margin: 0 }}>No tasks given yet.</p>
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 640 }}>
        <thead><tr>{['Person', 'Given by lead', 'Added by self', 'Done', 'Open', 'Overdue', 'Cancelled', 'Est. h', 'Logged h', 'Last completed'].map((h, i) => <th key={h} style={thStyle}>{h}{i === 0 && <RowCount count={rows.length} />}</th>)}</tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.user_id ?? 0}>
              <td style={{ ...tdStyle, fontWeight: 600 }}>{r.name}</td>
              <td style={tdStyle}>{r.given}</td>
              <td style={tdStyle}>{r.self_added}</td>
              <td style={{ ...tdStyle, color: '#16a34a' }}>{r.done}</td>
              <td style={tdStyle}>{r.open}</td>
              <td style={{ ...tdStyle, color: r.overdue ? '#dc2626' : TEXT.body }}>{r.overdue}</td>
              <td style={tdStyle}>{r.cancelled}</td>
              <td style={tdStyle}>{r.estimated_hours ? r.estimated_hours.toFixed(1) : '—'}</td>
              <td style={tdStyle}>{r.logged_hours ? r.logged_hours.toFixed(1) : '—'}</td>
              <td style={tdStyle}>{r.last_completed_at ? formatDateTime(r.last_completed_at) : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function Files({ files, onOpen }: { files: PmProjectDocument[]; onOpen: (f: PmProjectDocument) => void }) {
  return (
    <>
      {files.map((f) => (
        <p key={f.id} style={line}>
          <button type="button" onClick={() => onOpen(f)} style={{ background: 'none', border: 'none', padding: 0, color: '#2563eb', cursor: 'pointer', fontSize: 12.5 }}>📎 {f.file_name}</button>
          <span style={{ color: TEXT.muted }}> — {f.uploaded_by_name || '—'}, {f.created_at ? formatDateTime(f.created_at) : ''}</span>
        </p>
      ))}
    </>
  )
}

function TaskBlock({ t, onOpenFile }: { t: PmBreakdownTask; onOpenFile: (f: PmProjectDocument) => void }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const reasons = [
    t.blocker_reason && t.status === 'blocked' ? `Blocked: ${t.blocker_reason}` : null,
    t.reopen_reason ? `Sent back by lead: ${t.reopen_reason}` : null,
    t.cancel_reason ? `Cancelled: ${t.cancel_reason}` : null,
  ].filter(Boolean) as string[]
  return (
    <div style={{ borderTop: '1px solid rgba(0,0,0,0.05)', padding: '8px 0' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <button type="button" onClick={() => setOpen(!open)} style={toggle}>{open ? '▾' : '▸'}</button>
        <span onClick={() => router.push(recordPath('/dashboard/projects/tasks', t))} style={{ fontSize: 13, fontWeight: 600, color: '#2563eb', cursor: 'pointer', flex: '1 1 220px' }}>{t.title}</span>
        <span style={{ fontSize: 12, color: TEXT.secondary, minWidth: 120 }}>{t.assignee_name || '—'}</span>
        <Pill value={t.status} labels={TASK_LABELS} hex={TASK_HEX} />
        <Pill value={t.priority} labels={PRIORITY_LABELS} hex={PRIORITY_HEX} />
        {t.is_overdue && <FlagPill text="Overdue" color="#dc2626" />}
        <span style={{ fontSize: 12, color: t.is_overdue ? '#dc2626' : TEXT.muted, minWidth: 90 }}>due {formatDate(t.due_date)}</span>
        <span style={{ fontSize: 11.5, color: TEXT.muted, minWidth: 140 }}>
          {t.files.length} file · {t.comments.length} comment · {t.logged_hours} h
        </span>
      </div>
      {reasons.map((r) => <p key={r} style={{ ...line, marginLeft: 24, color: '#b91c1c' }}>{r}</p>)}
      {open && (
        <div style={{ marginLeft: 24, padding: '4px 0 6px' }}>
          <p style={line}>
            {t.is_self_created ? `Added by ${t.assignee_name} for themselves` : `Given by ${t.created_by_name || '—'}`}
            {t.created_at ? ` on ${formatDateTime(t.created_at)}` : ''}
            {t.started_at ? ` · started ${formatDateTime(t.started_at)}` : ''}
            {t.completed_at ? ` · completed ${formatDateTime(t.completed_at)}` : ''}
            {t.estimated_hours ? ` · estimate ${t.estimated_hours} h` : ''}
          </p>
          {t.description && <p style={{ ...line, whiteSpace: 'pre-wrap' }}>{t.description}</p>}
          {t.subtasks.length > 0 && (
            <>
              <p style={small}>Sub-tasks ({t.subtasks.filter((s) => s.status === 'done').length}/{t.subtasks.length})</p>
              {t.subtasks.map((s) => <p key={s.id} style={line}>{s.status === 'done' ? '☑' : '☐'} {s.title}{s.completed_at ? ` — done ${formatDateTime(s.completed_at)}` : s.due_date ? ` — due ${formatDate(s.due_date)}` : ''}</p>)}
            </>
          )}
          {t.files.length > 0 && <><p style={small}>Files &amp; drawings</p><Files files={t.files} onOpen={onOpenFile} /></>}
          {t.comments.length > 0 && (
            <>
              <p style={small}>Comments</p>
              {t.comments.map((c) => (
                <p key={c.id} style={line}>
                  <strong>{c.user_name}</strong> <span style={{ color: TEXT.muted }}>{c.created_at ? formatDateTime(c.created_at) : ''}</span>: <MentionText body={c.comment || ''} mentions={c.mentions || []} />
                </p>
              ))}
            </>
          )}
          {t.history.length > 0 && (
            <>
              <p style={small}>Status history</p>
              {t.history.map((h) => (
                <p key={h.id} style={line}>
                  {h.created_at ? formatDateTime(h.created_at) : ''} — {h.user_name}: {TASK_LABELS[h.from_status || ''] || h.from_status} → {TASK_LABELS[h.to_status || ''] || h.to_status}{h.comment ? ` (${h.comment})` : ''}
                </p>
              ))}
            </>
          )}
          {t.time_logs.length > 0 && (
            <>
              <p style={small}>Time log</p>
              {t.time_logs.map((lg) => <p key={lg.id} style={line}>{formatDate(lg.work_date)} — {lg.hours} h by {lg.user_name}{lg.note ? `: ${lg.note}` : ''}</p>)}
            </>
          )}
        </div>
      )}
    </div>
  )
}

/** One WBS's people table and task tree. `bare` (inside the WBS page itself)
 * leaves out what that page already shows: header, dates, evidence, chat. */
function MilestoneBody({ b, onOpenFile, bare = false }: { b: PmBreakdownMilestone; onOpenFile: (f: PmProjectDocument) => void; bare?: boolean }) {
  const [showChat, setShowChat] = useState(false)
  const m = b.milestone
  return (
    <>
      <p style={small}>Who got how many tasks</p>
      <PeopleTable rows={b.people} />
      <p style={small}>Tasks ({b.tasks.length})</p>
      {b.tasks.length === 0 ? <p style={{ fontSize: 12.5, color: TEXT.muted, margin: 0 }}>No tasks yet.</p> : b.tasks.map((t) => <TaskBlock key={t.id} t={t} onOpenFile={onOpenFile} />)}
      {b.mentioned.length > 0 && <><p style={small}>People tagged</p><p style={line}>{b.mentioned.map((p) => `@${p.name}`).join(', ')}</p></>}
      {!bare && (
        <>
          {m.submission_note && <><p style={small}>Handover note</p><p style={line}>{m.submission_note}</p></>}
          {b.evidence.length > 0 && <><p style={small}>Evidence</p><Files files={b.evidence} onOpen={onOpenFile} /></>}
          <p style={small}>
            Team chat ({b.messages.length}){' '}
            {b.messages.length > 0 && <button type="button" onClick={() => setShowChat(!showChat)} style={{ ...toggle, width: 'auto', color: '#2563eb' }}>{showChat ? 'hide' : 'show'}</button>}
          </p>
          {showChat && b.messages.map((c) => (
            <div key={c.id} style={{ ...line, marginBottom: 6 }}>
              <strong>{c.user_name}</strong> <span style={{ color: TEXT.muted }}>{c.created_at ? formatDateTime(c.created_at) : ''}</span>: {c.body && <MentionText body={c.body} mentions={c.mentions} />}
              {c.files.length > 0 && <div style={{ marginLeft: 12 }}><Files files={c.files} onOpen={onOpenFile} /></div>}
            </div>
          ))}
        </>
      )}
    </>
  )
}

function MilestoneBlock({ b, onOpenFile }: { b: PmBreakdownMilestone; onOpenFile: (f: PmProjectDocument) => void }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const m = b.milestone
  return (
    <div style={{ padding: 14, borderRadius: 14, background: 'rgba(255,255,255,.55)', border: '1px solid rgba(0,0,0,0.06)', marginBottom: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <button type="button" onClick={() => setOpen(!open)} style={toggle}>{open ? '▾' : '▸'}</button>
        <span style={{ fontSize: 12, fontWeight: 800, color: '#4338ca' }}>Step {m.sequence}</span>
        <span onClick={() => router.push(recordPath('/dashboard/projects/milestones', m))} style={{ fontSize: 14, fontWeight: 700, color: TEXT.heading, cursor: 'pointer', flex: '1 1 200px' }}>{m.title}</span>
        <span style={{ fontSize: 12, color: TEXT.secondary }}>{m.department_name} · lead {m.lead_name || '—'}{m.assistants.length ? ` + ${m.assistants.length}` : ''}</span>
        <Pill value={m.status} labels={MILESTONE_LABELS} hex={MILESTONE_HEX} />
        {m.is_overdue && <FlagPill text="Overdue" color="#dc2626" />}
        {m.is_locked && <FlagPill text="Locked" color="#64748b" />}
        <ProgressBar value={m.progress_percent} width={70} />
      </div>
      <p style={{ ...line, marginLeft: 24, color: TEXT.muted }}>
        Due {formatDate(m.target_date)}{m.original_target_date ? ` (originally ${formatDate(m.original_target_date)})` : ''}
        {m.submitted_at ? ` · submitted ${formatDateTime(m.submitted_at)} by ${m.submitted_by_name}` : ''}
        {m.achieved_at ? ` · accepted ${formatDateTime(m.achieved_at)} by ${m.achieved_by_name} (actual ${formatDate(m.actual_date)})` : ''}
        {` · ${m.tasks_done}/${m.task_count} tasks done · ${b.messages.length} message(s)`}
      </p>
      {m.return_reason && m.status === 'in_progress' && <p style={{ ...line, marginLeft: 24, color: '#b91c1c' }}>Rejected by management: {m.return_reason}</p>}
      {m.cancel_reason && <p style={{ ...line, marginLeft: 24, color: '#b91c1c' }}>Cancelled: {m.cancel_reason}</p>}
      {open && <div style={{ marginLeft: 24 }}><MilestoneBody b={b} onOpenFile={onOpenFile} /></div>}
    </div>
  )
}

/** Pass `projectId` for the whole project (management), or `milestoneId`
 * for one milestone (its lead / department head). `refreshKey` changing
 * reloads it (e.g. a task's status changed on the WBS page). */
export default function WorkBreakdown({ projectId, milestoneId, refreshKey }: { projectId?: number; milestoneId?: number; refreshKey?: string }) {
  const single = !projectId
  const [data, setData] = useState<PmBreakdown | null>(null)
  const [error, setError] = useState<string | string[]>('')
  // On the WBS page it is a closed "History & report" — loaded on first open.
  const [expanded, setExpanded] = useState(!single)
  const load = useCallback(() => {
    const req = projectId ? projectsApi.breakdown(projectId) : pmWorkApi.milestoneBreakdown(milestoneId as number)
    req.then((d: PmBreakdown) => { setData(d); setError('') }).catch((err) => setError(extractErrorMessages(err, 'Could not load the task breakdown.')))
  }, [projectId, milestoneId])
  useEffect(() => { if (expanded) load() }, [load, expanded, refreshKey])
  const openFile = (f: PmProjectDocument) => { openAttachmentBlob(() => pmWorkApi.fileBlob(f.id), f.file_name).catch(() => setError(`Could not open ${f.file_name} — it may have been removed from SharePoint.`)) }

  if (single && !expanded) return (
    <div data-tour="pm-breakdown" style={sectionStyle}>
      <button type="button" onClick={() => setExpanded(true)} style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', textAlign: 'left', width: '100%' }}>
        <h2 style={{ fontSize: 16, fontWeight: 700, color: TEXT.heading, margin: 0 }}>▸ History &amp; report</h2>
        <p style={{ fontSize: 12.5, color: TEXT.muted, margin: '2px 0 0' }}>Who got how many tasks, and each task&apos;s sub-tasks, files, comments, reasons, status history and time. Click to open.</p>
      </button>
    </div>
  )
  if (!data) return <div style={sectionStyle}><ErrorBanner error={error} />{!error && <p style={{ fontSize: 13, color: TEXT.muted, margin: 0 }}>Loading…</p>}</div>
  return (
    <div data-tour="pm-breakdown" style={sectionStyle}>
      <ErrorBanner error={error} />
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
        <div>
          {single ? (
            <button type="button" onClick={() => setExpanded(false)} style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}>
              <h2 style={{ fontSize: 16, fontWeight: 700, color: TEXT.heading, margin: 0 }}>▾ History &amp; report</h2>
            </button>
          ) : <h2 style={{ fontSize: 16, fontWeight: 700, color: TEXT.heading, margin: 0 }}>Work breakdown</h2>}
          <p style={{ fontSize: 12.5, color: TEXT.muted, margin: '2px 0 0' }}>
            {single ? 'Who got how many tasks, and each task\'s files, comments, tags, reasons and history.' : 'Every milestone in step order → who got how many tasks → each task with its files, comments, tags, reasons, history and time. Click ▸ to expand.'}
          </p>
        </div>
        <button type="button" onClick={load} style={{ background: 'none', border: 'none', color: '#2563eb', fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }}>↻ Refresh</button>
      </div>
      {!single && (
        <>
          <p style={small}>Whole project — tasks per person</p>
          <PeopleTable rows={data.people} />
          <div style={{ height: 14 }} />
        </>
      )}
      {data.milestones.length === 0 ? <p style={{ fontSize: 13, color: TEXT.muted, margin: 0 }}>No milestones yet.</p>
        : single ? data.milestones.map((b) => <MilestoneBody key={b.milestone.id} b={b} onOpenFile={openFile} bare />)
        : data.milestones.map((b) => <MilestoneBlock key={b.milestone.id} b={b} onOpenFile={openFile} />)}
    </div>
  )
}
