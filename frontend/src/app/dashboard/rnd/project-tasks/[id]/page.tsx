'use client'

// R&D › R&D Tasks › a Project Management (All Projects) project. Where the R&D tasks
// given on that project are worked: the same Tasks board as an R&D project / requirement
// (checklist, updates, approval requests, complete, reopen). Project Management only
// shows these tasks read-only on the project's Tasks tab. Opened from R&D › R&D Tasks
// through a signed ref.

import { useEffect, useMemo, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { rndApi } from '@/lib/api'
import { TEXT } from '@/lib/theme'
import { secondaryBtnStyle } from '@/components/shared/ui'
import RndNav from '@/components/rnd/RndNav'
import InvalidRecordLink from '@/components/erp/InvalidRecordLink'
import { useRecordId } from '@/lib/recordRef'
import TasksBoard, { TaskApi, TaskLabels } from '@/components/rnd/TasksBoard'
import { extractErrorMessages } from '@/lib/validation'
import { useCan } from '@/lib/permissions'

const TASK_LABELS: TaskLabels = {
  manager: 'R&D head / project manager',
  dueDate: 'Due Date',
  assignPlaceholder: 'Select person…',
  emptyManager: 'No R&D tasks on this project yet — use “Add Task”.',
  emptyOther: 'You have no R&D tasks on this project.',
}

type PmProjectInfo = { id: number; project_code: string; name: string; client_name: string | null; status: string }

function ErrorBanner({ error }: { error: string | string[] }) {
  if (!error || (Array.isArray(error) && error.length === 0)) return null
  return (
    <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
      {Array.isArray(error) ? error.join(' ') : error}
    </div>
  )
}

export default function RndPmProjectTasksPage() {
  const { isAuthorized, isLoading, user } = useRequireApp('rnd')
  const { canFeature } = useCan()
  const router = useRouter()
  const params = useParams()
  const { id: resolvedId, error: linkError } = useRecordId(params.id as string)
  const pmProjectId = resolvedId ?? 0

  const [project, setProject] = useState<PmProjectInfo | null>(null)
  const [canManage, setCanManage] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | string[]>('')

  const taskApi = useMemo<TaskApi>(() => ({
    list: () => rndApi.listPmProjectTasks(pmProjectId),
    people: async () => (await rndApi.pmProjectTaskAccess(pmProjectId)).people,
    team: async () => (await rndApi.pmProjectTaskAccess(pmProjectId)).team,
    create: (p, parentId) => rndApi.createPmProjectTask(pmProjectId, p, parentId),
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
  }), [pmProjectId])

  useEffect(() => {
    if (!isAuthorized || !pmProjectId) return
    let alive = true
    rndApi.pmProjectTaskAccess(pmProjectId)
      .then((a) => { if (alive) { setProject(a.project); setCanManage(a.can_manage) } })
      .catch((err) => { if (alive) setError(extractErrorMessages(err, 'Could not load this project\'s R&D tasks. Go back to R&D Tasks and open it again; if it keeps failing, check your role has View on R&D › Prototype / Research (the task actions live there).')) })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [isAuthorized, pmProjectId])

  if (isLoading || !isAuthorized) return null
  if (linkError) return (<div style={{ width: '100%' }}><RndNav /><InvalidRecordLink message={linkError} listHref="/dashboard/rnd/tasks" listLabel="Back to R&D Tasks" /></div>)
  if (loading) return null

  const back = (
    <button onClick={() => router.push('/dashboard/rnd/tasks')} type="button" style={secondaryBtnStyle}>← Back</button>
  )

  if (!project) {
    return (
      <div style={{ width: '100%' }}>
        <RndNav />
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
          <div>
            <p style={{ fontSize: 12, fontWeight: 700, color: TEXT.muted, textTransform: 'uppercase', letterSpacing: 0.4, margin: '0 0 4px' }}>R&amp;D Tasks</p>
            <h1 style={{ fontSize: 24, fontWeight: 700, color: TEXT.heading, margin: '0 0 20px' }}>Project</h1>
          </div>
          {back}
        </div>
        <ErrorBanner error={error || 'Project not found — it may have been removed from Project Management. Go back to R&D Tasks.'} />
      </div>
    )
  }

  const canCreate = canManage && canFeature('rnd', 'projects', 'tasks', 'create')

  return (
    <div style={{ width: '100%' }}>
      <RndNav />
      <div data-tour="rnd-pmt-header" style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', marginBottom: 16 }}>
        <div style={{ minWidth: 0 }}>
          <p style={{ fontSize: 12, fontWeight: 700, color: TEXT.muted, textTransform: 'uppercase', letterSpacing: 0.4, margin: '0 0 4px' }}>R&amp;D Tasks</p>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: TEXT.heading, margin: 0, overflowWrap: 'anywhere' }}>{project.project_code} — {project.name}</h1>
          <p style={{ fontSize: 13, color: TEXT.muted, margin: '4px 0 0' }}>
            {[project.client_name, project.status ? `Status: ${project.status.replace(/_/g, ' ')}` : ''].filter(Boolean).join(' · ') || 'Project Management › All Projects'}
          </p>
        </div>
        {back}
      </div>
      <ErrorBanner error={error} />
      {user && (
        <div id="tasks" data-tour="rnd-pmt-tasks">
          <TasksBoard
            key={project.id}
            api={taskApi} userId={user.id} canManage={canManage} labels={TASK_LABELS} draftKey={`pm-project-${project.id}`} reloadKey={project.id}
            canCreate={canCreate}
            rights={{ create: canFeature('rnd', 'projects', 'tasks', 'create'), edit: canFeature('rnd', 'projects', 'tasks', 'edit'), approve: canFeature('rnd', 'projects', 'tasks', 'approve'), cancel: canFeature('rnd', 'projects', 'tasks', 'cancel') }}
          />
        </div>
      )}
    </div>
  )
}
