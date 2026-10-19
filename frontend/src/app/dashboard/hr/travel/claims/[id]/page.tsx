'use client'

import { useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import type { HrExpenseClaim } from '@/types'
import HrNav from '@/components/hr/HrNav'
import ClaimDetail from '@/components/hr/admin/ClaimDetail'
import ClaimFinancePanel from '@/components/hr/admin/ClaimFinancePanel'
import { PageHeader } from '@/components/hr/admin/adminUi'
import { secondaryBtnStyle } from '@/components/shared/ui'
import { useRecordId } from '@/lib/recordRef'
import InvalidRecordLink from '@/components/erp/InvalidRecordLink'

export default function HrClaimDetailPage() {
  const { isAuthorized, isLoading } = useRequireApp('hr')
  const router = useRouter()
  const params = useParams<{ id: string }>()
  const { id: claimIdResolved, error: linkError } = useRecordId(params?.id)
  const claimId = claimIdResolved ?? 0
  const [claim, setClaim] = useState<HrExpenseClaim | null>(null)

  if (isLoading || !isAuthorized) return null
  if (linkError) return (<div><HrNav /><InvalidRecordLink message={linkError} listHref="/dashboard/hr/travel?tab=claims" listLabel="Back to claims" /></div>)
  if (!claimId) return <div><HrNav /></div>

  return (
    <div>
      <HrNav />

      <PageHeader
        title={claim ? `${claim.claim_no} — ${claim.title}` : 'Expense claim'}
        subtitle={claim ? `Claimed by ${claim.user_name || 'employee'}${claim.user_department ? ` · ${claim.user_department}` : ''}` : undefined}
        actions={<button onClick={() => router.push('/dashboard/hr/travel?tab=claims')} type="button" style={secondaryBtnStyle}>← Back</button>}
      />

      <ClaimDetail claimId={claimId} onChanged={setClaim} />
      <ClaimFinancePanel claimId={claimId} claimStatus={claim?.status} />
    </div>
  )
}
