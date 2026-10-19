'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { pmWorkApi } from '@/lib/api'
import { useAuth } from '@/hooks/useAuth'
import { openAttachmentBlob } from '@/hooks/useAttachmentBlobUrl'
import { PmSubtask, PmTaskDetail } from '@/types'
import { TEXT } from '@/lib/theme'
import { formatDate, formatDateTime } from '@/lib/format'
import { extractErrorMessages } from '@/lib/validation'
import DateField from '@/components/erp/DateField'
import PromptDialog from '@/components/erp/PromptDialog'
import ConfirmDialog from '@/components/erp/ConfirmDialog'
import {
  AttachmentList, ErrorBanner, FlagPill, Notice, PRIORITY_HEX, PRIORITY_LABELS, Pill, ProgressBar, TASK_HEX, TASK_LABELS,
  actionBtn, sectionStyle, todayIso,
} from './pmUi'
import { FormSheet, Optional, Req, SHEET, SheetIcon, SheetSection, sheetBtn, sheetHint, sheetInput, sheetLabel } from '@/components/shared/FormSheet'
import { MentionComposer, MentionText } from './PmChat'
import { recordPath } from '@/lib/recordRef'

/** One task: the assignee starts it, splits it into sub-tasks, logs time,
 * comments (tagging people with @), attaches files (drawings) and completes
 * it. The milestone lead and department head can see it all. */
