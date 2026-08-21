'use client'

import { useParams, useRouter } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import CrmNav from '@/components/crm/CrmNav'
import OrganizationDetailPanel from '@/components/crm/OrganizationDetailPanel'

export default function OrganizationDetailPage() {
  const { isAuthorized, isLoading } = useRequireApp('crm')
  const params = useParams()
  const router = useRouter()
  const orgId = Number(params.id)

  if (isLoading || !isAuthorized) return null

  return (
    <div>
      <CrmNav />
      <OrganizationDetailPanel orgId={orgId} onDeleted={() => router.push('/dashboard/crm/organizations')} />
    </div>
  )
}
