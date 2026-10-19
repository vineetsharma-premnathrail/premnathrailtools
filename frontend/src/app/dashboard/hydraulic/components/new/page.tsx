'use client'

import { useRouter } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { hydraulicApi } from '@/lib/api'
import HydraulicNav from '@/components/hydraulic/HydraulicNav'
import { recordPath } from '@/lib/recordRef'
import ComponentForm from '@/components/hydraulic/ComponentForm'

export default function NewHydComponentPage() {
  const { isAuthorized, isLoading } = useRequireApp('hydraulic')
  const router = useRouter()

  if (isLoading || !isAuthorized) return null

  const back = () => router.push('/dashboard/hydraulic/components')
  return (
    <ComponentForm
      nav={<HydraulicNav />}
      title="New Component"
      subtitle="A pump, valve, cylinder or other part in the component master — BOMs and tests pick from it."
      onBack={back}
      onCancel={back}
      submitLabel="Create Component"
      onSubmit={async (payload) => {
        const comp = await hydraulicApi.createComponent(payload)
        router.push(recordPath('/dashboard/hydraulic/components', comp))
      }}
    />
  )
}
