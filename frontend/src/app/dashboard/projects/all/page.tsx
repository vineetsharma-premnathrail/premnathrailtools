'use client'

import { useEffect, useState } from 'react'
import { useRequireApp } from '@/hooks/useAuth'
import { useCan } from '@/lib/permissions'
import { projectsApi } from '@/lib/api'
import { TEXT } from '@/lib/theme'
import ProjectsNav from '@/components/projects/ProjectsNav'
import ProjectListView from '@/components/projects/ProjectListView'
import { primaryBtnStyle } from '@/components/shared/ui'
import { useRouter } from 'next/navigation'

export default function AllProjectsPage() {
  const { isAuthorized, isLoading } = useRequireApp('projects')
  const { can } = useCan()
  const canCurrent = can('projects', 'all_projects', 'view')
  const canPast = can('projects', 'service_projects', 'view')
  const [canCreate, setCanCreate] = useState(false)
  const router = useRouter()

  useEffect(() => {
    if (isAuthorized) projectsApi.meta().then((m) => setCanCreate(m.can_create)).catch(() => setCanCreate(false))
  }, [isAuthorized])

  if (isLoading || !isAuthorized) return null

  // One table: projects (All Projects › View) and past machines (Past Projects › View), each shown only with its permission.
  return (
    <div>
      <ProjectsNav />
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, marginBottom: 20, flexWrap: 'wrap' }}>
        <div>
          <p style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 4px' }}>Project Management</p>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: TEXT.heading, margin: 0 }}>All Projects</h1>
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          {canCreate && canCurrent && (
          <button
            data-tour="pm-all-new-btn"
            onClick={() => router.push('/dashboard/projects/new')}
            type="button"
            style={{ ...primaryBtnStyle, background: '#6366f1' }}
          >
            + Create Project
          </button>
          )}
        </div>
      </div>
      <ProjectListView showProjects={canCurrent} showMachines={canPast} />
    </div>
  )
}
