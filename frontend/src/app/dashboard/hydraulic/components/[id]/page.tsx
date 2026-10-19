'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { hydraulicApi } from '@/lib/api'
import { HydComponent } from '@/types'
import { TEXT, DANGER, GLASS, SHADOWS } from '@/lib/theme'
import { secondaryBtnStyle, InfoRow } from '@/components/shared/ui'
import { COMPONENT_CATEGORY_LABELS, MEDIA_TYPE_LABELS, CATEGORY_FIELDS, DEFAULT_CATEGORY_FIELDS, useHydCosts } from '@/components/hydraulic/labels'
import HydraulicNav from '@/components/hydraulic/HydraulicNav'
import InvalidRecordLink from '@/components/erp/InvalidRecordLink'
import { useRecordId } from '@/lib/recordRef'
import ComponentForm, { RATING_FIELDS } from '@/components/hydraulic/ComponentForm'

const cardStyle: React.CSSProperties = {
  borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur,
  border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), padding: 20,
}
import HydDocumentsPanel from '@/components/hydraulic/HydDocumentsPanel'
import ConfirmDialog from '@/components/erp/ConfirmDialog'
import { extractErrorMessages } from '@/lib/validation'
import { useCan } from '@/lib/permissions'

export default function HydComponentDetailPage() {
  const { isAuthorized, isLoading, user } = useRequireApp('hydraulic')
  const { can, canDelete } = useCan()
  const seeCosts = useHydCosts()  // Hydraulic › BOM › Prices & costs
  // Saving a component needs components:edit on the backend.
  const canEditComp = can('hydraulic', 'components', 'edit')
  const [editOpen, setEditOpen] = useState(false)
  const router = useRouter()
  const params = useParams()
  const ref = params.id as string
  const { id: resolvedId, error: linkError } = useRecordId(ref)
  const compId = resolvedId ?? 0

  const [comp, setComp] = useState<HydComponent | null>(null)
  const [error, setError] = useState<string | string[]>('')
  const [saved, setSaved] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  useEffect(() => {
    if (!isAuthorized || !compId) return
    hydraulicApi.getComponent(compId)
      .then(setComp)
      .catch((err) => setError(extractErrorMessages(err, 'Failed to load component.')))
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
  if (linkError) return (<div><HydraulicNav /><InvalidRecordLink message={linkError} listHref="/dashboard/hydraulic/components" listLabel="Back to components" /></div>)
  if (!resolvedId) return <div><HydraulicNav /></div>

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
          {comp && canDelete('hydraulic', 'components', (comp as { created_by_id?: number | null } | null)?.created_by_id ?? null) && (
            <button data-tour="hyd-compd-delete-btn" type="button" onClick={() => setConfirmDelete(true)} style={{ ...secondaryBtnStyle, color: DANGER.primary, borderColor: DANGER.border }}>Delete</button>
          )}
          <button data-tour="hyd-compd-back-btn" onClick={() => router.push('/dashboard/hydraulic/components')} type="button" style={secondaryBtnStyle}>← Back</button>
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
          <p data-tour="hyd-compd-summary" style={{ fontSize: 13, color: TEXT.secondary, margin: '0 0 14px' }}>
            {comp.bom_usage_count ? `Used on ${comp.bom_usage_count} BOM(s).` : 'Not on any BOM yet.'}
            {comp.store_item_code ? ` Stocked in Store as ${comp.store_item_code}.` : ''}
            {comp.datasheet_url && <> · <a href={comp.datasheet_url} target="_blank" rel="noreferrer" style={{ color: '#FF6A2A', fontWeight: 600 }}>Open datasheet ↗</a></>}
          </p>
          <div data-tour="hyd-compd-info" style={cardStyle}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
              <h2 style={{ fontSize: 15, fontWeight: 700, color: TEXT.heading, margin: 0 }}>Component Details</h2>
              {canEditComp && <button data-tour="hyd-compd-edit-btn" type="button" style={secondaryBtnStyle} onClick={() => { setSaved(false); setEditOpen(true) }}>Edit</button>}
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px 28px' }}>
              <InfoRow label="Category" value={COMPONENT_CATEGORY_LABELS[comp.category] || comp.category} />
              <InfoRow label="Medium" value={MEDIA_TYPE_LABELS[comp.system_type] || comp.system_type} />
              <InfoRow label="Status" value={comp.status === 'obsolete' ? 'Obsolete' : 'Active'} />
              <InfoRow label="Manufacturer" value={comp.manufacturer || '—'} />
              <InfoRow label="Model Number" value={comp.model_number || '—'} />
              <InfoRow label="Part / Order Number" value={comp.part_number || '—'} />
              <InfoRow label="Linked Store Item" value={comp.store_item_code ? `${comp.store_item_code}${comp.store_item_name ? ` — ${comp.store_item_name}` : ''}` : 'Not stocked in Store'} />
              {seeCosts && <InfoRow label="Unit Cost" value={`₹${(comp.unit_cost ?? 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`} />}
            </div>
            <p style={{ fontSize: 12, fontWeight: 600, color: TEXT.secondary, margin: '16px 0 8px' }}>Ratings</p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px 28px' }}>
              {(CATEGORY_FIELDS[comp.category] || DEFAULT_CATEGORY_FIELDS).map((k) => {
                const [label, unit] = RATING_FIELDS[k]
                const v = (comp as unknown as Record<string, unknown>)[k]
                return <InfoRow key={k} label={`${label}${unit ? ` (${unit})` : ''}`} value={v == null || v === '' ? '—' : String(v)} />
              })}
              <InfoRow label="Medium / Fluid" value={comp.media || '—'} />
              <InfoRow label="Temp (°C)" value={comp.temp_min_c != null || comp.temp_max_c != null ? `${comp.temp_min_c ?? '—'} to ${comp.temp_max_c ?? '—'}` : '—'} />
              <InfoRow label="Weight (kg)" value={comp.weight_kg != null ? String(comp.weight_kg) : '—'} />
            </div>
            {comp.specifications.length > 0 && (
              <>
                <p style={{ fontSize: 12, fontWeight: 600, color: TEXT.secondary, margin: '16px 0 8px' }}>Other Specifications</p>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px 28px' }}>
                  {comp.specifications.map((s, i) => <InfoRow key={`${s.label}-${i}`} label={s.label} value={s.value || '—'} />)}
                </div>
              </>
            )}
            {comp.description && (
              <>
                <p style={{ fontSize: 12, fontWeight: 600, color: TEXT.secondary, margin: '16px 0 4px' }}>Description</p>
                <p style={{ fontSize: 13, color: TEXT.body, margin: 0, whiteSpace: 'pre-wrap' }}>{comp.description}</p>
              </>
            )}
          </div>
          {editOpen && (
            <ComponentForm
              mode="sheet"
              title={`Edit ${comp.code}`}
              subtitle={comp.name}
              onCancel={() => setEditOpen(false)}
              initial={comp}
              submitLabel="Save Changes"
              onSubmit={async (payload) => {
                setSaved(false)
                const updated = await hydraulicApi.updateComponent(compId, payload)
                setComp(updated)
                setEditOpen(false)
                setSaved(true)
              }}
            />
          )}

          <div style={{ marginTop: 20 }} />
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
