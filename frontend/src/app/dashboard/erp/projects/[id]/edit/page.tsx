'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useRequireErpPermission } from '@/hooks/useAuth'
import { erpApi } from '@/lib/api'
import { Project } from '@/types'
import ErpNav from '@/components/erp/ErpNav'
import ProjectForm from '@/components/erp/ProjectForm'
import { extractErrorMessages } from '@/lib/validation'
import { useRecordId } from '@/lib/recordRef'
import InvalidRecordLink from '@/components/erp/InvalidRecordLink'

export default function EditProjectPage() {
  const params = useParams()
  const router = useRouter()
  const ref = params.id as string
  const { id: projectId, error: linkError } = useRecordId(ref)
  const { user, isAuthorized, isLoading } = useRequireErpPermission('project_edit', `/dashboard/erp/projects/${ref}`)

  const [project, setProject] = useState<Project | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!isAuthorized || !projectId) return
    erpApi.getProject(projectId).then(setProject).catch((err) => setError(extractErrorMessages(err, 'Could not load this machine — check your connection and reload the page.').join(' '))).finally(() => setLoading(false))
  }, [isAuthorized, projectId])

  if (isLoading || !isAuthorized) return null
  if (linkError) return (<div><ErpNav /><InvalidRecordLink message={linkError} listHref="/dashboard/erp/projects" listLabel="Back to projects" /></div>)
  if (loading) return <p style={{ fontSize: 13, color: '#78716c' }}>Loading…</p>
  if (error || !project) return <p style={{ fontSize: 13, color: '#b91c1c' }}>{error || 'Machine not found.'}</p>

  return (
    <div>
      <ProjectForm
        nav={<ErpNav />}
        title={`Edit Project — ${project.serial_number}`}
        subtitle={[project.model_name, project.client_company].filter(Boolean).join(' · ') || 'Machine record'}
        initial={project}
        submitLabel="Save Changes"
        currentUserId={user?.id}
        onCancel={() => router.push(`/dashboard/erp/projects/${ref}`)}
        onSubmit={async (payload, files, shareOptions) => {
          await erpApi.updateProject(projectId!, payload)
          if (files.length > 0) {
            await erpApi.uploadProjectAttachments(projectId!, files, shareOptions)
          }
          router.push(`/dashboard/erp/projects/${ref}`)
        }}
      />
    </div>
  )
}
