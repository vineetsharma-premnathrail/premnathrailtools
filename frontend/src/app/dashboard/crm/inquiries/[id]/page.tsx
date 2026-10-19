'use client'

import { useParams, useRouter } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import CrmNav from '@/components/crm/CrmNav'
import InquiryDetailPanel from '@/components/crm/InquiryDetailPanel'
import { useRecordId } from '@/lib/recordRef'
import InvalidRecordLink from '@/components/erp/InvalidRecordLink'

export default function InquiryDetailPage() {
  const { isAuthorized, isLoading } = useRequireApp('crm')
  const params = useParams()
  const router = useRouter()
  const { id: inquiryId, error: linkError } = useRecordId(params.id as string)

  if (isLoading || !isAuthorized) return null
  if (linkError) return (<div><CrmNav /><InvalidRecordLink message={linkError} listHref="/dashboard/crm/inquiries?type=inquiry" listLabel="Back to inquiries" /></div>)
  if (!inquiryId) return <div><CrmNav /></div>

  return (
    <div>
      <CrmNav />
      <InquiryDetailPanel inquiryId={inquiryId} onDeleted={() => router.push('/dashboard/crm/inquiries')} />
    </div>
  )
}
