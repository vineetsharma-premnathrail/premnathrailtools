'use client'

import { useCallback, useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { projectsApi } from '@/lib/api'
import { PmProject } from '@/types'
import { TEXT } from '@/lib/theme'
import ProjectsNav from '@/components/projects/ProjectsNav'
import ProjectWorkspace from './ProjectWorkspace'
import { extractErrorMessages } from '@/lib/validation'

export default function ProjectDetailPage() {
  const { isAuthorized, isLoading } = useRequireApp('projects')
  const params = useParams()
  const router = useRouter()
  const projectId = Number(params.id)

  const [project, setProject] = useState<PmProject | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | string[]>('')

  const load = useCallback(() => {
    if (!projectId) return
    setLoading(true)
    setError('')
    projectsApi.get(projectId)
      .then(setProject)
      .catch((err) => setError(extractErrorMessages(err, 'Failed to load project.')))
      .finally(() => setLoading(false))
  }, [projectId])

  useEffect(() => {
    if (!isAuthorized) return
    load()
  }, [isAuthorized, load])

  if (isLoading || !isAuthorized) return null

  return (
    <div>
      <ProjectsNav />

      {loading ? (
        <p style={{ fontSize: 13, color: TEXT.muted }}>Loading…</p>
      ) : error && !project ? (
        <div style={{ padding: '10px 14px', borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
          {Array.isArray(error) ? error.join(' ') : error}
        </div>
      ) : project ? (
        <ProjectWorkspace
          project={project}
          onProjectUpdate={load}
          onDeleted={() => router.push('/dashboard/projects/all')}
        />
      ) : null}
    </div>
  )
}
