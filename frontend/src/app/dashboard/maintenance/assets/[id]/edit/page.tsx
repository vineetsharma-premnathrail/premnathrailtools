'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { maintenanceApi } from '@/lib/api'
import { MaintenanceAsset } from '@/types'
import MaintenanceNav from '@/components/maintenance/MaintenanceNav'
import InvalidRecordLink from '@/components/erp/InvalidRecordLink'
import { useRecordId } from '@/lib/recordRef'
import AssetForm from '@/components/maintenance/AssetForm'
import { extractErrorMessages } from '@/lib/validation'

export default function EditMaintenanceAssetPage() {
  const { isAuthorized, isLoading } = useRequireApp('maintenance')
  const router = useRouter()
  const params = useParams()
  const ref = params.id as string
  const { id: resolvedId, error: linkError } = useRecordId(ref)
  const id = resolvedId ?? 0
  const [asset, setAsset] = useState<MaintenanceAsset | null>(null)
  const [error, setError] = useState<string | string[]>('')

  useEffect(() => {
    if (!isAuthorized || !id) return
    maintenanceApi.getAsset(id).then(setAsset).catch((err) => setError(extractErrorMessages(err, 'Failed to load asset.')))
  }, [isAuthorized, id])

  if (isLoading || !isAuthorized) return null
  if (linkError) return (<div><MaintenanceNav /><InvalidRecordLink message={linkError} listHref="/dashboard/maintenance/assets" listLabel="Back to assets" /></div>)
  if (!id) return <div><MaintenanceNav /></div>

  if (!asset) {
    return (
      <div>
        <MaintenanceNav />
        {error && (
          <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
            {Array.isArray(error) ? error.join(' ') : error}
          </div>
        )}
      </div>
    )
  }

  return (
    <AssetForm
      nav={<MaintenanceNav />}
      title={`Edit ${asset.asset_code}`}
      subtitle={asset.name}
      onBack={() => router.push(`/dashboard/maintenance/assets/${ref}`)}
      initial={asset}
      submitLabel="Save Changes"
      onSubmit={async (payload) => {
        await maintenanceApi.updateAsset(id, payload)
        router.push(`/dashboard/maintenance/assets/${ref}`)
      }}
    />
  )
}
