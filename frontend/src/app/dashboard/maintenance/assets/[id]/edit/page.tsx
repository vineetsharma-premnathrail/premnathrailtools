'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { maintenanceApi } from '@/lib/api'
import { MaintenanceAsset } from '@/types'
import { TEXT } from '@/lib/theme'
import { secondaryBtnStyle } from '@/components/shared/ui'
import MaintenanceNav from '@/components/maintenance/MaintenanceNav'
import AssetForm from '@/components/maintenance/AssetForm'
import { extractErrorMessages } from '@/lib/validation'

export default function EditMaintenanceAssetPage() {
  const { isAuthorized, isLoading } = useRequireApp('maintenance')
  const router = useRouter()
  const params = useParams()
  const id = Number(params.id)
  const [asset, setAsset] = useState<MaintenanceAsset | null>(null)
  const [error, setError] = useState<string | string[]>('')

  useEffect(() => {
    if (!isAuthorized || !id) return
    maintenanceApi.getAsset(id).then(setAsset).catch((err) => setError(extractErrorMessages(err, 'Failed to load asset.')))
  }, [isAuthorized, id])

  if (isLoading || !isAuthorized) return null

  return (
    <div>
      <MaintenanceNav />

      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
        <div>
          <p style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 4px' }}>
            Maintenance Module
          </p>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: TEXT.heading, margin: '0 0 20px' }}>
            Edit {asset ? asset.asset_code : 'Asset'}
          </h1>
        </div>
        <button onClick={() => router.push(`/dashboard/maintenance/assets/${id}`)} type="button" style={secondaryBtnStyle}>← Back</button>
      </div>

      {error && (
        <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
          {Array.isArray(error) ? error.join(' ') : error}
        </div>
      )}

      {asset && (
        <AssetForm
          initial={asset}
          submitLabel="Save Changes"
          onSubmit={async (payload) => {
            await maintenanceApi.updateAsset(id, payload)
            router.push(`/dashboard/maintenance/assets/${id}`)
          }}
        />
      )}
    </div>
  )
}
