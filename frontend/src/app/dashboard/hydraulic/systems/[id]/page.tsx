'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { hydraulicApi } from '@/lib/api'
import { HydSystem, HydCircuit, HydBom, HydTest, HydServiceRecord } from '@/types'
import { TEXT, DANGER, GLASS, SHADOWS, BORDER } from '@/lib/theme'
import { secondaryBtnStyle, InfoRow } from '@/components/shared/ui'
import HydraulicNav from '@/components/hydraulic/HydraulicNav'
import InvalidRecordLink from '@/components/erp/InvalidRecordLink'
import { recordPath, useRecordId } from '@/lib/recordRef'
import { OrderProjectChip } from '@/components/sales/OrderProjectPicker'
import SystemForm from '@/components/hydraulic/SystemForm'
import HydDocumentsPanel from '@/components/hydraulic/HydDocumentsPanel'
import ConfirmDialog from '@/components/erp/ConfirmDialog'
import { extractErrorMessages } from '@/lib/validation'
import { formatDate } from '@/lib/format'
import {
  SYSTEM_TYPE_LABELS, SYSTEM_TYPE_HEX, SYSTEM_STATUS_LABELS, TEST_TYPE_LABELS, SERVICE_TYPE_LABELS, flowUnit, useHydCosts,
} from '@/components/hydraulic/labels'
import { useCan } from '@/lib/permissions'

const STATUS_HEX: Record<string, string> = {
  design: '#78716c', under_build: '#2563EB', testing: '#7C3AED', commissioned: '#0f766e',
  in_service: '#16A34A', under_maintenance: '#F59E0B', decommissioned: '#57534e',
}
const CIRCUIT_STATUS_LABELS: Record<string, string> = { draft: 'Draft', under_review: 'Under Review', approved: 'Approved', superseded: 'Superseded' }
const CIRCUIT_STATUS_HEX: Record<string, string> = { draft: '#78716c', under_review: '#F59E0B', approved: '#16A34A', superseded: '#57534e' }
const BOM_STATUS_LABELS: Record<string, string> = { draft: 'Draft', under_review: 'Awaiting Release Approval', released: 'Released', obsolete: 'Obsolete' }
const BOM_STATUS_HEX: Record<string, string> = { draft: '#78716c', under_review: '#2563EB', released: '#16A34A', obsolete: '#57534e' }
const TEST_STATUS_LABELS: Record<string, string> = { planned: 'Planned', in_progress: 'In Progress' }
const TEST_STATUS_HEX: Record<string, string> = { planned: '#78716c', in_progress: '#2563EB' }
const RESULT_LABELS: Record<string, string> = { pending: 'Pending', pass: 'Pass', fail: 'Fail', conditional: 'Conditional' }
const RESULT_HEX: Record<string, string> = { pending: '#78716c', pass: '#16A34A', fail: '#DC2626', conditional: '#F59E0B' }

const cardStyle: React.CSSProperties = {
  borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur,
  border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), padding: 20, marginBottom: 20,
}
const rowStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 12, padding: '9px 0', borderTop: `1px solid ${BORDER.light}`, cursor: 'pointer', flexWrap: 'wrap', fontSize: 13 }
const codeStyle: React.CSSProperties = { fontWeight: 600, color: TEXT.heading, minWidth: 110, whiteSpace: 'nowrap' }
const titleStyle: React.CSSProperties = { flex: '1 1 200px', minWidth: 0, color: TEXT.body, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }
const numText = (v: number | null | undefined) => (v == null ? '—' : String(v))
const metaStyle: React.CSSProperties = { fontSize: 12, color: TEXT.muted, whiteSpace: 'nowrap' }

function Badge({ label, hex }: { label: string; hex: string }) {
  return (
    <span style={{ fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 9999, background: `${hex}1a`, color: hex, whiteSpace: 'nowrap' }}>
      {label}
    </span>
  )
}

/** One related-records list; `rows === null` means the fetch was refused/failed. */
interface Related<T> { rows: T[] | null; loaded: boolean }
const emptyRelated = { rows: [], loaded: false }

