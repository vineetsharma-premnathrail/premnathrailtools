'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { approvalsApi, pmWorkApi, projectsApi } from '@/lib/api'
import { useAuth } from '@/hooks/useAuth'
import { openAttachmentBlob } from '@/hooks/useAttachmentBlobUrl'
import { PmDepartmentPerson, PmMilestoneWorkspace, PmProjectTask } from '@/types'
import { TEXT } from '@/lib/theme'
import { formatDate } from '@/lib/format'
import { extractErrorMessages } from '@/lib/validation'
import DateField from '@/components/erp/DateField'
import ConfirmDialog from '@/components/erp/ConfirmDialog'
import PromptDialog from '@/components/erp/PromptDialog'
import {
  AttachmentList, DOC_TYPE_LABELS, ErrorBanner, FlagPill, MILESTONE_HEX, MILESTONE_LABELS, Notice, PRIORITY_LABELS, Pill,
  ProgressBar, actionBtn, inputStyle, sectionStyle, todayIso,
} from './pmUi'
import { FormSheet, Optional, Req, SHEET, SheetIcon, SheetSection, sheetBtn, sheetHint, sheetInput, sheetLabel } from '@/components/shared/FormSheet'
import { TaskTable } from './DepartmentWork'
import PeoplePicker, { useTeamCandidates } from './PeoplePicker'
import PmChat from './PmChat'
import WorkBreakdown from './WorkBreakdown'
import ApprovalPanel from '@/components/shared/ApprovalPanel'
import { recordPath } from '@/lib/recordRef'

type TaskForm = { id?: number; title: string; description: string; assignee_id: string; due_date: string; priority: string; estimated_hours: string }
const emptyTask = (): TaskForm => ({ title: '', description: '', assignee_id: '', due_date: '', priority: 'medium', estimated_hours: '' })

/** One milestone. The lead (or a department head) plans and assigns its
 * tasks, manages the team, attaches evidence and submits it; management
 * accepts or rejects it. Assistants see the milestone name and date, only
 * their own tasks, and can add tasks for themselves. Everyone on it — plus
 * anyone tagged — talks in the team chat. */
