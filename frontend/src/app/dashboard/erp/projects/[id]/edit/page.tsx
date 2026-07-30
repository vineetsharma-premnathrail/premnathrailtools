'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useRequireErpPermission } from '@/hooks/useAuth'
import { erpApi } from '@/lib/api'
import { Project } from '@/types'
import ErpNav from '@/components/erp/ErpNav'
import ProjectForm from '@/components/erp/ProjectForm'

export default function EditProjectPage() {
  const params = useParams()
  const router = useRouter()
  const projectId = Number(params.id)
  const { isAuthorized, isLoading } = useRequireErpPermission('project_edit', `/dashboard/erp/projects/${projectId}`)

  const [project, setProject] = useState<Project | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!isAuthorized || !projectId) return
    erpApi.getProject(projectId).then(setProject).catch(() => setError('Machine not found.')).finally(() => setLoading(false))
  }, [isAuthorized, projectId])

  if (isLoading || !isAuthorized) return null
  if (loading) return <p style={{ fontSize: 13, color: '#78716c' }}>Loading…</p>
  if (error || !project) return <p style={{ fontSize: 13, color: '#b91c1c' }}>{error || 'Machine not found.'}</p>

  return (
    <div>
      <ErpNav />
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, flexWrap: 'wrap', gap: 10 }}>
        <div>
          <p style={{ fontSize: 11.5, fontWeight: 700, color: '#a8a29e', margin: '0 0 6px' }}>
            <span onClick={() => router.push('/dashboard/erp/projects')} style={{ cursor: 'pointer' }}>Projects</span> › Edit
          </p>
          <h1 style={{ fontSize: 22, fontWeight: 800, color: '#1f1108', margin: 0 }}>Edit Project — {project.serial_number}</h1>
        </div>
        <button
          onClick={() => router.push(`/dashboard/erp/projects/${projectId}`)}
          style={{ fontSize: 13, fontWeight: 700, padding: '9px 18px', borderRadius: 10, border: '1px solid rgba(0,0,0,0.1)', background: '#fff', color: '#57534e', cursor: 'pointer' }}
        >
          ‹ Back
        </button>
      </div>

      <ProjectForm
        initial={project}
        submitLabel="Save Changes"
        onCancel={() => router.push(`/dashboard/erp/projects/${projectId}`)}
        onSubmit={async (payload, files) => {
          await erpApi.updateProject(projectId, payload)
          if (files.length > 0) {
            await erpApi.uploadProjectAttachments(projectId, files)
          }
          router.push(`/dashboard/erp/projects/${projectId}`)
        }}
      />
    </div>
  )
}