export default function TaskDetailView({ taskId }: { taskId: number }) {
  const router = useRouter()
  const { user } = useAuth()
  const [d, setD] = useState<PmTaskDetail | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | string[]>('')
  const [blockOpen, setBlockOpen] = useState(false)
  const [doneOpen, setDoneOpen] = useState(false)
  const [delSub, setDelSub] = useState<PmSubtask | null>(null)
  const [subTitle, setSubTitle] = useState('')
  const [subDue, setSubDue] = useState('')
  const [logDate, setLogDate] = useState(todayIso())
  const [logHours, setLogHours] = useState('')
  const [logNote, setLogNote] = useState('')
  const [subOpen, setSubOpen] = useState(false)
  const [timeOpen, setTimeOpen] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const load = useCallback(() => {
    pmWorkApi.task(taskId).then((r: PmTaskDetail) => { setD(r); setError('') }).catch((err) => setError(extractErrorMessages(err, 'Failed to load the task.')))
  }, [taskId])
  useEffect(() => { load() }, [load])

  const act = async (fn: () => Promise<unknown>, fallback: string) => {
    setBusy(true)
    setError('')
    try {
      const res = await fn()
      if (res && typeof res === 'object' && 'task' in (res as object)) setD(res as PmTaskDetail)
      else load()
      return true
    } catch (err) {
      setError(extractErrorMessages(err, fallback))
      return false
    } finally {
      setBusy(false)
    }
  }

  if (!d) return <><ErrorBanner error={error} />{!error && <p style={{ fontSize: 13, color: TEXT.muted }}>Loading…</p>}</>
  const t = d.task
  const workable = t.is_assignee && t.project_status === 'active' && !['submitted', 'achieved', 'cancelled'].includes(t.milestone_status || '')
  const isOpen = ['todo', 'in_progress', 'blocked'].includes(t.status)
  const openSubs = d.subtasks.filter((s) => s.status !== 'done').length
  const comments = d.updates.filter((u) => u.kind === 'comment')
  const history = d.updates.filter((u) => u.kind === 'status')

  const addSub = async () => {
    if (!subTitle.trim()) { setError('Write the sub-task first.'); return }
    if (await act(() => pmWorkApi.addSubtask(t.id, { title: subTitle.trim(), due_date: subDue || null }), 'Could not add the sub-task.')) { setSubTitle(''); setSubDue(''); setSubOpen(false) }
  }
  const addTime = async () => {
    const h = Number(logHours)
    if (!logDate || !h || h <= 0 || h > 24) { setError('Enter the date and the hours spent (more than 0, at most 24).'); return }
    if (await act(() => pmWorkApi.logTime(t.id, { work_date: logDate, hours: h, note: logNote.trim() || null }), 'Could not log the time.')) { setLogHours(''); setLogNote(''); setTimeOpen(false) }
  }
  const canLog = t.is_assignee && t.project_status === 'active' && ['in_progress', 'blocked', 'done'].includes(t.status)
  const upload = async (files: FileList | null) => {
    if (!files || files.length === 0) return
    const fd = new FormData()
    Array.from(files).forEach((f) => fd.append('files', f))
    await act(() => pmWorkApi.uploadTaskFiles(t.id, fd), 'Upload failed.')
    if (fileRef.current) fileRef.current.value = ''
  }

  return (
    <div>
      <div style={sectionStyle}>
        <p style={{ fontSize: 12, fontWeight: 700, color: TEXT.muted, margin: '0 0 4px' }}>
          {t.project_code} · {t.department_name} ·{' '}
          <a href="#" onClick={(e) => { e.preventDefault(); router.push(recordPath('/dashboard/projects/milestones', t, 'milestone_id')) }} style={{ color: '#2563eb', textDecoration: 'none' }}>{t.milestone_title}</a>
        </p>
        <h1 style={{ fontSize: 21, fontWeight: 700, color: TEXT.heading, margin: '0 0 8px' }}>{t.title}</h1>
        <div data-tour="pm-task-badges" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <Pill value={t.status} labels={TASK_LABELS} hex={TASK_HEX} />
          <Pill value={t.priority} labels={PRIORITY_LABELS} hex={PRIORITY_HEX} />
          {t.is_overdue && <FlagPill text="Overdue" color="#dc2626" />}
          <span style={{ fontSize: 12.5, color: TEXT.secondary }}>
            {t.assignee_name} · due {formatDate(t.due_date)} (WBS {formatDate(t.milestone_target_date)}){t.estimated_hours ? ` · ${t.estimated_hours} h est.` : ''} · {t.logged_hours} h logged{t.is_self_created ? ' · added by assignee' : ''}
          </span>
          <span style={{ marginLeft: 'auto' }}><ProgressBar value={t.progress_percent} width={140} /></span>
        </div>
        {t.description && <p style={{ fontSize: 13, color: TEXT.body, whiteSpace: 'pre-wrap', margin: '12px 0 0' }}>{t.description}</p>}
        {t.status === 'blocked' && <div style={{ marginTop: 12 }}><Notice tone="bad">Blocked: {t.blocker_reason}</Notice></div>}
        {t.status === 'in_progress' && t.reopen_reason && <div style={{ marginTop: 12 }}><Notice tone="warn">Sent back by your head: {t.reopen_reason}</Notice></div>}
        {t.status === 'cancelled' && <div style={{ marginTop: 12 }}><Notice tone="bad">Cancelled: {t.cancel_reason}</Notice></div>}
        {t.is_assignee && t.project_status !== 'active' && <div style={{ marginTop: 12 }}><Notice tone="warn">The project is {t.project_status?.replace('_', ' ')} — work is frozen.</Notice></div>}
        {workable && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 14, justifyContent: 'flex-end' }}>
            {t.status === 'todo' && <button data-tour="pm-task-start-btn" type="button" disabled={busy} onClick={() => act(() => pmWorkApi.startTask(t.id), 'Could not start the task.')} style={actionBtn('primary', busy)}>Start task</button>}
            {t.status === 'in_progress' && (
              <>
                <button data-tour="pm-task-block-btn" type="button" disabled={busy} onClick={() => setBlockOpen(true)} style={actionBtn('danger', busy)}>Blocked</button>
                <button data-tour="pm-task-done-btn" type="button" disabled={busy || openSubs > 0} title={openSubs ? `${openSubs} sub-task(s) still open` : ''} onClick={() => setDoneOpen(true)} style={actionBtn('primary', busy || openSubs > 0)}>
                  Mark done{openSubs ? ` (${openSubs} sub-task${openSubs > 1 ? 's' : ''} open)` : ''}
                </button>
              </>
            )}
            {t.status === 'blocked' && <button data-tour="pm-task-unblock-btn" type="button" disabled={busy} onClick={() => act(() => pmWorkApi.unblockTask(t.id), 'Could not unblock the task.')} style={actionBtn('primary', busy)}>Unblocked — continue</button>}
          </div>
        )}
        {!t.is_assignee && t.is_head && t.status === 'blocked' && (
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 14 }}>
            <button data-tour="pm-task-head-unblock-btn" type="button" disabled={busy} onClick={() => act(() => pmWorkApi.unblockTask(t.id), 'Could not unblock the task.')} style={actionBtn('secondary', busy)}>Mark unblocked</button>
          </div>
        )}
        {!subOpen && !timeOpen && <ErrorBanner error={error} />}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: 20 }}>
        <div data-tour="pm-task-subtasks" style={{ ...sectionStyle, marginBottom: 0 }}>
          <h2 style={{ fontSize: 16, fontWeight: 700, color: TEXT.heading, margin: '0 0 4px' }}>Sub-tasks ({d.subtasks.filter((s) => s.status === 'done').length}/{d.subtasks.length})</h2>
          <p style={{ fontSize: 12.5, color: TEXT.muted, margin: '0 0 10px' }}>Split the task into smaller steps. The task can only be marked done when every step is ticked.</p>
          {d.subtasks.map((s) => (
            <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 0', borderTop: '1px solid rgba(0,0,0,0.05)' }}>
              <input type="checkbox" checked={s.status === 'done'} disabled={!workable || !isOpen || busy}
                onChange={(e) => act(() => pmWorkApi.updateSubtask(s.id, { status: e.target.checked ? 'done' : 'todo' }), 'Could not update the sub-task.')} />
              <span style={{ fontSize: 13, color: s.status === 'done' ? TEXT.muted : TEXT.body, textDecoration: s.status === 'done' ? 'line-through' : 'none', flex: 1 }}>{s.title}</span>
              {s.due_date && <span style={{ fontSize: 12, color: TEXT.muted }}>{formatDate(s.due_date)}</span>}
              {workable && isOpen && s.status !== 'done' && (
                <button type="button" title="Delete sub-task" onClick={() => setDelSub(s)} style={{ ...actionBtn('danger'), padding: '2px 8px', fontSize: 11 }}>×</button>
              )}
            </div>
          ))}
          {workable && isOpen && (
            <div style={{ marginTop: 10 }}>
              <button data-tour="pm-task-sub-add-btn" type="button" disabled={busy} onClick={() => { setError(''); setSubOpen(true) }} style={actionBtn('secondary', busy)}>+ Add sub-task</button>
            </div>
          )}
        </div>

        <div data-tour="pm-task-files" style={{ ...sectionStyle, marginBottom: 0 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <h2 style={{ fontSize: 16, fontWeight: 700, color: TEXT.heading, margin: 0 }}>Files &amp; drawings</h2>
            {isOpen && (t.is_assignee || t.is_head) && (
              <>
                <input ref={fileRef} type="file" multiple hidden onChange={(e) => upload(e.target.files)} />
                <button data-tour="pm-task-attach-btn" type="button" disabled={busy} onClick={() => fileRef.current?.click()} style={actionBtn('secondary', busy)}>Attach files</button>
              </>
            )}
          </div>
          <AttachmentList
            files={d.files}
            onOpen={(id, name) => openAttachmentBlob(() => pmWorkApi.fileBlob(id), name).catch(() => setError(`Could not open ${name}.`))}
            onDelete={isOpen ? (id) => act(() => pmWorkApi.deleteFile(id), 'Could not remove the file.') : undefined}
            canDelete={(f) => user?.role === 'admin' || f.uploaded_by_id === user?.id}
          />
        </div>
      </div>

      <div data-tour="pm-task-time" style={{ ...sectionStyle, marginTop: 20 }}>
        <h2 style={{ fontSize: 16, fontWeight: 700, color: TEXT.heading, margin: '0 0 4px' }}>Time spent ({t.logged_hours} h{t.estimated_hours ? ` of ${t.estimated_hours} h estimated` : ''})</h2>
        <p style={{ fontSize: 12.5, color: TEXT.muted, margin: '0 0 10px' }}>Log the hours you worked on this task each day — your lead sees actual effort against the estimate.</p>
        {canLog && (
          <div style={{ marginBottom: 10 }}>
            <button data-tour="pm-task-time-add" type="button" disabled={busy} onClick={() => { setError(''); setTimeOpen(true) }} style={actionBtn('secondary', busy)}>+ Log time</button>
          </div>
        )}
        {d.time_logs.length === 0 ? <p style={{ fontSize: 13, color: TEXT.muted, margin: 0 }}>No time logged yet.</p> : d.time_logs.map((lg) => (
          <div key={lg.id} style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '6px 0', borderTop: '1px solid rgba(0,0,0,0.05)', fontSize: 13 }}>
            <span style={{ minWidth: 90, color: TEXT.secondary }}>{formatDate(lg.work_date)}</span>
            <strong style={{ minWidth: 50 }}>{lg.hours} h</strong>
            <span style={{ flex: 1, color: TEXT.body }}>{lg.note || ''}</span>
            <span style={{ fontSize: 12, color: TEXT.muted }}>{lg.user_name}</span>
            {lg.user_id === user?.id && t.project_status === 'active' && (
              <button type="button" onClick={() => act(() => pmWorkApi.deleteTime(lg.id), 'Could not remove the entry.')} style={{ ...actionBtn('danger'), padding: '2px 8px', fontSize: 11 }}>×</button>
            )}
          </div>
        ))}
      </div>

      <div data-tour="pm-task-comments" style={{ ...sectionStyle, marginTop: 20 }}>
        <h2 style={{ fontSize: 16, fontWeight: 700, color: TEXT.heading, margin: '0 0 10px' }}>Comments</h2>
        <div data-tour="pm-task-comment-input" style={{ marginBottom: 12 }}>
          <MentionComposer sendLabel="Post" placeholder="Write a comment… type @ to tag someone"
            onSend={async (body, ids) => !!body && act(() => pmWorkApi.comment(t.id, body, ids), 'Could not post the comment.')} />
        </div>
        {comments.length === 0 ? <p style={{ fontSize: 13, color: TEXT.muted, margin: 0 }}>No comments yet.</p> : comments.map((c) => (
          <div key={c.id} style={{ padding: '8px 0', borderTop: '1px solid rgba(0,0,0,0.05)' }}>
            <span style={{ fontSize: 12.5, fontWeight: 700, color: TEXT.heading }}>{c.user_name}</span>
            <span style={{ fontSize: 11.5, color: TEXT.muted, marginLeft: 8 }}>{c.created_at ? formatDateTime(c.created_at) : ''}</span>
            <p style={{ fontSize: 13, color: TEXT.body, margin: '2px 0 0', whiteSpace: 'pre-wrap' }}><MentionText body={c.comment || ''} mentions={c.mentions || []} /></p>
          </div>
        ))}
        {history.length > 0 && (
          <>
            <p style={{ fontSize: 12, fontWeight: 700, letterSpacing: '.04em', textTransform: 'uppercase', color: TEXT.muted, margin: '16px 0 6px' }}>Status history</p>
            {history.map((h) => (
              <p key={h.id} style={{ fontSize: 12.5, color: TEXT.secondary, margin: '3px 0' }}>
                {h.created_at ? formatDateTime(h.created_at) : ''} — {h.user_name}: {TASK_LABELS[h.from_status || ''] || h.from_status} → {TASK_LABELS[h.to_status || ''] || h.to_status}{h.comment ? ` (${h.comment})` : ''}
              </p>
            ))}
          </>
        )}
      </div>

      {subOpen && (
        <FormSheet width={580} icon="plus" title="Add Sub-task" subtitle={`Part of task '${t.title}'.`} onClose={() => setSubOpen(false)} busy={busy}
          footer={<>
            <button type="button" onClick={() => setSubOpen(false)} disabled={busy} style={sheetBtn('secondary', SHEET.INK, busy)}>Cancel</button>
            <button type="button" onClick={addSub} disabled={busy} style={sheetBtn('primary', SHEET.BLUE, busy)}><SheetIcon name="plus" size={16} />{busy ? 'Saving…' : 'Add sub-task'}</button>
          </>}>
          <div style={{ padding: '20px 24px' }}>
            <ErrorBanner error={error} />
            <SheetSection icon="list" title="Sub-task">
              <div data-tour="pm-task-sub-title">
                <label style={sheetLabel}>Sub-task <Req /></label>
                <input style={sheetInput} value={subTitle} onChange={(e) => setSubTitle(e.target.value)} placeholder="e.g. Check weld sizes on the frame" autoFocus onKeyDown={(e) => { if (e.key === 'Enter') addSub() }} />
              </div>
              <div data-tour="pm-task-sub-due" style={{ marginTop: 14, maxWidth: 200 }}>
                <label style={sheetLabel}>Due date <Optional /></label>
                <DateField value={subDue} onChange={setSubDue} />
              </div>
              <p style={sheetHint}>The task can only be marked done when every sub-task is ticked.</p>
            </SheetSection>
          </div>
        </FormSheet>
      )}
      {timeOpen && (
        <FormSheet width={580} icon="clock" title="Log Time" subtitle={`Hours worked on '${t.title}'.`} onClose={() => setTimeOpen(false)} busy={busy}
          footer={<>
            <button type="button" onClick={() => setTimeOpen(false)} disabled={busy} style={sheetBtn('secondary', SHEET.INK, busy)}>Cancel</button>
            <button type="button" onClick={addTime} disabled={busy} style={sheetBtn('primary', SHEET.BLUE, busy)}><SheetIcon name="clock" size={16} />{busy ? 'Saving…' : 'Log time'}</button>
          </>}>
          <div style={{ padding: '20px 24px' }}>
            <ErrorBanner error={error} />
            <SheetSection icon="clock" title="Time entry">
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                <div data-tour="pm-task-time-date" style={{ flex: '0 1 170px', minWidth: 150 }}>
                  <label style={sheetLabel}>Date <Req /></label>
                  <DateField value={logDate} onChange={setLogDate} />
                </div>
                <div data-tour="pm-task-time-hours" style={{ flex: '0 1 110px', minWidth: 100 }}>
                  <label style={sheetLabel}>Hours <Req /></label>
                  <input type="number" min={0.25} max={24} step="0.25" style={sheetInput} value={logHours} onChange={(e) => setLogHours(e.target.value)} placeholder="e.g. 2.5" autoFocus />
                </div>
              </div>
              <label style={{ ...sheetLabel, marginTop: 14 }}>What you did <Optional /></label>
              <input style={sheetInput} value={logNote} onChange={(e) => setLogNote(e.target.value)} placeholder="e.g. Finished the GA drawing views" />
              <p style={sheetHint}>More than 0 and at most 24 hours. Your lead sees actual effort against the estimate.</p>
            </SheetSection>
          </div>
        </FormSheet>
      )}
      <PromptDialog
        open={blockOpen}
        title="What is blocking this task?"
        message="Your department head is notified so they can help."
        confirmLabel="Mark blocked"
        danger
        requireValue
        onConfirm={(v) => { setBlockOpen(false); act(() => pmWorkApi.blockTask(t.id, v), 'Could not mark the task blocked.') }}
        onCancel={() => setBlockOpen(false)}
      />
      <PromptDialog
        open={doneOpen}
        title={`Mark "${t.title}" done?`}
        message="What did you deliver? (drawing no., report, file name) — your lead checks this before submitting the WBS."
        confirmLabel="Mark done"
        requireValue
        onConfirm={(v) => { setDoneOpen(false); act(() => pmWorkApi.completeTask(t.id, v), 'Could not complete the task.') }}
        onCancel={() => setDoneOpen(false)}
      />
      <ConfirmDialog
        open={!!delSub}
        title="Delete this sub-task?"
        message={delSub ? `Delete "${delSub.title}"?` : ''}
        confirmLabel="Delete"
        onConfirm={() => { const x = delSub!; setDelSub(null); act(() => pmWorkApi.deleteSubtask(x.id), 'Could not delete the sub-task.') }}
        onCancel={() => setDelSub(null)}
      />
    </div>
  )
}
