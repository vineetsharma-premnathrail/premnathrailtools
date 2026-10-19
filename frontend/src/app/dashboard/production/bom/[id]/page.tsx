'use client'

import { useCallback, useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { productionApi } from '@/lib/api'
import { ProductionBom } from '@/types'
import { TEXT, GLASS, SHADOWS, GRADIENTS, BORDER, DANGER } from '@/lib/theme'
import { secondaryBtnStyle, InfoRow } from '@/components/shared/ui'
import ProductionNav from '@/components/production/ProductionNav'
import BomForm from '@/components/production/BomForm'
import ConfirmDialog from '@/components/erp/ConfirmDialog'
import ApprovalPanel from '@/components/shared/ApprovalPanel'
import { extractErrorMessages } from '@/lib/validation'
import { formatDateTime } from '@/lib/format'
import { useCan } from '@/lib/permissions'
import { recordHref, recordPath, useRecordId } from '@/lib/recordRef'
import InvalidRecordLink from '@/components/erp/InvalidRecordLink'
import { DesignDiffSection } from '@/components/production/DesignBomLink'
import { DisciplineMergeSection, ExplosionSection } from '@/components/production/BomEngineeringSections'
import { formatDate } from '@/lib/format'

const STATUS_LABELS: Record<string, string> = { draft: 'Draft', scheduled: 'Scheduled', active: 'Active', obsolete: 'Obsolete' }
const STATUS_HEX: Record<string, string> = { draft: '#F59E0B', scheduled: '#2563eb', active: '#16A34A', obsolete: '#78716c' }
const CATEGORY_LABELS: Record<string, string> = { stock: 'Stock', non_stock: 'Non-stock', text: 'Text', document: 'Document' }
const CONFIRM_LABELS: Record<string, string> = { required: 'Required', optional: 'Optional', none: 'None' }

const sectionStyle: React.CSSProperties = {
  borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur,
  border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), padding: 20, marginBottom: 20,
}
const sectionTitle: React.CSSProperties = { fontSize: 12, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.secondary, margin: '0 0 14px' }
const thStyle: React.CSSProperties = { textAlign: 'left', padding: '8px 12px', fontSize: 11, fontWeight: 600, letterSpacing: '.03em', textTransform: 'uppercase', color: TEXT.muted, background: '#fdf1e6' }
const tdStyle: React.CSSProperties = { padding: '9px 12px', fontSize: 13, color: TEXT.body, borderTop: `1px solid ${BORDER.light}` }
const primaryBtn: React.CSSProperties = {
  padding: '10px 18px', borderRadius: 12, border: 'none', cursor: 'pointer',
  background: GRADIENTS.primary, color: '#fff', fontSize: 13, fontWeight: 600, boxShadow: `0 8px 20px ${SHADOWS.glowOrange}`,
}
const inr = (n: number) => `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`

type PendingAction = 'activate' | 'obsolete' | 'delete' | null

