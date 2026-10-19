'use client'

import { useParams } from 'next/navigation'
import { useProtectedPage } from '@/hooks/useAuth'
import MilestoneWorkspace from '@/components/projects/work/MilestoneWorkspace'
import { PmPageHeader, PmPageNav } from '@/components/projects/work/pmOrigin'
import { useRecordId } from '@/lib/recordRef'
import InvalidRecordLink from '@/components/erp/InvalidRecordLink'

// Open to management, the milestone lead and department heads, assistants
// (their own view) and anyone tagged in its chat — the backend decides
// access per milestone, so no Projects-app gate here. Opened from a module's
// Ongoing Projects tab it keeps that module's nav (see pmOrigin).
export default function MilestonePage() {
  const { isAuthorized, isLoading } = useProtectedPage()
  const params = useParams()
  const { id: milestoneId, error: linkError } = useRecordId(params.id as string)

  if (isLoading || !isAuthorized) return null
  if (linkError) return (<div><PmPageNav /><InvalidRecordLink message={linkError} listHref="/dashboard/projects/my-tasks" listLabel="Back to my tasks" /></div>)
  if (!milestoneId) return <div><PmPageNav /></div>

  return (
    <div>
      <PmPageHeader page="WBS" tourBack="pm-mw-back" />
      <MilestoneWorkspace milestoneId={milestoneId} />
    </div>
  )
}
