'use client'

import { useRouter } from 'next/navigation'
import { useRequireErpPermission } from '@/hooks/useAuth'
import { erpApi } from '@/lib/api'
import ErpNav from '@/components/erp/ErpNav'
import ProjectForm from '@/components/erp/ProjectForm'

export default function NewProjectPage() {
  const { user, isAuthorized, isLoading } = useRequireErpPermission('project_create', '/dashboard/erp/projects')
  const router = useRouter()

  if (isLoading || !isAuthorized) return null

  return (
    <div>
      <ErpNav />
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, flexWrap: 'wrap', gap: 10 }}>
        <div>
          <p style={{ fontSize: 11.5, fontWeight: 700, color: '#a8a29e', margin: '0 0 6px' }}>
            <span onClick={() => router.push('/dashboard/erp/projects')} style={{ cursor: 'pointer' }}>Projects</span> › Registration
          </p>
          <h1 style={{ fontSize: 22, fontWeight: 800, color: '#1f1108', margin: 0 }}>Add New Project</h1>
        </div>
        <button
          onClick={() => router.push('/dashboard/erp/projects')}
          style={{ fontSize: 13, fontWeight: 700, padding: '9px 18px', borderRadius: 10, border: '1px solid rgba(0,0,0,0.1)', background: '#fff', color: '#57534e', cursor: 'pointer' }}
        >
          ‹ Back
        </button>
      </div>

      <ProjectForm
        submitLabel="Save Project"
        currentUserId={user?.id}
        onCancel={() => router.push('/dashboard/erp/projects')}
        onSubmit={async (payload, files, shareOptions) => {
          const created = await erpApi.createProject(payload)
          if (files.length > 0) {
            await erpApi.uploadProjectAttachments(created.id, files, shareOptions)
          }
          router.push(`/dashboard/erp/projects/${created.id}`)
        }}
      />
    </div>
  )
}
