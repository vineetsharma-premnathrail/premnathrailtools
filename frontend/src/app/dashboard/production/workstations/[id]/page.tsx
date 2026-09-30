'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { productionApi } from '@/lib/api'
import { ProductionWorkstation } from '@/types'
import { TEXT, DANGER } from '@/lib/theme'
import { secondaryBtnStyle } from '@/components/shared/ui'
import ProductionNav from '@/components/production/ProductionNav'
import WorkstationForm from '@/components/production/WorkstationForm'
import ConfirmDialog from '@/components/erp/ConfirmDialog'
import { extractErrorMessages } from '@/lib/validation'

export default function WorkstationDetailPage() {
  const { isAuthorized, isLoading } = useRequireApp('production')
  const router = useRouter()
  const params = useParams()
  const wsId = Number(params.id)

  const [ws, setWs] = useState<ProductionWorkstation | null>(null)
  const [error, setError] = useState<string | string[]>('')
  const [saved, setSaved] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  useEffect(() => {
    if (!isAuthorized || !wsId) return
    productionApi.getWorkstation(wsId)
      .then(setWs)
      .catch((err) => setError(extractErrorMessages(err, 'Failed to load workstation.')))
  }, [isAuthorized, wsId])

  const handleDelete = async () => {
    setConfirmDelete(false)
    try {
      await productionApi.deleteWorkstation(wsId)
      router.push('/dashboard/production/workstations')
    } catch (err) {
      setError(extractErrorMessages(err, 'Failed to delete workstation.'))
    }
  }

  if (isLoading || !isAuthorized) return null

  return (
    <div>
      <ProductionNav />

      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
        <div>
          <p style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 4px' }}>
            Production Module · Workstation
          </p>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: TEXT.heading, margin: '0 0 20px' }}>{ws ? `${ws.code} — ${ws.name}` : 'Workstation'}</h1>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {ws && (
            <button type="button" onClick={() => setConfirmDelete(true)} style={{ ...secondaryBtnStyle, color: DANGER.primary, borderColor: DANGER.border }}>Delete</button>
          )}
          <button onClick={() => router.push('/dashboard/production/workstations')} type="button" style={secondaryBtnStyle}>← Back</button>
        </div>
      </div>

      {error && (
        <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
          {Array.isArray(error) ? error.join(' ') : error}
        </div>
      )}
      {saved && (
        <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(22,163,74,0.08)', border: '1px solid rgba(22,163,74,0.2)', color: '#15803d', fontSize: 13 }}>
          Workstation saved.
        </div>
      )}

      {ws && (
        <>
          <p style={{ fontSize: 13, color: TEXT.secondary, margin: '0 0 14px' }}>
            {ws.open_operations > 0
              ? `${ws.open_operations} open operation(s) are queued here on released or in-progress work orders.`
              : 'No open operations are queued on this workstation right now.'}
          </p>
          <WorkstationForm
            key={ws.updated_at}
            initial={ws}
            submitLabel="Save Changes"
            onSubmit={async (payload) => {
              setSaved(false)
              const updated = await productionApi.updateWorkstation(wsId, payload)
              setWs(updated)
              setSaved(true)
            }}
          />
        </>
      )}

      <ConfirmDialog
        open={confirmDelete}
        title="Delete workstation?"
        message={`${ws?.code} will be removed from routing pickers. Completed work orders and time logs keep their history.`}
        onConfirm={handleDelete}
        onCancel={() => setConfirmDelete(false)}
      />
    </div>
  )
}
