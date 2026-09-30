'use client'

import { Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { hydraulicApi } from '@/lib/api'
import { TEXT } from '@/lib/theme'
import { secondaryBtnStyle } from '@/components/shared/ui'
import HydraulicNav from '@/components/hydraulic/HydraulicNav'
import MaintenancePlanForm from '@/components/hydraulic/MaintenancePlanForm'

function NewPlanInner() {
  const { isAuthorized, isLoading } = useRequireApp('hydraulic')
  const router = useRouter()
  const searchParams = useSearchParams()
  const systemId = searchParams.get('system_id') || ''

  if (isLoading || !isAuthorized) return null

  return (
    <div>
      <HydraulicNav />

      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
        <div>
          <p style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 4px' }}>
            Hydraulic &amp; Pneumatic
          </p>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: TEXT.heading, margin: '0 0 20px' }}>New Maintenance Plan</h1>
        </div>
        <button onClick={() => router.push('/dashboard/hydraulic/maintenance')} type="button" style={secondaryBtnStyle}>← Back</button>
      </div>

      <MaintenancePlanForm
        defaultSystemId={/^\d+$/.test(systemId) ? systemId : ''}
        submitLabel="Create Plan"
        onSubmit={async (payload) => {
          const plan = await hydraulicApi.createPlan(payload)
          router.push(`/dashboard/hydraulic/maintenance/${plan.id}`)
        }}
      />
    </div>
  )
}

export default function NewHydMaintenancePlanPage() {
  return (
    <Suspense fallback={null}>
      <NewPlanInner />
    </Suspense>
  )
}
