'use client'

import { useCallback, useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { productionApi } from '@/lib/api'
import { ProductionBom } from '@/types'
import { TEXT, GLASS, SHADOWS, BORDER, DANGER } from '@/lib/theme'
import { secondaryBtnStyle, primaryBtnStyle, RowCount, Pill, DetailCard, DetailSummary, DetailGroup, DetailRow } from '@/components/shared/ui'
import ProductionNav from '@/components/production/ProductionNav'
import BomForm from '@/components/production/BomForm'
import ConfirmDialog from '@/components/erp/ConfirmDialog'
import ApprovalPanel from '@/components/shared/ApprovalPanel'
import { extractErrorMessages } from '@/lib/validation'
import { formatDateTime } from '@/lib/format'
import { useCan } from '@/lib/permissions'
import { recordHref, recordPath, useRecordId } from '@/lib/recordRef'
import { useVisibility } from '@/lib/visibility'
import { VisSection, VisTd, VisTh } from '@/lib/visibilityComponents'
import { sampleBom } from '@/lib/productionPreviewSamples'
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
const thStyle: React.CSSProperties = { textAlign: 'left', padding: '8px 12px', fontSize: 11, fontWeight: 600, letterSpacing: '.03em', whiteSpace: 'nowrap', textTransform: 'uppercase', color: TEXT.muted, background: '#fdf1e6', position: 'sticky', top: 0, zIndex: 1 }
const tdStyle: React.CSSProperties = { padding: '9px 12px', fontSize: 13, color: TEXT.body, borderTop: `1px solid ${BORDER.light}` }
const primaryBtn: React.CSSProperties = primaryBtnStyle
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
  // What the user's roles let them see here (Role & Permissions › Production › BOM & Routing › Visibility). In the
  // Role editor's "Preview & choose" a sample BOM is drawn: no record id, nothing loaded, no actions.
  const vis = useVisibility('production:bom')
  const { id: bomIdResolved, error: linkError } = useRecordId(vis.preview ? null : (params.id as string))
  const bomId = bomIdResolved ?? 0

  const [bom, setBom] = useState<ProductionBom | null>(vis.preview ? sampleBom : null)
  const [editing, setEditing] = useState(false)
  // Table columns a role may hide (header and cells use the same key); the colSpan follows the shown ones.
  const keepCol = (table: string) => ([, k]: [string, string | null]) => !k || vis.preview || vis.showColumn(table, k)
  const componentCols = ([['Item', null], ['Category', 'category'], ['Qty', null], ['UOM', 'uom'], ['Make / Buy', 'make_buy'], ['Scrap %', 'scrap'],
    ...(seeCosts ? [['Unit Cost', null], ['Line Cost', null]] : []), ['Remarks', 'remarks']] as [string, string | null][]).filter(keepCol('detail_components'))
  const routingCols = ([['Seq', null], ['Operation', null], ['Control key', 'control_key'], ['Workstation / Vendor', 'workstation'], ['Setup hrs', 'setup'],
    ['Run hrs / unit', 'run'], ['Confirmation', 'confirmation'], ['Quality Gate', 'quality_gate'], ['Print', 'print'], ['Instructions', 'instructions']] as [string, string | null][])
    .filter(keepCol('detail_routing'))
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
  if (linkError && !vis.preview) return (<div><ProductionNav /><InvalidRecordLink message={linkError} listHref="/dashboard/production/bom" listLabel="Back to BOMs" /></div>)
  if (!bomId && !vis.preview) return <div><ProductionNav /></div>

  const unitCost = bom ? ((bom.standard_material_cost ?? 0) + (bom.standard_labour_cost ?? 0)) / (bom.base_quantity || 1) : 0

  if (bom && editing && !vis.preview) return (
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
      {!vis.preview && <ProductionNav />}

      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
        <div>
          <p style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 4px' }}>
            Production Module · BOM
          </p>
          <div data-tour="production-bom-detail-header" style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '0 0 20px', flexWrap: 'wrap' }}>
            <h1 style={{ fontSize: 24, fontWeight: 700, color: TEXT.heading, margin: 0 }}>{bom ? `${bom.bom_number} · v${bom.version}` : 'BOM'}</h1>
          </div>
        </div>
        {!vis.preview && <button data-tour="production-bom-detail-back-btn" onClick={() => router.push('/dashboard/production/bom')} type="button" style={secondaryBtnStyle}>← Back</button>}
      </div>

      {error && (
        <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
          {Array.isArray(error) ? error.join(' ') : error}
        </div>
      )}

      {bom && !vis.preview && (
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
          {/* One record card: what the BOM makes, its key facts, then details grouped. */}
          <DetailCard tour="production-bom-summary">
            <VisSection vis={vis} k="detail_summary">
            <DetailSummary
              title={`${bom.product_code} — ${bom.product_name}`}
              text={bom.description || `Material list${seeRouting ? ' and routing' : ''} to make ${bom.base_quantity} ${bom.product_uom || 'unit(s)'} of this product — ${bom.items.length} component(s)${seeRouting ? `, ${bom.operations.length} operation(s)` : ''}.`}
              meta={<>
                <Pill label={STATUS_LABELS[bom.status] || bom.status} hex={STATUS_HEX[bom.status] || '#78716c'} />
                <span>· Version {bom.version}</span>
                <span>· Valid {bom.valid_from ? formatDate(bom.valid_from) : 'from activation'} → {bom.valid_to ? formatDate(bom.valid_to) : 'open'}</span>
                <span>· Used by <strong style={{ color: TEXT.heading }}>{bom.work_order_count}</strong> work order(s)</span>
              </>}
            />
            {bom.status === 'scheduled' && (
              <p style={{ fontSize: 12.5, color: '#1d4ed8', margin: '12px 0 4px' }}>
                Approved, in force from {bom.valid_from ? formatDate(bom.valid_from) : '—'}. Until then the current active version is used; work orders starting on or after that date use this one.
              </p>
            )}
            </VisSection>
            <VisSection vis={vis} k="detail_quantity_change">
            <DetailGroup title="Quantity & change control">
              <DetailRow label="Base quantity">{`${bom.base_quantity} ${bom.product_uom || ''}`}</DetailRow>
              <DetailRow label="Change number">{bom.ecn_number || bom.change_number}</DetailRow>
              {bom.effective_serial && <DetailRow label="Effective from serial">{bom.effective_serial}</DetailRow>}
            </DetailGroup>
            </VisSection>
            {seeCosts && (
              <DetailGroup title="Standard cost">
                <DetailRow label="Material">{inr(bom.standard_material_cost ?? 0)}</DetailRow>
                <DetailRow label="Labour">{inr(bom.standard_labour_cost ?? 0)}</DetailRow>
                <DetailRow label="Cost per unit"><strong>{inr(unitCost)}</strong></DetailRow>
                <p style={{ fontSize: 12, color: TEXT.muted, margin: '4px 0 6px' }}>
                  Standard costs use each component&apos;s Store standard cost (or moving-average cost) and each workstation&apos;s hourly rate.
                </p>
              </DetailGroup>
            )}
            <VisSection vis={vis} k="detail_record">
            <DetailGroup title="Record" last>
              <DetailRow label="Created by">{bom.created_by_name}</DetailRow>
              <DetailRow label="Activated">{bom.activated_at ? `${formatDateTime(bom.activated_at)} by ${bom.activated_by_name || '—'}` : null}</DetailRow>
              {bom.remarks && <DetailRow label="Remarks">{bom.remarks}</DetailRow>}
            </DetailGroup>
            </VisSection>
          </DetailCard>

          {bom.design_bom_id && seeDesignLink && !vis.preview && (
            <DesignDiffSection bom={bom} canTransfer={canFeature('production', 'bom', 'design_link', 'create')} onChanged={setBom} />
          )}

          <VisSection vis={vis} k="detail_components">
          <div data-tour="production-bom-components" style={sectionStyle}>
            <p style={sectionTitle}>Components ({bom.items.length})</p>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 700 }}>
                <thead><tr>{componentCols.map(([h, k], i) => (k
                  ? <VisTh key={h} vis={vis} table="detail_components" k={k} style={thStyle}>{h}</VisTh>
                  : <th key={h} style={thStyle}>{h}{i === 0 && <RowCount count={bom.items.length} />}</th>))}</tr></thead>
                <tbody>
                  {bom.items.length === 0 ? (
                    <tr><td colSpan={componentCols.length} style={{ ...tdStyle, textAlign: 'center', color: TEXT.muted }}>No components on this BOM yet.</td></tr>
                  ) : bom.items.map((i) => (
                    <tr key={i.id}>
                      <td style={{ ...tdStyle, fontWeight: 600, color: TEXT.heading }}>
                        {i.item_category === 'text' ? <i style={{ fontWeight: 400 }}>{i.line_text}</i>
                          : i.item_category === 'document' ? (i.document_number || `Document #${i.document_id}`)
                          : `${i.item_code} — ${i.item_name}`}
                        {i.has_bom && <span style={{ fontSize: 10.5, fontWeight: 700, marginLeft: 6, color: '#2563eb' }}>SUB-ASSEMBLY</span>}
                        {i.source_tag && <div style={{ fontSize: 11, fontWeight: 500, color: TEXT.muted }}>{i.source_tag}</div>}
                      </td>
                      <VisTd vis={vis} table="detail_components" k="category" style={tdStyle}>{CATEGORY_LABELS[i.item_category || 'stock'] || i.item_category}</VisTd>
                      <td style={tdStyle}>{i.quantity}</td>
                      <VisTd vis={vis} table="detail_components" k="uom" style={tdStyle}>{i.uom || '—'}</VisTd>
                      <VisTd vis={vis} table="detail_components" k="make_buy" style={tdStyle}>{i.make_buy ? (i.make_buy === 'make' ? 'Make' : 'Buy') : '—'}</VisTd>
                      <VisTd vis={vis} table="detail_components" k="scrap" style={tdStyle}>{i.scrap_percent}%</VisTd>
                      {seeCosts && <td style={tdStyle}>{i.unit_cost ? inr(i.unit_cost) : <span style={{ color: '#b45309' }}>not set</span>}</td>}
                      {seeCosts && <td style={tdStyle}>{inr(i.quantity * (1 + i.scrap_percent / 100) * (i.unit_cost ?? 0))}</td>}
                      <VisTd vis={vis} table="detail_components" k="remarks" style={tdStyle}>{i.remarks || '—'}</VisTd>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          </VisSection>

          {seeRouting && <VisSection vis={vis} k="detail_routing"><div data-tour="production-bom-routing" style={sectionStyle}>
            <p style={sectionTitle}>Routing ({bom.operations.length})</p>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 760 }}>
                <thead><tr>{routingCols.map(([h, k], i) => (k
                  ? <VisTh key={h} vis={vis} table="detail_routing" k={k} style={thStyle}>{h}</VisTh>
                  : <th key={h} style={thStyle}>{h}{i === 0 && <RowCount count={bom.operations.length} />}</th>))}</tr></thead>
                <tbody>
                  {bom.operations.length === 0 ? (
                    <tr><td colSpan={routingCols.length} style={{ ...tdStyle, textAlign: 'center', color: TEXT.muted }}>No routing operations — a work order needs at least one before it can be released.</td></tr>
                  ) : bom.operations.map((o) => (
                    <tr key={o.id}>
                      <td style={{ ...tdStyle, fontWeight: 600 }}>{o.sequence}</td>
                      <td style={{ ...tdStyle, color: TEXT.heading }}>{o.operation_name}</td>
                      <VisTd vis={vis} table="detail_routing" k="control_key" style={tdStyle}>{o.control_key === 'external'
                        ? <Pill label="External" hex="#9333ea" />
                        : 'Internal'}</VisTd>
                      <VisTd vis={vis} table="detail_routing" k="workstation" style={tdStyle}>{o.control_key === 'external' ? `${o.vendor_name || '—'}${seeCosts && o.external_cost ? ` · ${inr(o.external_cost)}/unit` : ''}` : (o.workstation_name || '—')}</VisTd>
                      <VisTd vis={vis} table="detail_routing" k="setup" style={tdStyle}>{o.setup_hours}</VisTd>
                      <VisTd vis={vis} table="detail_routing" k="run" style={tdStyle}>{o.run_hours_per_unit}</VisTd>
                      <VisTd vis={vis} table="detail_routing" k="confirmation" style={tdStyle}>{CONFIRM_LABELS[o.confirmation || 'optional']}</VisTd>
                      <VisTd vis={vis} table="detail_routing" k="quality_gate" style={tdStyle}>{o.requires_inspection ? <Pill label="Inspection" hex="#0d9488" /> : '—'}</VisTd>
                      <VisTd vis={vis} table="detail_routing" k="print" style={tdStyle}>{o.print_on_job_card === false ? 'No' : 'Yes'}</VisTd>
                      <VisTd vis={vis} table="detail_routing" k="instructions" style={tdStyle}>{o.instructions || '—'}</VisTd>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div></VisSection>}

          {seeMerges && !vis.preview && (
            <DisciplineMergeSection bom={bom} canEdit={canFeature('production', 'bom', 'discipline_merge', 'create')}
              canRemove={canFeature('production', 'bom', 'discipline_merge', 'delete')} onChanged={setBom} />
          )}
          {seeExplosion && !vis.preview && <ExplosionSection bom={bom} showCosts={seeCosts} />}
        </>
      )}

      {bom && !vis.preview && (
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
