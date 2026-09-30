'use client'

import { useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useAuth } from '@/hooks/useAuth'
import type { HrExpenseClaim } from '@/types'
import HrNav from '@/components/hr/HrNav'
import MyHrTabs from '@/components/hr/MyHrTabs'
import ClaimDetail from '@/components/hr/admin/ClaimDetail'
import { PageHeader } from '@/components/hr/admin/adminUi'
import { secondaryBtnStyle } from '@/components/shared/ui'

export default function MyClaimDetailPage() {
  // Self-service: any logged-in user (the backend only returns the claim to
  // its owner, its approver or HR).
  const { user, isLoading } = useAuth()
  const router = useRouter()
  const params = useParams<{ id: string }>()
  const claimId = Number(params?.id)
  const [claim, setClaim] = useState<HrExpenseClaim | null>(null)

  if (isLoading || !user) return null

  return (
    <div>
      <HrNav />
      <MyHrTabs />

      <PageHeader
        title={claim ? `${claim.claim_no} — ${claim.title}` : 'Expense claim'}
        subtitle={claim?.can_edit ? 'Add every expense as a line, attach receipts, then submit for approval.' : undefined}
        actions={<button onClick={() => router.push('/dashboard/hr/me/claims')} type="button" style={secondaryBtnStyle}>← Back</button>}
      />

      <ClaimDetail claimId={claimId} onChanged={setClaim} />
    </div>
  )
}
