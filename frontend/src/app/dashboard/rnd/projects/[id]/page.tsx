'use client'

import { useEffect, useMemo, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { rndApi, usersApi } from '@/lib/api'
import { DirectoryUser, RndProjectDetail, RndProjectPriority } from '@/types'
import { TEXT, GLASS, SHADOWS } from '@/lib/theme'
import DateField from '@/components/erp/DateField'
import { secondaryBtnStyle, dangerBtnStyle, InfoRow } from '@/components/shared/ui'
import { formatDate } from '@/lib/format'
import RndNav from '@/components/rnd/RndNav'
import InvalidRecordLink from '@/components/erp/InvalidRecordLink'
import { recordPath, useRecordId } from '@/lib/recordRef'
import TeamMemberPicker from '@/components/rnd/TeamMemberPicker'
import RndDocumentsPanel from '@/components/rnd/RndDocumentsPanel'
import TasksBoard, { TaskApi, TaskLabels } from '@/components/rnd/TasksBoard'
import ConfirmDialog from '@/components/erp/ConfirmDialog'
import { extractErrorMessages } from '@/lib/validation'
import { useCan } from '@/lib/permissions'
import { useEscapeKey } from '@/hooks/useEscapeKey'
import { useAssigneeFilter } from '@/hooks/useAssigneeFilter'
import ProjectOriginFields, { EMPTY_ORIGIN, KIND_LABELS, ORIGIN_HEX, OriginDraft, originError, originFromProject, originPayload } from '@/components/rnd/ProjectOriginFields'
import { FormSheet, SheetColumns, SheetSection, SheetIcon, Req, Optional, SHEET, sheetBtn, sheetInput, sheetLabel } from '@/components/shared/FormSheet'

const inputStyle = sheetInput
const labelStyle = sheetLabel
const sectionStyle: React.CSSProperties = {
  borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur,
  border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), padding: 20, marginBottom: 20,
}

const PRIORITY_LABELS: Record<string, string> = {
  high: 'High — Important requirement',
  medium: 'Medium — Normal requirement',
  low: 'Low — Can be handled later',
  critical: 'Critical',
}
const PRIORITY_HEX: Record<string, string> = { high: '#DC2626', medium: '#F59E0B', low: '#16A34A', critical: '#991B1B' }

