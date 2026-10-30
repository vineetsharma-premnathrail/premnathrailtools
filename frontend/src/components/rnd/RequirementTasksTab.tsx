'use client'

// Tasks on an R&D requirement — a flat list (no milestones, no department
// chips). R&D heads and people with R&D › R&D Tasks › Create give tasks to
// people in R&D; the assignee works on it, can split it into sub-tasks, and
// whoever gave a task reviews and can edit it (see TasksBoard for the flow).
// New tasks wait until R&D has accepted the requirement's latest revision.

import { useMemo } from 'react'
import { rndApi } from '@/lib/api'
import { RndMyAccess } from '@/types'
import { TEXT } from '@/lib/theme'
import TasksBoard, { TaskApi, TaskLabels, TaskRights } from '@/components/rnd/TasksBoard'

export const REQUIREMENT_TASK_LABELS: TaskLabels = {
  manager: 'head',
  dueDate: 'Due Date',
  assignPlaceholder: 'Select person in R&D…',
  emptyManager: 'No tasks yet — use “Add Task” to give work to someone in R&D.',
  emptyOther: 'No tasks on this requirement yet.',
}

/** R&D page: the role's R&D › Requirements › Tasks features on top of the per-requirement access. */
export interface RequirementTaskGates {
  tasks: TaskRights
}

/** The task API of one requirement. */
export function requirementTaskApi(source: 'inquiry' | 'tender', recordId: number): TaskApi {
  return {
    list: () => rndApi.listTasks(source, recordId),
    people: () => rndApi.requirementAssignees(source, recordId),
    team: () => rndApi.requirementAssignees(source, recordId),
    create: (p, parentId) => (parentId ? rndApi.createSubtask(parentId, p) : rndApi.createTask(source, recordId, p)),
    edit: rndApi.editTask,
    progress: rndApi.taskProgress,
    extend: rndApi.extendTask,
    complete: rndApi.completeTask,
    update: rndApi.addTaskUpdate,
    requestApproval: rndApi.requestApproval,
    decideApproval: rndApi.decideApproval,
    withdrawApproval: rndApi.withdrawApproval,
    reopen: rndApi.reopenTask,
    cancel: rndApi.cancelTask,
    openDoc: rndApi.openWorkDocument,
  }
}

export default function RequirementTasksTab({ source, recordId, userId, access, gates, createDisabledHint }: {
  source: 'inquiry' | 'tender'; recordId: number; userId: number; access: RndMyAccess; gates?: RequirementTaskGates
  /** Set while the latest revision is not accepted: "Add Task" is off and the reason is shown. */
  createDisabledHint?: string
}) {
  const api = useMemo<TaskApi>(() => requirementTaskApi(source, recordId), [source, recordId])

  return (
    <div>
      {createDisabledHint && <p data-tour="rnd-req-tasks-accept-hint" style={{ fontSize: 12.5, color: TEXT.muted, margin: '0 0 10px' }}>{createDisabledHint}</p>}
      <TasksBoard api={api} userId={userId} canManage={access.is_head} canCreate={access.view && (gates?.tasks.create ?? true) && !createDisabledHint} rights={gates?.tasks} labels={REQUIREMENT_TASK_LABELS} draftKey={`${source}-${recordId}`}
        reloadKey={`${source}-${recordId}`} />
    </div>
  )
}
