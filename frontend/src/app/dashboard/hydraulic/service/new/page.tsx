'use client'

import { Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { hydraulicApi } from '@/lib/api'
import HydraulicNav from '@/components/hydraulic/HydraulicNav'
import InvalidRecordLink from '@/components/erp/InvalidRecordLink'
import { recordPath, useRecordId } from '@/lib/recordRef'
import RetiredBanner from '@/components/hydraulic/RetiredBanner'
import ServiceRecordForm from '@/components/hydraulic/ServiceRecordForm'
import { SERVICE_TYPE_LABELS } from '@/components/hydraulic/labels'

function NewServiceRecordInner() {
  const { isAuthorized, isLoading } = useRequireApp('hydraulic')
  const router = useRouter()
  const searchParams = useSearchParams()
  const planRef = searchParams.get('plan_id')
  const sys = useRecordId(searchParams.get('system_id'))
  const plan = useRecordId(planRef)
  const linkError = sys.error || plan.error
  const linkLoading = sys.loading || plan.loading
  const systemId = sys.id ? String(sys.id) : ''
  const planId = plan.id ? String(plan.id) : ''
  const type = searchParams.get('type') || ''

  if (isLoading || !isAuthorized) return null
  if (linkError) return (<div><HydraulicNav /><InvalidRecordLink message={linkError} listHref="/dashboard/hydraulic/service" listLabel="Back to service jobs" /></div>)
  if (linkLoading) return <div><HydraulicNav /></div>

  const back = () => router.push(planRef ? `/dashboard/hydraulic/maintenance/${planRef}` : '/dashboard/hydraulic/service')
  return (
    <ServiceRecordForm
      nav={<><HydraulicNav /><RetiredBanner what="Hydraulic service records" /></>}
      title="New Service Job"
      subtitle="Retired — the server refuses new service jobs (410); kept for reference only."
      onBack={back}
      onCancel={back}
      defaults={{ systemId, planId, serviceType: SERVICE_TYPE_LABELS[type] ? type : undefined }}
      submitLabel="Create Service Job"
      onSubmit={async (payload) => {
        const rec = await hydraulicApi.createServiceRecord(payload)
        router.push(recordPath('/dashboard/hydraulic/service', rec))
      }}
    />
  )
}

export default function NewHydServiceRecordPage() {
  return (
    <Suspense fallback={null}>
      <NewServiceRecordInner />
    </Suspense>
  )
}
