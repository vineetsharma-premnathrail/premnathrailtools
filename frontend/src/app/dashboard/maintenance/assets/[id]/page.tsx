'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { maintenanceApi } from '@/lib/api'
import { MaintenanceAsset, MaintenanceAssetHistoryEntry, MaintenancePmPlan } from '@/types'
import { TEXT, GLASS, SHADOWS, GRADIENTS, BORDER } from '@/lib/theme'
import { secondaryBtnStyle, dangerBtnStyle, InfoRow } from '@/components/shared/ui'
import MaintenanceNav from '@/components/maintenance/MaintenanceNav'
import InvalidRecordLink from '@/components/erp/InvalidRecordLink'
import { recordPath, useRecordId } from '@/lib/recordRef'
import MaintenanceAttachments from '@/components/maintenance/MaintenanceAttachments'
import AssetSparesPanel from '@/components/maintenance/AssetSparesPanel'
import AssetReadingsPanel from '@/components/maintenance/AssetReadingsPanel'
import ConfirmDialog from '@/components/erp/ConfirmDialog'
import { extractErrorMessages } from '@/lib/validation'
import { formatDate, formatDateTime } from '@/lib/format'
import {
  ASSET_CATEGORY_LABELS, ASSET_STATUS_LABELS, CRITICALITY_LABELS, REQUEST_STATUS_LABELS, WO_STATUS_LABELS,
  formatINR, formatMinutes, PM_FREQUENCY_UNIT_LABELS, PM_SCHEDULE_BASIS_LABELS, PM_DUE_STATE_LABELS,
} from '@/components/maintenance/labels'
import { useCan } from '@/lib/permissions'

const STATUS_HEX: Record<string, string> = { operational: '#16A34A', breakdown: '#DC2626', under_maintenance: '#F59E0B', standby: '#2563EB', decommissioned: '#78716c' }
// Same due-state colours as the PM schedule page; due_state is computed server-side in IST.
const DUE_HEX: Record<string, string> = { overdue: '#DC2626', due_soon: '#F59E0B', scheduled: '#2563EB', inactive: '#78716c' }
const HISTORY_STATUS_HEX: Record<string, string> = {
  open: '#F59E0B', acknowledged: '#2563EB', converted: '#0f766e', rejected: '#DC2626', duplicate: '#78716c',
  draft: '#78716c', assigned: '#2563EB', in_progress: '#F59E0B', on_hold: '#9333EA', completed: '#16A34A', closed: '#0f766e', cancelled: '#78716c',
}

const sectionStyle: React.CSSProperties = {
  borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur,
  border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), padding: 20, marginBottom: 20,
}
const sectionTitle: React.CSSProperties = { fontSize: 12, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.secondary, margin: '0 0 14px' }
const gridStyle: React.CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 16 }
const cellStyle: React.CSSProperties = { padding: '10px 14px', fontSize: 13, color: TEXT.body, borderTop: `1px solid ${BORDER.light}` }

const TABS = [
  { key: 'overview', label: 'Overview' },
  { key: 'history', label: 'History' },
  { key: 'pm', label: 'PM Plans' },
  { key: 'spares', label: 'Spares' },
  { key: 'readings', label: 'Counters & Readings' },
  { key: 'documents', label: 'Documents' },
] as const

