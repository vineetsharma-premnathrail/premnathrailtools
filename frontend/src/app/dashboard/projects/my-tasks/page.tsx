'use client'

import { useProtectedPage } from '@/hooks/useAuth'
import ProjectsNav from '@/components/projects/ProjectsNav'
import ProjectPlan from '@/components/projects/work/ProjectPlan'

// Every user's own project work — milestones given to them, their tasks in
// others' milestones, and milestones they gave — in the same design as a
// project's Plan & Milestones (2026-10-19). Open to everyone (no Project
// Management app needed); it replaced the old Ongoing Projects list (2026-10-14).
export default function MyTasksPage() {
  const { isAuthorized, isLoading } = useProtectedPage()

  if (isLoading || !isAuthorized) return null

  return (
    <div>
      <ProjectsNav />
      <ProjectPlan />
    </div>
  )
}