export default function MilestoneWorkspace({ milestoneId }: { milestoneId: number }) {
  const router = useRouter()
  const { user } = useAuth()
  const [ws, setWs] = useState<PmMilestoneWorkspace | null>(null)
  const [people, setPeople] = useState<PmDepartmentPerson[]>([])
  const [form, setForm] = useState<TaskForm | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | string[]>('')
  const [reasonFor, setReasonFor] = useState<{ task?: PmProjectTask; kind: 'cancel' | 'reopen' | 'reject' } | null>(null)
  const [deleteTask, setDeleteTask] = useState<PmProjectTask | null>(null)
  const [submitOpen, setSubmitOpen] = useState(false)
  const [note, setNote] = useState('')
  const [acceptOpen, setAcceptOpen] = useState(false)
  const [acceptDate, setAcceptDate] = useState(todayIso())
  const [docType, setDocType] = useState('drawing')
  const [teamEdit, setTeamEdit] = useState<number[] | null>(null)
  const [selfTask, setSelfTask] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const candidates = useTeamCandidates(ws?.milestone.department_id, !!ws?.can_plan)
  // Acceptance runs on the central approval engine (Organization › Approval
  // Workflows › Milestone acceptance). A milestone submitted before that has
  // no engine request — only then are the old Accept / Reject buttons shown.
  const [engineRequest, setEngineRequest] = useState<boolean | null>(null)
  const milestoneStatus = ws?.milestone.status
  useEffect(() => {
    if (milestoneStatus !== 'submitted') return
    approvalsApi.entity('pm_milestone', milestoneId).then((s) => setEngineRequest(!!s.current && s.current.status === 'pending')).catch(() => setEngineRequest(null))
  }, [milestoneId, milestoneStatus])

  const load = useCallback(() => {
    pmWorkApi.milestone(milestoneId).then((d: PmMilestoneWorkspace) => { setWs(d); setError('') }).catch((err) => setError(extractErrorMessages(err, 'Failed to load the WBS.')))
  }, [milestoneId])
  useEffect(() => { load() }, [load])
  useEffect(() => {
    if (ws?.can_plan && ws.milestone.department_id) pmWorkApi.people(ws.milestone.department_id).then(setPeople).catch(() => setPeople([]))
  }, [ws?.can_plan, ws?.milestone.department_id])

  const act = async (fn: () => Promise<unknown>, fallback: string) => {
    setBusy(true)
    setError('')
    try { await fn(); load() } catch (err) { setError(extractErrorMessages(err, fallback)) } finally { setBusy(false) }
  }

  if (!ws) return <><ErrorBanner error={error} />{!error && <p style={{ fontSize: 13, color: TEXT.muted }}>Loading…</p>}</>
  const m = ws.milestone
  const projectActive = m.project_status === 'active'
  const open = ['not_started', 'in_progress'].includes(m.status)
  const canPlan = ws.can_plan && projectActive && open
  const full = ws.role === 'manage' || ws.role === 'lead'
  const canAddOwn = (ws.role === 'member' || ws.can_plan) && projectActive && open
  const teamIds = [m.lead_user_id, ...(m.assistant_user_ids || [])].filter(Boolean) as number[]
  // Assignee list: the team first, then the rest of the department.
  const teamPeople = people.filter((p) => teamIds.includes(p.id))
  const deptPeople = people.filter((p) => !teamIds.includes(p.id))
  const teamNames = new Map<number, string>([[m.lead_user_id || 0, m.lead_name || ''], ...m.assistants.map((a) => [a.id, a.name] as [number, string])])
  const live = ws.tasks.filter((t) => t.status !== 'cancelled')
  const doneCount = live.filter((t) => t.status === 'done').length
  const allDone = live.length > 0 && doneCount === live.length
  // Why Submit is not available yet — shown next to the button, not in a tooltip.
  const submitBlocker = m.is_locked ? `Waits for step ${m.waiting_for_sequence} to be achieved`
    : live.length === 0 ? 'Add tasks first — nothing to submit yet'
    : !allDone ? `${doneCount} of ${live.length} task(s) done — every task must be Done`
    : ''
  const canOpenProject = !!user?.apps?.includes('projects')

  const saveTask = async () => {
    if (!form) return
    const missing: string[] = []
    if (!form.title.trim()) missing.push('Task name is required.')
    if (!selfTask && !form.assignee_id) missing.push('Assign the task to someone on the team.')
    if (!form.due_date) missing.push('Due date is required.')
    if (form.due_date && form.due_date > m.target_date) missing.push(`Due date must be on or before the WBS date (${formatDate(m.target_date)}).`)
    if (missing.length) { setError(missing); return }
    const payload = {
      title: form.title.trim(), description: form.description.trim() || null,
      due_date: form.due_date, priority: form.priority, estimated_hours: form.estimated_hours ? Number(form.estimated_hours) : null,
    }
    await act(async () => {
      if (selfTask) await pmWorkApi.createOwnTask(m.id, payload)
      else if (form.id) await pmWorkApi.updateTask(form.id, { ...payload, assignee_id: Number(form.assignee_id) })
      else await pmWorkApi.createTask(m.id, { ...payload, assignee_id: Number(form.assignee_id) })
      setForm(null)
    }, 'Could not save the task.')
  }

  const uploadEvidence = async (files: FileList | null) => {
    if (!files || files.length === 0) return
    const fd = new FormData()
    fd.append('doc_type', docType)
    Array.from(files).forEach((f) => fd.append('files', f))
    await act(() => pmWorkApi.uploadEvidence(m.id, fd), 'Upload failed.')
    if (fileRef.current) fileRef.current.value = ''
  }

  return (
    <div>
      <div style={sectionStyle}>
        <p style={{ fontSize: 12, fontWeight: 700, color: TEXT.muted, margin: '0 0 4px' }}>
          {canOpenProject ? (
            <a href="#" onClick={(e) => { e.preventDefault(); router.push(recordPath('/dashboard/projects', m, 'project_id')) }} style={{ color: '#2563eb', textDecoration: 'none' }}>
              {m.project_code} · {m.project_name}
            </a>
          ) : <>{m.project_code} · {m.project_name}</>}
        </p>
        <h1 style={{ fontSize: 21, fontWeight: 700, color: TEXT.heading, margin: '0 0 8px' }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: '#4338ca', marginRight: 8 }}>Step {m.sequence}</span>{m.title}
        </h1>
        <div data-tour="pm-mw-badges" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 10 }}>
          <Pill value={m.status} labels={MILESTONE_LABELS} hex={MILESTONE_HEX} />
          {m.is_overdue && <FlagPill text="Overdue" color="#dc2626" />}
          {m.is_at_risk && <FlagPill text="At risk" color="#f59e0b" />}
          {m.is_locked && <FlagPill text="Locked" color="#64748b" />}
          <span style={{ fontSize: 12.5, color: TEXT.secondary }}>
            {m.department_name} · due {formatDate(m.target_date)}{m.original_target_date ? ` (originally ${formatDate(m.original_target_date)})` : ''}
            {m.actual_date ? ` · achieved ${formatDate(m.actual_date)}` : ''}
          </span>
          {full && (
            <span title="Progress = tasks Done ÷ all tasks (cancelled tasks don't count)" style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 11.5, color: TEXT.muted }}>{doneCount}/{live.length} tasks done</span>
              <ProgressBar value={m.progress_percent} width={150} />
            </span>
          )}
        </div>
        <p data-tour="pm-mw-deliverable" style={{ fontSize: 13, color: TEXT.body, margin: 0, whiteSpace: 'pre-wrap' }}><strong>Deliverable:</strong> {m.deliverable}</p>
        <div data-tour="pm-mw-team" style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginTop: 8, fontSize: 12.5, color: TEXT.secondary }}>
          <span><strong>Lead:</strong> {m.lead_name || '—'}</span>
          <span><strong>Assistants:</strong> {m.assistants.length ? m.assistants.map((a) => a.name).join(', ') : '—'}</span>
          {ws.can_plan && !['achieved', 'cancelled'].includes(m.status) && teamEdit === null && (
            <button type="button" onClick={() => setTeamEdit(m.assistant_user_ids || [])} style={{ ...actionBtn('secondary'), padding: '3px 10px', fontSize: 11.5 }}>Edit team</button>
          )}
        </div>
        {teamEdit !== null && (
          <FormSheet width={580} icon="users" title="Edit Team" subtitle={`WBS '${m.title}' — lead ${m.lead_name || '—'}.`} onClose={() => setTeamEdit(null)} busy={busy}
            footer={<>
              <button type="button" onClick={() => setTeamEdit(null)} disabled={busy} style={sheetBtn('secondary', SHEET.INK, busy)}>Cancel</button>
              <button type="button" disabled={busy} onClick={() => { const ids = teamEdit; act(async () => { await pmWorkApi.updateTeam(m.id, ids); setTeamEdit(null) }, 'Could not update the team.') }} style={sheetBtn('primary', SHEET.BLUE, busy)}><SheetIcon name="check" size={16} />{busy ? 'Saving…' : 'Save team'}</button>
            </>}>
            <div style={{ padding: '20px 24px' }}>
              <ErrorBanner error={error} />
              <SheetSection icon="users" title="Assistants">
                <label style={sheetLabel}>Assistants <Optional /></label>
                <PeoplePicker people={candidates} value={teamEdit} exclude={m.lead_user_id ? [m.lead_user_id] : []} onChange={setTeamEdit} />
                <p style={sheetHint}>Assistants see the WBS, their own tasks, and can add tasks for themselves.</p>
              </SheetSection>
            </div>
          </FormSheet>
        )}
        {full && <WbsStepper status={m.status} hasTasks={live.length > 0} allDone={allDone} hasEvidence={ws.evidence.length > 0} />}
        {ws.role === 'member' && (
          <div style={{ marginTop: 12 }}>
            <Notice tone="info">
              {live.length ? `Your tasks: ${doneCount} of ${live.length} done` : 'No tasks for you yet'} · WBS stage: {MILESTONE_LABELS[m.status] || m.status}
              {['not_started', 'in_progress'].includes(m.status) && live.length > 0 && doneCount < live.length ? ' — the lead can submit only when your tasks are Done.' : ''}
            </Notice>
          </div>
        )}
        {m.is_locked && <div style={{ marginTop: 12 }}><Notice tone="warn">Locked — step {m.waiting_for_sequence} &quot;{m.waiting_for_title}&quot; must be achieved before work here can start. You can already plan tasks and use the team chat.</Notice></div>}
        {ws.role === 'guest' && <div style={{ marginTop: 12 }}><Notice tone="info">You were tagged in this WBS&apos;s chat — you can read and reply below.</Notice></div>}
        {m.project_status !== 'active' && <div style={{ marginTop: 12 }}><Notice tone="warn">The project is {m.project_status?.replace('_', ' ')} — work can&apos;t be recorded right now.</Notice></div>}
        {m.status === 'in_progress' && m.return_reason && <div style={{ marginTop: 12 }}><Notice tone="bad">Rejected by management: {m.return_reason}</Notice></div>}
        {m.status === 'submitted' && <div style={{ marginTop: 12 }}><Notice tone="info">Submitted by {m.submitted_by_name}: {m.submission_note}</Notice></div>}
        {m.status === 'cancelled' && <div style={{ marginTop: 12 }}><Notice tone="bad">Cancelled: {m.cancel_reason}</Notice></div>}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12, justifyContent: 'flex-end', alignItems: 'center' }}>
          {ws.can_manage && m.status === 'submitted' && engineRequest === false && (
            <>
              <button data-tour="pm-mw-accept-btn" type="button" disabled={busy} onClick={() => { setAcceptDate(todayIso()); setAcceptOpen(true) }} style={actionBtn('primary', busy)}>Accept WBS</button>
              <button data-tour="pm-mw-reject-btn" type="button" disabled={busy} onClick={() => setReasonFor({ kind: 'reject' })} style={actionBtn('danger', busy)}>Reject</button>
            </>
          )}
          {canPlan && (
            <>
              {submitBlocker && <span style={{ fontSize: 12, color: TEXT.muted }}>{submitBlocker}</span>}
              <button data-tour="pm-mw-submit-btn" type="button" disabled={busy || !!submitBlocker} onClick={() => { setNote(''); setSubmitOpen(true) }} style={actionBtn('primary', busy || !!submitBlocker)}>
                Submit WBS
              </button>
            </>
          )}
        </div>
        {!form && teamEdit === null && <ErrorBanner error={error} />}
      </div>

      <ApprovalPanel title="Acceptance" entityType="pm_milestone" entityId={m.id} onChanged={() => load()} />

      {ws.role !== 'guest' && <div data-tour="pm-mw-tasks" style={sectionStyle}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, gap: 10, flexWrap: 'wrap' }}>
          <h2 style={{ fontSize: 16, fontWeight: 700, color: TEXT.heading, margin: 0 }}>{full ? `Tasks (${live.length})` : `My tasks (${live.length})`}</h2>
          {!form && (
            <div style={{ display: 'flex', gap: 8 }}>
              {canAddOwn && <button data-tour="pm-mw-add-own-btn" type="button" onClick={() => { setSelfTask(true); setForm(emptyTask()) }} style={actionBtn(canPlan ? 'secondary' : 'primary')}>+ My own task</button>}
              {canPlan && <button data-tour="pm-mw-add-task-btn" type="button" onClick={() => { setSelfTask(false); setForm(emptyTask()) }} style={actionBtn('primary')}>+ Assign task</button>}
            </div>
          )}
        </div>
        {form && (
          <FormSheet width={580} icon={form.id ? 'edit' : 'plus'} title={form.id ? 'Edit Task' : selfTask ? 'Add My Task' : 'Assign Task'}
            subtitle={`WBS '${m.title}' — tasks must be due by ${formatDate(m.target_date)}.`} onClose={() => { setForm(null); setError('') }} busy={busy}
            footer={<>
              <button data-tour="pm-task-form-cancel" type="button" onClick={() => { setForm(null); setError('') }} disabled={busy} style={sheetBtn('secondary', SHEET.INK, busy)}>Cancel</button>
              <button data-tour="pm-task-form-save" type="button" onClick={saveTask} disabled={busy} style={sheetBtn('primary', SHEET.BLUE, busy)}><SheetIcon name={form.id ? 'check' : 'plus'} size={16} />{busy ? 'Saving…' : form.id ? 'Save' : selfTask ? 'Add my task' : 'Create & assign'}</button>
            </>}>
            <div style={{ padding: '20px 24px' }}>
              <ErrorBanner error={error} />
              <SheetSection icon="list" title="Basic Information">
                <div data-tour="pm-task-form-title">
                  <label style={sheetLabel}>Task name <Req /></label>
                  <input style={sheetInput} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="e.g. Prepare GA drawing" autoFocus />
                </div>
                <div data-tour="pm-task-form-description" style={{ marginTop: 14 }}>
                  <label style={sheetLabel}>Description <Optional /></label>
                  <textarea style={{ ...sheetInput, minHeight: 60, resize: 'vertical' }} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
                </div>
              </SheetSection>
              <SheetSection icon={selfTask ? 'calendar' : 'user'} title={selfTask ? 'Schedule' : 'Assignment & Schedule'}>
                {!selfTask && <div data-tour="pm-task-form-assignee" style={{ marginBottom: 14, maxWidth: 360 }}>
                  <label style={sheetLabel}>Assigned to <Req /></label>
                  <select style={sheetInput} value={form.assignee_id} onChange={(e) => setForm({ ...form, assignee_id: e.target.value })}>
                    <option value="">Select…</option>
                    <optgroup label="WBS team">
                      {teamIds.map((id) => <option key={id} value={id}>{teamPeople.find((p) => p.id === id)?.name || teamNames.get(id) || `User #${id}`}{id === m.lead_user_id ? ' (lead)' : ''}</option>)}
                    </optgroup>
                    {deptPeople.length > 0 && (
                      <optgroup label={`Others in ${m.department_name || 'the department'} (joins the team)`}>
                        {deptPeople.map((p) => <option key={p.id} value={p.id}>{p.name}{p.designation ? ` — ${p.designation}` : ''}</option>)}
                      </optgroup>
                    )}
                  </select>
                </div>}
                <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                  <div data-tour="pm-task-form-due" style={{ flex: '0 1 170px', minWidth: 150 }}>
                    <label style={sheetLabel}>Due date <Req /></label>
                    <DateField value={form.due_date} onChange={(v) => setForm({ ...form, due_date: v })} />
                  </div>
                  <div data-tour="pm-task-form-priority" style={{ flex: '0 1 140px', minWidth: 120 }}>
                    <label style={sheetLabel}>Priority <Req /></label>
                    <select style={sheetInput} value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })}>
                      {Object.entries(PRIORITY_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                    </select>
                  </div>
                  <div data-tour="pm-task-form-hours" style={{ flex: '0 1 130px', minWidth: 110 }}>
                    <label style={sheetLabel}>Estimated hours</label>
                    <input type="number" min={0} step="0.5" style={sheetInput} value={form.estimated_hours} onChange={(e) => setForm({ ...form, estimated_hours: e.target.value })} />
                  </div>
                </div>
                <p style={sheetHint}>Due on or before the WBS date ({formatDate(m.target_date)}).</p>
              </SheetSection>
            </div>
          </FormSheet>
        )}
        {ws.tasks.length === 0 ? (
          <p style={{ fontSize: 13, color: TEXT.muted, margin: 0 }}>No tasks yet.{canPlan ? ' Break the WBS into tasks and assign each to someone on the team.' : canAddOwn ? ' Your lead will assign tasks; you can also add your own.' : ''}</p>
        ) : (
          <TaskTable
            tasks={ws.tasks}
            onOpen={(t) => router.push(recordPath('/dashboard/projects/tasks', t))}
            actions={canPlan ? (t) => (
              <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }} onClick={(e) => e.stopPropagation()}>
                {['todo', 'in_progress', 'blocked'].includes(t.status) && (
                  <button type="button" onClick={() => { setSelfTask(false); setForm({ id: t.id, title: t.title, description: t.description || '', assignee_id: t.assignee_id ? String(t.assignee_id) : '', due_date: t.due_date || '', priority: t.priority, estimated_hours: t.estimated_hours != null ? String(t.estimated_hours) : '' }) }} style={{ ...actionBtn('secondary'), padding: '4px 9px', fontSize: 11.5 }}>Edit</button>
                )}
                {t.status === 'done' && <button type="button" onClick={() => setReasonFor({ task: t, kind: 'reopen' })} style={{ ...actionBtn('secondary'), padding: '4px 9px', fontSize: 11.5 }}>Reopen</button>}
                {['todo', 'in_progress', 'blocked'].includes(t.status) && <button type="button" onClick={() => setReasonFor({ task: t, kind: 'cancel' })} style={{ ...actionBtn('danger'), padding: '4px 9px', fontSize: 11.5 }}>Cancel</button>}
                {t.status === 'todo' && !t.started_at && t.subtasks_total === 0 && (
                  <button type="button" onClick={() => setDeleteTask(t)} title="Only works while nothing is recorded on the task (no comments or files) — otherwise use Cancel" style={{ ...actionBtn('danger'), padding: '4px 9px', fontSize: 11.5 }}>Delete</button>
                )}
              </div>
            ) : undefined}
          />
        )}
      </div>}

      {full && <div data-tour="pm-mw-evidence" style={sectionStyle}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, gap: 10, flexWrap: 'wrap' }}>
          <h2 style={{ fontSize: 16, fontWeight: 700, color: TEXT.heading, margin: 0 }}>Evidence</h2>
          {canPlan && (
            <div style={{ display: 'flex', gap: 8 }}>
              <select data-tour="pm-mw-evidence-type" style={{ ...inputStyle, width: 150 }} value={docType} onChange={(e) => setDocType(e.target.value)}>
                {Object.entries(DOC_TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
              <input ref={fileRef} type="file" multiple hidden onChange={(e) => uploadEvidence(e.target.files)} />
              <button data-tour="pm-mw-attach-btn" type="button" disabled={busy} onClick={() => fileRef.current?.click()} style={actionBtn('secondary', busy)}>Attach files</button>
            </div>
          )}
        </div>
        <p style={{ fontSize: 12.5, color: TEXT.muted, margin: '0 0 10px' }}>
          Drawings, reports or certificates that prove the deliverable — management checks these before accepting.
          {ws.evidence.length === 0 && !allDone && open ? ' Attach them once the work is done, before you submit.' : ''}
        </p>
        <AttachmentList
          files={ws.evidence}
          onOpen={(id, name) => openAttachmentBlob(() => pmWorkApi.fileBlob(id), name).catch(() => setError(`Could not open ${name}.`))}
          onDelete={canPlan ? (id) => act(() => pmWorkApi.deleteFile(id), 'Could not remove the file.') : undefined}
          canDelete={(f) => user?.role === 'admin' || f.uploaded_by_id === user?.id}
        />
      </div>}

      <PmChat milestoneId={m.id} readOnly={['closed', 'cancelled'].includes(m.project_status || '')} />

      {full && <WorkBreakdown refreshKey={ws.tasks.map((t) => `${t.id}:${t.status}`).join(',')} milestoneId={m.id} />}

      {submitOpen && (
        <FormSheet width={580} icon="send" title="Submit WBS" subtitle={`'${m.title}' goes to management to accept or reject.`} onClose={() => setSubmitOpen(false)} busy={busy}
          footer={<>
            <button type="button" onClick={() => setSubmitOpen(false)} style={sheetBtn('secondary', SHEET.INK)}>Cancel</button>
            <button type="button" disabled={!note.trim()} onClick={() => { setSubmitOpen(false); act(() => pmWorkApi.submitMilestone(m.id, note.trim()), 'Could not submit the WBS.') }} style={sheetBtn('primary', SHEET.BLUE, !note.trim())}><SheetIcon name="send" size={16} />Submit</button>
          </>}>
          <div style={{ padding: '20px 24px' }}>
            <SheetSection icon="doc" title="Handover">
              <p style={{ ...sheetHint, margin: '0 0 12px' }}>All {live.length} task(s) are Done. {ws.evidence.length} evidence file(s) attached. Management will accept or reject it.</p>
              <label style={sheetLabel}>Handover note <Req /></label>
              <textarea style={{ ...sheetInput, minHeight: 90, resize: 'vertical' }} value={note} onChange={(e) => setNote(e.target.value)} placeholder="What is attached (drawing no., report, certificate) and anything management should check" autoFocus />
            </SheetSection>
          </div>
        </FormSheet>
      )}
      {acceptOpen && (
        <FormSheet width={580} icon="check" iconColor="#16a34a" title="Accept WBS" subtitle={`Accept '${m.title}' as achieved.`} onClose={() => setAcceptOpen(false)} busy={busy}
          footer={<>
            <button type="button" onClick={() => setAcceptOpen(false)} style={sheetBtn('secondary', SHEET.INK)}>Cancel</button>
            <button type="button" onClick={() => { setAcceptOpen(false); act(() => projectsApi.acceptMilestone(m.project_id, m.id, acceptDate), 'Could not accept the WBS.') }} style={sheetBtn('primary', '#16a34a')}><SheetIcon name="check" size={16} />Accept</button>
          </>}>
          <div style={{ padding: '20px 24px' }}>
            <SheetSection icon="calendar" title="Achievement">
              <div style={{ maxWidth: 200 }}>
                <label style={sheetLabel}>Actual date achieved</label>
                <DateField value={acceptDate} onChange={setAcceptDate} />
              </div>
            </SheetSection>
          </div>
        </FormSheet>
      )}
      <PromptDialog
        open={!!reasonFor}
        title={reasonFor?.kind === 'reject' ? `Reject "${m.title}"?` : reasonFor?.kind === 'reopen' ? `Reopen "${reasonFor?.task?.title}"?` : `Cancel "${reasonFor?.task?.title}"?`}
        message={reasonFor?.kind === 'reject' ? 'Say what is missing or wrong — the department head sees this.' : reasonFor?.kind === 'reopen' ? 'What still needs doing? It goes back to the person as In progress.' : 'Why is this task no longer needed?'}
        confirmLabel={reasonFor?.kind === 'reject' ? 'Reject' : reasonFor?.kind === 'reopen' ? 'Reopen' : 'Cancel task'}
        danger={reasonFor?.kind !== 'reopen'}
        requireValue
        onConfirm={(v) => {
          const r = reasonFor!
          setReasonFor(null)
          if (r.kind === 'reject') act(() => projectsApi.rejectMilestone(m.project_id, m.id, v), 'Could not reject the WBS.')
          else if (r.kind === 'reopen') act(() => pmWorkApi.reopenTask(r.task!.id, v), 'Could not reopen the task.')
          else act(() => pmWorkApi.cancelTask(r.task!.id, v), 'Could not cancel the task.')
        }}
        onCancel={() => setReasonFor(null)}
      />
      <ConfirmDialog
        open={!!deleteTask}
        title="Delete this task?"
        message={deleteTask ? `Delete "${deleteTask.title}"? No work has been recorded on it yet.` : ''}
        confirmLabel="Delete"
        onConfirm={() => { const t = deleteTask!; setDeleteTask(null); act(() => pmWorkApi.deleteTask(t.id), 'Could not delete the task.') }}
        onCancel={() => setDeleteTask(null)}
      />
    </div>
  )
}

