'use client'

import { Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { hydraulicApi } from '@/lib/api'
import HydraulicNav from '@/components/hydraulic/HydraulicNav'
import InvalidRecordLink from '@/components/erp/InvalidRecordLink'
import { recordPath, useRecordId } from '@/lib/recordRef'
import RetiredBanner from '@/components/hydraulic/RetiredBanner'
import SparePartForm from '@/components/hydraulic/SparePartForm'

function NewSpareInner() {
  const { isAuthorized, isLoading } = useRequireApp('hydraulic')
  const router = useRouter()
  const searchParams = useSearchParams()
  const componentRef = searchParams.get('component_id')
  const { id: presetComponentId, error: linkError, loading: linkLoading } = useRecordId(componentRef)
  const componentId = presetComponentId ? String(presetComponentId) : ''

  if (isLoading || !isAuthorized) return null
  if (linkError) return (<div><HydraulicNav /><InvalidRecordLink message={linkError} listHref="/dashboard/hydraulic/spares" listLabel="Back to spare parts" /></div>)
  if (linkLoading) return <div><HydraulicNav /></div>

  const back = () => router.push(componentRef ? `/dashboard/hydraulic/components/${componentRef}` : '/dashboard/hydraulic/spares')
  return (
    <SparePartForm
      nav={<><HydraulicNav /><RetiredBanner what="Hydraulic spare parts" /></>}
      title="New Spare Part"
      subtitle="Retired — the server refuses new spare parts (410); kept for reference only."
      onBack={back}
      onCancel={back}
      defaultComponentId={componentId}
      submitLabel="Create Spare"
      onSubmit={async (payload) => {
        const spare = await hydraulicApi.createSpare(payload)
        router.push(recordPath('/dashboard/hydraulic/spares', spare))
      }}
    />
  )
}

export default function NewHydSparePartPage() {
  return (
    <Suspense fallback={null}>
      <NewSpareInner />
    </Suspense>
  )
}