export default function BomDetailPage() {
  const { isAuthorized, isLoading } = useRequireApp('production')
  const { can, canDelete, canFeature } = useCan()
  // Activation goes through Organization › Approval Workflows › BOM activation:
  // a BOM approver activates in one click, anyone else submits it to them.
  // Features (core/features/production.py) gate each block / action.
  const canApprove = canFeature('production', 'bom', 'lifecycle', 'approve')
  const canSubmit = canFeature('production', 'bom', 'lifecycle', 'submit')
  const canNewVersion = canFeature('production', 'bom', 'lifecycle', 'create')
  const canEdit = can('production', 'bom', 'edit')
  const seeCosts = canFeature('production', 'bom', 'costs', 'view')
  const seeRouting = canFeature('production', 'bom', 'routing', 'view')
  const seeDesignLink = canFeature('production', 'bom', 'design_link', 'view')
  const seeMerges = canFeature('production', 'bom', 'discipline_merge', 'view')
  const seeExplosion = canFeature('production', 'bom', 'explosion', 'view')
  const router = useRouter()
  const params = useParams()
  const { id: bomIdResolved, error: linkError } = useRecordId(params.id as string)
  const bomId = bomIdResolved ?? 0

  const [bom, setBom] = useState<ProductionBom | null>(null)
  const [editing, setEditing] = useState(false)
  const [error, setError] = useState<string | string[]>('')
  const [pending, setPending] = useState<PendingAction>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(() => {
    productionApi.getBom(bomId)
      .then(setBom)
      .catch((err) => setError(extractErrorMessages(err, 'Failed to load BOM.')))
  }, [bomId])

  useEffect(() => {
    if (!isAuthorized || !bomId) return
    load()
  }, [isAuthorized, bomId, load])

  const run = async (fn: () => Promise<ProductionBom | void>, fallback: string) => {
    setError('')
    setBusy(true)
    try {
      const result = await fn()
      if (result) setBom(result)
    } catch (err) {
      setError(extractErrorMessages(err, fallback))
    } finally {
      setBusy(false)
    }
  }

  const confirmPending = async () => {
    const action = pending
    setPending(null)
    if (action === 'activate') await run(() => productionApi.activateBom(bomId), canApprove ? 'Failed to activate BOM.' : 'Failed to submit the BOM for activation.')
    if (action === 'obsolete') await run(() => productionApi.obsoleteBom(bomId), 'Failed to mark BOM obsolete.')
    if (action === 'delete') {
      await run(async () => { await productionApi.deleteBom(bomId); router.push('/dashboard/production/bom') }, 'Failed to delete BOM.')
    }
  }

  const newVersion = () => run(async () => {
    const created = await productionApi.newBomVersion(bomId)
    router.push(recordPath('/dashboard/production/bom', created))
  }, 'Failed to create a new version.')

  if (isLoading || !isAuthorized) return null
  if (linkError) return (<div><ProductionNav /><InvalidRecordLink message={linkError} listHref="/dashboard/production/bom" listLabel="Back to BOMs" /></div>)
  if (!bomId) return <div><ProductionNav /></div>

  const unitCost = bom ? ((bom.standard_material_cost ?? 0) + (bom.standard_labour_cost ?? 0)) / (bom.base_quantity || 1) : 0

  if (bom && editing) return (
    <BomForm
      initial={bom}
      title={`Edit ${bom.bom_number} · v${bom.version}`}
      subtitle={`${bom.product_code} — ${bom.product_name}. Only a draft can be edited; an active BOM changes through a New Version.`}
      nav={<ProductionNav />}
      onBack={() => setEditing(false)}
      backTour="production-bom-edit-cancel-btn"
      submitLabel="Save Changes"
      onSubmit={async (payload) => {
        const updated = await productionApi.updateBom(bomId, payload)
        setBom(updated)
        setEditing(false)
      }}
    />
  )

  return (
    <div>
      <ProductionNav />

      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
        <div>
          <p style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 4px' }}>
            Production Module · BOM
          </p>
          <div data-tour="production-bom-detail-header" style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '0 0 20px', flexWrap: 'wrap' }}>
            <h1 style={{ fontSize: 24, fontWeight: 700, color: TEXT.heading, margin: 0 }}>{bom ? `${bom.bom_number} · v${bom.version}` : 'BOM'}</h1>
            {bom && (
              <span style={{ fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 9999, background: `${STATUS_HEX[bom.status]}1a`, color: STATUS_HEX[bom.status], whiteSpace: 'nowrap' }}>
                {STATUS_LABELS[bom.status] || bom.status}
              </span>
            )}
          </div>
        </div>
        <button data-tour="production-bom-detail-back-btn" onClick={() => router.push('/dashboard/production/bom')} type="button" style={secondaryBtnStyle}>← Back</button>
      </div>

      {error && (
        <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
          {Array.isArray(error) ? error.join(' ') : error}
        </div>
      )}

      {bom && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 20 }}>
          {bom.status === 'draft' && (
            <>
              {(canApprove || canSubmit) && <button data-tour="production-bom-activate-btn" type="button" disabled={busy} style={primaryBtn} onClick={() => setPending('activate')}>{canApprove ? 'Activate BOM' : 'Submit for Activation'}</button>}
              {canEdit && <button data-tour="production-bom-edit-btn" type="button" disabled={busy} style={secondaryBtnStyle} onClick={() => setEditing(true)}>Edit</button>}
              {canDelete('production', 'bom', (bom as { created_by_id?: number | null } | null)?.created_by_id ?? null) && <button data-tour="production-bom-delete-btn" type="button" disabled={busy} style={{ ...secondaryBtnStyle, color: DANGER.primary, borderColor: DANGER.border }} onClick={() => setPending('delete')}>Delete Draft</button>}
            </>
          )}
          {bom.status === 'active' && (
            <>
              {can('production', 'work_orders', 'create') && <button data-tour="production-bom-raise-wo-btn" type="button" disabled={busy} style={primaryBtn} onClick={() => router.push(recordHref('/dashboard/production/work-orders/new', bom, 'id', undefined, 'bom_id'))}>+ Raise Work Order</button>}
              {canNewVersion && <button data-tour="production-bom-new-version-btn" type="button" disabled={busy} style={secondaryBtnStyle} onClick={newVersion}>New Version</button>}
              {canApprove && <button data-tour="production-bom-obsolete-btn" type="button" disabled={busy} style={secondaryBtnStyle} onClick={() => setPending('obsolete')}>Mark Obsolete</button>}
            </>
          )}
          {bom.status === 'obsolete' && canNewVersion && (
            <button data-tour="production-bom-version-from-obsolete-btn" type="button" disabled={busy} style={secondaryBtnStyle} onClick={newVersion}>New Version from this</button>
          )}
        </div>
      )}

      {bom && (
        <>
          <div data-tour="production-bom-summary" style={sectionStyle}>
            <p style={sectionTitle}>Summary</p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 14 }}>
              <InfoRow label="Product" value={`${bom.product_code} — ${bom.product_name}`} />
              <InfoRow label="Base Quantity" value={`${bom.base_quantity} ${bom.product_uom || ''}`} />
              {seeCosts && (
                <>
                  <InfoRow label="Std Material Cost" value={inr(bom.standard_material_cost ?? 0)} />
                  <InfoRow label="Std Labour Cost" value={inr(bom.standard_labour_cost ?? 0)} />
                  <InfoRow label="Std Cost / Unit" value={inr(unitCost)} />
                </>
              )}
              <InfoRow label="Work Orders" value={String(bom.work_order_count)} />
              <InfoRow label="Created By" value={bom.created_by_name || '—'} />
              <InfoRow label="Activated" value={bom.activated_at ? `${formatDateTime(bom.activated_at)} by ${bom.activated_by_name || '—'}` : '—'} />
              <InfoRow label="Valid" value={`${bom.valid_from ? formatDate(bom.valid_from) : 'from activation'} → ${bom.valid_to ? formatDate(bom.valid_to) : 'open'}`} />
              <InfoRow label="Change Number" value={bom.ecn_number || bom.change_number || '—'} />
              {bom.effective_serial && <InfoRow label="Effective from serial" value={bom.effective_serial} />}
            </div>
            {bom.status === 'scheduled' && (
              <p style={{ fontSize: 12.5, color: '#1d4ed8', margin: '12px 0 0' }}>
                Approved, in force from {bom.valid_from ? formatDate(bom.valid_from) : '—'}. Until then the current active version is used; work orders starting on or after that date use this one.
              </p>
            )}
            {bom.description && <div style={{ marginTop: 14 }}><InfoRow label="Description" value={bom.description} /></div>}
            {bom.remarks && <div style={{ marginTop: 14 }}><InfoRow label="Remarks" value={bom.remarks} /></div>}
            {seeCosts && <p style={{ fontSize: 12, color: TEXT.muted, margin: '14px 0 0' }}>
              Standard costs use each component&apos;s Store standard cost (or moving-average cost) and each workstation&apos;s hourly rate.
            </p>}
          </div>

          {bom.design_bom_id && seeDesignLink && (
            <DesignDiffSection bom={bom} canTransfer={canFeature('production', 'bom', 'design_link', 'create')} onChanged={setBom} />
          )}

          <div data-tour="production-bom-components" style={sectionStyle}>
            <p style={sectionTitle}>Components ({bom.items.length})</p>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 700 }}>
                <thead><tr>{['Item', 'Category', 'Qty', 'UOM', 'Make / Buy', 'Scrap %', ...(seeCosts ? ['Unit Cost', 'Line Cost'] : []), 'Remarks'].map((h) => <th key={h} style={thStyle}>{h}</th>)}</tr></thead>
                <tbody>
                  {bom.items.length === 0 ? (
                    <tr><td colSpan={9} style={{ ...tdStyle, textAlign: 'center', color: TEXT.muted }}>No components.</td></tr>
                  ) : bom.items.map((i) => (
                    <tr key={i.id}>
                      <td style={{ ...tdStyle, fontWeight: 600, color: TEXT.heading }}>
                        {i.item_category === 'text' ? <i style={{ fontWeight: 400 }}>{i.line_text}</i>
                          : i.item_category === 'document' ? (i.document_number || `Document #${i.document_id}`)
                          : `${i.item_code} — ${i.item_name}`}
                        {i.has_bom && <span style={{ fontSize: 10.5, fontWeight: 700, marginLeft: 6, color: '#2563eb' }}>SUB-ASSEMBLY</span>}
                        {i.source_tag && <div style={{ fontSize: 11, fontWeight: 500, color: TEXT.muted }}>{i.source_tag}</div>}
                      </td>
                      <td style={tdStyle}>{CATEGORY_LABELS[i.item_category || 'stock'] || i.item_category}</td>
                      <td style={tdStyle}>{i.quantity}</td>
                      <td style={tdStyle}>{i.uom || '—'}</td>
                      <td style={tdStyle}>{i.make_buy ? (i.make_buy === 'make' ? 'Make' : 'Buy') : '—'}</td>
                      <td style={tdStyle}>{i.scrap_percent}%</td>
                      {seeCosts && <td style={tdStyle}>{i.unit_cost ? inr(i.unit_cost) : <span style={{ color: '#b45309' }}>not set</span>}</td>}
                      {seeCosts && <td style={tdStyle}>{inr(i.quantity * (1 + i.scrap_percent / 100) * (i.unit_cost ?? 0))}</td>}
                      <td style={tdStyle}>{i.remarks || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {seeRouting && <div data-tour="production-bom-routing" style={sectionStyle}>
            <p style={sectionTitle}>Routing ({bom.operations.length})</p>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 760 }}>
                <thead><tr>{['Seq', 'Operation', 'Control key', 'Workstation / Vendor', 'Setup hrs', 'Run hrs / unit', 'Confirmation', 'Quality Gate', 'Print', 'Instructions'].map((h) => <th key={h} style={thStyle}>{h}</th>)}</tr></thead>
                <tbody>
                  {bom.operations.length === 0 ? (
                    <tr><td colSpan={10} style={{ ...tdStyle, textAlign: 'center', color: TEXT.muted }}>No routing operations.</td></tr>
                  ) : bom.operations.map((o) => (
                    <tr key={o.id}>
                      <td style={{ ...tdStyle, fontWeight: 600 }}>{o.sequence}</td>
                      <td style={{ ...tdStyle, color: TEXT.heading }}>{o.operation_name}</td>
                      <td style={tdStyle}>{o.control_key === 'external'
                        ? <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 9px', borderRadius: 9999, background: '#9333ea1a', color: '#9333ea' }}>External</span>
                        : 'Internal'}</td>
                      <td style={tdStyle}>{o.control_key === 'external' ? `${o.vendor_name || '—'}${seeCosts && o.external_cost ? ` · ${inr(o.external_cost)}/unit` : ''}` : (o.workstation_name || '—')}</td>
                      <td style={tdStyle}>{o.setup_hours}</td>
                      <td style={tdStyle}>{o.run_hours_per_unit}</td>
                      <td style={tdStyle}>{CONFIRM_LABELS[o.confirmation || 'optional']}</td>
                      <td style={tdStyle}>{o.requires_inspection ? <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 9px', borderRadius: 9999, background: '#0d94881a', color: '#0d9488' }}>Inspection</span> : '—'}</td>
                      <td style={tdStyle}>{o.print_on_job_card === false ? 'No' : 'Yes'}</td>
                      <td style={tdStyle}>{o.instructions || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>}

          {seeMerges && (
            <DisciplineMergeSection bom={bom} canEdit={canFeature('production', 'bom', 'discipline_merge', 'create')}
              canRemove={canFeature('production', 'bom', 'discipline_merge', 'delete')} onChanged={setBom} />
          )}
          {seeExplosion && <ExplosionSection bom={bom} showCosts={seeCosts} />}
        </>
      )}

      {bom && (
        <div data-tour="production-bom-approval-panel">
          <ApprovalPanel entityType="production_bom" entityId={bom.id} title="Activation approval" onChanged={load} />
        </div>
      )}

      <ConfirmDialog
        open={pending !== null}
        title={pending === 'activate' ? (canApprove ? 'Activate this BOM?' : 'Submit this BOM for activation?') : pending === 'obsolete' ? 'Mark BOM obsolete?' : 'Delete draft BOM?'}
        message={
          pending === 'activate' && !canApprove
            ? 'A BOM approver is asked to activate it. It stays a draft (and locked for editing) until they decide.'
            : pending === 'activate'
            ? 'It becomes the active version for this product and locks for editing. Any currently active version becomes obsolete. Existing work orders keep their own material list.'
            : pending === 'obsolete'
              ? 'No new work orders can be raised from it. Existing work orders are not affected.'
              : 'This draft will be removed.'
        }
        confirmLabel={pending === 'activate' ? (canApprove ? 'Activate' : 'Submit') : pending === 'obsolete' ? 'Mark Obsolete' : 'Delete'}
        danger={pending !== 'activate'}
        onConfirm={confirmPending}
        onCancel={() => setPending(null)}
      />
    </div>
  )
}