/** Where the WBS stands: Plan tasks → Work → Evidence → Submit → Accepted. */
function WbsStepper({ status, hasTasks, allDone, hasEvidence }: { status: string; hasTasks: boolean; allDone: boolean; hasEvidence: boolean }) {
  if (status === 'cancelled') return null
  const submitted = status === 'submitted' || status === 'achieved'
  const steps = [
    { label: 'Plan tasks', done: hasTasks || submitted },
    { label: 'Work', done: allDone || submitted },
    { label: 'Evidence', done: hasEvidence || submitted },
    { label: 'Submit', done: submitted },
    { label: 'Accepted', done: status === 'achieved' },
  ]
  const current = steps.findIndex((x) => !x.done)
  return (
    <div data-tour="pm-mw-stepper" style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', marginTop: 12 }}>
      {steps.map((x, i) => {
        const color = x.done ? '#16a34a' : i === current ? '#6366f1' : '#94a3b8'
        return (
          <span key={x.label} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '3px 10px', borderRadius: 999, fontSize: 12, fontWeight: i === current ? 700 : 600, color, border: `1px solid ${color}55`, background: i === current ? 'rgba(99,102,241,0.08)' : 'transparent' }}>
              {x.done ? '✓' : i + 1} {x.label}
            </span>
            {i < steps.length - 1 && <span style={{ color: '#cbd5e1', fontSize: 12 }}>→</span>}
          </span>
        )
      })}
    </div>
  )
}