function RelatedCard<T>({
  title, related, newLabel, onNew, empty, render, tourId, canNew = true,
}: {
  tourId?: string
  /** Whether the user may create one (the "+ New" link renders only then). */
  canNew?: boolean
  title: string
  related: Related<T>
  newLabel: string
  onNew: () => void
  empty: string
  render: (row: T) => React.ReactNode
}) {
  const rows = related.rows
  return (
    <div data-tour={tourId} style={cardStyle}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 10 }}>
        <h2 style={{ fontSize: 15, fontWeight: 700, color: TEXT.heading, margin: 0 }}>{title}{rows ? ` (${rows.length})` : ''}</h2>
        {rows && canNew && <span data-tour={tourId ? `${tourId}-new` : undefined} onClick={onNew} style={{ fontSize: 12.5, fontWeight: 600, color: '#FF6A2A', cursor: 'pointer' }}>{newLabel}</span>}
      </div>
      {!related.loaded ? (
        <p style={{ fontSize: 13, color: TEXT.muted, margin: 0 }}>Loading…</p>
      ) : rows === null ? (
        <p style={{ fontSize: 13, color: TEXT.muted, margin: 0 }}>Not available — you may not have access to this tab. Ask an admin if you need it.</p>
      ) : rows.length === 0 ? (
        <p style={{ fontSize: 13, color: TEXT.muted, margin: 0 }}>{empty}</p>
      ) : (
        <div style={{ maxHeight: 360, overflowY: 'auto' }}>{rows.map(render)}</div>
      )}
    </div>
  )
}

/** Fetches a related list; a failure (e.g. 403 on that tab) only blanks that card. */
function loadRelated<T>(fetcher: () => Promise<unknown>, set: (r: Related<T>) => void) {
  fetcher()
    .then((data) => set({ rows: Array.isArray(data) ? (data as T[]) : [], loaded: true }))
    .catch(() => set({ rows: null, loaded: true }))
}

