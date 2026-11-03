'use client'

// R&D › R&D Tasks › Create Task. Step 1 is the Type — Requirement (default), Prototype or
// Project — and the matching form follows: a Requirement task is picked from requirements R&D
// has ACCEPTED (shown by R&D ID); a Prototype task from a Prototype / Research
// project; a Project task from a Project Management › All Projects project (PEW code).
// Title, details, assignee, start / due date, priority (Standard / Urgent),
// checklist and attachments are the same for both. The server checks the record
// rule (requirement accepted and openable, or project lead) and the "Assign to" rule.

import Select from '@/components/shared/Select'
import { useEffect, useMemo, useState } from 'react'
import { rndApi } from '@/lib/api'
import { RndPerson } from '@/types'
import { formatDate } from '@/lib/format'
import { extractErrorMessages } from '@/lib/validation'
import { useFormDraft } from '@/lib/formDraft'
import { PRIORITY_OPTIONS, type Priority } from '@/lib/priority'
import DraftBanner from '@/components/shared/DraftBanner'
import SearchableSelect from '@/components/erp/SearchableSelect'
import DateField from '@/components/erp/DateField'
import { segmentBtnStyle } from '@/components/shared/ui'
import { FormSheet, SheetSection, SheetIcon, FileDropZone, Optional, Req, SHEET, sheetBtn, sheetInput, sheetLabel, sheetHint, SheetError } from '@/components/shared/FormSheet'
import { ChecklistEditor, type DraftStep } from '@/components/rnd/TasksBoard'
import type { RndReqSource, RndRequirementRow, RndTaskType } from '@/types/rndIntake'
import { useVisibility } from '@/lib/visibility'
import { VisColumns } from '@/components/quality/VisColumns'
import { VisOptionValues, VisSection } from '@/lib/visibilityComponents'

const todayIso = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

type ReqPick = { source: RndReqSource; record_id: number }
type ProjOption = { id: number; project_number: string; title: string }
type PmProjOption = { id: number; project_code: string; name: string; label: string }

