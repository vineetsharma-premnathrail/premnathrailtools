'use client'

import { useRequireApp } from '@/hooks/useAuth'
import { TEXT } from '@/lib/theme'
import ProjectsNav from '@/components/projects/ProjectsNav'
import ProjectListView from '@/components/projects/ProjectListView'

export default function MyProjectsPage() {
  const { isAuthorized, isLoading } = useRequireApp('projects')

  if (isLoading || !isAuthorized) return null

  return (
    <div>
      <ProjectsNav />

      <div style={{ marginBottom: 20 }}>
        <p style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 4px' }}>
          Project Management
        </p>
        <h1 style={{ fontSize: 24, fontWeight: 700, color: TEXT.heading, margin: 0 }}>My Projects</h1>
      </div>

      <ProjectListView mine={true} />
    </div>
  )
}
