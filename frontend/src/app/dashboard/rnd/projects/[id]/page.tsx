'use client'

import Select from '@/components/shared/Select'
import { useEffect, useMemo, useState } from 'react'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { rndApi, usersApi } from '@/lib/api'
import { DirectoryUser, RndDocument, RndProjectDetail } from '@/types'
import { PRIORITY_OPTIONS, normalizePriority, priorityLabel, type Priority } from '@/lib/priority'
import { TEXT } from '@/lib/theme'
import DateField from '@/components/erp/DateField'
import { secondaryBtnStyle, smallSecondaryBtnStyle, dangerBtnStyle } from '@/components/shared/ui'
import { formatDate } from '@/lib/format'
import RndNav from '@/components/rnd/RndNav'
import InvalidRecordLink from '@/components/erp/InvalidRecordLink'
import { recordPath, useRecordId } from '@/lib/recordRef'
import TeamMemberPicker from '@/components/rnd/TeamMemberPicker'
import RndDocumentsPanel from '@/components/rnd/RndDocumentsPanel'
import TasksBoard, { TaskApi, TaskLabels } from '@/components/rnd/TasksBoard'
import RndProjectHistory from '@/components/rnd/RndProjectHistory'
import RndProjectMembers from '@/components/rnd/RndProjectMembers'
import ConfirmDialog from '@/components/erp/ConfirmDialog'
import { extractErrorMessages } from '@/lib/validation'
import { useCan } from '@/lib/permissions'
import { useEscapeKey } from '@/hooks/useEscapeKey'
import { useAssigneeFilter } from '@/hooks/useAssigneeFilter'
import RndBudgetFields, { EMPTY_RND_BUDGET, RndBudgetDraft, rndBudgetError, rndBudgetFromProject, rndBudgetPayload } from '@/components/rnd/RndBudgetFields'
import { ProjectBudgetCard } from '@/components/finance/ProjectBudget'
import ProjectOriginFields, { EMPTY_ORIGIN, KIND_LABELS, ORIGIN_LABELS, OriginDraft, normalizeOrigin, originError, originFromProject, originPayload } from '@/components/rnd/ProjectOriginFields'
import { FormPage, SheetColumns, SheetSection, SheetIcon, FileDropZone, Req, Optional, SHEET, sheetBtn, sheetInput, sheetLabel, sheetHint } from '@/components/shared/FormSheet'

const inputStyle = sheetInput
const labelStyle = sheetLabel
const TASK_LABELS: TaskLabels = {
  manager: 'project lead',
  dueDate: 'Due Date',
  assignPlaceholder: 'Select team member…',
  emptyManager: 'No tasks yet — use “Add Task” to hand work to a team member. Only people under Team Members can be assigned.',
  emptyOther: 'You have no tasks on this project.',
}

// Overview · Members · Tasks · Documents · Timeline (Timeline was History). No milestones.
const TABS = ['Overview', 'Members', 'Tasks', 'Documents', 'Timeline'] as const
type Tab = typeof TABS[number]
function tabBtnStyle(active: boolean): React.CSSProperties {
  return {
    padding: '10px 16px', marginBottom: -1, borderTop: '0', borderLeft: '0', borderRight: '0', borderRadius: 0, background: 'none', boxShadow: 'none',
    cursor: 'pointer', fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap', fontFamily: 'inherit',
    color: active ? '#6366f1' : '#78716c', borderBottom: active ? '2px solid #6366f1' : '2px solid transparent',
  }
}

function ErrorBanner({ error }: { error: string | string[] }) {
  if (!error || (Array.isArray(error) && error.length === 0)) return null
  return (
    <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
      {Array.isArray(error) ? error.join(' ') : error}
    </div>
  )
}

