'use client'

import { useRouter } from 'next/navigation'
import { useRequireErpPermission } from '@/hooks/useAuth'
import { erpApi } from '@/lib/api'
import ErpNav from '@/components/erp/ErpNav'
import ServiceRequestForm from '@/components/erp/ServiceRequestForm'
import { recordPath } from '@/lib/recordRef'

export default function NewServiceRequestPage() {
  const { isAuthorized, isLoading } = useRequireErpPermission('sr_create', '/dashboard/erp/service-requests')
  const router = useRouter()

  if (isLoading || !isAuthorized) return null

  return (
    <div>
      <ServiceRequestForm
        nav={<ErpNav />}
        title="Create Service Request"
        subtitle="Log a fault or service job against a machine — warranty cover is checked as you pick it."
        submitLabel="Create Request"
        onCancel={() => router.push('/dashboard/erp/service-requests')}
        onSubmit={async (payload, files) => {
          const created = await erpApi.createServiceRequest(payload)
          if (files.length > 0) {
            await erpApi.uploadAttachments(created.id, files)
          }
          router.push(recordPath('/dashboard/erp/service-requests', created))
        }}
      />
    </div>
  )
}
