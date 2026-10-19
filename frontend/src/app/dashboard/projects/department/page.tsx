'use client'

import { useProtectedPage } from '@/hooks/useAuth'
import { TEXT } from '@/lib/theme'
import ProjectsNav from '@/components/projects/ProjectsNav'
import DepartmentWork from '@/components/projects/work/DepartmentWork'

export default function DepartmentWorkPage() {
  const { isAuthorized, isLoading } = useProtectedPage()

  if (isLoading || !isAuthorized) return null

  return (
    <div>
      <ProjectsNav />
      <div style={{ marginBottom: 20 }}>
        <p style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 4px' }}>
          Project Management
        </p>
        <h1 style={{ fontSize: 24, fontWeight: 700, color: TEXT.heading, margin: '0 0 4px' }}>Department Work</h1>
        <p style={{ fontSize: 13.5, color: TEXT.muted, margin: 0 }}>
          WBS given to the departments you head: create and assign tasks, follow your team's work, attach evidence and submit.
        </p>
      </div>
      <DepartmentWork />
      <EmptyHint />
    </div>
  )
}

function EmptyHint() {
  // DepartmentWork renders nothing for non-heads; say why instead of a blank page.
  return (
    <p data-tour="pm-dw-hint" style={{ fontSize: 12.5, color: TEXT.muted, margin: '8px 0 0' }}>
      Only department heads see WBS elements here (set in Organization &gt; Departments). Tasks assigned to you are under My Tasks.
    </p>
  )
}
