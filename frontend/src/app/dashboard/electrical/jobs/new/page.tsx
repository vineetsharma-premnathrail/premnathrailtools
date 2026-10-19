'use client'

import { useRouter } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { electricalApi } from '@/lib/api'
import { recordPath } from '@/lib/recordRef'
import ElectricalNav from '@/components/electrical/ElectricalNav'
import JobForm from '@/components/electrical/JobForm'

export default function NewElectricalJobPage() {
  const { isAuthorized, isLoading } = useRequireApp('electrical')
  const router = useRouter()

  if (isLoading || !isAuthorized) return null

  return (
    <JobForm
      nav={<ElectricalNav />}
      title="New RRV Electrical Job"
      subtitle="The job is created with all 20 scope stages — from Electrical Requirement to As-Built Records — ready to plan."
      onBack={() => router.push('/dashboard/electrical/jobs')}
      submitLabel="Create Job"
      onCancel={() => router.push('/dashboard/electrical/jobs')}
      onSubmit={async (payload) => {
        const job = await electricalApi.createJob(payload)
        router.push(recordPath('/dashboard/electrical/jobs', job))
      }}
    />
  )
}
