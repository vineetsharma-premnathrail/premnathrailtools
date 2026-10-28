'use client'

import Select from '@/components/shared/Select'
import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { projectsApi } from '@/lib/api'
import { PmProject, PmProjectMilestone, PmStartRule } from '@/types'
import { TEXT } from '@/lib/theme'
import { formatDate } from '@/lib/format'
import { useCan } from '@/lib/permissions'
import { extractErrorMessages } from '@/lib/validation'
import DateField from '@/components/erp/DateField'
import SearchableSelect from '@/components/erp/SearchableSelect'
import PeoplePicker, { useTeamCandidates } from '@/components/projects/work/PeoplePicker'
import ConfirmDialog from '@/components/erp/ConfirmDialog'
import PromptDialog from '@/components/erp/PromptDialog'
import { recordPath } from '@/lib/recordRef'
import {
  ErrorBanner, FlagPill, Notice, MILESTONE_HEX, MILESTONE_LABELS, Pill, ProgressBar, actionBtn, smallActionBtn, sectionStyle,
  tdStyle, thStyle, todayIso,
} from '@/components/projects/work/pmUi'
import { useFormDraft } from '@/lib/formDraft'
import DraftBanner from '@/components/shared/DraftBanner'
import { FormSheet, Optional, Req, SHEET, SheetColumns, SheetIcon, SheetSection, sheetBtn, sheetHint, sheetInput, sheetLabel } from '@/components/shared/FormSheet'
import { RowCount } from '@/components/shared/ui'

type Dept = { id: number; name: string; heads: string[]; has_head: boolean }
type Form = { id?: number; title: string; department_id: string; lead_user_id: string; assistant_user_ids: number[]; target_date: string; deliverable: string; date_change_reason: string; original_target?: string; start_rule: PmStartRule; depends_on: string }
const emptyForm = (): Form => ({ title: '', department_id: '', lead_user_id: '', assistant_user_ids: [], target_date: '', deliverable: '', date_change_reason: '', start_rule: 'after_previous', depends_on: '' })

// When a step may start. Most run top to bottom; some overlap (purchase and
// production start while design is still changing).
const START_RULES: { value: PmStartRule; label: string }[] = [
  { value: 'after_previous', label: 'After all steps above are achieved' },
  { value: 'with_previous', label: 'Together with the step above (parallel)' },
  { value: 'after_step_started', label: 'Once a chosen step has started (overlap)' },
  { value: 'after_step_done', label: 'After a chosen step is achieved' },
]
const needsStep = (r: PmStartRule) => r === 'after_step_started' || r === 'after_step_done'
const ruleBadge = (m: PmProjectMilestone): { text: string; color: string } | null => {
  if (m.start_rule === 'with_previous') return { text: '∥ parallel with step above', color: '#0891b2' }
  if (m.start_rule === 'after_step_started') return { text: `↗ once step ${m.depends_on_sequence ?? '?'} starts`, color: '#7c3aed' }
  if (m.start_rule === 'after_step_done') return { text: `after step ${m.depends_on_sequence ?? '?'} only`, color: '#4338ca' }
  return null
}

/** Management lays the milestones out as a chain (R&D → Design → Purchase →
 * Production → Quality …), added one by one for each project.
 * Each step has a department, a lead who represents it (plans and assigns
 * tasks) and assistants, and a start rule: after the steps above (default),
 * in parallel with the step above, or overlapping a chosen step once it has
 * started. Management moves dates with a reason and accepts or rejects what
 * departments submit. */
