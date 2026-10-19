'use client'

import { Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { hydraulicApi } from '@/lib/api'
import HydraulicNav from '@/components/hydraulic/HydraulicNav'
import InvalidRecordLink from '@/components/erp/InvalidRecordLink'
import { recordPath, useRecordId } from '@/lib/recordRef'
import RetiredBanner from '@/components/hydraulic/RetiredBanner'
import MaintenancePlanForm from '@/components/hydraulic/MaintenancePlanForm'

function NewPlanInner() {
  const { isAuthorized, isLoading } = useRequireApp('hydraulic')
  const router = useRouter()
  const searchParams = useSearchParams()
  const systemRef = searchParams.get('system_id')
  const { id: presetSystemId, error: linkError, loading: linkLoading } = useRecordId(systemRef)
  const systemId = presetSystemId ? String(presetSystemId) : ''

  if (isLoading || !isAuthorized) return null
  if (linkError) return (<div><HydraulicNav /><InvalidRecordLink message={linkError} listHref="/dashboard/hydraulic/maintenance" listLabel="Back to maintenance plans" /></div>)
  if (linkLoading) return <div><HydraulicNav /></div>

  const back = () => router.push('/dashboard/hydraulic/maintenance')
  return (
    <MaintenancePlanForm
      nav={<><HydraulicNav /><RetiredBanner what="Maintenance plans" /></>}
      title="New Maintenance Plan"
      subtitle="Retired — the server refuses new plans (410); kept for reference only."
      onBack={back}
      onCancel={back}
      defaultSystemId={systemId}
      submitLabel="Create Plan"
      onSubmit={async (payload) => {
        const plan = await hydraulicApi.createPlan(payload)
        router.push(recordPath('/dashboard/hydraulic/maintenance', plan))
      }}
    />
  )
}

export default function NewHydMaintenancePlanPage() {
  return (
    <Suspense fallback={null}>
      <NewPlanInner />
    </Suspense>
  )
}
