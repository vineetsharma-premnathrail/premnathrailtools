'use client'

import { useParams, useRouter } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import CrmNav from '@/components/crm/CrmNav'
import TenderDetailPanel from '@/components/crm/TenderDetailPanel'

export default function TenderDetailPage() {
  const { isAuthorized, isLoading } = useRequireApp('crm')
  const params = useParams()
  const router = useRouter()
  const tenderId = Number(params.id)

  if (isLoading || !isAuthorized) return null

  return (
    <div>
      <CrmNav />
      <TenderDetailPanel tenderId={tenderId} onDeleted={() => router.push('/dashboard/crm/tenders')} />
    </div>
  )
}
