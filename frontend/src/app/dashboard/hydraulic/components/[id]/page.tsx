'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { hydraulicApi } from '@/lib/api'
import { HydComponent, HydSparePart } from '@/types'
import { TEXT, DANGER, GLASS, SHADOWS, BORDER } from '@/lib/theme'
import { secondaryBtnStyle } from '@/components/shared/ui'
import HydraulicNav from '@/components/hydraulic/HydraulicNav'
import ComponentForm from '@/components/hydraulic/ComponentForm'
import HydDocumentsPanel from '@/components/hydraulic/HydDocumentsPanel'
import ConfirmDialog from '@/components/erp/ConfirmDialog'
import { extractErrorMessages } from '@/lib/validation'

const cardStyle: React.CSSProperties = {
  borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur,
  border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), padding: 20, marginBottom: 20,
}

export default function HydComponentDetailPage() {
  const { isAuthorized, isLoading, user } = useRequireApp('hydraulic')
  const router = useRouter()
  const params = useParams()
  const compId = Number(params.id)

  const [comp, setComp] = useState<HydComponent | null>(null)
  const [spares, setSpares] = useState<HydSparePart[]>([])
  const [error, setError] = useState<string | string[]>('')
  const [saved, setSaved] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  useEffect(() => {
    if (!isAuthorized || !compId) return
    hydraulicApi.getComponent(compId)
      .then(setComp)
      .catch((err) => setError(extractErrorMessages(err, 'Failed to load component.')))
    hydraulicApi.listSpares({ component_id: compId })
      .then((data) => setSpares(Array.isArray(data) ? data : []))
      .catch(() => { /* spares tab may be restricted; the component itself still loads */ })
  }, [isAuthorized, compId])

  const handleDelete = async () => {
    setConfirmDelete(false)
    try {
      await hydraulicApi.deleteComponent(compId)
      router.push('/dashboard/hydraulic/components')
    } catch (err) {
      setError(extractErrorMessages(err, 'Failed to delete component.'))
    }
  }

  if (isLoading || !isAuthorized) return null

  return (
    <div>
      <HydraulicNav />

      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
        <div>
          <p style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 4px' }}>
            Hydraulic &amp; Pneumatic · Component
          </p>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: TEXT.heading, margin: '0 0 20px' }}>{comp ? `${comp.code} — ${comp.name}` : 'Component'}</h1>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {comp && (
            <button type="button" onClick={() => setConfirmDelete(true)} style={{ ...secondaryBtnStyle, color: DANGER.primary, borderColor: DANGER.border }}>Delete</button>
          )}
          <button onClick={() => router.push('/dashboard/hydraulic/components')} type="button" style={secondaryBtnStyle}>← Back</button>
        </div>
      </div>

      {error && (
        <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
          {Array.isArray(error) ? error.join(' ') : error}
        </div>
      )}
      {saved && (
        <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(22,163,74,0.08)', border: '1px solid rgba(22,163,74,0.2)', color: '#15803d', fontSize: 13 }}>
          Component saved.
        </div>
      )}

      {comp && (
        <>
          <p style={{ fontSize: 13, color: TEXT.secondary, margin: '0 0 14px' }}>
            {comp.bom_usage_count ? `Used on ${comp.bom_usage_count} BOM(s).` : 'Not on any BOM yet.'}
            {comp.store_item_code ? ` Stocked in Store as ${comp.store_item_code}.` : ''}
            {comp.datasheet_url && <> · <a href={comp.datasheet_url} target="_blank" rel="noreferrer" style={{ color: '#FF6A2A', fontWeight: 600 }}>Open datasheet ↗</a></>}
          </p>
          <ComponentForm
            key={comp.updated_at}
            initial={comp}
            submitLabel="Save Changes"
            onSubmit={async (payload) => {
              setSaved(false)
              const updated = await hydraulicApi.updateComponent(compId, payload)
              setComp(updated)
              setSaved(true)
            }}
          />

          <div style={{ ...cardStyle, marginTop: 20 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 10 }}>
              <h2 style={{ fontSize: 15, fontWeight: 700, color: TEXT.heading, margin: 0 }}>Spare Parts ({spares.length})</h2>
              <span onClick={() => router.push(`/dashboard/hydraulic/spares/new?component_id=${compId}`)} style={{ fontSize: 12.5, fontWeight: 600, color: '#FF6A2A', cursor: 'pointer' }}>+ Add spare</span>
            </div>
            {spares.length === 0 ? (
              <p style={{ fontSize: 13, color: TEXT.muted, margin: 0 }}>No spares recorded for this component — add its seal kit, filter element or cartridge so service jobs can draw on them.</p>
            ) : spares.map((s) => (
              <div key={s.id} onClick={() => router.push(`/dashboard/hydraulic/spares/${s.id}`)}
                style={{ display: 'flex', gap: 12, padding: '9px 0', borderTop: `1px solid ${BORDER.light}`, cursor: 'pointer', flexWrap: 'wrap', fontSize: 13 }}>
                <span style={{ fontWeight: 600, color: TEXT.heading, minWidth: 100 }}>{s.part_code}</span>
                <span style={{ flex: '1 1 200px', color: TEXT.body }}>{s.name}</span>
                <span style={{ color: TEXT.muted }}>{s.available_qty != null ? `${s.available_qty} ${s.uom} available` : 'Not linked to Store'}</span>
              </div>
            ))}
          </div>

          <HydDocumentsPanel entityType="component" entityId={comp.id} title="Datasheets & Drawings" defaultDocType="datasheet"
            currentUserId={user?.id} isAdmin={user?.role === 'admin'} />
        </>
      )}

      <ConfirmDialog
        open={confirmDelete}
        title="Delete component?"
        message={`${comp?.code} will be removed from the component master and pickers. Released BOMs and past tests keep their history.`}
        onConfirm={handleDelete}
        onCancel={() => setConfirmDelete(false)}
      />
    </div>
  )
}
