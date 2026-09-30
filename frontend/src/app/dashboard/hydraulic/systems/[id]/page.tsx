'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { hydraulicApi } from '@/lib/api'
import { HydSystem, HydCircuit, HydBom, HydTest, HydMaintenancePlan, HydServiceRecord } from '@/types'
import { TEXT, DANGER, GLASS, SHADOWS, BORDER } from '@/lib/theme'
import { secondaryBtnStyle } from '@/components/shared/ui'
import HydraulicNav from '@/components/hydraulic/HydraulicNav'
import SystemForm from '@/components/hydraulic/SystemForm'
import HydDocumentsPanel from '@/components/hydraulic/HydDocumentsPanel'
import ConfirmDialog from '@/components/erp/ConfirmDialog'
import { extractErrorMessages } from '@/lib/validation'
import { formatDate } from '@/lib/format'
import {
  SYSTEM_TYPE_LABELS, SYSTEM_TYPE_HEX, SYSTEM_STATUS_LABELS, TEST_TYPE_LABELS, MAINTENANCE_TYPE_LABELS, SERVICE_TYPE_LABELS,
} from '@/components/hydraulic/labels'

const STATUS_HEX: Record<string, string> = {
  design: '#78716c', under_build: '#2563EB', testing: '#7C3AED', commissioned: '#0f766e',
  in_service: '#16A34A', under_maintenance: '#F59E0B', decommissioned: '#57534e',
}
const CIRCUIT_STATUS_LABELS: Record<string, string> = { draft: 'Draft', under_review: 'Under Review', approved: 'Approved', superseded: 'Superseded' }
const CIRCUIT_STATUS_HEX: Record<string, string> = { draft: '#78716c', under_review: '#F59E0B', approved: '#16A34A', superseded: '#57534e' }
const BOM_STATUS_LABELS: Record<string, string> = { draft: 'Draft', released: 'Released', obsolete: 'Obsolete' }
const BOM_STATUS_HEX: Record<string, string> = { draft: '#78716c', released: '#16A34A', obsolete: '#57534e' }
const TEST_STATUS_LABELS: Record<string, string> = { planned: 'Planned', in_progress: 'In Progress' }
const TEST_STATUS_HEX: Record<string, string> = { planned: '#78716c', in_progress: '#2563EB' }
const RESULT_LABELS: Record<string, string> = { pending: 'Pending', pass: 'Pass', fail: 'Fail', conditional: 'Conditional' }
const RESULT_HEX: Record<string, string> = { pending: '#78716c', pass: '#16A34A', fail: '#DC2626', conditional: '#F59E0B' }
const DUE_LABELS: Record<string, string> = { overdue: 'Overdue', due_soon: 'Due Soon', ok: 'On Track', inactive: 'Inactive' }
const DUE_HEX: Record<string, string> = { overdue: '#DC2626', due_soon: '#F59E0B', ok: '#16A34A', inactive: '#78716c' }
const SERVICE_STATUS_LABELS: Record<string, string> = { open: 'Open', in_progress: 'In Progress', completed: 'Completed', cancelled: 'Cancelled' }
const SERVICE_STATUS_HEX: Record<string, string> = { open: '#2563EB', in_progress: '#F59E0B', completed: '#16A34A', cancelled: '#78716c' }