// Shows exactly what the New Project form captures — title, priority, dates,
// objective, scope, leads, team, remarks and attachments. Read-only by
// default; Edit (header) switches the details to the form, same pattern as
// the HR lifecycle / P2P vendor detail pages. Stage / status / budget /
// feasibility / handover are not shown.
// One line of the Overview list: fixed-width label on the left, value on the
// right (wraps under itself), "—" when empty. Stacks on a phone.
function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  const empty = children === null || children === undefined || children === ''
  return (
    <div className="rnd-detail-row" style={{ display: 'flex', gap: 16, padding: '9px 0', alignItems: 'baseline', flexWrap: 'wrap' }}>
      <div style={{ flex: '0 0 190px', fontSize: 13, color: SHEET.MUTED }}>{label}</div>
      <div style={{ flex: '1 1 260px', minWidth: 0, fontSize: 13.5, lineHeight: '20px', color: empty ? SHEET.MUTED : SHEET.INK, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{empty ? '—' : children}</div>
    </div>
  )
}

// Overview › Attachments: the files on the project (what the New Project form's
// Attachments uploaded, plus later ones). Open a file here; add / remove in Documents.
function OverviewAttachments({ projectId }: { projectId: number }) {
  const [docs, setDocs] = useState<RndDocument[] | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    let cancelled = false
    rndApi.listDocuments({ project_id: projectId })
      .then((d) => { if (!cancelled) setDocs(Array.isArray(d) ? d : []) })
      .catch((err) => { if (!cancelled) { setDocs([]); setError([extractErrorMessages(err, 'Could not load the attachments.')].flat().join(' ')) } })
    return () => { cancelled = true }
  }, [projectId])
  const open = async (d: RndDocument) => {
    try {
      const blob = await rndApi.getDocumentContent(d.id)
      window.open(URL.createObjectURL(blob), '_blank')
    } catch (err) {
      setError([extractErrorMessages(err, `Unable to open "${d.file_name}".`)].flat().join(' '))
    }
  }
  return (
    <>
      {error && <p style={{ fontSize: 12.5, color: '#b91c1c', margin: '0 0 8px' }}>{error}</p>}
      {docs === null ? (
        <p style={{ fontSize: 13, color: SHEET.MUTED, margin: 0 }}>Loading…</p>
      ) : docs.length === 0 ? (
        <p style={{ fontSize: 13, color: SHEET.MUTED, margin: 0 }}>No attachments.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {docs.map((d) => (
            <button key={d.id} type="button" onClick={() => open(d)} title="Open file"
              style={{ padding: 0, border: 'none', background: 'none', color: '#2563EB', fontSize: 13.5, fontWeight: 500, cursor: 'pointer', textAlign: 'left' }}>
              {d.title && d.title !== d.file_name ? `${d.title} — ${d.file_name}` : d.file_name}
            </button>
          ))}
        </div>
      )}
    </>
  )
}

