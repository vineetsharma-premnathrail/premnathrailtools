'use client'

// R&D › R&D Tasks › one task on its own page. Opened from the R&D Tasks board so the
// person doing the work sees only the task (brief, checklist, updates, approval requests,
// complete, sub-tasks) — not the whole requirement / project. The server returns the task,
// its main task and its sub-tasks as far as the user may see them (data scope + task rules);
// "Open requirement / project" shows only when the user may open that page too.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { apiClient, rndApi } from '@/lib/api'
import { TEXT } from '@/lib/theme'
import { secondaryBtnStyle } from '@/components/shared/ui'
import RndNav from '@/components/rnd/RndNav'
import InvalidRecordLink from '@/components/erp/InvalidRecordLink'
import { recordPath, useRecordId } from '@/lib/recordRef'
import { TaskApi, TaskLabels, TaskView } from '@/components/rnd/TasksBoard'
import { REQUIREMENT_TASK_LABELS, requirementTaskApi } from '@/components/rnd/RequirementTasksTab'
import { extractErrorMessages } from '@/lib/validation'
import { useCan } from '@/lib/permissions'
import type { RndPerson, RndTask } from '@/types'

export type RndTaskKind = 'requirement' | 'project'

type Parent = { kind: 'requirement' | 'project' | 'pm_project'; id: number; id_ref?: string; source?: 'inquiry' | 'tender'; ref: string; title: string | null }
type Detail = { tasks: RndTask[]; parent: Parent; can_manage: boolean; can_open_parent: boolean }

const PROJECT_TASK_LABELS: TaskLabels = {
  manager: 'project lead',
  dueDate: 'Due Date',
  assignPlaceholder: 'Select person…',
  emptyManager: 'No tasks yet.',
  emptyOther: 'No tasks yet.',
}

const PARENT_LABEL: Record<Parent['kind'], string> = { requirement: 'Requirement', project: 'Prototype / Research', pm_project: 'Project' }

function projectTaskApi(parent: Parent | null, reload: () => Promise<RndTask[]>): TaskApi {
  const pm = parent?.kind === 'pm_project'
  const id = parent?.id ?? 0
  const access = () => (pm ? rndApi.pmProjectTaskAccess(id) : rndApi.projectTaskAccess(id))
  return {
    list: reload,
    people: async () => (await access()).people,
    team: async () => (await access()).team,
    create: (p, parentId) => (pm ? rndApi.createPmProjectTask(id, p, parentId) : rndApi.createProjectTask(id, p, parentId)),
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
  }
}

