'use client'

import { useRouter } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { electricalApi } from '@/lib/api'
import { TEXT } from '@/lib/theme'
import { secondaryBtnStyle } from '@/components/shared/ui'
import ElectricalNav from '@/components/electrical/ElectricalNav'
import JobForm from '@/components/electrical/JobForm'

export default function NewElectricalJobPage() {
  const { isAuthorized, isLoading } = useRequireApp('electrical')
  const router = useRouter()

  if (isLoading || !isAuthorized) return null

  return (
    <div>
      <ElectricalNav />

      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, marginBottom: 20, flexWrap: 'wrap' }}>
        <div>
          <p style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 4px' }}>
            Electrical Module
          </p>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: TEXT.heading, margin: 0 }}>New RRV Electrical Job</h1>
          <p style={{ fontSize: 13, color: TEXT.muted, margin: '6px 0 0' }}>
            The job is created with all 20 scope stages — from Electrical Requirement to As-Built Records — ready to plan.
          </p>
        </div>
        <button onClick={() => router.push('/dashboard/electrical/jobs')} type="button" style={secondaryBtnStyle}>← Back</button>
      </div>

      <JobForm
        submitLabel="Create Job"
        onCancel={() => router.push('/dashboard/electrical/jobs')}
        onSubmit={async (payload) => {
          const job = await electricalApi.createJob(payload)
          router.push(`/dashboard/electrical/jobs/${job.id}`)
        }}
      />
    </div>
  )
}