export default function HydSystemDetailPage() {
  const { isAuthorized, isLoading, user } = useRequireApp('hydraulic')
  const { can, canDelete } = useCan()
  const seeCosts = useHydCosts()  // Hydraulic › BOM › Prices & costs
  // Backend: system edit needs systems:edit; the "+ New" links open create forms of their own tabs.
  const canEditSystem = can('hydraulic', 'systems', 'edit')
  const [editOpen, setEditOpen] = useState(false)
  const router = useRouter()
  const params = useParams()
  const ref = params.id as string
  const { id: resolvedId, error: linkError } = useRecordId(ref)
  const systemId = resolvedId ?? 0

  const [system, setSystem] = useState<HydSystem | null>(null)
  const [circuits, setCircuits] = useState<Related<HydCircuit>>(emptyRelated)
  const [boms, setBoms] = useState<Related<HydBom>>(emptyRelated)
  const [tests, setTests] = useState<Related<HydTest>>(emptyRelated)
  // Service records are retired (rule R5); only open legacy jobs are surfaced so they can be cancelled.
  const [openServices, setOpenServices] = useState<HydServiceRecord[]>([])
  const [error, setError] = useState<string | string[]>('')
  const [saved, setSaved] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  useEffect(() => {
    if (!isAuthorized || !systemId) return
    hydraulicApi.getSystem(systemId)
      .then(setSystem)
      .catch((err) => setError(extractErrorMessages(err, 'Failed to load system.')))
    const q = { system_id: systemId }
    loadRelated<HydCircuit>(() => hydraulicApi.listCircuits(q), setCircuits)
    loadRelated<HydBom>(() => hydraulicApi.listBoms(q), setBoms)
    loadRelated<HydTest>(() => hydraulicApi.listTests(q), setTests)
    hydraulicApi.listServiceRecords(q)
      .then((rows: HydServiceRecord[]) => setOpenServices((Array.isArray(rows) ? rows : []).filter((r) => r.status === 'open' || r.status === 'in_progress')))
      .catch(() => setOpenServices([]))
  }, [isAuthorized, systemId])

  const handleDelete = async () => {
    setConfirmDelete(false)
    try {
      await hydraulicApi.deleteSystem(systemId)
      router.push('/dashboard/hydraulic/systems')
    } catch (err) {
      setError(extractErrorMessages(err, 'Failed to delete system.'))
    }
  }

  if (isLoading || !isAuthorized) return null
  if (linkError) return (<div><HydraulicNav /><InvalidRecordLink message={linkError} listHref="/dashboard/hydraulic/systems" listLabel="Back to systems" /></div>)
  if (!resolvedId) return <div><HydraulicNav /></div>

  const go = (path: string) => () => router.push(`/dashboard/hydraulic/${path}`)
  const newFor = (entity: string) => go(`${entity}/new?system_id=${ref}`)

  const summary: string[] = []
  if (system) {
    if (system.project_label) summary.push(`Project ${system.project_label}`)
    if (system.branch_name) summary.push(system.branch_name)
    if (system.equipment_ref) summary.push(`Serial ${system.equipment_ref}`)
    if (system.owner_name) summary.push(`Owner ${system.owner_name}`)
  }

  return (
    <div>
      <HydraulicNav />

      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
        <div>
          <p style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 4px' }}>
            Hydraulic &amp; Pneumatic · System
          </p>
          <div data-tour="hyd-sysd-header" style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', margin: '0 0 20px' }}>
            <h1 style={{ fontSize: 24, fontWeight: 700, color: TEXT.heading, margin: 0 }}>{system ? `${system.system_number} — ${system.name}` : 'System'}</h1>
            {system && (
              <>
                <Badge label={SYSTEM_TYPE_LABELS[system.system_type] || system.system_type} hex={SYSTEM_TYPE_HEX[system.system_type]} />
                <Badge label={SYSTEM_STATUS_LABELS[system.status] || system.status} hex={STATUS_HEX[system.status] || '#78716c'} />
              </>
            )}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {system && canDelete('hydraulic', 'systems', (system as { created_by_id?: number | null } | null)?.created_by_id ?? null) && (
            <button data-tour="hyd-sysd-delete-btn" type="button" onClick={() => setConfirmDelete(true)} style={{ ...secondaryBtnStyle, color: DANGER.primary, borderColor: DANGER.border }}>Delete</button>
          )}
          <button data-tour="hyd-sysd-back-btn" onClick={() => router.push('/dashboard/hydraulic/systems')} type="button" style={secondaryBtnStyle}>← Back</button>
        </div>
      </div>

      {error && (
        <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
          {Array.isArray(error) ? error.join(' ') : error}
        </div>
      )}
      {saved && (
        <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(22,163,74,0.08)', border: '1px solid rgba(22,163,74,0.2)', color: '#15803d', fontSize: 13 }}>
          System saved.
        </div>
      )}

      {system && (
        <>
          {openServices.length > 0 && (
            <div style={{ padding: '12px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.25)', fontSize: 13, color: TEXT.body }}>
              <p style={{ margin: '0 0 6px', fontWeight: 600, color: '#b45309' }}>
                {openServices.length} open legacy service record{openServices.length === 1 ? '' : 's'}
              </p>
              <p style={{ margin: '0 0 8px', color: TEXT.secondary }}>
                Hydraulic service records are retired and can no longer be completed. Open each one and Cancel it (with a reason) so the
                system returns to service and can be deleted if needed.
              </p>
              {openServices.map((r) => (
                <div key={r.id} onClick={go(recordPath('service', r))} style={rowStyle}>
                  <span style={codeStyle}>{r.record_number}</span>
                  <span style={titleStyle}>{r.reported_problem || SERVICE_TYPE_LABELS[r.service_type] || r.service_type}</span>
                  <span style={metaStyle}>{SERVICE_TYPE_LABELS[r.service_type] || r.service_type} · {formatDate(r.service_date)}</span>
                  <Badge label={r.status === 'in_progress' ? 'In Progress' : 'Open'} hex={r.status === 'in_progress' ? '#2563EB' : '#F59E0B'} />
                </div>
              ))}
            </div>
          )}

          <p data-tour="hyd-sysd-summary" style={{ fontSize: 13, color: TEXT.secondary, margin: '0 0 14px' }}>
            {summary.join(' · ')}
          </p>

          <div data-tour="hyd-sysd-info" style={cardStyle}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
              <h2 style={{ fontSize: 15, fontWeight: 700, color: TEXT.heading, margin: 0 }}>System Details</h2>
              {canEditSystem && <button data-tour="hyd-sysd-edit-btn" type="button" style={secondaryBtnStyle} onClick={() => { setSaved(false); setEditOpen(true) }}>Edit</button>}
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px 28px' }}>
              <InfoRow label="Application" value={system.application || '—'} />
              {system.order_project_number && (
                <div>
                  <p style={{ fontSize: 10.5, fontWeight: 600, letterSpacing: '.04em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 4px' }}>Order project</p>
                  <OrderProjectChip opNumber={system.order_project_number} elementNo={system.order_project_element_no} label={system.order_project_element_label}
                    onClick={() => router.push(recordPath('/dashboard/sales/order-projects', system, 'order_project_id'))} />
                </div>
              )}
              <InfoRow label="ERP Project" value={system.project_label || '—'} />
              <InfoRow label="Plant" value={system.branch_name || '—'} />
              <InfoRow label="Owner" value={system.owner_name || '—'} />
              <InfoRow label="Loco / Machine Serial" value={system.equipment_ref || '—'} />
            </div>
            <p style={{ fontSize: 12, fontWeight: 600, color: TEXT.secondary, margin: '16px 0 8px' }}>Design Parameters</p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px 28px' }}>
              <InfoRow label="Working Pressure (bar)" value={numText(system.working_pressure_bar)} />
              <InfoRow label="Max Pressure (bar)" value={numText(system.max_pressure_bar)} />
              <InfoRow label={`Flow Rate (${flowUnit(system.system_type)})`} value={numText(system.flow_rate)} />
              <InfoRow label={system.system_type === 'pneumatic' ? 'Air Receiver Volume (L)' : 'Reservoir Volume (L)'} value={numText(system.reservoir_capacity_l)} />
              <InfoRow label="Motor / Compressor Power (kW)" value={numText(system.prime_mover_kw)} />
              <InfoRow label="Fluid / Medium" value={system.fluid_medium || '—'} />
              <InfoRow label="Filtration (micron)" value={numText(system.filtration_micron)} />
              <InfoRow label="Cleanliness Target" value={system.cleanliness_target || '—'} />
              <InfoRow label="Operating Temp (°C)" value={system.operating_temp_min_c != null || system.operating_temp_max_c != null ? `${numText(system.operating_temp_min_c)} to ${numText(system.operating_temp_max_c)}` : '—'} />
            </div>
            {(system.description || system.remarks) && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px 28px', marginTop: 16 }}>
                {system.description && <div style={{ flex: '1 1 300px' }}><InfoRow label="Description" value={system.description} /></div>}
                {system.remarks && <div style={{ flex: '1 1 300px' }}><InfoRow label="Remarks" value={system.remarks} /></div>}
              </div>
            )}
          </div>
          {editOpen && (
            <SystemForm
              mode="sheet"
              title={`Edit ${system.system_number}`}
              subtitle={system.name}
              onCancel={() => setEditOpen(false)}
              initial={system}
              submitLabel="Save Changes"
              onSubmit={async (payload) => {
                setSaved(false)
                const updated = await hydraulicApi.updateSystem(systemId, payload)
                setSystem(updated)
                setEditOpen(false)
                setSaved(true)
              }}
            />
          )}

          <div style={{ marginTop: 20 }}>
            <RelatedCard<HydCircuit>
              tourId="hyd-sysd-circuits"
              title="Circuits" related={circuits} newLabel="+ New circuit" onNew={newFor('circuits')} canNew={can('hydraulic', 'circuits', 'create')}
              empty="No circuit drawings yet — add the circuit diagram so it can go through review and approval."
              render={(c) => (
                <div key={c.id} onClick={go(recordPath('circuits', c))} style={rowStyle}>
                  <span style={codeStyle}>{c.circuit_number} Rev {c.revision}</span>
                  <span style={titleStyle}>{c.title}</span>
                  {c.drawing_number && <span style={metaStyle}>Dwg {c.drawing_number}</span>}
                  <Badge label={CIRCUIT_STATUS_LABELS[c.status] || c.status} hex={CIRCUIT_STATUS_HEX[c.status] || '#78716c'} />
                </div>
              )}
            />

            <RelatedCard<HydBom>
              tourId="hyd-sysd-boms"
              title="Bills of Material" related={boms} newLabel="+ New BOM" onNew={newFor('bom')} canNew={can('hydraulic', 'bom', 'create')}
              empty="No BOM yet — build one from the component master to get a cost roll-up for this system."
              render={(b) => (
                <div key={b.id} onClick={go(recordPath('bom', b))} style={rowStyle}>
                  <span style={codeStyle}>{b.bom_number} Rev {b.revision}</span>
                  <span style={titleStyle}>{b.title}</span>
                  <span style={metaStyle}>{b.line_count} line(s){seeCosts && b.total_cost != null ? ` · ₹${b.total_cost.toLocaleString('en-IN')}` : ''}</span>
                  <Badge label={BOM_STATUS_LABELS[b.status] || b.status} hex={BOM_STATUS_HEX[b.status] || '#78716c'} />
                </div>
              )}
            />

            <RelatedCard<HydTest>
              tourId="hyd-sysd-tests"
              title="Tests" related={tests} newLabel="+ New test" onNew={newFor('testing')} canNew={can('hydraulic', 'testing', 'create')}
              empty="No tests recorded — plan a pressure, leak or functional test before commissioning."
              render={(t) => (
                <div key={t.id} onClick={go(recordPath('testing', t))} style={rowStyle}>
                  <span style={codeStyle}>{t.test_number}</span>
                  <span style={titleStyle}>{t.title}</span>
                  <span style={metaStyle}>{TEST_TYPE_LABELS[t.test_type] || t.test_type} · {formatDate(t.test_date)}</span>
                  {t.status === 'completed'
                    ? <Badge label={RESULT_LABELS[t.result] || t.result} hex={RESULT_HEX[t.result] || '#78716c'} />
                    : <Badge label={TEST_STATUS_LABELS[t.status] || t.status} hex={TEST_STATUS_HEX[t.status] || '#78716c'} />}
                </div>
              )}
            />

          </div>

          <HydDocumentsPanel entityType="system" entityId={system.id} title="System Documents" defaultDocType="ga_drawing"
            currentUserId={user?.id} isAdmin={user?.role === 'admin'} />
        </>
      )}

      <ConfirmDialog
        open={confirmDelete}
        title="Delete system?"
        message={`${system?.system_number} will be removed from the systems list and pickers. Its circuits, BOMs and tests keep their link. If the system is just out of use, set its status to Decommissioned instead.`}
        onConfirm={handleDelete}
        onCancel={() => setConfirmDelete(false)}
      />
    </div>
  )
}
