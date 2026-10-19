'use client'

import { useParams, useRouter } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import CrmNav from '@/components/crm/CrmNav'
import TenderDetailPanel from '@/components/crm/TenderDetailPanel'
import { useRecordId } from '@/lib/recordRef'
import InvalidRecordLink from '@/components/erp/InvalidRecordLink'

export default function TenderDetailPage() {
  const { isAuthorized, isLoading } = useRequireApp('crm')
  const params = useParams()
  const router = useRouter()
  const { id: tenderId, error: linkError } = useRecordId(params.id as string)

  if (isLoading || !isAuthorized) return null
  if (linkError) return (<div><CrmNav /><InvalidRecordLink message={linkError} listHref="/dashboard/crm/inquiries?type=tender" listLabel="Back to tenders" /></div>)
  if (!tenderId) return <div><CrmNav /></div>

  return (
    <div>
      <CrmNav />
      <TenderDetailPanel tenderId={tenderId} onDeleted={() => router.push('/dashboard/crm/tenders')} />
    </div>
  )
}
