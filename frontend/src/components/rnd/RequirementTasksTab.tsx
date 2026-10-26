'use client'

// Tasks & Departments on an R&D requirement — one tab for R&D and every
// department the requirement is shared with (Design / Electrical / Hydraulic &
// Pneumatic), opened the same from R&D and from the department's Requirements
// page. Top: which departments it is shared with and their feasibility replies
// (the R&D head shares from here). Below: every department's tasks on the
// shared TasksBoard, filtered by All · My department · per department. Anyone
// who can open the requirement gives tasks to a person in R&D or a shared
// department; the assignee works on it, can split it into sub-tasks, and
// whoever gave a task reviews and can edit it (see TasksBoard for the flow).

import { useMemo, useState } from 'react'
import { rndApi } from '@/lib/api'
import { RndMyAccess, RndRequirementShare } from '@/types'
import { TEXT } from '@/lib/theme'
import TasksBoard, { TaskApi, TaskLabels, TaskRights } from '@/components/rnd/TasksBoard'
import RequirementDepartmentsTab from '@/components/rnd/RequirementDepartmentsTab'

export const REQUIREMENT_TASK_LABELS: TaskLabels = {
  manager: 'head',
  dueDate: 'Response Due Date',
  assignPlaceholder: 'Select person (R&D or a shared department)…',
  emptyManager: 'No tasks yet — use “+ New task” to give work to someone in R&D or a department this requirement is shared with.',
  emptyOther: 'No tasks on this requirement yet.',
}

/** R&D page: the role's R&D › Requirements features (Tasks, Share with departments)
 *  on top of the per-requirement access. Department pages leave it out — their
 *  own module governs them. */
export interface RequirementTaskGates {
  tasks: TaskRights
  /** See the departments block (list of shares + replies). */
  departments: boolean
  /** Share with departments (still the R&D head only). */
  share: boolean
}

/** The task API of one requirement — used here and by the Milestones tab (tasks inside milestones). */
export function requirementTaskApi(source: 'inquiry' | 'tender', recordId: number): TaskApi {
  return {
    list: () => rndApi.listTasks(source, recordId),
    // R&D people and the people of every department the requirement is shared with.
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
  /** Set while the requirement has a live milestone: new tasks are added inside a milestone, so "New task" is off here. */
  createDisabledHint?: string
}) {
  const [shares, setShares] = useState<RndRequirementShare[]>([])

  const api = useMemo<TaskApi>(() => requirementTaskApi(source, recordId), [source, recordId])

  // Chips: R&D plus every department the requirement is shared with.
  const sharedDepts = Array.from(new Map(shares.map((s) => [s.department, s.department_label])).entries())
  const options = [{ key: 'rnd', label: 'R&D' }, ...sharedDepts.map(([key, label]) => ({ key, label }))]
  // A new share adds that department's people to the assignee list — reload it.
  const shareKey = sharedDepts.map(([d]) => d).join(',')

  return (
    <div>
      {(gates?.departments ?? true) && (
        <RequirementDepartmentsTab source={source} recordId={recordId} isHead={access.is_head && (gates?.share ?? true)} onSharesChange={setShares} />
      )}
      <p style={{ fontSize: 12, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.secondary, margin: '4px 0 10px' }}>Tasks — all departments</p>
      {createDisabledHint && <p data-tour="rnd-req-tasks-milestone-hint" style={{ fontSize: 12.5, color: TEXT.muted, margin: '0 0 10px' }}>{createDisabledHint}</p>}
      <TasksBoard api={api} userId={userId} canManage={access.is_head} canCreate={access.view && (gates?.tasks.create ?? true) && !createDisabledHint} rights={gates?.tasks} labels={REQUIREMENT_TASK_LABELS}
        departmentFilter={{ options, mine: access.departments || [] }}
        reloadKey={`${source}-${recordId}-${shareKey}`} />
    </div>
  )
}
