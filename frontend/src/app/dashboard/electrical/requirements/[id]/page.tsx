'use client'

import { useParams } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import ElectricalNav from '@/components/electrical/ElectricalNav'
import DeptRequirementDetail from '@/components/rnd/DeptRequirementDetail'
import InvalidRecordLink from '@/components/erp/InvalidRecordLink'
import { useRecordId } from '@/lib/recordRef'

export default function ElectricalRequirementDetailPage() {
  const { isAuthorized, isLoading } = useRequireApp('electrical')
  const params = useParams<{ id: string }>()
  const { id: shareId, error: linkError } = useRecordId(params.id)
  if (isLoading || !isAuthorized) return null
  if (linkError) return (<div><ElectricalNav /><InvalidRecordLink message={linkError} listHref="/dashboard/electrical/requirements" listLabel="Back to requirements" /></div>)
  if (!shareId) return <div><ElectricalNav /></div>
  return (
    <div>
      <ElectricalNav />
      <DeptRequirementDetail department="electrical" departmentLabel="Electrical" shareId={shareId} />
    </div>
  )
}
