'use client'

import { useParams } from 'next/navigation'
import { useProtectedPage } from '@/hooks/useAuth'
import TaskDetailView from '@/components/projects/work/TaskDetailView'
import { PmPageHeader, PmPageNav } from '@/components/projects/work/pmOrigin'
import { useRecordId } from '@/lib/recordRef'
import InvalidRecordLink from '@/components/erp/InvalidRecordLink'

// Open to the assignee, the department head and the PM — access is checked
// per task by the backend, so no Projects-app gate here. Opened from a
// module's Ongoing Projects tab it keeps that module's nav (see pmOrigin).
export default function TaskPage() {
  const { isAuthorized, isLoading } = useProtectedPage()
  const params = useParams()
  const { id: taskId, error: linkError } = useRecordId(params.id as string)

  if (isLoading || !isAuthorized) return null
  if (linkError) return (<div><PmPageNav /><InvalidRecordLink message={linkError} listHref="/dashboard/projects/my-tasks" listLabel="Back to my tasks" /></div>)
  if (!taskId) return <div><PmPageNav /></div>

  return (
    <div>
      <PmPageHeader page="Task" tourBack="pm-task-back" />
      <TaskDetailView taskId={taskId} />
    </div>
  )
}