export default function MilestonesTab({ project, onChange }: { project: PmProject; onChange: () => void }) {
  const [rows, setRows] = useState<PmProjectMilestone[]>([])
  const [depts, setDepts] = useState<Dept[]>([])
  const [form, setForm] = useState<Form | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | string[]>('')
  const [info, setInfo] = useState('')
  const [acceptFor, setAcceptFor] = useState<PmProjectMilestone | null>(null)
  const [acceptDate, setAcceptDate] = useState(todayIso())
  const [reasonFor, setReasonFor] = useState<{ m: PmProjectMilestone; kind: 'reject' | 'cancel' } | null>(null)
  const [deleteFor, setDeleteFor] = useState<PmProjectMilestone | null>(null)

  const { user, can, canDelete } = useCan()
  const open = project.can_manage && ['planning', 'active', 'on_hold'].includes(project.status)
  // The project's own manager always runs its WBS (add / edit / delete),
  // without needing the Milestones grants in the Permission Matrix.
  const isPm = !!user && project.project_manager_id === user.id
  const editable = open && (isPm || can('projects', 'milestones', 'edit'))
  const creatable = open && (isPm || can('projects', 'milestones', 'create'))
  // Milestones carry no creator id, so only 'Delete' on the tab is checked.
  const deletable = open && (isPm || canDelete('projects', 'milestones', null))

  const load = useCallback(() => {
    projectsApi.milestones(project.id).then((d) => setRows(Array.isArray(d) ? d : [])).catch((err) => setError(extractErrorMessages(err, 'Failed to load WBS elements.')))
  }, [project.id])
  useEffect(() => { load() }, [load])
  useEffect(() => { projectsApi.departments().then(setDepts).catch(() => setDepts([])) }, [])

  const draft = useFormDraft(form && !form.id ? `projects-wbs-new-${project.id}` : null, form, (d) => setForm({ ...emptyForm(), ...d }))
  const candidates = useTeamCandidates(form?.department_id ? Number(form.department_id) : null)
  const done = () => { load(); onChange() }
  const act = async (fn: () => Promise<unknown>, fallback: string) => {
    setError('')
    setInfo('')
    try { await fn(); done() } catch (err) { setError(extractErrorMessages(err, fallback)) }
  }

  const save = async () => {
    if (!form) return
    const missing: string[] = []
    if (!form.title.trim()) missing.push('WBS name is required.')
    if (!form.department_id) missing.push('Department is required.')
    if (!form.lead_user_id) missing.push('Pick the WBS lead — the person who represents the department and plans its tasks.')
    if (!form.target_date) missing.push('Target date is required.')
    if (!form.deliverable.trim()) missing.push('Deliverable / completion criteria is required — it is how everyone agrees the WBS is done.')
    else if (form.deliverable.trim().length < 10) missing.push("Describe the deliverable in at least 10 characters — what is handed over and how it is judged done (e.g. 'Signed GA drawing + BOM').")
    if (needsStep(form.start_rule) && !form.depends_on) missing.push('Pick the step this WBS waits for.')
    const moved = form.id && form.original_target && form.target_date !== form.original_target
    if (moved && project.status !== 'planning' && !form.date_change_reason.trim()) missing.push('Give a reason for moving the target date — the department committed to the old date.')
    if (missing.length) { setError(missing); return }
    setSaving(true)
    setError('')
    const payload: Record<string, unknown> = {
      title: form.title.trim(), department_id: Number(form.department_id), target_date: form.target_date,
      deliverable: form.deliverable.trim(), lead_user_id: Number(form.lead_user_id),
      assistant_user_ids: form.assistant_user_ids.filter((i) => i !== Number(form.lead_user_id)),
      start_rule: form.start_rule,
      depends_on_milestone_id: needsStep(form.start_rule) && form.depends_on ? Number(form.depends_on) : null,
    }
    if (moved) payload.date_change_reason = form.date_change_reason.trim()
    try {
      if (form.id) await projectsApi.updateMilestone(project.id, form.id, payload)
      else { await projectsApi.createMilestone(project.id, payload); draft.clear() }
      setForm(null)
      done()
    } catch (err) {
      setError(extractErrorMessages(err, 'Could not save the WBS.'))
    } finally {
      setSaving(false)
    }
  }

  const edit = (m: PmProjectMilestone) => setForm({
    id: m.id, title: m.title, department_id: m.department_id ? String(m.department_id) : '', target_date: m.target_date,
    lead_user_id: m.lead_user_id ? String(m.lead_user_id) : '', assistant_user_ids: m.assistant_user_ids || [],
    deliverable: m.deliverable || '', date_change_reason: '', original_target: m.target_date,
    start_rule: m.start_rule || 'after_previous', depends_on: m.depends_on_milestone_id ? String(m.depends_on_milestone_id) : '',
  })
  const move = (m: PmProjectMilestone, dir: 'up' | 'down') => act(() => projectsApi.moveMilestone(project.id, m.id, dir), 'Could not move the WBS.')
  const movable = (m: PmProjectMilestone) => m.status === 'not_started' 

  return (
    <div data-tour="pm-ms-section" style={sectionStyle}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, gap: 10, flexWrap: 'wrap' }}>
        <div>
          <h2 style={{ fontSize: 16, fontWeight: 700, color: TEXT.heading, margin: 0 }}>WBS</h2>
          <p style={{ fontSize: 12.5, color: TEXT.muted, margin: '2px 0 0' }}>Steps run top to bottom unless their start rule says otherwise — a step can run in parallel with the one above, or overlap a chosen step once it has started. Each step&apos;s lead turns it into tasks for the team once the project is started.</p>
        </div>
        {creatable && !form && <button data-tour="pm-ms-add-btn" type="button" onClick={() => setForm(emptyForm())} style={actionBtn('primary')}>+ Add WBS</button>}
      </div>
      {!form && <ErrorBanner error={error} />}
      {info && <div style={{ marginBottom: 12 }}><Notice tone="info">{info}</Notice></div>}

      {form && (
        <FormSheet icon={form.id ? 'edit' : 'flag'} title={form.id ? 'Edit WBS' : 'Add WBS'} subtitle={`${project.project_code} · ${project.name}`}
          onClose={() => { setForm(null); setError('') }} busy={saving}
          footer={<>
            <button data-tour="pm-ms-form-cancel" type="button" onClick={() => { setForm(null); setError('') }} disabled={saving} style={sheetBtn('secondary', SHEET.INK, saving)}>Cancel</button>
            <button data-tour="pm-ms-form-save" type="button" onClick={save} disabled={saving} style={sheetBtn('primary', SHEET.BLUE, saving)}><SheetIcon name={form.id ? 'check' : 'plus'} size={16} />{saving ? 'Saving…' : form.id ? 'Save' : 'Add WBS'}</button>
          </>}>
          <SheetColumns
            left={<>
              <DraftBanner draft={draft} />
              <ErrorBanner error={error} />
              <SheetSection icon="list" title="Basic Information">
                <div data-tour="pm-ms-form-title">
                  <label style={sheetLabel}>WBS name <Req /></label>
                  <input style={sheetInput} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="e.g. GA drawing released — name the outcome, not the department" autoFocus />
                </div>
                <div data-tour="pm-ms-form-deliverable" style={{ marginTop: 14 }}>
                  <label style={sheetLabel}>Deliverable / completion criteria <Req /></label>
                  <textarea style={{ ...sheetInput, minHeight: 72, resize: 'vertical' }} value={form.deliverable} onChange={(e) => setForm({ ...form, deliverable: e.target.value })} placeholder="What must be handed over, and how it will be judged done (e.g. signed GA drawing + BOM)" />
                </div>
              </SheetSection>
              <SheetSection icon="calendar" title="Department & Schedule">
                <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                  <div data-tour="pm-ms-form-dept" style={{ flex: '1 1 220px', maxWidth: 320 }}>
                    <label style={sheetLabel}>Department <Req /></label>
                    <Select style={sheetInput} value={form.department_id} onChange={(e) => setForm({ ...form, department_id: e.target.value })}>
                      <option value="">Select…</option>
                      {depts.map((d) => <option key={d.id} value={d.id}>{d.name}{d.has_head ? ` — head ${d.heads.join(', ')}` : ''}</option>)}
                    </Select>
                  </div>
                  <div data-tour="pm-ms-form-target" style={{ flex: '0 1 170px', minWidth: 150 }}>
                    <label style={sheetLabel}>Target date <Req /></label>
                    <DateField value={form.target_date} onChange={(v) => setForm({ ...form, target_date: v })} />
                  </div>
                </div>
                {form.id && form.original_target && form.target_date !== form.original_target && project.status !== 'planning' && (
                  <div data-tour="pm-ms-form-reason" style={{ marginTop: 14 }}>
                    <label style={sheetLabel}>Reason for moving the date <Req /></label>
                    <input style={sheetInput} value={form.date_change_reason} onChange={(e) => setForm({ ...form, date_change_reason: e.target.value })} />
                    <p style={sheetHint}>Was {formatDate(form.original_target)}; the original date is kept.</p>
                  </div>
                )}
              </SheetSection>
            </>}
            right={<>
              <SheetSection icon="users" title="Team">
                <div data-tour="pm-ms-form-lead">
                  <label style={sheetLabel}>Lead (head for this WBS) <Req /></label>
                  <SearchableSelect
                    value={form.lead_user_id}
                    onChange={(v) => setForm({ ...form, lead_user_id: v, assistant_user_ids: form.assistant_user_ids.filter((i) => i !== Number(v)) })}
                    options={candidates.map((c) => ({ value: String(c.id), label: `${c.name}${c.sub ? ` — ${c.sub}` : ''}` }))}
                    placeholder={form.department_id ? 'Who represents the department?' : 'Pick the department first'}
                  />
                  <p style={sheetHint}>Plans and assigns the tasks, submits the WBS.</p>
                </div>
                <div data-tour="pm-ms-form-assistants" style={{ marginTop: 14 }}>
                  <label style={sheetLabel}>Assistants <Optional /></label>
                  <PeoplePicker people={candidates} value={form.assistant_user_ids} exclude={form.lead_user_id ? [Number(form.lead_user_id)] : []}
                    onChange={(ids) => setForm({ ...form, assistant_user_ids: ids })} placeholder="Type a name to add…" />
                  <p style={sheetHint}>See their own tasks and the team chat; can add their own tasks.</p>
                </div>
              </SheetSection>
              <SheetSection icon="right" title="Start rule">
                <div data-tour="pm-ms-form-start-rule">
                  <label style={sheetLabel}>Starts</label>
                  <Select style={sheetInput} value={form.start_rule} onChange={(e) => setForm({ ...form, start_rule: e.target.value as PmStartRule })}>
                    {START_RULES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
                  </Select>
                </div>
                {needsStep(form.start_rule) && (
                  <div data-tour="pm-ms-form-waits-for" style={{ marginTop: 14 }}>
                    <label style={sheetLabel}>{form.start_rule === 'after_step_started' ? 'Can start once this step has started' : 'Waits for this step to be achieved'} <Req /></label>
                    <Select style={sheetInput} value={form.depends_on} onChange={(e) => setForm({ ...form, depends_on: e.target.value })}>
                      <option value="">Select step…</option>
                      {rows.filter((r) => r.id !== form.id && r.status !== 'cancelled').map((r) => <option key={r.id} value={r.id}>Step {r.sequence}: {r.title}</option>)}
                    </Select>
                  </div>
                )}
              </SheetSection>
            </>}
          />
        </FormSheet>
      )}

      {rows.length === 0 ? (
        <div style={{ padding: 14, borderRadius: 12, background: 'rgba(99,102,241,0.05)', border: '1px dashed rgba(99,102,241,0.35)' }}>
          <p style={{ fontSize: 13, color: TEXT.secondary, margin: 0 }}>
            No WBS elements yet. Use &quot;+ Add WBS&quot; to lay out the steps this project needs.
          </p>
        </div>
      ) : (
        <div data-tour="pm-ms-table" style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 960 }}>
            <thead><tr>{['WBS no.', 'WBS', 'Department / team', 'Target', 'Status', 'Progress', ''].map((h, i) => <th key={h} style={thStyle}>{h}{i === 0 && <RowCount count={rows.length} />}</th>)}</tr></thead>
            <tbody>
              {rows.map((m, i) => (
                <tr key={m.id} style={{ opacity: m.status === 'cancelled' ? 0.55 : 1 }}>
                  <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>
                    {/* ui-audit-ignore-next-line custom-pill — round step-number badge, not a status pill */}
                    <span style={{ display: 'inline-flex', width: 26, height: 26, borderRadius: 9999, alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 800, background: m.status === 'achieved' ? '#16a34a1a' : 'rgba(99,102,241,0.1)', color: m.status === 'achieved' ? '#16a34a' : '#4338ca' }}>{m.sequence || i + 1}</span>
                    {editable && movable(m) && (
                      <span style={{ display: 'inline-flex', flexDirection: 'column', marginLeft: 4, verticalAlign: 'middle' }}>
                        {i > 0 && movable(rows[i - 1]) && <button type="button" title="Move up" onClick={() => move(m, 'up')} style={{ border: 'none', background: 'none', cursor: 'pointer', fontSize: 10, padding: 0, color: TEXT.muted }}>▲</button>}
                        {i < rows.length - 1 && movable(rows[i + 1]) && <button type="button" title="Move down" onClick={() => move(m, 'down')} style={{ border: 'none', background: 'none', cursor: 'pointer', fontSize: 10, padding: 0, color: TEXT.muted }}>▼</button>}
                      </span>
                    )}
                  </td>
                  <td style={tdStyle}>
                    <Link href={recordPath('/dashboard/projects/milestones', m)} style={{ fontWeight: 600, color: '#2563eb', textDecoration: 'none' }}>{m.title}</Link>
                    {ruleBadge(m) && <div style={{ display: 'inline-block', fontSize: 11, fontWeight: 700, padding: '1px 8px', borderRadius: 9999, margin: '2px 0', color: ruleBadge(m)!.color, background: `${ruleBadge(m)!.color}14` }}>{ruleBadge(m)!.text}</div>}
                    <div style={{ fontSize: 12, color: TEXT.muted, whiteSpace: 'pre-wrap' }}>{m.deliverable}</div>
                    {m.status === 'submitted' && m.submission_note && <div style={{ fontSize: 12, color: '#b45309', marginTop: 4 }}>Submitted: {m.submission_note} ({m.evidence_count} file(s))</div>}
                    {m.return_reason && m.status === 'in_progress' && <div style={{ fontSize: 12, color: '#b91c1c', marginTop: 4 }}>Rejected: {m.return_reason}</div>}
                    {m.cancel_reason && <div style={{ fontSize: 12, color: TEXT.muted, marginTop: 4 }}>Cancelled: {m.cancel_reason}</div>}
                  </td>
                  <td style={tdStyle}>
                    {m.department_name || '—'}
                    <div style={{ fontSize: 12, color: TEXT.secondary }}>Lead: {m.lead_name || <span style={{ color: '#b45309' }}>not set</span>}</div>
                    {m.assistants.length > 0 && <div style={{ fontSize: 11.5, color: TEXT.muted }}>+ {m.assistants.map((a) => a.name).join(', ')}</div>}
                  </td>
                  <td style={tdStyle}>
                    {formatDate(m.target_date)}
                    {m.original_target_date && <div style={{ fontSize: 11.5, color: TEXT.muted }}>originally {formatDate(m.original_target_date)}</div>}
                    {m.actual_date && <div style={{ fontSize: 11.5, color: '#16a34a' }}>achieved {formatDate(m.actual_date)}</div>}
                  </td>
                  <td style={tdStyle}>
                    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                      <Pill value={m.status} labels={MILESTONE_LABELS} hex={MILESTONE_HEX} />
                      {m.is_overdue && <FlagPill text="Overdue" color="#dc2626" />}
                      {m.is_at_risk && <FlagPill text="At risk" color="#f59e0b" />}
                      {m.is_locked && <FlagPill text="Locked" color="#64748b" />}
                    </div>
                    {m.is_locked && <div style={{ fontSize: 11.5, color: TEXT.muted, marginTop: 4 }}>Waits for {m.waiting_reason || `step ${m.waiting_for_sequence}: ${m.waiting_for_title}`}</div>}
                  </td>
                  <td style={tdStyle}><ProgressBar value={m.progress_percent} width={60} /><div style={{ fontSize: 11.5, color: TEXT.muted }}>{m.tasks_done}/{m.task_count} tasks</div></td>
                  <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>
                    {editable && m.status === 'submitted' && (
                      <>
                        <button type="button" onClick={() => { setAcceptDate(todayIso()); setAcceptFor(m) }} style={{ ...smallActionBtn('primary'), marginRight: 6 }}>Accept</button>
                        <button type="button" onClick={() => setReasonFor({ m, kind: 'reject' })} style={{ ...smallActionBtn('danger'), marginRight: 6 }}>Reject</button>
                      </>
                    )}
                    {editable && !['achieved', 'cancelled'].includes(m.status) && (
                      <>
                        <button type="button" onClick={() => edit(m)} style={{ ...smallActionBtn('secondary'), marginRight: 6 }}>Edit</button>
                        {m.status !== 'submitted' && <button type="button" onClick={() => setReasonFor({ m, kind: 'cancel' })} style={{ ...smallActionBtn('danger'), marginRight: 6 }}>Cancel</button>}
                        {deletable && m.status === 'not_started' && m.task_count === 0 && (
                          <button type="button" onClick={() => setDeleteFor(m)} title="Only works while no task (not even a cancelled one) was ever created — otherwise use Cancel" style={{ ...smallActionBtn('danger') }}>Delete</button>
                        )}
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {acceptFor && (
        <FormSheet width={580} icon="check" iconColor="#16a34a" title="Accept WBS" subtitle={`Accept '${acceptFor.title}' as achieved.`} onClose={() => setAcceptFor(null)} busy={false}
          footer={<>
            <button type="button" onClick={() => setAcceptFor(null)} style={sheetBtn('secondary', SHEET.INK)}>Cancel</button>
            <button type="button" onClick={() => { const m = acceptFor; setAcceptFor(null); act(() => projectsApi.acceptMilestone(project.id, m.id, acceptDate), 'Could not accept the WBS.') }} style={sheetBtn('primary', '#16a34a')}><SheetIcon name="check" size={16} />Accept</button>
          </>}>
          <div style={{ padding: '20px 24px' }}>
            {acceptFor.submission_note && (
              <SheetSection icon="doc" title="Submission">
                <p style={{ fontSize: 13, color: SHEET.BODY, margin: 0, whiteSpace: 'pre-wrap' }}>{acceptFor.submission_note}</p>
              </SheetSection>
            )}
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
        title={reasonFor?.kind === 'reject' ? `Reject "${reasonFor?.m.title}"?` : `Cancel "${reasonFor?.m.title}"?`}
        message={reasonFor?.kind === 'reject' ? 'Say what is missing or wrong — the department head sees this and the WBS goes back to In progress.' : 'Why is this WBS no longer needed? Its open tasks are cancelled too.'}
        confirmLabel={reasonFor?.kind === 'reject' ? 'Reject' : 'Cancel WBS'}
        danger
        requireValue
        onConfirm={(v) => {
          const r = reasonFor!
          setReasonFor(null)
          act(() => r.kind === 'reject' ? projectsApi.rejectMilestone(project.id, r.m.id, v) : projectsApi.cancelMilestone(project.id, r.m.id, v), 'Could not update the WBS.')
        }}
        onCancel={() => setReasonFor(null)}
      />
      <ConfirmDialog
        open={!!deleteFor}
        title="Delete this WBS?"
        message={deleteFor ? `Delete "${deleteFor.title}"? No work has been recorded on it yet.` : ''}
        confirmLabel="Delete"
        onConfirm={() => { const m = deleteFor!; setDeleteFor(null); act(async () => {
          // The server re-points WBS elements that waited for this one and says which.
          const res = await projectsApi.deleteMilestone(project.id, m.id) as { message?: string }
          if (res?.message && res.message !== 'WBS deleted') setInfo(res.message)
        }, 'Could not delete the WBS.') }}
        onCancel={() => setDeleteFor(null)}
      />
    </div>
  )
}