const cardStyle: React.CSSProperties = {
  borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur,
  border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), padding: 20, marginBottom: 20,
}
const rowStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 12, padding: '9px 0', borderTop: `1px solid ${BORDER.light}`, cursor: 'pointer', flexWrap: 'wrap', fontSize: 13 }
const codeStyle: React.CSSProperties = { fontWeight: 600, color: TEXT.heading, minWidth: 110, whiteSpace: 'nowrap' }
const titleStyle: React.CSSProperties = { flex: '1 1 200px', minWidth: 0, color: TEXT.body, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }
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
  title, related, newLabel, onNew, empty, render,
}: {
  title: string
  related: Related<T>
  newLabel: string
  onNew: () => void
  empty: string
  render: (row: T) => React.ReactNode
}) {
  const rows = related.rows
  return (
    <div style={cardStyle}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 10 }}>
        <h2 style={{ fontSize: 15, fontWeight: 700, color: TEXT.heading, margin: 0 }}>{title}{rows ? ` (${rows.length})` : ''}</h2>
        {rows && <span onClick={onNew} style={{ fontSize: 12.5, fontWeight: 600, color: '#FF6A2A', cursor: 'pointer' }}>{newLabel}</span>}
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
  const router = useRouter()
  const params = useParams()
  const systemId = Number(params.id)

  const [system, setSystem] = useState<HydSystem | null>(null)
  const [circuits, setCircuits] = useState<Related<HydCircuit>>(emptyRelated)
  const [boms, setBoms] = useState<Related<HydBom>>(emptyRelated)
  const [tests, setTests] = useState<Related<HydTest>>(emptyRelated)
  const [plans, setPlans] = useState<Related<HydMaintenancePlan>>(emptyRelated)
  const [services, setServices] = useState<Related<HydServiceRecord>>(emptyRelated)
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
    loadRelated<HydMaintenancePlan>(() => hydraulicApi.listPlans(q), setPlans)
    loadRelated<HydServiceRecord>(() => hydraulicApi.listServiceRecords(q), setServices)
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

  const go = (path: string) => () => router.push(`/dashboard/hydraulic/${path}`)
  const newFor = (entity: string) => go(`${entity}/new?system_id=${systemId}`)

  const summary: string[] = []
  if (system) {
    if (system.project_label) summary.push(`Project ${system.project_label}`)
    if (system.branch_name) summary.push(system.branch_name)
    if (system.equipment_ref) summary.push(`Serial ${system.equipment_ref}`)
    if (system.owner_name) summary.push(`Owner ${system.owner_name}`)
    summary.push(`${system.running_hours.toLocaleString('en-IN')} running hrs`)
    if (system.commissioned_on) summary.push(`Commissioned ${formatDate(system.commissioned_on)}`)
  }

  return (
    <div>
      <HydraulicNav />

      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
        <div>
          <p style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 4px' }}>
            Hydraulic &amp; Pneumatic · System
          </p>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', margin: '0 0 20px' }}>
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
          {system && (
            <button type="button" onClick={() => setConfirmDelete(true)} style={{ ...secondaryBtnStyle, color: DANGER.primary, borderColor: DANGER.border }}>Delete</button>
          )}
          <button onClick={() => router.push('/dashboard/hydraulic/systems')} type="button" style={secondaryBtnStyle}>← Back</button>
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
          <p style={{ fontSize: 13, color: TEXT.secondary, margin: '0 0 14px' }}>
            {summary.join(' · ')}
            {system.open_service_count > 0 && <> · <span style={{ color: '#F59E0B', fontWeight: 600 }}>{system.open_service_count} open service job(s)</span></>}
            {system.overdue_plan_count > 0 && <> · <span style={{ color: '#DC2626', fontWeight: 600 }}>{system.overdue_plan_count} overdue PM plan(s)</span></>}
          </p>

          <SystemForm
            key={system.updated_at}
            initial={system}
            submitLabel="Save Changes"
            onSubmit={async (payload) => {
              setSaved(false)
              const updated = await hydraulicApi.updateSystem(systemId, payload)
              setSystem(updated)
              setSaved(true)
            }}
          />

          <div style={{ marginTop: 20 }}>
            <RelatedCard<HydCircuit>
              title="Circuits" related={circuits} newLabel="+ New circuit" onNew={newFor('circuits')}
              empty="No circuit drawings yet — add the circuit diagram so it can go through review and approval."
              render={(c) => (
                <div key={c.id} onClick={go(`circuits/${c.id}`)} style={rowStyle}>
                  <span style={codeStyle}>{c.circuit_number} Rev {c.revision}</span>
                  <span style={titleStyle}>{c.title}</span>
                  {c.drawing_number && <span style={metaStyle}>Dwg {c.drawing_number}</span>}
                  <Badge label={CIRCUIT_STATUS_LABELS[c.status] || c.status} hex={CIRCUIT_STATUS_HEX[c.status] || '#78716c'} />
                </div>
              )}
            />

            <RelatedCard<HydBom>
              title="Bills of Material" related={boms} newLabel="+ New BOM" onNew={newFor('bom')}
              empty="No BOM yet — build one from the component master to get a cost roll-up for this system."
              render={(b) => (
                <div key={b.id} onClick={go(`bom/${b.id}`)} style={rowStyle}>
                  <span style={codeStyle}>{b.bom_number} Rev {b.revision}</span>
                  <span style={titleStyle}>{b.title}</span>
                  <span style={metaStyle}>{b.line_count} line(s) · ₹{b.total_cost.toLocaleString('en-IN')}</span>
                  <Badge label={BOM_STATUS_LABELS[b.status] || b.status} hex={BOM_STATUS_HEX[b.status] || '#78716c'} />
                </div>
              )}
            />

            <RelatedCard<HydTest>
              title="Tests" related={tests} newLabel="+ New test" onNew={newFor('testing')}
              empty="No tests recorded — plan a pressure, leak or functional test before commissioning."
              render={(t) => (
                <div key={t.id} onClick={go(`testing/${t.id}`)} style={rowStyle}>
                  <span style={codeStyle}>{t.test_number}</span>
                  <span style={titleStyle}>{t.title}</span>
                  <span style={metaStyle}>{TEST_TYPE_LABELS[t.test_type] || t.test_type} · {formatDate(t.test_date)}</span>
                  {t.status === 'completed'
                    ? <Badge label={RESULT_LABELS[t.result] || t.result} hex={RESULT_HEX[t.result] || '#78716c'} />
                    : <Badge label={TEST_STATUS_LABELS[t.status] || t.status} hex={TEST_STATUS_HEX[t.status] || '#78716c'} />}
                </div>
              )}
            />

            <RelatedCard<HydMaintenancePlan>
              title="Maintenance Plans" related={plans} newLabel="+ New plan" onNew={newFor('maintenance')}
              empty="No maintenance plans — set up oil changes, filter changes and inspections so they come due automatically."
              render={(p) => (
                <div key={p.id} onClick={go(`maintenance/${p.id}`)} style={rowStyle}>
                  <span style={codeStyle}>{p.plan_number}</span>
                  <span style={titleStyle}>{p.title}</span>
                  <span style={metaStyle}>{MAINTENANCE_TYPE_LABELS[p.maintenance_type] || p.maintenance_type}</span>
                  <span style={{ ...metaStyle, color: p.due_status === 'overdue' ? '#DC2626' : TEXT.muted, fontWeight: p.due_status === 'overdue' ? 600 : 400 }}>
                    {p.next_due_date ? `Due ${formatDate(p.next_due_date)}` : p.next_due_hours != null ? `Due at ${p.next_due_hours.toLocaleString('en-IN')} hrs` : 'No due date'}
                    {p.due_status === 'overdue' && p.days_to_due != null && p.days_to_due < 0 ? ` (${-p.days_to_due}d overdue)` : ''}
                  </span>
                  <Badge label={DUE_LABELS[p.due_status] || p.due_status} hex={DUE_HEX[p.due_status] || '#78716c'} />
                </div>
              )}
            />

            <RelatedCard<HydServiceRecord>
              title="Service History" related={services} newLabel="+ New service record" onNew={newFor('service')}
              empty="No service records yet — log breakdowns, overhauls and completed PM jobs here."
              render={(r) => (
                <div key={r.id} onClick={go(`service/${r.id}`)} style={rowStyle}>
                  <span style={codeStyle}>{r.record_number}</span>
                  <span style={titleStyle}>{SERVICE_TYPE_LABELS[r.service_type] || r.service_type}{r.plan_number ? ` · ${r.plan_number}` : ''}</span>
                  <span style={metaStyle}>{formatDate(r.service_date)}{r.total_cost ? ` · ₹${r.total_cost.toLocaleString('en-IN')}` : ''}</span>
                  <Badge label={SERVICE_STATUS_LABELS[r.status] || r.status} hex={SERVICE_STATUS_HEX[r.status] || '#78716c'} />
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
        message={`${system?.system_number} will be removed from the systems list and pickers, and its maintenance plans will be deactivated. Circuits, tests and service history keep their link. If the system is just out of use, set its status to Decommissioned instead.`}
        onConfirm={handleDelete}
        onCancel={() => setConfirmDelete(false)}
      />
    </div>
  )
}
