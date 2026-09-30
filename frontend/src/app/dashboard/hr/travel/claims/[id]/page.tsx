'use client'

import { useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import type { HrExpenseClaim } from '@/types'
import HrNav from '@/components/hr/HrNav'
import ClaimDetail from '@/components/hr/admin/ClaimDetail'
import { PageHeader } from '@/components/hr/admin/adminUi'
import { secondaryBtnStyle } from '@/components/shared/ui'

export default function HrClaimDetailPage() {
  const { isAuthorized, isLoading } = useRequireApp('hr')
  const router = useRouter()
  const params = useParams<{ id: string }>()
  const claimId = Number(params?.id)
  const [claim, setClaim] = useState<HrExpenseClaim | null>(null)

  if (isLoading || !isAuthorized) return null

  return (
    <div>
      <HrNav />

      <PageHeader
        title={claim ? `${claim.claim_no} — ${claim.title}` : 'Expense claim'}
        subtitle={claim ? `Claimed by ${claim.user_name || 'employee'}${claim.user_department ? ` · ${claim.user_department}` : ''}` : undefined}
        actions={<button onClick={() => router.push('/dashboard/hr/travel?tab=claims')} type="button" style={secondaryBtnStyle}>← Back</button>}
      />

      <ClaimDetail claimId={claimId} onChanged={setClaim} />
    </div>
  )
}
