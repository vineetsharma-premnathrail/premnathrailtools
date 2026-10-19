'use client'

import { Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { hydraulicApi } from '@/lib/api'
import HydraulicNav from '@/components/hydraulic/HydraulicNav'
import InvalidRecordLink from '@/components/erp/InvalidRecordLink'
import { recordPath, useRecordId } from '@/lib/recordRef'
import HydBomForm from '@/components/hydraulic/HydBomForm'

function NewHydBomPageInner() {
  const { isAuthorized, isLoading } = useRequireApp('hydraulic')
  const router = useRouter()
  const searchParams = useSearchParams()
  const systemRef = searchParams.get('system_id')
  const { id: presetSystemId, error: linkError, loading: linkLoading } = useRecordId(systemRef)
  const systemId = presetSystemId ? String(presetSystemId) : ''

  if (isLoading || !isAuthorized) return null
  if (linkError) return (<div><HydraulicNav /><InvalidRecordLink message={linkError} listHref="/dashboard/hydraulic/bom" listLabel="Back to BOMs" /></div>)
  if (linkLoading) return <div><HydraulicNav /></div>

  const back = () => router.push(systemRef ? `/dashboard/hydraulic/systems/${systemRef}` : '/dashboard/hydraulic/bom')
  return (
    <HydBomForm
      nav={<HydraulicNav />}
      title="New BOM"
      subtitle="Bill of material for a system or circuit — tag each line with the circuit symbol (P1, V3…)."
      onBack={back}
      onCancel={back}
      defaultSystemId={systemId}
      submitLabel="Create BOM"
      onSubmit={async (payload) => {
        const bom = await hydraulicApi.createBom(payload)
        router.push(recordPath('/dashboard/hydraulic/bom', bom))
      }}
    />
  )
}

// useSearchParams needs a Suspense boundary for the static build.
export default function NewHydBomPage() {
  return (
    <Suspense fallback={null}>
      <NewHydBomPageInner />
    </Suspense>
  )
}
