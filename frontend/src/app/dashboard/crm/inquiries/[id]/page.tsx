'use client'

import { useParams, useRouter } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import CrmNav from '@/components/crm/CrmNav'
import InquiryDetailPanel from '@/components/crm/InquiryDetailPanel'

export default function InquiryDetailPage() {
  const { isAuthorized, isLoading } = useRequireApp('crm')
  const params = useParams()
  const router = useRouter()
  const inquiryId = Number(params.id)

  if (isLoading || !isAuthorized) return null

  return (
    <div>
      <CrmNav />
      <InquiryDetailPanel inquiryId={inquiryId} onDeleted={() => router.push('/dashboard/crm/inquiries')} />
    </div>
  )
}
