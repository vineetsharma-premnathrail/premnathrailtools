'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { productionApi } from '@/lib/api'
import { ProductionWorkstation } from '@/types'
import { TEXT, DANGER, GLASS, SHADOWS } from '@/lib/theme'
import { secondaryBtnStyle, InfoRow } from '@/components/shared/ui'
import ProductionNav from '@/components/production/ProductionNav'
import WorkstationForm, { WORKSTATION_TYPE_LABELS } from '@/components/production/WorkstationForm'
import ConfirmDialog from '@/components/erp/ConfirmDialog'
import { extractErrorMessages } from '@/lib/validation'
import { useCan } from '@/lib/permissions'
import { useRecordId } from '@/lib/recordRef'
import InvalidRecordLink from '@/components/erp/InvalidRecordLink'

const STATUS_LABELS: Record<string, string> = { active: 'Active', under_maintenance: 'Under Maintenance', inactive: 'Inactive' }

export default function WorkstationDetailPage() {
  const { isAuthorized, isLoading } = useRequireApp('production')
  const { can, canDelete } = useCan()
  const router = useRouter()
  const params = useParams()
  const { id: wsIdResolved, error: linkError } = useRecordId(params.id as string)
  const wsId = wsIdResolved ?? 0

  const [ws, setWs] = useState<ProductionWorkstation | null>(null)
  const [error, setError] = useState<string | string[]>('')
  const [saved, setSaved] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [editing, setEditing] = useState(false)

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
  if (linkError) return (<div><ProductionNav /><InvalidRecordLink message={linkError} listHref="/dashboard/production/workstations" listLabel="Back to workstations" /></div>)
  if (!wsId) return <div><ProductionNav /></div>

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
          {ws && can('production', 'workstations', 'edit') && (
            <button data-tour="production-ws-edit-btn" type="button" onClick={() => { setSaved(false); setEditing(true) }} style={secondaryBtnStyle}>Edit</button>
          )}
          {ws && canDelete('production', 'workstations', null) && (
            <button data-tour="production-ws-delete-btn" type="button" onClick={() => setConfirmDelete(true)} style={{ ...secondaryBtnStyle, color: DANGER.primary, borderColor: DANGER.border }}>Delete</button>
          )}
          <button data-tour="production-ws-form-back-btn" onClick={() => router.push('/dashboard/production/workstations')} type="button" style={secondaryBtnStyle}>← Back</button>
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
          <p data-tour="production-ws-open-ops" style={{ fontSize: 13, color: TEXT.secondary, margin: '0 0 14px' }}>
            {ws.open_operations > 0
              ? `${ws.open_operations} open operation(s) are queued here on released or in-progress work orders.`
              : 'No open operations are queued on this workstation right now.'}
          </p>
          <div data-tour="production-ws-summary" style={{
            borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur,
            border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), padding: 20, marginBottom: 20,
          }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 14 }}>
              <InfoRow label="Code" value={ws.code} />
              <InfoRow label="Name" value={ws.name} />
              <InfoRow label="Type" value={WORKSTATION_TYPE_LABELS[ws.workstation_type] || ws.workstation_type} />
              <InfoRow label="Status" value={STATUS_LABELS[ws.status] || ws.status} />
              <InfoRow label="Plant" value={ws.branch_name || '—'} />
              <InfoRow label="Department" value={ws.department_name || '—'} />
              <InfoRow label="Capacity / day" value={`${ws.capacity_hours_per_day} h`} />
              <InfoRow label="Hourly Rate" value={`₹${ws.hourly_rate.toLocaleString('en-IN')}`} />
            </div>
            {ws.description && <div style={{ marginTop: 14 }}><InfoRow label="Description" value={ws.description} /></div>}
          </div>
        </>
      )}

      {ws && editing && (
        <WorkstationForm
          key={ws.updated_at}
          initial={ws}
          submitLabel="Save Changes"
          onCancel={() => setEditing(false)}
          onSubmit={async (payload) => {
            setSaved(false)
            const updated = await productionApi.updateWorkstation(wsId, payload)
            setWs(updated)
            setEditing(false)
            setSaved(true)
          }}
        />
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
