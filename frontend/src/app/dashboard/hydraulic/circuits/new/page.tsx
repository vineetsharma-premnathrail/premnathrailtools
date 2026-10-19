'use client'

import { Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { hydraulicApi } from '@/lib/api'
import HydraulicNav from '@/components/hydraulic/HydraulicNav'
import InvalidRecordLink from '@/components/erp/InvalidRecordLink'
import { recordPath, useRecordId } from '@/lib/recordRef'
import CircuitForm from '@/components/hydraulic/CircuitForm'

function NewHydCircuitPageInner() {
  const { isAuthorized, isLoading } = useRequireApp('hydraulic')
  const router = useRouter()
  const searchParams = useSearchParams()
  const systemRef = searchParams.get('system_id')
  const { id: presetSystemId, error: linkError, loading: linkLoading } = useRecordId(systemRef)
  const systemId = presetSystemId ? String(presetSystemId) : ''

  if (isLoading || !isAuthorized) return null
  if (linkError) return (<div><HydraulicNav /><InvalidRecordLink message={linkError} listHref="/dashboard/hydraulic/circuits" listLabel="Back to circuits" /></div>)
  if (linkLoading) return <div><HydraulicNav /></div>

  const back = () => router.push(systemRef ? `/dashboard/hydraulic/systems/${systemRef}` : '/dashboard/hydraulic/circuits')
  return (
    <CircuitForm
      nav={<HydraulicNav />}
      title="New Circuit"
      subtitle="Created as Rev A (draft). Upload the schematic on the next page, then submit it for review."
      onBack={back}
      onCancel={back}
      defaultSystemId={systemId}
      submitLabel="Create Circuit"
      onSubmit={async (payload) => {
        const circuit = await hydraulicApi.createCircuit(payload)
        router.push(recordPath('/dashboard/hydraulic/circuits', circuit))
      }}
    />
  )
}

// useSearchParams needs a Suspense boundary for the static build.
export default function NewHydCircuitPage() {
  return (
    <Suspense fallback={null}>
      <NewHydCircuitPageInner />
    </Suspense>
  )
}