const TASK_LABELS: TaskLabels = {
  manager: 'project lead',
  dueDate: 'Due Date',
  assignPlaceholder: 'Select team member…',
  emptyManager: 'No tasks yet — use “+ New task” to hand work to a team member. Only people under Team Members can be assigned.',
  emptyOther: 'You have no tasks on this project.',
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
  const [priority, setPriority] = useState<RndProjectPriority>('medium')
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
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  const [deleting, setDeleting] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  // Project lead / admin — hands out tasks and is the only one who may delete files.
  const [isManager, setIsManager] = useState(false)
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
    setPriority(p.priority)
    setObjective(p.objective)
    setScope(p.scope || '')
    setLeadIds(p.lead_ids?.length ? p.lead_ids : p.lead_id ? [p.lead_id] : [])
    setTeamIds(p.team_member_ids || [])
    setStartDate(p.start_date || '')
    setTargetEndDate(p.target_end_date || '')
    setRemarks(p.remarks || '')
    setOrigin(originFromProject(p))
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
      <div>
        <RndNav />
        <ErrorBanner error={error || 'R&D project not found.'} />
        <button onClick={() => router.push('/dashboard/rnd/projects')} type="button" style={secondaryBtnStyle}>← Back</button>
      </div>
    )
  }

  const canEdit = can('rnd', 'projects', 'edit')
  const canDeleteProject = canDelete('rnd', 'projects', project.created_by_id ?? null)

  const startEdit = () => { setError(''); setSaved(false); applyProject(project); setEditing(true) }
  const discardEdit = () => { setError(''); applyProject(project); setEditing(false) }

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
      })
      applyProject(await rndApi.getProject(projectId))
      setIsManager((await rndApi.projectTaskAccess(projectId)).can_manage)
      setEditing(false)
      setSaved(true)
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

  return (
    <div style={{ width: '100%' }}>
      <RndNav />

      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
        <div data-tour="rnd-pd-badges">
          <p style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 4px' }}>
            R&amp;D Module
          </p>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', margin: '0 0 20px' }}>
            <h1 style={{ fontSize: 24, fontWeight: 700, color: TEXT.heading, margin: 0 }}>{project.project_number}</h1>
            <span style={{ fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 9999, background: `${PRIORITY_HEX[project.priority] || '#78716c'}1a`, color: PRIORITY_HEX[project.priority] || '#78716c', whiteSpace: 'nowrap' }}>
              {PRIORITY_LABELS[project.priority] || project.priority}
            </span>
          </div>
          {(project.linked_requirements || []).length > 0 && (
            <div data-tour="rnd-pd-requirements" style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', margin: '-12px 0 20px' }}>
              <span style={{ fontSize: 12, color: TEXT.muted }}>For requirement:</span>
              {(project.linked_requirements || []).map((r) => (
                <button key={`${r.source}-${r.record_id}`} type="button" onClick={() => router.push(recordPath(`/dashboard/rnd/requirements/${r.source}`, r, 'record_id'))}
                  title={r.title || undefined}
                  style={{ fontSize: 12, fontWeight: 600, padding: '3px 10px', borderRadius: 9999, border: '1px solid rgba(255,106,42,0.3)', background: 'rgba(255,106,42,0.08)', color: '#c2410c', cursor: 'pointer' }}>
                  {r.ref}{r.title ? ` · ${r.title}` : ''}
                </button>
              ))}
            </div>
          )}
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

      <div data-tour="rnd-pd-source" style={sectionStyle}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', margin: '0 0 14px' }}>
          <h2 style={{ fontSize: 15, fontWeight: 700, color: TEXT.heading, margin: 0 }}>Source</h2>
          {project.origin ? (
            <span style={{ fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 9999, background: `${ORIGIN_HEX[project.origin] || '#78716c'}1a`, color: ORIGIN_HEX[project.origin] || '#78716c', whiteSpace: 'nowrap' }}>
              {project.origin_label || project.origin}
            </span>
          ) : (
            <span style={{ fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 9999, background: '#78716c1a', color: '#78716c', whiteSpace: 'nowrap' }}>Origin not recorded</span>
          )}
        </div>
        {project.origin ? (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '14px 32px' }}>
            {project.source_kind && (
              <div>
                <p style={{ fontSize: 11.5, fontWeight: 600, color: TEXT.muted, margin: '0 0 3px' }}>{KIND_LABELS[project.source_kind]}</p>
                {project.source_path && project.source_exists ? (
                  <button type="button" onClick={() => router.push(recordPath(project.source_path as string, project, 'source_id'))}
                    style={{ padding: 0, border: 'none', background: 'none', color: '#2563EB', fontWeight: 600, fontSize: 13.5, cursor: 'pointer', textAlign: 'left' }}>
                    {project.source_ref || `#${project.source_id}`}
                  </button>
                ) : (
                  <p style={{ fontSize: 13.5, color: TEXT.body, margin: 0 }}>
                    {project.source_ref || `#${project.source_id}`} <span style={{ fontSize: 12, color: TEXT.muted }}>(record no longer exists)</span>
                  </p>
                )}
              </div>
            )}
            {project.product_name && <InfoRow label={project.origin === 'product_improvement' ? 'Product being improved' : 'Product'} value={project.product_name} />}
            {project.improvement_reason_label && <InfoRow label="Reason" value={project.improvement_reason_label} />}
            {project.origin_note && <div style={{ flexBasis: '100%' }}><InfoRow label="Who proposed it and why" value={project.origin_note} /></div>}
          </div>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <p style={{ fontSize: 13, color: TEXT.muted, margin: 0 }}>
              This project was created before its origin was recorded — nobody can tell why it exists or what it belongs to.
              {canEdit && isManager ? ' Set it now.' : ' A project lead or admin can set it.'}
            </p>
            {canEdit && isManager && !editing && (
              <button data-tour="rnd-pd-set-origin-btn" type="button" onClick={startEdit} style={secondaryBtnStyle}>Set origin</button>
            )}
          </div>
        )}
      </div>

      {(
        <>
          <div data-tour="rnd-pd-details" style={sectionStyle}>
            <h2 style={{ fontSize: 15, fontWeight: 700, color: TEXT.heading, margin: '0 0 14px' }}>Project Initiation</h2>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '14px 32px', marginBottom: 18 }}>
              <InfoRow label="Project Title" value={project.title} />
              <InfoRow label="Start Date" value={formatDate(project.start_date)} />
              <InfoRow label="Target End Date" value={project.target_end_date ? formatDate(project.target_end_date) : 'Not decided'} />
              <InfoRow label="Created" value={formatDate(project.created_at)} />
            </div>
            <div style={{ marginBottom: 14 }}><InfoRow label="Objective" value={project.objective || '—'} /></div>
            <InfoRow label="Scope" value={project.scope || '—'} />
          </div>

          <div style={sectionStyle}>
            <h2 style={{ fontSize: 15, fontWeight: 700, color: TEXT.heading, margin: '0 0 14px' }}>Project Members</h2>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '14px 32px', marginBottom: 14 }}>
              <InfoRow label="Project Leads" value={project.leads?.map((m) => m.name).join(', ') || project.lead_name || '—'} />
              <InfoRow label="Team Members" value={project.team_members?.map((m) => m.name).join(', ') || '—'} />
            </div>
            <InfoRow label="Remarks" value={project.remarks || '—'} />
          </div>
        </>
      )}

      {editing && (
        <FormSheet tour="rnd-pd-edit-form" icon="edit" title="Edit R&D Project" subtitle={`${project.project_number} — changes are saved to the project record.`}
          onClose={discardEdit} busy={saving}
          footer={<>
            <button data-tour="rnd-pd-discard-btn" type="button" onClick={discardEdit} disabled={saving} style={sheetBtn('secondary', SHEET.INK, saving)}>Discard</button>
            <button data-tour="rnd-pd-save-btn" type="button" onClick={handleSave} disabled={saving} style={sheetBtn('primary', SHEET.BLUE, saving)}>
              <SheetIcon name="check" size={16} />{saving ? 'Saving…' : 'Save changes'}
            </button>
          </>}>
          <SheetColumns
            left={<>
              <ErrorBanner error={error} />
              <SheetSection icon="flag" title="Project Origin">
                <ProjectOriginFields value={origin} onChange={setOrigin} />
              </SheetSection>
              <SheetSection icon="list" title="Project Initiation">
                <label style={labelStyle}>Project Title <Req /></label>
                <input style={inputStyle} value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
                <label style={{ ...labelStyle, marginTop: 14 }}>Objective <Req /></label>
                <textarea style={{ ...inputStyle, minHeight: 80, resize: 'vertical' }} value={objective} onChange={(e) => setObjective(e.target.value)} placeholder="What should this project achieve, and why?" />
                <label style={{ ...labelStyle, marginTop: 14 }}>Scope</label>
                <textarea style={{ ...inputStyle, minHeight: 70, resize: 'vertical' }} value={scope} onChange={(e) => setScope(e.target.value)} placeholder="In scope / out of scope, key deliverables" />
              </SheetSection>
              <SheetSection icon="calendar" title="Priority & Schedule">
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
                  <div style={{ flex: '1 1 240px', minWidth: 220, maxWidth: 300 }}>
                    <label style={labelStyle}>Priority</label>
                    <select style={inputStyle} value={priority} onChange={(e) => setPriority(e.target.value as RndProjectPriority)}>
                      <option value="high">High — Important requirement</option>
                      <option value="medium">Medium — Normal requirement</option>
                      <option value="low">Low — Can be handled later</option>
                      {/* Older projects may still carry "critical" — keep it visible so a save doesn't silently change it. */}
                      {project.priority === 'critical' && <option value="critical">Critical (old value)</option>}
                    </select>
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
            </>}
            right={<>
              <SheetSection icon="users" title="Project Members">
                <label style={labelStyle}>Project Leads</label>
                <TeamMemberPicker users={pickable} value={leadIds} onChange={setLeadIds} excludeIds={teamIds} selfId={user?.id} placeholder="Search name or email to add a project lead…" />
                <label style={{ ...labelStyle, marginTop: 14 }}>Team Members</label>
                <TeamMemberPicker users={pickable} value={teamIds} onChange={setTeamIds} excludeIds={leadIds} selfId={user?.id} />
              </SheetSection>
              <SheetSection icon="chat" title="Remarks" extra={<Optional />}>
                <textarea style={{ ...inputStyle, minHeight: 60, resize: 'vertical' }} value={remarks} onChange={(e) => setRemarks(e.target.value)} />
              </SheetSection>
            </>}
          />
        </FormSheet>
      )}

      {canFeature('rnd', 'projects', 'tasks', 'view') && <div id="tasks" data-tour="rnd-pd-tasks" style={{ ...sectionStyle, scrollMarginTop: 16 }}>
        <h2 style={{ fontSize: 15, fontWeight: 700, color: TEXT.heading, margin: '0 0 4px' }}>Tasks</h2>
        <p style={{ fontSize: 12, color: TEXT.muted, margin: '0 0 14px' }}>
          Project leads hand work to team members. Whoever a task is assigned to can split it into sub-tasks; whoever creates a task can edit it and checks it when it&apos;s marked done.
        </p>
        {user && (
          <TasksBoard api={taskApi} userId={user.id} canManage={isManager} labels={TASK_LABELS}
            canCreate={isManager && canFeature('rnd', 'projects', 'tasks', 'create')}
            rights={{
              create: canFeature('rnd', 'projects', 'tasks', 'create'), edit: canFeature('rnd', 'projects', 'tasks', 'edit'),
              approve: canFeature('rnd', 'projects', 'tasks', 'approve'), cancel: canFeature('rnd', 'projects', 'tasks', 'cancel'),
            }}
            reloadKey={`${project.id}-${project.updated_at || ''}`} />
        )}
      </div>}

      <RndDocumentsPanel
        key={project.id}
        projectId={project.id}
        title="Attachments"
        currentUserId={user?.id}
        isAdmin={user?.role === 'admin'}
        canManageFiles={isManager}
      />

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
