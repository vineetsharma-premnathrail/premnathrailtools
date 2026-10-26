'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { hydraulicApi } from '@/lib/api'
import { HydComponent } from '@/types'
import { TEXT, DANGER } from '@/lib/theme'
import { secondaryBtnStyle, Pill, DetailCard, DetailSummary, DetailGroup, DetailRow } from '@/components/shared/ui'
import { COMPONENT_CATEGORY_LABELS, MEDIA_TYPE_LABELS, SYSTEM_TYPE_HEX, CATEGORY_FIELDS, DEFAULT_CATEGORY_FIELDS, useHydCosts } from '@/components/hydraulic/labels'
import HydraulicNav from '@/components/hydraulic/HydraulicNav'
import InvalidRecordLink from '@/components/erp/InvalidRecordLink'
import { useRecordId } from '@/lib/recordRef'
import ComponentForm, { RATING_FIELDS } from '@/components/hydraulic/ComponentForm'

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
          <h1 style={{ fontSize: 24, fontWeight: 700, color: TEXT.heading, margin: '0 0 20px' }}>{comp ? comp.code : 'Component'}</h1>
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
          <DetailCard tour="hyd-compd-info">
            <DetailSummary
              title={comp.name}
              text={comp.description || undefined}
              meta={(
                <span data-tour="hyd-compd-summary" style={{ display: 'inline-flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  <Pill label={comp.status === 'obsolete' ? 'Obsolete' : 'Active'} hex={comp.status === 'obsolete' ? '#78716c' : '#16A34A'} />
                  <Pill label={COMPONENT_CATEGORY_LABELS[comp.category] || comp.category} hex="#0369a1" />
                  <Pill label={MEDIA_TYPE_LABELS[comp.system_type] || comp.system_type} hex={SYSTEM_TYPE_HEX[comp.system_type] || '#78716c'} />
                  <span>· {comp.bom_usage_count ? `Used on ${comp.bom_usage_count} BOM${comp.bom_usage_count === 1 ? '' : 's'}` : 'Not on any BOM yet'}</span>
                  {comp.datasheet_url && <span>· <a href={comp.datasheet_url} target="_blank" rel="noreferrer" style={{ color: '#FF6A2A', fontWeight: 600 }}>Open datasheet ↗</a></span>}
                </span>
              )}
              actions={canEditComp ? <button data-tour="hyd-compd-edit-btn" type="button" style={secondaryBtnStyle} onClick={() => { setSaved(false); setEditOpen(true) }}>Edit</button> : undefined}
            />
            <DetailGroup title="Make & purchase">
              <DetailRow label="Manufacturer">{comp.manufacturer}</DetailRow>
              <DetailRow label="Model number">{comp.model_number}</DetailRow>
              <DetailRow label="Part / order number">{comp.part_number}</DetailRow>
              <DetailRow label="Linked store item">{comp.store_item_code ? `${comp.store_item_code}${comp.store_item_name ? ` — ${comp.store_item_name}` : ''}` : 'Not stocked in Store'}</DetailRow>
              {seeCosts && <DetailRow label="Unit cost">{`₹${(comp.unit_cost ?? 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`}</DetailRow>}
            </DetailGroup>
            <DetailGroup title="Ratings" last={comp.specifications.length === 0}>
              {(CATEGORY_FIELDS[comp.category] || DEFAULT_CATEGORY_FIELDS).map((k) => {
                const [label, unit] = RATING_FIELDS[k]
                const v = (comp as unknown as Record<string, unknown>)[k]
                return <DetailRow key={k} label={label}>{v == null || v === '' ? null : `${String(v)}${unit ? ` ${unit}` : ''}`}</DetailRow>
              })}
              <DetailRow label="Medium / fluid">{comp.media}</DetailRow>
              <DetailRow label="Temperature range">{comp.temp_min_c != null || comp.temp_max_c != null ? `${comp.temp_min_c ?? '—'} to ${comp.temp_max_c ?? '—'} °C` : null}</DetailRow>
              <DetailRow label="Weight">{comp.weight_kg != null ? `${comp.weight_kg} kg` : null}</DetailRow>
            </DetailGroup>
            {comp.specifications.length > 0 && (
              <DetailGroup title="Other specifications" last>
                {comp.specifications.map((sp, i) => <DetailRow key={`${sp.label}-${i}`} label={sp.label}>{sp.value}</DetailRow>)}
              </DetailGroup>
            )}
          </DetailCard>
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