export default function RndProjectDetailPage() {
  const { isAuthorized, isLoading, user } = useRequireApp('rnd')
  const { can, canDelete, canFeature } = useCan()
  const router = useRouter()
  const params = useParams()
  const { id: resolvedId, error: linkError } = useRecordId(params.id as string)
  const projectId = resolvedId ?? 0

  const [project, setProject] = useState<RndProjectDetail | null>(null)
  const [users, setUsers] = useState<DirectoryUser[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | string[]>('')

  const [title, setTitle] = useState('')
  const [priority, setPriority] = useState<Priority>('standard')
  const [objective, setObjective] = useState('')
  const [scope, setScope] = useState('')
  const [leadIds, setLeadIds] = useState<number[]>([])
  const [teamIds, setTeamIds] = useState<number[]>([])
  // The role's assign-to rule for lead / team; yourself, people already on the
  // project and anyone already picked stay listed (the server only checks people being added).
  const allowTeam = useAssigneeFilter('rnd:projects.team')
  const pickable = users.filter((u) => allowTeam(u.id) || u.id === user?.id || leadIds.includes(u.id) || teamIds.includes(u.id)
    || !!project?.lead_ids?.includes(u.id) || !!project?.team_member_ids?.includes(u.id))
  const [startDate, setStartDate] = useState('')
  const [targetEndDate, setTargetEndDate] = useState('')
  const [remarks, setRemarks] = useState('')
  const [origin, setOrigin] = useState<OriginDraft>(EMPTY_ORIGIN)
  const [budget, setBudget] = useState<RndBudgetDraft>(EMPTY_RND_BUDGET)
  const [files, setFiles] = useState<File[]>([])
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  const [deleting, setDeleting] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  // Project lead / admin — hands out tasks and is the only one who may delete files.
  const [isManager, setIsManager] = useState(false)
  // ?tab=tasks (R&D Tasks rows; also the old ?tab=milestones and #tasks links) opens the Tasks tab; ?tab=timeline / history the Timeline.
  const search = useSearchParams()
  const [chosenTab, setTab] = useState<Tab>(() => {
    const asked = (search.get('tab') || '').toLowerCase()
    const alias: Record<string, Tab> = { milestones: 'Tasks', history: 'Timeline' }
    const hit = alias[asked] || TABS.find((t) => t.toLowerCase() === asked)
    if (hit) return hit
    return typeof window !== 'undefined' && window.location.hash === '#tasks' ? 'Tasks' : 'Overview'
  })
  useEscapeKey(editing && !saving, () => { setError(''); setEditing(false) })

  const taskApi = useMemo<TaskApi>(() => ({
    list: () => rndApi.listProjectTasks(projectId),
    people: async () => (await rndApi.projectTaskAccess(projectId)).people,
    team: async () => (await rndApi.projectTaskAccess(projectId)).team,
    create: (p, parentId) => rndApi.createProjectTask(projectId, p, parentId),
    edit: rndApi.editProjectTask,
    progress: rndApi.projectTaskProgress,
    extend: rndApi.extendProjectTask,
    complete: rndApi.completeProjectTask,
    update: rndApi.addProjectTaskUpdate,
    requestApproval: rndApi.requestProjectApproval,
    decideApproval: rndApi.decideProjectApproval,
    withdrawApproval: rndApi.withdrawProjectApproval,
    reopen: rndApi.reopenProjectTask,
    cancel: rndApi.cancelProjectTask,
    openDoc: async (d) => { window.open(URL.createObjectURL(await rndApi.getDocumentContent(d.id)), '_blank') },
  }), [projectId])

  const applyProject = (p: RndProjectDetail) => {
    setProject(p)
    setTitle(p.title)
    setPriority(normalizePriority(p.priority))
    setObjective(p.objective)
    setScope(p.scope || '')
    setLeadIds(p.lead_ids?.length ? p.lead_ids : p.lead_id ? [p.lead_id] : [])
    setTeamIds(p.team_member_ids || [])
    setStartDate(p.start_date || '')
    setTargetEndDate(p.target_end_date || '')
    setRemarks(p.remarks || '')
    setOrigin(originFromProject(p))
    setBudget(rndBudgetFromProject(p))
  }

  useEffect(() => {
    if (!isAuthorized || !projectId) return
    ;(async () => {
      try {
        const [p, dir, access] = await Promise.all([rndApi.getProject(projectId), usersApi.directory(), rndApi.projectTaskAccess(projectId)])
        applyProject(p)
        setUsers(Array.isArray(dir) ? dir : [])
        setIsManager(access.can_manage)
      } catch (err) {
        setError(extractErrorMessages(err, 'Failed to load R&D project.'))
      } finally {
        setLoading(false)
      }
    })()
  }, [isAuthorized, projectId])

  if (isLoading || !isAuthorized) return null
  if (linkError) return (<div style={{ width: '100%' }}><RndNav /><InvalidRecordLink message={linkError} listHref="/dashboard/rnd/projects" listLabel="Back to projects" /></div>)
  if (loading) return null
  if (!project) {
    return (
      <div style={{ width: '100%' }}>
        <RndNav />
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
          <div>
            <h1 style={{ fontSize: 24, fontWeight: 700, color: TEXT.heading, margin: '0 0 20px' }}>R&amp;D Project</h1>
          </div>
          <button onClick={() => router.push('/dashboard/rnd/projects')} type="button" style={secondaryBtnStyle}>← Back</button>
        </div>
        <ErrorBanner error={error || 'R&D project not found — it may have been deleted. Go back to the project list.'} />
      </div>
    )
  }

  const canEdit = can('rnd', 'projects', 'edit')
  const visibleTabs = TABS.filter((t) => t !== 'Tasks' || canFeature('rnd', 'projects', 'tasks', 'view'))
  const tab: Tab = visibleTabs.includes(chosenTab) ? chosenTab : 'Overview'
  const canDeleteProject = canDelete('rnd', 'projects', project.created_by_id ?? null)

  const startEdit = () => { setError(''); setSaved(false); applyProject(project); setEditing(true) }
  const discardEdit = () => { setError(''); setFiles([]); applyProject(project); setEditing(false) }

  const handleSave = async () => {
    setError('')
    setSaved(false)
    if (!title.trim()) { setError('Project title is required.'); return }
    if (!objective.trim()) { setError('Objective is required — describe what this project should achieve.'); return }
    if (startDate && targetEndDate && targetEndDate < startDate) { setError("Target end date can't be before the start date."); return }
    // Origin goes to the server only when changed (it re-checks the linked record and your access to it).
    const originChanged = JSON.stringify(originPayload(origin)) !== JSON.stringify(originPayload(originFromProject(project)))
    if (originChanged) {
      const originMsg = originError(origin, null)
      if (originMsg) { setError(originMsg); return }
    }
    const budgetMsg = rndBudgetError(budget)
    if (budgetMsg) { setError(budgetMsg); return }

    setSaving(true)
    try {
      await rndApi.updateProject(projectId, {
        ...(originChanged ? originPayload(origin) : {}),
        title: title.trim(),
        priority,
        objective: objective.trim(),
        scope: scope.trim() || null,
        lead_ids: leadIds,
        team_member_ids: teamIds,
        start_date: startDate || null,
        target_end_date: targetEndDate || null,
        remarks: remarks.trim() || null,
        ...rndBudgetPayload(budget, rndBudgetFromProject(project)),
      })
      // New attachments go to the project's Documents; a failed file never undoes the save.
      const failed: string[] = []
      for (const f of files) {
        const fd = new FormData()
        fd.append('project_id', String(projectId))
        fd.append('doc_type', 'other')
        fd.append('title', f.name)
        fd.append('files', f)
        try {
          await rndApi.uploadDocuments(fd)
        } catch (err) {
          failed.push(`${f.name}: ${[extractErrorMessages(err, 'upload failed')].flat().join(' ')}`)
        }
      }
      setFiles([])
      applyProject(await rndApi.getProject(projectId))
      setIsManager((await rndApi.projectTaskAccess(projectId)).can_manage)
      setEditing(false)
      if (failed.length) {
        setError([
          `Changes were saved, but ${failed.length} attachment(s) didn't upload —`,
          ...failed,
          '— upload them again from the Documents section below.',
        ])
      } else {
        setSaved(true)
      }
    } catch (err) {
      setError(extractErrorMessages(err, 'Failed to save R&D project.'))
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    setConfirmOpen(false)
    setError('')
    setDeleting(true)
    try {
      await rndApi.deleteProject(projectId)
      router.push('/dashboard/rnd/projects')
    } catch (err) {
      setError(extractErrorMessages(err, 'Failed to delete R&D project.'))
      setDeleting(false)
    }
  }

  // Edit opens the same full-page form as New Project — same sections, same order.
  if (editing) {
    return (
      <div style={{ width: '100%' }}>
        <FormPage
          tour="rnd-pd-edit-form"
          nav={<RndNav />}
          icon="edit"
          title="Edit R&D Project"
          subtitle={`${project.project_number} — changes are saved to the project record.`}
          onBack={discardEdit}
          footer={<>
            <button data-tour="rnd-pd-discard-btn" type="button" onClick={discardEdit} disabled={saving} style={sheetBtn('secondary', SHEET.INK, saving)}>Discard</button>
            <button data-tour="rnd-pd-save-btn" type="button" onClick={handleSave} disabled={saving} style={sheetBtn('primary', SHEET.BLUE, saving)}>
              <SheetIcon name="check" size={16} />{saving ? (files.length ? 'Saving & uploading…' : 'Saving…') : 'Save changes'}
            </button>
          </>}
        >
          {error && (
            <div style={{ padding: '16px 24px 0' }}>
              <div style={{ padding: '10px 14px', borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
                {Array.isArray(error) ? error.join(' ') : error}
              </div>
            </div>
          )}

          <SheetColumns
            left={<>
              <SheetSection icon="flag" title="Project Origin" extra={<span style={{ fontSize: 12, color: SHEET.MUTED }}>Why does this project exist? <Req /></span>}>
                <ProjectOriginFields value={origin} onChange={setOrigin} />
              </SheetSection>
              <SheetSection icon="list" title="Project Initiation">
                <label style={labelStyle}>Project Title <Req /></label>
                <input style={inputStyle} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Lightweight bogie frame for track machines" autoFocus />
                <label style={{ ...labelStyle, marginTop: 14 }}>Objective <Req /></label>
                <textarea style={{ ...inputStyle, minHeight: 80, resize: 'vertical' }} value={objective} onChange={(e) => setObjective(e.target.value)} placeholder="What should this project achieve, and why?" />
                <label style={{ ...labelStyle, marginTop: 14 }}>Scope</label>
                <textarea style={{ ...inputStyle, minHeight: 70, resize: 'vertical' }} value={scope} onChange={(e) => setScope(e.target.value)} placeholder="In scope / out of scope, key deliverables" />
              </SheetSection>
              <SheetSection icon="calendar" title="Priority & Schedule">
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
                  <div style={{ flex: '1 1 240px', minWidth: 220, maxWidth: 300 }}>
                    <label style={labelStyle}>Priority</label>
                    <Select style={inputStyle} value={priority} onChange={(e) => setPriority(e.target.value as Priority)}>
                      {PRIORITY_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </Select>
                  </div>
                  <div style={{ flex: '0 1 160px', minWidth: 150 }}>
                    <label style={labelStyle}>Start Date</label>
                    <DateField value={startDate} onChange={setStartDate} />
                  </div>
                  <div style={{ flex: '0 1 160px', minWidth: 150 }}>
                    <label style={labelStyle}>Target End Date</label>
                    <DateField value={targetEndDate} onChange={setTargetEndDate} placeholder="Not decided" />
                  </div>
                </div>
              </SheetSection>
              <RndBudgetFields value={budget} onChange={setBudget} projectId={project.id} />
            </>}
            right={<>
              <SheetSection icon="users" title="Project Members">
                <label style={labelStyle}>Project Leads</label>
                <TeamMemberPicker users={pickable} value={leadIds} onChange={setLeadIds} excludeIds={teamIds} placeholder="Search name or email to add a project lead…" />
                <label style={{ ...labelStyle, marginTop: 14 }}>Team Members</label>
                <TeamMemberPicker users={pickable} value={teamIds} onChange={setTeamIds} excludeIds={leadIds} />
              </SheetSection>
              <SheetSection icon="chat" title="Remarks" extra={<Optional />}>
                <textarea style={{ ...inputStyle, minHeight: 60, resize: 'vertical' }} value={remarks} onChange={(e) => setRemarks(e.target.value)} />
              </SheetSection>
              <SheetSection icon="clip" title="Attachments" extra={<Optional />}>
                <FileDropZone
                  files={files}
                  onChange={(next) => setFiles(next.filter((f, i) => next.findIndex((p) => p.name === f.name && p.size === f.size) === i))}
                />
                <p style={sheetHint}>Add more specs, drawings, photos or proof — saved to the project&apos;s Documents along with the files already there.</p>
              </SheetSection>
            </>}
          />
        </FormPage>
      </div>
    )
  }

  return (
    <div style={{ width: '100%' }}>
      <RndNav />

      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
        <div data-tour="rnd-pd-badges">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', margin: '0 0 20px' }}>
            <h1 style={{ fontSize: 24, fontWeight: 700, color: TEXT.heading, margin: 0 }}>{project.project_number}</h1>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          {!editing && canEdit && (
            <button data-tour="rnd-pd-edit-btn" type="button" onClick={startEdit} style={secondaryBtnStyle}>Edit</button>
          )}
          {!editing && canDeleteProject && (
            <button data-tour="rnd-pd-delete-btn" type="button" onClick={() => setConfirmOpen(true)} disabled={deleting} style={{ ...dangerBtnStyle, opacity: deleting ? 0.6 : 1 }}>
              {deleting ? 'Deleting…' : 'Delete'}
            </button>
          )}
          <button data-tour="rnd-pd-back-btn" onClick={() => router.push('/dashboard/rnd/projects')} type="button" style={secondaryBtnStyle}>← Back</button>
        </div>
      </div>

      {!editing && <ErrorBanner error={error} />}
      {saved && !editing && (
        <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(22,163,74,0.08)', border: '1px solid rgba(22,163,74,0.2)', color: '#15803d', fontSize: 13 }}>
          Changes saved.
        </div>
      )}

      <div data-tour="rnd-pd-tabs" style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 16, borderBottom: '1px solid rgba(0,0,0,0.08)' }}>
        {visibleTabs.map((t) => (
          <button key={t} data-tour={`rnd-pd-tab-${t.toLowerCase()}`} type="button" role="tab" aria-selected={tab === t} onClick={() => setTab(t)} style={tabBtnStyle(tab === t)}>{t}</button>
        ))}
      </div>

      {tab === 'Overview' && (() => {
        const leads = (project.leads?.map((m) => m.name) || (project.lead_name ? [project.lead_name] : [])).join(', ')
        const team = (project.team_members?.map((m) => m.name) || []).join(', ')
        const schedule = `${project.start_date ? formatDate(project.start_date) : '—'} → ${project.target_end_date ? formatDate(project.target_end_date) : 'Not decided'}`
        return (
          // Summary on top (what the project is), then every detail as one label–value list.
          <div data-tour="rnd-pd-overview" style={{ borderRadius: 18, background: '#fff', border: `1px solid ${SHEET.LINE}`, boxShadow: '0 4px 16px rgba(15,23,42,0.06)', padding: '22px 26px', marginBottom: 20 }}>
            <div data-tour="rnd-pd-details" style={{ paddingBottom: 18, borderBottom: `1px solid ${SHEET.LINE}` }}>
              <h2 style={{ fontSize: 20, fontWeight: 700, color: SHEET.INK, margin: '0 0 6px' }}>{project.title}</h2>
              <p style={{ fontSize: 14, lineHeight: '21px', color: SHEET.BODY, margin: '0 0 12px', whiteSpace: 'pre-wrap' }}>{project.objective || '—'}</p>
              <p style={{ fontSize: 13, color: SHEET.MUTED, margin: 0 }}>
                <strong style={{ color: SHEET.INK }}>{priorityLabel(project.priority)}</strong>
                {' · '}{schedule}
                {' · '}Lead: <strong style={{ color: SHEET.INK }}>{leads || '—'}</strong>
              </p>
            </div>

            <div data-tour="rnd-pd-source" style={{ padding: '6px 0', borderBottom: `1px solid ${SHEET.LINE}` }}>
              {project.origin ? (
                <>
                  <DetailRow label="Why it exists">{ORIGIN_LABELS[normalizeOrigin(project.origin)] || project.origin_label || project.origin}</DetailRow>
                  {project.source_kind && (
                    <DetailRow label={KIND_LABELS[project.source_kind]}>
                      {project.source_path && project.source_exists ? (
                        <button type="button" onClick={() => router.push(recordPath(project.source_path as string, project, 'source_id'))}
                          style={{ padding: 0, border: 'none', background: 'none', color: '#2563EB', fontWeight: 600, fontSize: 13.5, cursor: 'pointer', textAlign: 'left' }}>
                          {project.source_ref || `#${project.source_id}`}
                        </button>
                      ) : (
                        <>{project.source_ref || `#${project.source_id}`} <span style={{ fontSize: 12, color: SHEET.MUTED }}>(record no longer exists)</span></>
                      )}
                    </DetailRow>
                  )}
                  {project.machine_label && <DetailRow label="Existing project being improved">{project.machine_label}</DetailRow>}
                  {project.product_name && <DetailRow label="Product">{project.product_name}</DetailRow>}
                  {project.improvement_reason_label && <DetailRow label="Reason">{project.improvement_reason_label}</DetailRow>}
                  {project.origin_note && <DetailRow label="Who proposed it and why">{project.origin_note}</DetailRow>}
                </>
              ) : (
                <DetailRow label="Why it exists">
                  <span style={{ color: SHEET.MUTED }}>Not recorded{canEdit && isManager ? '' : ' — a project lead or admin can set it.'}</span>
                  {canEdit && isManager && !editing && (
                    <button data-tour="rnd-pd-set-origin-btn" type="button" onClick={startEdit} style={{ ...smallSecondaryBtnStyle, marginLeft: 10 }}>Set origin</button>
                  )}
                </DetailRow>
              )}
              <DetailRow label="Scope">{project.scope}</DetailRow>
            </div>

            <div data-tour="rnd-pd-members" style={{ padding: '6px 0', borderBottom: `1px solid ${SHEET.LINE}` }}>
              <DetailRow label="Team Members">{team || null}</DetailRow>
              <DetailRow label="Remarks">{project.remarks}</DetailRow>
            </div>

            <div data-tour="rnd-pd-attachments" style={{ padding: '6px 0' }}>
              <DetailRow label="Attachments">
                <OverviewAttachments projectId={project.id} />
                {visibleTabs.includes('Documents') && (
                  <button type="button" onClick={() => setTab('Documents')} style={{ ...smallSecondaryBtnStyle, marginTop: 8 }}>Manage in Documents</button>
                )}
              </DetailRow>
            </div>

            <p style={{ fontSize: 12, color: SHEET.MUTED, margin: '10px 0 0' }}>Created {formatDate(project.created_at)}</p>
          </div>
        )
      })()}
      {tab === 'Overview' && (
        <ProjectBudgetCard key={`${project.id}-${project.updated_at || ''}`} load={() => rndApi.projectBudget(project.id)} tour="rnd-pd-budget"
          emptyText={canEdit ? 'No budget yet — use Edit to pick a budget Finance created, or type an amount.' : 'No budget set for this project.'} />
      )}

      {tab === 'Members' && (
        <RndProjectMembers key={`${project.id}-${project.updated_at || ''}`} project={project} users={users} pickable={pickable} canEdit={canEdit} onSaved={applyProject} />
      )}

      {tab === 'Tasks' && user && (
        <div id="tasks" data-tour="rnd-pd-tasks" style={{ scrollMarginTop: 16 }}>
          <TasksBoard
            key={`${project.id}-${project.updated_at || ''}`}
            api={taskApi} userId={user.id} canManage={isManager} labels={TASK_LABELS} draftKey={`project-${project.id}`} reloadKey={project.id}
            canCreate={isManager && canFeature('rnd', 'projects', 'tasks', 'create')}
            rights={{ create: canFeature('rnd', 'projects', 'tasks', 'create'), edit: canFeature('rnd', 'projects', 'tasks', 'edit'), approve: canFeature('rnd', 'projects', 'tasks', 'approve'), cancel: canFeature('rnd', 'projects', 'tasks', 'cancel') }}
          />
        </div>
      )}

      {tab === 'Documents' && (
        <RndDocumentsPanel
          key={project.id}
          projectId={project.id}
          title="Attachments"
          currentUserId={user?.id}
          isAdmin={user?.role === 'admin'}
          canManageFiles={isManager}
        />
      )}

      {tab === 'Timeline' && <RndProjectHistory projectId={project.id} />}

      <ConfirmDialog
        open={confirmOpen}
        title="Delete this project?"
        message={`This deletes "${project.title}" (${project.project_number}). A project that still has attachments, experiments or prototypes can't be deleted — remove those first.`}
        confirmLabel="Delete"
        onConfirm={handleDelete}
        onCancel={() => setConfirmOpen(false)}
      />
    </div>
  )
}
