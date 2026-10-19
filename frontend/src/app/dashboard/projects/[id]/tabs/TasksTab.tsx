'use client'

import { PmProject } from '@/types'
import ProjectPlan from '@/components/projects/work/ProjectPlan'

/** Project › Milestones: the project plan — a timeline of milestones (name,
 * expected achievable date, responsible person), each opened to work its
 * tasks and their sub-tasks. */
export default function TasksTab({ project }: { project: PmProject }) {
  return (
    <div data-tour="pm-tasks-section">
      <ProjectPlan project={project} />
    </div>
  )
}