export default function RndTaskPage({ kind }: { kind: RndTaskKind }) {
  const { isAuthorized, isLoading, user } = useRequireApp('rnd')
  const { canFeature } = useCan()
  const router = useRouter()
  const params = useParams()
  const { id: taskId, error: linkError } = useRecordId(params.id as string)

  const [detail, setDetail] = useState<Detail | null>(null)
  const [people, setPeople] = useState<RndPerson[]>([])
  const [team, setTeam] = useState<RndPerson[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | string[]>('')

  const url = kind === 'requirement' ? `/rnd/requirement-work/tasks/${taskId}/detail` : `/rnd/project-tasks/${taskId}/detail`
  const fetchDetail = useCallback(async (): Promise<Detail> => (await apiClient.get<Detail>(url)).data, [url])
  const reload = useCallback(async () => {
    const d = await fetchDetail()
    setDetail(d)
    return d.tasks
  }, [fetchDetail])

  useEffect(() => {
    if (!isAuthorized || !taskId) return
    let alive = true
    fetchDetail()
      .then((d) => { if (alive) { setDetail(d); setError('') } })
      .catch((err) => { if (alive) setError(extractErrorMessages(err, 'Could not open this task. Go back to R&D Tasks and open it again; if it keeps failing, ask the R&D head whether the task is still assigned to you.')) })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [isAuthorized, taskId, fetchDetail])

  const parent = detail?.parent ?? null
  const api = useMemo<TaskApi>(() => {
    if (kind === 'requirement' && parent?.source) return { ...requirementTaskApi(parent.source, parent.id), list: reload }
    return projectTaskApi(parent, reload)
  }, [kind, parent, reload])

  // Assignee pickers: everyone for a manager (edit / reassign), the team for sub-tasks.
  const canManage = !!detail?.can_manage
  useEffect(() => {
    if (!parent) return
    if (canManage) api.people().then(setPeople).catch(() => setPeople([]))
    if (api.team) api.team().then(setTeam).catch(() => setTeam([]))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parent?.kind, parent?.id, canManage])

  if (isLoading || !isAuthorized) return null
  if (linkError) return (<div style={{ width: '100%' }}><RndNav /><InvalidRecordLink message={linkError} listHref="/dashboard/rnd/tasks" listLabel="Back to R&D Tasks" /></div>)

  const task = detail?.tasks.find((t) => t.id === taskId)
  const feat = kind === 'requirement' ? 'requirements' : 'projects'
  const rights = {
    create: canFeature('rnd', feat, 'tasks', 'create'), edit: canFeature('rnd', feat, 'tasks', 'edit'),
    approve: canFeature('rnd', feat, 'tasks', 'approve'), cancel: canFeature('rnd', feat, 'tasks', 'cancel'),
  }

  const openParent = () => {
    if (!parent) return
    try {
      router.push(parent.kind === 'requirement'
        ? `${recordPath(`/dashboard/rnd/requirements/${parent.source || 'inquiry'}`, parent)}?tab=tasks`
        : parent.kind === 'pm_project' ? recordPath('/dashboard/rnd/project-tasks', parent) : `${recordPath('/dashboard/rnd/projects', parent)}?tab=tasks`)
    } catch (err) {
      setError(extractErrorMessages(err, 'Could not open it — reload the page and try again.'))
    }
  }
  const openTask = (id: number) => {
    const t = detail?.tasks.find((x) => x.id === id)
    if (!t) return
    try { router.push(recordPath(`/dashboard/rnd/tasks/${kind}`, t)) } catch (err) { setError(extractErrorMessages(err, 'Could not open that task — reload the page and try again.')) }
  }

  return (
    <div style={{ width: '100%' }}>
      <RndNav />
      <div data-tour="rnd-task-page-header" style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', marginBottom: 16 }}>
        <div style={{ minWidth: 0 }}>
          <p style={{ fontSize: 12, fontWeight: 700, color: TEXT.muted, textTransform: 'uppercase', letterSpacing: 0.4, margin: '0 0 4px' }}>R&amp;D Tasks</p>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: TEXT.heading, margin: 0, overflowWrap: 'anywhere' }}>Task</h1>
          {parent && (
            <p style={{ fontSize: 13, color: TEXT.muted, margin: '4px 0 0', overflowWrap: 'anywhere' }}>
              {PARENT_LABEL[parent.kind]} {parent.ref}{parent.title ? ` — ${parent.title}` : ''}
            </p>
          )}
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {parent && detail?.can_open_parent && (
            <button type="button" data-tour="rnd-task-page-open-parent" onClick={openParent} style={secondaryBtnStyle}>Open {PARENT_LABEL[parent.kind].toLowerCase()} →</button>
          )}
          <button type="button" onClick={() => router.push('/dashboard/rnd/tasks')} style={secondaryBtnStyle}>← Back</button>
        </div>
      </div>

      {error && (
        <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
          {Array.isArray(error) ? error.join(' ') : error}
        </div>
      )}

      {loading ? (
        <p style={{ fontSize: 13, color: TEXT.muted }}>Loading…</p>
      ) : task && detail && user ? (
        <div data-tour="rnd-task-page-task" style={{ maxWidth: 980 }}>
          <TaskView key={task.id} task={task} all={detail.tasks} userId={user.id} canManage={canManage}
            rights={rights} api={api} labels={kind === 'requirement' ? REQUIREMENT_TASK_LABELS : PROJECT_TASK_LABELS}
            people={people} team={team}
            onChanged={() => { void reload().catch(() => undefined) }}
            onCreated={() => { void reload().catch(() => undefined) }}
            onOpen={openTask} />
        </div>
      ) : !error && (
        <p style={{ fontSize: 13, color: TEXT.muted }}>This task no longer exists — go back to R&amp;D Tasks.</p>
      )}
    </div>
  )
}
