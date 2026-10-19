'use client'

import { useParams } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import HydraulicNav from '@/components/hydraulic/HydraulicNav'
import DeptRequirementDetail from '@/components/rnd/DeptRequirementDetail'
import InvalidRecordLink from '@/components/erp/InvalidRecordLink'
import { useRecordId } from '@/lib/recordRef'

export default function HydraulicRequirementDetailPage() {
  const { isAuthorized, isLoading } = useRequireApp('hydraulic')
  const params = useParams<{ id: string }>()
  const { id: shareId, error: linkError } = useRecordId(params.id)
  if (isLoading || !isAuthorized) return null
  if (linkError) return (<div><HydraulicNav /><InvalidRecordLink message={linkError} listHref="/dashboard/hydraulic/requirements" listLabel="Back to requirements" /></div>)
  if (!shareId) return <div><HydraulicNav /></div>
  return (
    <div>
      <HydraulicNav />
      <DeptRequirementDetail department="hydraulic" departmentLabel="Hydraulic & Pneumatic" shareId={shareId} />
    </div>
  )
}
