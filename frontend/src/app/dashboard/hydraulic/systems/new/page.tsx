'use client'

import { Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { hydraulicApi } from '@/lib/api'
import HydraulicNav from '@/components/hydraulic/HydraulicNav'
import { recordPath } from '@/lib/recordRef'
import SystemForm from '@/components/hydraulic/SystemForm'

function NewHydSystemInner() {
  const { isAuthorized, isLoading } = useRequireApp('hydraulic')
  const router = useRouter()
  const searchParams = useSearchParams()
  const defaultType = searchParams.get('type') === 'pneumatic' ? 'pneumatic' : 'hydraulic'

  if (isLoading || !isAuthorized) return null

  const back = () => router.push('/dashboard/hydraulic/systems')
  return (
    <SystemForm
      nav={<HydraulicNav />}
      title="New System"
      subtitle="A hydraulic power pack or pneumatic unit — its circuits, BOMs and tests hang off it."
      onBack={back}
      onCancel={back}
      defaultSystemType={defaultType}
      submitLabel="Create System"
      onSubmit={async (payload) => {
        const system = await hydraulicApi.createSystem(payload)
        router.push(recordPath('/dashboard/hydraulic/systems', system))
      }}
    />
  )
}

export default function NewHydSystemPage() {
  return (
    <Suspense fallback={null}>
      <NewHydSystemInner />
    </Suspense>
  )
}
