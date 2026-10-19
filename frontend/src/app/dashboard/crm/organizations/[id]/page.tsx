'use client'

import { useParams, useRouter } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import CrmNav from '@/components/crm/CrmNav'
import OrganizationDetailPanel from '@/components/crm/OrganizationDetailPanel'
import InvalidRecordLink from '@/components/erp/InvalidRecordLink'
import { useRecordId } from '@/lib/recordRef'

export default function OrganizationDetailPage() {
  const { isAuthorized, isLoading } = useRequireApp('crm')
  const params = useParams()
  const router = useRouter()
  const { id: orgId, error: linkError } = useRecordId(params.id as string)

  if (isLoading || !isAuthorized) return null
  if (linkError) return (<div><CrmNav /><InvalidRecordLink message={linkError} listHref="/dashboard/crm/organizations" listLabel="Back to customer organizations" /></div>)
  if (!orgId) return <div><CrmNav /></div>

  return (
    <div>
      <CrmNav />
      <OrganizationDetailPanel orgId={orgId} onDeleted={() => router.push('/dashboard/crm/organizations')} />
    </div>
  )
}
