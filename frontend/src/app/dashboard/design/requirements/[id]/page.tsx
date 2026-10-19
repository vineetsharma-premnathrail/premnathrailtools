'use client'

import { useParams } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import DesignNav from '@/components/design/DesignNav'
import DeptRequirementDetail from '@/components/rnd/DeptRequirementDetail'
import InvalidRecordLink from '@/components/erp/InvalidRecordLink'
import { useRecordId } from '@/lib/recordRef'

export default function DesignRequirementDetailPage() {
  const { isAuthorized, isLoading } = useRequireApp('design')
  const params = useParams<{ id: string }>()
  const { id: shareId, error: linkError } = useRecordId(params.id)
  if (isLoading || !isAuthorized) return null
  if (linkError) return (<div><DesignNav /><InvalidRecordLink message={linkError} listHref="/dashboard/design/requirements" listLabel="Back to requirements" /></div>)
  if (!shareId) return <div><DesignNav /></div>
  return (
    <div>
      <DesignNav />
      <DeptRequirementDetail department="design" departmentLabel="Design" shareId={shareId} />
    </div>
  )
}
