'use client'

import { useRouter } from 'next/navigation'
import { useRequireErpPermission } from '@/hooks/useAuth'
import { erpApi } from '@/lib/api'
import ErpNav from '@/components/erp/ErpNav'
import ServiceRequestForm from '@/components/erp/ServiceRequestForm'

export default function NewServiceRequestPage() {
  const { isAuthorized, isLoading } = useRequireErpPermission('sr_create', '/dashboard/erp/service-requests')
  const router = useRouter()

  if (isLoading || !isAuthorized) return null

  return (
    <div>
      <ErpNav />
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, flexWrap: 'wrap', gap: 10 }}>
        <div>
          <p style={{ fontSize: 11.5, fontWeight: 600, color: '#a8a29e', margin: '0 0 6px' }}>
            <span onClick={() => router.push('/dashboard/erp/service-requests')} style={{ cursor: 'pointer' }}>Service Operations</span> › New Request
          </p>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: '#1f1108', margin: 0 }}>Create Service Request</h1>
        </div>
        <button
          onClick={() => router.push('/dashboard/erp/service-requests')}
          style={{ fontSize: 13, fontWeight: 600, padding: '9px 18px', borderRadius: 10, border: '1px solid rgba(0,0,0,0.1)', background: '#fff', color: '#57534e', cursor: 'pointer' }}
        >
          ‹ Back
        </button>
      </div>

      <ServiceRequestForm
        submitLabel="Create Request"
        onCancel={() => router.push('/dashboard/erp/service-requests')}
        onSubmit={async (payload, files) => {
          const created = await erpApi.createServiceRequest(payload)
          if (files.length > 0) {
            await erpApi.uploadAttachments(created.id, files)
          }
          router.push(`/dashboard/erp/service-requests/${created.id}`)
        }}
      />
    </div>
  )
}