export default function MaintenanceAssetDetailPage() {
  const { isAuthorized, isLoading } = useRequireApp('maintenance')
  const { can, canDelete, canFeature } = useCan()
  // Asset sub-tabs that are features (maintenance:assets.<key>) — core/features/maintenance.py.
  const af = (key: string, action: 'view' | 'create' | 'edit' | 'delete' = 'view') => canFeature('maintenance', 'assets', key, action)
  const TAB_FEATURE: Record<string, string> = { history: 'history', spares: 'spare_parts', readings: 'readings', documents: 'documents' }
  const visibleTabs = TABS.filter((t) => !TAB_FEATURE[t.key] || af(TAB_FEATURE[t.key]))
  const showCosts = canFeature('maintenance', 'work_orders', 'costs', 'view')
  const router = useRouter()
  const params = useParams()
  const ref = params.id as string
  const { id: resolvedId, error: linkError } = useRecordId(ref)
  const id = resolvedId ?? 0
  const [asset, setAsset] = useState<MaintenanceAsset | null>(null)
  const [history, setHistory] = useState<MaintenanceAssetHistoryEntry[] | null>(null)
  const [pmPlans, setPmPlans] = useState<MaintenancePmPlan[] | null>(null)
  const [tab, setTab] = useState<(typeof TABS)[number]['key']>('overview')
  const [error, setError] = useState<string | string[]>('')
  const [loading, setLoading] = useState(true)
  const [confirmDelete, setConfirmDelete] = useState(false)

  useEffect(() => {
    if (!isAuthorized || !id) return
    maintenanceApi.getAsset(id).then(setAsset).catch((err) => setError(extractErrorMessages(err, 'Failed to load asset.')))
      .finally(() => setLoading(false))
  }, [isAuthorized, id])

  useEffect(() => {
    if (!isAuthorized || !id || tab !== 'history' || history) return
    maintenanceApi.getAssetHistory(id).then(setHistory).catch((err) => setError(extractErrorMessages(err, 'Failed to load maintenance history.')))
  }, [isAuthorized, id, tab, history])

  useEffect(() => {
    if (!isAuthorized || !id || tab !== 'pm' || pmPlans) return
    maintenanceApi.listPmPlans({ asset_id: id }).then(setPmPlans).catch((err) => setError(extractErrorMessages(err, 'Failed to load PM plans.')))
  }, [isAuthorized, id, tab, pmPlans])

  const handleDelete = async () => {
    setConfirmDelete(false)
    setError('')
    try {
      await maintenanceApi.deleteAsset(id)
      router.push('/dashboard/maintenance/assets')
    } catch (err) {
      setError(extractErrorMessages(err, 'Failed to delete asset.'))
    }
  }

  if (isLoading || !isAuthorized) return null
  if (linkError) return (<div><MaintenanceNav /><InvalidRecordLink message={linkError} listHref="/dashboard/maintenance/assets" listLabel="Back to assets" /></div>)
  if (!id) return <div><MaintenanceNav /></div>

  const isDown = asset && (asset.status === 'breakdown' || asset.status === 'under_maintenance')

  return (
    <div>
      <MaintenanceNav />

      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, marginBottom: 20, flexWrap: 'wrap' }}>
        <div>
          <p style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 4px' }}>
            Maintenance Asset
          </p>
          <h1 data-tour="maint-assetd-status" style={{ fontSize: 24, fontWeight: 700, color: TEXT.heading, margin: 0, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            {asset ? `${asset.asset_code} — ${asset.name}` : 'Asset'}
            {asset && (
              <span style={{ fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 9999, background: `${STATUS_HEX[asset.status]}1a`, color: STATUS_HEX[asset.status], whiteSpace: 'nowrap' }}>
                {ASSET_STATUS_LABELS[asset.status] || asset.status}
              </span>
            )}
          </h1>
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          {asset && asset.status !== 'decommissioned' && (
            <>
              <button data-tour="maint-assetd-report-btn" type="button" onClick={() => router.push(`/dashboard/maintenance/requests/new?asset=${ref}`)} style={{
                padding: '9px 18px', borderRadius: 12, border: 'none', cursor: 'pointer',
                background: GRADIENTS.primary, color: '#fff', fontSize: 13, fontWeight: 600,
              }}>Report Breakdown</button>
              {can('maintenance', 'work_orders', 'create') && <button data-tour="maint-assetd-new-wo-btn" type="button" onClick={() => router.push(`/dashboard/maintenance/work-orders/new?asset=${ref}`)} style={secondaryBtnStyle}>New Work Order</button>}
            </>
          )}
          {asset && <button data-tour="maint-assetd-label-btn" type="button" onClick={() => router.push(`/dashboard/maintenance/assets/labels?ids=${ref}`)} style={secondaryBtnStyle}>QR Label</button>}
          {asset && can('maintenance', 'assets', 'edit') && <button data-tour="maint-assetd-edit-btn" type="button" onClick={() => router.push(`/dashboard/maintenance/assets/${ref}/edit`)} style={secondaryBtnStyle}>Edit</button>}
          {asset && canDelete('maintenance', 'assets', (asset as { created_by_id?: number | null } | null)?.created_by_id ?? null) && <button data-tour="maint-assetd-delete-btn" type="button" onClick={() => setConfirmDelete(true)} style={dangerBtnStyle}>Delete</button>}
          <button data-tour="maint-assetd-back" type="button" onClick={() => router.push('/dashboard/maintenance/assets')} style={secondaryBtnStyle}>← Back</button>
        </div>
      </div>

      {error && (
        <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
          {Array.isArray(error) ? error.join(' ') : error}
        </div>
      )}

      {asset && isDown && (
        <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.06)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
          {asset.down_since ? `Down since ${formatDateTime(asset.down_since)}. ` : ''}
          {asset.open_work_orders ? `${asset.open_work_orders} open work order${asset.open_work_orders > 1 ? 's' : ''}.` : 'No work order raised yet.'}
          {asset.workstation_code && ` Workstation ${asset.workstation_code} is blocked in Production until this is closed.`}
        </div>
      )}

      {!asset && !error && loading && (
        <div style={{ ...sectionStyle, fontSize: 13, color: TEXT.muted }}>Loading asset…</div>
      )}

      {asset && (
        <>
          <div style={{ display: 'flex', gap: 4, marginBottom: 16, borderBottom: '1px solid rgba(0,0,0,0.08)' }}>
            {visibleTabs.map((t) => (
              <button key={t.key} data-tour={`maint-asset-tab-${t.key}`} type="button" onClick={() => setTab(t.key)} style={{
                padding: '8px 14px', marginBottom: -1, border: 'none', background: 'none', cursor: 'pointer',
                fontSize: 13, fontWeight: 600, color: tab === t.key ? '#FF6A2A' : '#78716c',
                borderBottom: tab === t.key ? '2px solid #FF6A2A' : '2px solid transparent',
              }}>{t.label}</button>
            ))}
          </div>

          {tab === 'overview' && (
            <>
              <div data-tour="maint-assetd-details" style={sectionStyle}>
                <p style={sectionTitle}>Details</p>
                <div style={gridStyle}>
                  <InfoRow label="Category" value={ASSET_CATEGORY_LABELS[asset.category] || asset.category} />
                  <InfoRow label="Criticality" value={CRITICALITY_LABELS[asset.criticality] || asset.criticality} />
                  <InfoRow label="Plant" value={asset.branch_name || '—'} />
                  <InfoRow label="Department" value={asset.department_name || '—'} />
                  <InfoRow label="Location" value={asset.location_text || '—'} />
                  <InfoRow label="Part Of" value={asset.parent_asset_code || '—'} />
                  <InfoRow label="Workstation" value={asset.workstation_code ? `${asset.workstation_code}${asset.workstation_status ? ` (${asset.workstation_status.replace('_', ' ')})` : ''}` : 'Not linked'} />
                  <InfoRow label="Open Work Orders" value={String(asset.open_work_orders)} />
                </div>
              </div>
              <div data-tour="maint-assetd-make" style={sectionStyle}>
                <p style={sectionTitle}>Make, Purchase &amp; Warranty</p>
                <div style={gridStyle}>
                  <InfoRow label="Make" value={asset.make || '—'} />
                  <InfoRow label="Model" value={asset.model || '—'} />
                  <InfoRow label="Serial Number" value={asset.serial_number || '—'} />
                  <InfoRow label="Year Built" value={asset.year_of_manufacture ? String(asset.year_of_manufacture) : '—'} />
                  <InfoRow label="Supplier" value={asset.supplier_vendor_name || '—'} />
                  <InfoRow label="Purchase Date" value={formatDate(asset.purchase_date)} />
                  <InfoRow label="Purchase Cost" value={formatINR(asset.purchase_cost)} />
                  <InfoRow label="Commissioned On" value={formatDate(asset.commissioned_on)} />
                  <InfoRow label="Warranty Expiry" value={formatDate(asset.warranty_expiry)} />
                  <InfoRow label="AMC Vendor" value={asset.amc_vendor_name || '—'} />
                  <InfoRow label="AMC Expiry" value={formatDate(asset.amc_expiry)} />
                  <InfoRow label="Meter" value={asset.current_meter_reading != null ? `${asset.current_meter_reading} ${asset.meter_unit || ''}`.trim() : '—'} />
                  {asset.status === 'decommissioned' && <InfoRow label="Decommissioned On" value={formatDate(asset.decommissioned_on)} />}
                </div>
              </div>
              {(asset.description || asset.remarks) && (
                <div style={sectionStyle}>
                  <p style={sectionTitle}>Notes</p>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                    {asset.description && <InfoRow label="Description / Specs" value={asset.description} />}
                    {asset.remarks && <InfoRow label="Remarks" value={asset.remarks} />}
                  </div>
                </div>
              )}
            </>
          )}

          {tab === 'history' && (
            <div data-tour="maint-assetd-history" style={{ ...sectionStyle, padding: 0, overflow: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 760 }}>
                <thead>
                  <tr>
                    {['Date', 'Number', 'Title', 'Status', 'Downtime', ...(showCosts ? ['Cost'] : [])].map((h) => (
                      <th key={h} style={{ textAlign: 'left', padding: '10px 14px', fontSize: 11, fontWeight: 600, letterSpacing: '.03em', textTransform: 'uppercase', color: TEXT.muted, background: '#fdf1e6' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {!history ? (
                    <tr><td colSpan={6} style={{ padding: 20, textAlign: 'center', fontSize: 13, color: TEXT.muted }}>Loading…</td></tr>
                  ) : history.length === 0 ? (
                    <tr><td colSpan={6} style={{ padding: 20, textAlign: 'center', fontSize: 13, color: TEXT.muted }}>No requests or work orders on this asset yet.</td></tr>
                  ) : history.map((h) => (
                    <tr key={`${h.kind}-${h.id}`} style={{ cursor: 'pointer' }}
                      onClick={() => router.push(recordPath(h.kind === 'request' ? '/dashboard/maintenance/requests' : '/dashboard/maintenance/work-orders', h))}>
                      <td style={cellStyle}>{formatDate(h.date)}</td>
                      <td style={{ ...cellStyle, fontWeight: 600, color: TEXT.heading }}>{h.number}</td>
                      <td style={cellStyle}>{h.title}</td>
                      <td style={cellStyle}>
                        <span style={{ fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 9999, background: `${HISTORY_STATUS_HEX[h.status] || '#78716c'}1a`, color: HISTORY_STATUS_HEX[h.status] || '#78716c', whiteSpace: 'nowrap' }}>
                          {(h.kind === 'request' ? REQUEST_STATUS_LABELS : WO_STATUS_LABELS)[h.status] || h.status}
                        </span>
                      </td>
                      <td style={cellStyle}>{formatMinutes(h.downtime_minutes)}</td>
                      {showCosts && <td style={cellStyle}>{h.total_cost ? formatINR(h.total_cost) : '—'}</td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {tab === 'pm' && (
            <div data-tour="maint-assetd-pm" style={{ ...sectionStyle, padding: 0, overflow: 'auto' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '14px 16px' }}>
                <p style={{ ...sectionTitle, margin: 0 }}>Preventive maintenance plans</p>
                {asset.status !== 'decommissioned' && can('maintenance', 'schedule', 'create') && (
                  <button data-tour="maint-assetd-new-pm-btn" type="button" onClick={() => router.push(`/dashboard/maintenance/schedule/new?asset=${ref}`)} style={secondaryBtnStyle}>+ New PM Plan</button>
                )}
              </div>
              <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 760 }}>
                <thead>
                  <tr>
                    {['Plan', 'Title', 'Every', 'Basis', 'Next Due', 'Last Done', 'Status'].map((h) => (
                      <th key={h} style={{ textAlign: 'left', padding: '10px 14px', fontSize: 11, fontWeight: 600, letterSpacing: '.03em', textTransform: 'uppercase', color: TEXT.muted, background: '#fdf1e6' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {!pmPlans ? (
                    <tr><td colSpan={7} style={{ padding: 20, textAlign: 'center', fontSize: 13, color: TEXT.muted }}>Loading…</td></tr>
                  ) : pmPlans.length === 0 ? (
                    <tr><td colSpan={7} style={{ padding: 20, textAlign: 'center', fontSize: 13, color: TEXT.muted }}>No PM plan on this asset yet. Add one so servicing is raised automatically before it falls due.</td></tr>
                  ) : pmPlans.map((p) => {
                    const dueState = p.due_state || (p.is_active ? 'scheduled' : 'inactive')
                    const overdue = dueState === 'overdue'
                    const dueHex = DUE_HEX[dueState] || '#78716c'
                    return (
                      <tr key={p.id} style={{ cursor: 'pointer' }} onClick={() => router.push(recordPath('/dashboard/maintenance/schedule', p))}>
                        <td style={{ ...cellStyle, fontWeight: 600, color: TEXT.heading }}>{p.plan_code}</td>
                        <td style={cellStyle}>{p.title}</td>
                        <td style={cellStyle}>{p.frequency_value} {PM_FREQUENCY_UNIT_LABELS[p.frequency_unit] || p.frequency_unit}</td>
                        <td style={cellStyle}>{PM_SCHEDULE_BASIS_LABELS[p.schedule_basis] || p.schedule_basis}</td>
                        <td style={{ ...cellStyle, color: overdue ? '#DC2626' : TEXT.body, fontWeight: overdue ? 600 : 400 }}>{formatDate(p.next_due_date)}</td>
                        <td style={cellStyle}>{formatDate(p.last_done_date)}</td>
                        <td style={cellStyle}>
                          <span style={{ fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 9999, background: `${dueHex}1a`, color: dueHex, whiteSpace: 'nowrap' }}>
                            {PM_DUE_STATE_LABELS[dueState] || dueState}
                          </span>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}

          {tab === 'spares' && (
            <div data-tour="maint-assetd-spares" style={sectionStyle}>
              <p style={sectionTitle}>Bill of spares</p>
              <AssetSparesPanel assetId={id} canEdit={asset.status !== 'decommissioned' && can('maintenance', 'assets', 'edit') && af('spare_parts', 'edit')} />
            </div>
          )}

          {tab === 'readings' && (
            <div style={sectionStyle}>
              <p style={sectionTitle}>Counters &amp; measuring points</p>
              <AssetReadingsPanel assetId={id} onChanged={() => maintenanceApi.getAsset(id).then(setAsset).catch(() => undefined)} />
            </div>
          )}

          {tab === 'documents' && (
            <div data-tour="maint-assetd-documents" style={sectionStyle}>
              <p style={sectionTitle}>Manuals, drawings &amp; photos</p>
              <MaintenanceAttachments entityType="asset" entityId={id} defaultDocType="manual" canUpload={af('documents', 'create')} canDeleteFiles={af('documents', 'delete')} />
            </div>
          )}
        </>
      )}

      <ConfirmDialog
        open={confirmDelete}
        title="Delete asset?"
        message={asset ? `${asset.asset_code} will be removed from the register. Its request and work-order history stays on record.` : ''}
        onConfirm={handleDelete}
        onCancel={() => setConfirmDelete(false)}
      />
    </div>
  )
}
