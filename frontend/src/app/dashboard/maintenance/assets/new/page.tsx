'use client'

import { useRouter } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { maintenanceApi } from '@/lib/api'
import { TEXT } from '@/lib/theme'
import { secondaryBtnStyle } from '@/components/shared/ui'
import MaintenanceNav from '@/components/maintenance/MaintenanceNav'
import AssetForm from '@/components/maintenance/AssetForm'

export default function NewMaintenanceAssetPage() {
  const { isAuthorized, isLoading } = useRequireApp('maintenance')
  const router = useRouter()

  if (isLoading || !isAuthorized) return null

  return (
    <div>
      <MaintenanceNav />

      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
        <div>
          <p style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 4px' }}>
            Maintenance Module
          </p>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: TEXT.heading, margin: '0 0 20px' }}>New Asset</h1>
        </div>
        <button onClick={() => router.push('/dashboard/maintenance/assets')} type="button" style={secondaryBtnStyle}>← Back</button>
      </div>

      <AssetForm
        submitLabel="Create Asset"
        onSubmit={async (payload) => {
          const asset = await maintenanceApi.createAsset(payload)
          router.push(`/dashboard/maintenance/assets/${asset.id}`)
        }}
      />
    </div>
  )
}
