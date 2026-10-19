'use client'

import { useRouter } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { maintenanceApi } from '@/lib/api'
import MaintenanceNav from '@/components/maintenance/MaintenanceNav'
import { recordPath } from '@/lib/recordRef'
import AssetForm from '@/components/maintenance/AssetForm'

export default function NewMaintenanceAssetPage() {
  const { isAuthorized, isLoading } = useRequireApp('maintenance')
  const router = useRouter()

  if (isLoading || !isAuthorized) return null

  return (
    <AssetForm
      nav={<MaintenanceNav />}
      title="New Asset"
      subtitle="Register a machine or utility — it gets a QR label, PM plans, spares and a breakdown history."
      onBack={() => router.push('/dashboard/maintenance/assets')}
      submitLabel="Create Asset"
      onSubmit={async (payload) => {
        const asset = await maintenanceApi.createAsset(payload)
        router.push(recordPath('/dashboard/maintenance/assets', asset))
      }}
    />
  )
}