export default function TaskCreateSheet({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [type, setType] = useState<RndTaskType | ''>('requirement')
  const [requirements, setRequirements] = useState<RndRequirementRow[] | null>(null)
  const [projects, setProjects] = useState<ProjOption[] | null>(null)
  const [pmProjects, setPmProjects] = useState<PmProjOption[] | null>(null)
  const [reqKey, setReqKey] = useState('')
  const [projectId, setProjectId] = useState('')
  const [pmProjectId, setPmProjectId] = useState('')
  const [people, setPeople] = useState<RndPerson[]>([])
  const [peopleHint, setPeopleHint] = useState('')
  const [title, setTitle] = useState('')
  const [remarks, setRemarks] = useState('')
  const [assignee, setAssignee] = useState('')
  const [start, setStart] = useState('')
  const [due, setDue] = useState('')
  const [priority, setPriority] = useState<Priority>('standard')
  const [steps, setSteps] = useState<DraftStep[]>([])
  const [files, setFiles] = useState<File[]>([])
  const [error, setError] = useState<string | string[]>('')
  const [saving, setSaving] = useState(false)
  // What the user's roles let them see here (Role editor > R&D > R&D Tasks > Visibility). In the Role
  // editor's "Preview & choose" the form is drawn in place, nothing is saved or kept as a draft.
  const vis = useVisibility('rnd:tasks')
  const priorityChoices = vis.options('priority', PRIORITY_OPTIONS, (o) => o.value)
  const priorityKey = priorityChoices.map((o) => o.value).join(',')
  useEffect(() => {
    const allowed = priorityKey.split(',').filter(Boolean) as Priority[]
    if (allowed.length && !allowed.includes(priority)) setPriority(allowed[0])
  }, [priorityKey, priority])

  const draft = useFormDraft(vis.preview ? null : 'rnd-task-create', { type, reqKey, projectId, pmProjectId, title, remarks, assignee, start, due, priority, steps, files },
    (d) => {
      setType(d.type || 'requirement'); setReqKey(d.reqKey || ''); setProjectId(d.projectId || ''); setPmProjectId(d.pmProjectId || ''); setTitle(d.title || ''); setRemarks(d.remarks || '')
      setAssignee(d.assignee || ''); setStart(d.start || ''); setDue(d.due || ''); setPriority(d.priority === 'urgent' ? 'urgent' : 'standard'); setSteps(Array.isArray(d.steps) ? d.steps : [])
    })

  // Load the picker for the chosen type once.
  useEffect(() => {
    if (type === 'requirement' && requirements === null) {
      rndApi.listRequirements({ status: 'accepted' })
        .then((rows) => setRequirements(rows.filter((r) => r.status === 'accepted')))
        .catch((err) => { setRequirements([]); setError(extractErrorMessages(err, 'Could not load the accepted requirements. Refresh the page; if it keeps failing, check you can open R&D › Requirements.')) })
    }
    if (type === 'prototype' && projects === null) {
      rndApi.listProjects({ status: 'active' })
        .then((rows: ProjOption[]) => setProjects((Array.isArray(rows) ? rows : []).sort((a, b) => a.project_number.localeCompare(b.project_number, undefined, { numeric: true }))))
        .catch((err) => { setProjects([]); setError(extractErrorMessages(err, 'Could not load the Prototype / Research projects. Refresh the page; if it keeps failing, check you can open R&D › Prototype / Research.')) })
    }
    if (type === 'project' && pmProjects === null) {
      rndApi.pmProjectOptions()
        .then((rows) => setPmProjects((Array.isArray(rows) ? rows : []).slice().sort((a, b) => a.project_code.localeCompare(b.project_code, undefined, { numeric: true }))))
        .catch((err) => { setPmProjects([]); setError(extractErrorMessages(err, 'Could not load the All Projects list. Refresh the page; if it keeps failing, check you can open Project Management › All Projects.')) })
    }
  }, [type, requirements, projects, pmProjects])

  const reqOptions = useMemo(() => (requirements || [])
    .slice().sort((a, b) => (a.rd_number || '').localeCompare(b.rd_number || '', undefined, { numeric: true }))
    .map((r) => ({ value: `${r.source}:${r.record_id}`, label: `${r.rd_number || r.universal_id} — ${[r.org_name, r.product].filter(Boolean).join(' · ') || r.universal_id}` })), [requirements])
  const projOptions = useMemo(() => (projects || []).map((p) => ({ value: String(p.id), label: `${p.project_number} — ${p.title}` })), [projects])
  const pmOptions = useMemo(() => (pmProjects || []).map((p) => ({ value: String(p.id), label: p.label || `${p.project_code} — ${p.name}` })), [pmProjects])

  const picked: ReqPick | null = useMemo(() => {
    if (type !== 'requirement' || !reqKey) return null
    const [source, rid] = reqKey.split(':')
    return { source: source as RndReqSource, record_id: Number(rid) }
  }, [type, reqKey])

  // Who can be assigned follows the chosen record (R&D people / the project team).
  useEffect(() => {
    let alive = true
    const done = (list: RndPerson[], hint = '') => { if (alive) { setPeople(list); setPeopleHint(hint) } }
    if (picked) {
      rndApi.requirementAssignees(picked.source, picked.record_id).then((l) => done(l)).catch((err) => done([], [extractErrorMessages(err, 'Could not load who can be assigned.')].flat().join(' ')))
    } else if (type === 'prototype' && projectId) {
      rndApi.projectTaskAccess(Number(projectId))
        .then((a) => done(a.people, a.can_manage ? '' : 'Only the project lead can give tasks on this project — pick another project or ask the lead.'))
        .catch((err) => done([], [extractErrorMessages(err, 'Could not load the project team.')].flat().join(' ')))
    } else if (type === 'project' && pmProjectId) {
      rndApi.pmProjectTaskAccess(Number(pmProjectId))
        .then((a) => done(a.people, a.can_manage ? '' : 'Only R&D heads or the project manager can give R&D tasks on this project — pick another project or ask them.'))
        .catch((err) => done([], [extractErrorMessages(err, 'Could not load who can be assigned on this project.')].flat().join(' ')))
    } else done([])
    return () => { alive = false }
  }, [picked, type, projectId, pmProjectId])

  const chooseType = (t: RndTaskType) => {
    if (t === type) return
    setType(t); setReqKey(''); setProjectId(''); setPmProjectId(''); setAssignee(''); setPeople([]); setPeopleHint(''); setError('')
  }

  const submit = async () => {
    if (vis.preview) return
    if (!type) { setError('Pick the task type first — Requirement, Prototype or Project.'); return }
    if (type === 'requirement' && !picked) { setError('Pick the requirement this task is for (only accepted requirements are listed).'); return }
    if (type === 'prototype' && !projectId) { setError('Pick the Prototype / Research project this task is for.'); return }
    if (type === 'project' && !pmProjectId) { setError('Pick the project this task is for.'); return }
    if (!title.trim()) { setError('Give the task a title — what should be done.'); return }
    if (!assignee) { setError('Pick who should do this task.'); return }
    if (!due) { setError('Set the Due Date.'); return }
    if (due < todayIso()) { setError('Due Date is in the past — pick today or a later date.'); return }
    if (start && start > due) { setError(`Start date ${formatDate(start)} is after the Due Date ${formatDate(due)} — the task must start on or before it is due.`); return }
    const checklist = steps.map((s) => ({ text: s.text.trim() })).filter((s) => s.text)
    setSaving(true)
    setError('')
    try {
      await rndApi.createRndTask({
        type, ...(picked ? { source: picked.source, record_id: picked.record_id } : {}), ...(type === 'prototype' ? { rnd_project_id: Number(projectId) } : {}), ...(type === 'project' ? { pm_project_id: Number(pmProjectId) } : {}),
        title: title.trim(), remarks: remarks.trim() || undefined, assigned_to_id: Number(assignee), start_date: start || undefined, due_date: due,
        priority, checklist, files,
      })
      draft.clear()
      onCreated()
    } catch (err) {
      setError(extractErrorMessages(err, 'The task was not created. Check the fields and try again.'))
    } finally {
      setSaving(false)
    }
  }

  const typeBtn = (t: RndTaskType, label: string) => (
    <button key={t} type="button" data-tour={`rnd-tasks-type-${t}`} onClick={() => chooseType(t)} aria-pressed={type === t}
      style={{ ...segmentBtnStyle(type === t), border: 'none', borderRadius: 0, background: type === t ? SHEET.BLUE : '#fff', color: type === t ? '#fff' : SHEET.BODY }}>
      {label}
    </button>
  )

  const subtitle = 'Give R&D work to a person — on a requirement R&D has accepted, on a prototype / research project, or on a project from Project Management.'
  const footer = (<>
    <button type="button" onClick={onClose} disabled={saving || vis.preview} style={sheetBtn('secondary', SHEET.INK, saving)}>Cancel</button>
    <button data-tour="rnd-tasks-create-submit" type="button" onClick={submit} disabled={saving || !type || vis.preview} style={sheetBtn('primary', SHEET.BLUE, saving || !type)}>
      <SheetIcon name="plus" size={16} />{saving ? 'Creating…' : 'Create Task'}
    </button>
  </>)
  const body = (
      <VisColumns vis={vis} rightKeys={['checklist', 'attachments']}
        left={<>
          <SheetError error={error} />
          <DraftBanner draft={draft} />
          <VisSection vis={vis} k="type">
          <SheetSection icon="tag" title="Type">
            <label style={sheetLabel}>Task type <Req /></label>
            <div style={{ display: 'inline-flex', border: `1px solid ${SHEET.LINE}`, borderRadius: 10, overflow: 'hidden' }}>
              {typeBtn('requirement', 'Requirement')}
              {typeBtn('prototype', 'Prototype')}
              {typeBtn('project', 'Project')}
            </div>
            {type === 'requirement' && (
              <div style={{ marginTop: 14 }} data-tour="rnd-tasks-requirement">
                <label style={sheetLabel}>Requirement <Req /></label>
                <SearchableSelect value={reqKey} onChange={(v) => { setReqKey(v); setAssignee('') }} options={reqOptions}
                  placeholder={requirements === null ? 'Loading requirements…' : reqOptions.length ? 'Pick a requirement by R&D ID…' : 'No accepted requirement you can open'} />
                <p style={sheetHint}>Only requirements whose latest revision R&amp;D has accepted are listed, by R&amp;D ID.</p>
              </div>
            )}
            {type === 'prototype' && (
              <div style={{ marginTop: 14 }} data-tour="rnd-tasks-project">
                <label style={sheetLabel}>Prototype / Research project <Req /></label>
                <SearchableSelect value={projectId} onChange={(v) => { setProjectId(v); setAssignee('') }} options={projOptions}
                  placeholder={projects === null ? 'Loading projects…' : projOptions.length ? 'Pick a project by RND number…' : 'No active project you can open'} />
              </div>
            )}
            {type === 'project' && (
              <div style={{ marginTop: 14 }} data-tour="rnd-tasks-pm-project">
                <label style={sheetLabel}>Project (All Projects) <Req /></label>
                <SearchableSelect value={pmProjectId} onChange={(v) => { setPmProjectId(v); setAssignee('') }} options={pmOptions}
                  placeholder={pmProjects === null ? 'Loading projects…' : pmOptions.length ? 'Pick a project by PEW code…' : 'No project you can give tasks on'} />
                <p style={sheetHint}>Projects from Project Management › All Projects, by PEW code. The task stays R&amp;D work — the assignee tracks it in R&amp;D › R&amp;D Tasks.</p>
              </div>
            )}
          </SheetSection>
          </VisSection>
          {type && (
            <>
              <VisSection vis={vis} k="basic">
              <SheetSection icon="list" title="Basic Information">
                <label style={sheetLabel}>Task Name <Req /></label>
                <input style={sheetInput} value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Feasibility + GA drawing for 600 mm platform" autoFocus />
                <label style={{ ...sheetLabel, marginTop: 14 }}>Details <Optional /></label>
                <textarea style={{ ...sheetInput, minHeight: 72, resize: 'vertical' }} value={remarks} onChange={(e) => setRemarks(e.target.value)} placeholder="What exactly you need back, references, constraints…" />
              </SheetSection>
              </VisSection>
              <VisSection vis={vis} k="assignment">
              <SheetSection icon="user" title="Assignment">
                <label style={sheetLabel}>Assignee <Req /></label>
                <SearchableSelect value={assignee} onChange={setAssignee}
                  placeholder={(type === 'requirement' ? !picked : type === 'project' ? !pmProjectId : !projectId) ? 'Pick the requirement / project first…' : 'Select person…'}
                  options={people.map((p) => ({ value: String(p.id), label: `${p.name}${p.designation ? ` — ${p.designation}` : ''}` }))} />
                {peopleHint && <p style={{ ...sheetHint, color: '#b45309' }}>{peopleHint}</p>}
              </SheetSection>
              </VisSection>
              <VisSection vis={vis} k="schedule_priority">
              <SheetSection icon="calendar" title="Schedule & Priority">
                <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                  <div style={{ flex: '1 1 150px' }}><label style={sheetLabel}>Start Date</label><DateField value={start} onChange={setStart} /></div>
                  <div style={{ flex: '1 1 150px' }}><label style={sheetLabel}>Due Date <Req /></label><DateField value={due} onChange={setDue} /></div>
                  <div style={{ flex: '1 1 130px' }}>
                    <label style={sheetLabel}>Priority</label>
                    <Select data-tour="rnd-tasks-priority" style={sheetInput} value={priority} onChange={(e) => setPriority(e.target.value as Priority)}>
                      {priorityChoices.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </Select>
                    <VisOptionValues vis={vis} dropdown="priority" />
                  </div>
                </div>
              </SheetSection>
              </VisSection>
            </>
          )}
        </>}
        right={type ? <>
          <VisSection vis={vis} k="checklist">
          <SheetSection icon="list" title="Checklist" extra={<Optional />}>
            <ChecklistEditor steps={steps} onChange={setSteps} />
            <p style={{ fontSize: 11.5, color: SHEET.MUTED, margin: '6px 0 0' }}>Steps the assignee ticks off — progress then follows the ticked steps, and all must be ticked to complete the task.</p>
          </SheetSection>
          </VisSection>
          <VisSection vis={vis} k="attachments">
          <SheetSection icon="clip" title="Attachments" extra={<Optional />}>
            <FileDropZone files={files} onChange={setFiles} />
          </SheetSection>
          </VisSection>
        </> : <></>}
      />
  )

  // Role editor preview: the same form drawn in place (a popup would open over the preview).
  if (vis.preview) {
    return (
      <div style={{ background: '#fff', borderRadius: 18, border: `1px solid ${SHEET.LINE}` }}>
        <div style={{ padding: '18px 24px', borderBottom: `1px solid ${SHEET.LINE}` }}>
          <div style={{ fontSize: 18, fontWeight: 700, color: SHEET.INK }}>Create Task</div>
          <div style={{ fontSize: 13, color: SHEET.MUTED, marginTop: 4 }}>{subtitle}</div>
        </div>
        {body}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, padding: '16px 24px', borderTop: `1px solid ${SHEET.LINE}` }}>{footer}</div>
      </div>
    )
  }
  return (
    <FormSheet tour="rnd-tasks-create-form" icon="check" title="Create Task" subtitle={subtitle} onClose={onClose} busy={saving} footer={footer}>
      {body}
    </FormSheet>
  )
}
