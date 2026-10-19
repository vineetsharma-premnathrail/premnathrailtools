'use client'

import { useRouter } from 'next/navigation'
import { useRequireErpPermission } from '@/hooks/useAuth'
import { erpApi } from '@/lib/api'
import ErpNav from '@/components/erp/ErpNav'
import ProjectForm from '@/components/erp/ProjectForm'
import { recordPath } from '@/lib/recordRef'

export default function NewProjectPage() {
  const { user, isAuthorized, isLoading } = useRequireErpPermission('project_create', '/dashboard/erp/projects')
  const router = useRouter()

  if (isLoading || !isAuthorized) return null

  return (
    <div>
      <ProjectForm
        nav={<ErpNav />}
        title="Add New Project"
        subtitle="Register a machine in the asset register — identity, client & site, specs, warranty and documents."
        submitLabel="Save Project"
        currentUserId={user?.id}
        onCancel={() => router.push('/dashboard/erp/projects')}
        onSubmit={async (payload, files, shareOptions) => {
          const created = await erpApi.createProject(payload)
          if (files.length > 0) {
            await erpApi.uploadProjectAttachments(created.id, files, shareOptions)
          }
          router.push(recordPath('/dashboard/erp/projects', created))
        }}
      />
    </div>
  )
}
