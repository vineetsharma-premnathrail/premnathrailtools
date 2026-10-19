'use client'

import { useRouter } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { productionApi } from '@/lib/api'
import ProductionNav from '@/components/production/ProductionNav'
import BomForm from '@/components/production/BomForm'
import { recordPath } from '@/lib/recordRef'

export default function NewBomPage() {
  const { isAuthorized, isLoading } = useRequireApp('production')
  const router = useRouter()

  if (isLoading || !isAuthorized) return null

  return (
    <BomForm
      title="New BOM"
      subtitle="Components and routing for one finished / semi-finished Store item. It saves as a draft until activated."
      nav={<ProductionNav />}
      onBack={() => router.push('/dashboard/production/bom')}
      backTour="production-bom-form-back-btn"
      submitLabel="Save Draft BOM"
      onSubmit={async (payload) => {
        const bom = await productionApi.createBom(payload)
        router.push(recordPath('/dashboard/production/bom', bom))
      }}
    />
  )
}
