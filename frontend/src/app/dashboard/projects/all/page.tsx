'use client'

import { useRouter } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { TEXT } from '@/lib/theme'
import ProjectsNav from '@/components/projects/ProjectsNav'
import ProjectListView from '@/components/projects/ProjectListView'

export default function AllProjectsPage() {
  const { isAuthorized, isLoading } = useRequireApp('projects')
  const router = useRouter()

  if (isLoading || !isAuthorized) return null

  return (
    <div>
      <ProjectsNav />

      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, marginBottom: 20, flexWrap: 'wrap' }}>
        <div>
          <p style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 4px' }}>
            Project Management
          </p>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: TEXT.heading, margin: 0 }}>All Projects</h1>
        </div>
        <button
          onClick={() => router.push('/dashboard/projects/new')}
          type="button"
          style={{ padding: '10px 18px', borderRadius: 10, border: 'none', background: '#6366f1', color: '#fff', fontSize: 13.5, fontWeight: 600, cursor: 'pointer' }}
        >
          + New Project
        </button>
      </div>

      <ProjectListView mine={false} />
    </div>
  )
}
