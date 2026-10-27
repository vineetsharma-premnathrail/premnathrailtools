'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { erpApi } from '@/lib/api'
import { Project } from '@/types'
import ProjectsNav from '@/components/projects/ProjectsNav'
import ProjectForm from '@/components/erp/ProjectForm'
import { extractErrorMessages } from '@/lib/validation'
import { useRecordId } from '@/lib/recordRef'
import InvalidRecordLink from '@/components/erp/InvalidRecordLink'

export default function EditProjectPage() {
  const params = useParams()
  const router = useRouter()
  const ref = params.id as string
  const { id: projectId, error: linkError } = useRecordId(ref)
  // Machine edit grant, or management / project manager of the project the
  // machine belongs to: the server decides and answers with a real 403 message.
  const { user, isAuthorized, isLoading } = useRequireApp('projects')

  const [project, setProject] = useState<Project | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!isAuthorized || !projectId) return
    erpApi.getProject(projectId).then(setProject).catch((err) => setError(extractErrorMessages(err, 'Could not load this machine — check your connection and reload the page.').join(' '))).finally(() => setLoading(false))
  }, [isAuthorized, projectId])

  if (isLoading || !isAuthorized) return null
  if (linkError) return (<div><ProjectsNav /><InvalidRecordLink message={linkError} listHref="/dashboard/projects/all" listLabel="Back to projects" /></div>)
  if (loading) return <p style={{ fontSize: 13, color: '#78716c' }}>Loading…</p>
  if (error || !project) return <p style={{ fontSize: 13, color: '#b91c1c' }}>{error || 'Machine not found.'}</p>

  return (
    <div>
      <ProjectForm
        nav={<ProjectsNav />}
        title={`Edit Project — ${project.serial_number}`}
        subtitle={[project.model_name, project.client_company].filter(Boolean).join(' · ') || 'Machine record'}
        initial={project}
        submitLabel="Save Changes"
        currentUserId={user?.id}
        onCancel={() => router.push(`/dashboard/projects/service-projects/${ref}`)}
        onSubmit={async (payload, files, shareOptions) => {
          await erpApi.updateProject(projectId!, payload)
          if (files.length > 0) {
            await erpApi.uploadProjectAttachments(projectId!, files, shareOptions)
          }
          router.push(`/dashboard/projects/service-projects/${ref}`)
        }}
      />
    </div>
  )
}
