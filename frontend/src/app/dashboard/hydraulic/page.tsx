'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { hydraulicApi } from '@/lib/api'
import { HydDashboard } from '@/types'
import { TEXT, GLASS, SHADOWS, GRADIENTS, BORDER } from '@/lib/theme'
import { secondaryBtnStyle } from '@/components/shared/ui'
import HydraulicNav from '@/components/hydraulic/HydraulicNav'
import { TEST_TYPE_LABELS, SERVICE_TYPE_LABELS, CRITICALITY_LABELS, CRITICALITY_HEX } from '@/components/hydraulic/labels'
import { extractErrorMessages } from '@/lib/validation'
import { formatDate } from '@/lib/format'

const RESULT_LABELS: Record<string, string> = { pending: 'Pending', pass: 'Pass', fail: 'Fail', conditional: 'Conditional' }
const RESULT_HEX: Record<string, string> = { pending: '#78716c', pass: '#16A34A', fail: '#DC2626', conditional: '#F59E0B' }
const TEST_STATUS_LABELS: Record<string, string> = { planned: 'Planned', in_progress: 'In Progress' }
const TEST_STATUS_HEX: Record<string, string> = { planned: '#78716c', in_progress: '#2563EB' }
const SERVICE_STATUS_LABELS: Record<string, string> = { open: 'Open', in_progress: 'In Progress', completed: 'Completed', cancelled: 'Cancelled' }
const SERVICE_STATUS_HEX: Record<string, string> = { open: '#2563EB', in_progress: '#F59E0B', completed: '#16A34A', cancelled: '#78716c' }
const STOCK_LABELS: Record<string, string> = { low: 'Low', out: 'Out of stock' }
const STOCK_HEX: Record<string, string> = { low: '#F59E0B', out: '#DC2626' }

const cardStyle: React.CSSProperties = {
  borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur,
  border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), padding: 18,
}
const sectionTitle: React.CSSProperties = { fontSize: 12, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.secondary, margin: '0 0 12px' }
const groupTitle: React.CSSProperties = { fontSize: 11.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 8px' }
const kpiGrid: React.CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 14, marginBottom: 18 }
const rowStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 10, padding: '9px 0', borderTop: `1px solid ${BORDER.light}`, cursor: 'pointer', flexWrap: 'wrap' }
const codeStyle: React.CSSProperties = { fontSize: 13, fontWeight: 600, color: TEXT.heading, minWidth: 100, whiteSpace: 'nowrap' }
const nameStyle: React.CSSProperties = { fontSize: 13, color: TEXT.body, flex: '1 1 160px', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }
const metaStyle: React.CSSProperties = { fontSize: 12, color: TEXT.muted, whiteSpace: 'nowrap' }

function Kpi({ label, value, sub, hex, onClick }: { label: string; value: string | number; sub?: string; hex?: string; onClick?: () => void }) {
  return (
    <div onClick={onClick} style={{ ...cardStyle, cursor: onClick ? 'pointer' : 'default' }}>
      <p style={{ fontSize: 11, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 6px' }}>{label}</p>
      <p style={{ fontSize: 26, fontWeight: 700, margin: 0, color: hex || TEXT.heading }}>{value}</p>
      {sub && <p style={{ fontSize: 12, color: TEXT.muted, margin: '4px 0 0' }}>{sub}</p>}
    </div>
  )
}

function Badge({ label, hex }: { label: string; hex: string }) {
  return (
    <span style={{ fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 9999, background: `${hex}1a`, color: hex, whiteSpace: 'nowrap' }}>
      {label}
    </span>
  )
}

function Empty({ text }: { text: string }) {
  return <p style={{ fontSize: 13, color: TEXT.muted, margin: 0 }}>{text}</p>
}

function dueText(status: string, days?: number | null): string {
  if (days == null) return status === 'overdue' ? 'Running hours past due' : 'Due by running hours'
  if (days < 0) return `${-days}d overdue`
  if (status === 'overdue') return 'Running hours past due'
  if (days === 0) return 'Due today'
  return `Due in ${days}d`
}

export default function HydraulicDashboardPage() {
  const { isAuthorized, isLoading } = useRequireApp('hydraulic')
  const router = useRouter()
  const [data, setData] = useState<HydDashboard | null>(null)
  const [error, setError] = useState<string | string[]>('')

  useEffect(() => {
    if (!isAuthorized) return
    hydraulicApi.getDashboard()
      .then(setData)
      .catch((err) => setError(extractErrorMessages(err, 'Failed to load the Hydraulic & Pneumatic dashboard.')))
  }, [isAuthorized])

  if (isLoading || !isAuthorized) return null

  const k = data?.kpis
  const go = (path: string) => () => router.push(`/dashboard/hydraulic${path}`)
  const totalSystems = k ? k.hydraulic_systems + k.pneumatic_systems : 0

  return (
    <div>
      <HydraulicNav />

      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, marginBottom: 20, flexWrap: 'wrap' }}>
        <div>
          <p style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 4px' }}>
            Hydraulic &amp; Pneumatic
          </p>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: TEXT.heading, margin: 0 }}>Hydraulic &amp; Pneumatic Dashboard</h1>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <button type="button" onClick={go('/calculations/new')} style={secondaryBtnStyle}>Calculator</button>
          <button
            type="button"
            onClick={go('/systems/new')}
            style={{
              padding: '12px 22px', borderRadius: 12, border: 'none', cursor: 'pointer',
              background: GRADIENTS.primary, color: '#fff', fontSize: 14, fontWeight: 600,
              boxShadow: `0 8px 20px ${SHADOWS.glowOrange}`,
            }}
          >
            + New System
          </button>
        </div>
      </div>

      {error && (
        <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
          {Array.isArray(error) ? error.join(' ') : error}
        </div>
      )}

      {k && data && (
        <>
          {totalSystems === 0 && (
            <div style={{ ...cardStyle, marginBottom: 18, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
              <p style={{ fontSize: 13.5, color: TEXT.body, margin: 0 }}>
                Add your first system — a hydraulic power pack or pneumatic unit — then attach its circuits, BOM, tests and maintenance plans to it.
              </p>
              <span onClick={go('/systems/new')} style={{ fontSize: 13, fontWeight: 600, color: '#FF6A2A', cursor: 'pointer' }}>+ Add your first system</span>
            </div>
          )}

          <p style={groupTitle}>Systems</p>
          <div style={kpiGrid}>
            <Kpi label="Hydraulic Systems" value={k.hydraulic_systems} hex="#0369a1" onClick={go('/systems')} />
            <Kpi label="Pneumatic Systems" value={k.pneumatic_systems} hex="#7C3AED" onClick={go('/systems')} />
            <Kpi label="In Service" value={k.in_service} sub="Commissioned or in service" hex={k.in_service ? '#16A34A' : undefined} onClick={go('/systems')} />
            <Kpi label="Under Maintenance" value={k.under_maintenance} hex={k.under_maintenance ? '#F59E0B' : undefined} onClick={go('/systems')} />
          </div>

          <p style={groupTitle}>Maintenance</p>
          <div style={kpiGrid}>
            <Kpi label="Overdue PM" value={k.plans_overdue} sub="Plans past due date or hours" hex={k.plans_overdue > 0 ? '#DC2626' : undefined} onClick={go('/maintenance')} />
            <Kpi label="Due in 7 Days" value={k.plans_due_soon} hex={k.plans_due_soon > 0 ? '#F59E0B' : undefined} onClick={go('/maintenance')} />
            <Kpi label="Open Service Jobs" value={k.open_service_records} hex={k.open_service_records > 0 ? '#2563EB' : undefined} onClick={go('/service')} />
            <Kpi label="Downtime (30 days)" value={`${k.downtime_hours_30d.toLocaleString('en-IN')} h`} sub="From completed service jobs" />
            <Kpi label="Service Cost (30 days)" value={`₹${k.service_cost_30d.toLocaleString('en-IN')}`} sub="Parts + labour + other" />
          </div>

          <p style={groupTitle}>Quality, Design &amp; Spares</p>
          <div style={{ ...kpiGrid, marginBottom: 20 }}>
            <Kpi label="Tests (30 days)" value={k.tests_30d} sub={k.tests_failed_30d ? `${k.tests_failed_30d} failed` : 'None failed'} hex={k.tests_failed_30d > 0 ? '#DC2626' : undefined} onClick={go('/testing')} />
            <Kpi label="Circuits in Review" value={k.circuits_in_review} hex={k.circuits_in_review > 0 ? '#F59E0B' : undefined} onClick={go('/circuits')} />
            <Kpi label="Draft BOMs" value={k.draft_boms} onClick={go('/bom')} />
            <Kpi label="Spares Low / Out" value={k.spares_low} sub={`${k.critical_spares_out} critical out of stock`} hex={k.critical_spares_out > 0 ? '#DC2626' : k.spares_low > 0 ? '#F59E0B' : undefined} onClick={go('/spares')} />
            <Kpi label="Component Master" value={k.active_components} sub="Active components" onClick={go('/components')} />
          </div>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, marginBottom: 14 }}>
            <div style={{ ...cardStyle, flex: '1 1 380px' }}>
              <p style={sectionTitle}>Maintenance due</p>
              {data.maintenance_due.length === 0 ? (
                <Empty text={totalSystems === 0 ? 'Add your first system, then set up its maintenance plans.' : 'Nothing overdue or due in the next 7 days.'} />
              ) : data.maintenance_due.map((p) => {
                const overdue = p.due_status === 'overdue'
                return (
                  <div key={p.plan_id} onClick={go(`/maintenance/${p.plan_id}`)} style={rowStyle}>
                    <span style={codeStyle}>{p.plan_number}</span>
                    <span style={nameStyle}>{p.title}{p.system_number ? ` · ${p.system_number}` : ''}</span>
                    <span style={metaStyle}>{formatDate(p.next_due_date)}</span>
                    <span style={{ fontSize: 12, fontWeight: 600, color: overdue ? '#DC2626' : '#F59E0B', whiteSpace: 'nowrap' }}>{dueText(p.due_status, p.days_to_due)}</span>
                  </div>
                )
              })}
            </div>
            <div style={{ ...cardStyle, flex: '1 1 380px' }}>
              <p style={sectionTitle}>Open service jobs</p>
              {data.open_services.length === 0 ? (
                <Empty text="No open service jobs. Raise a service record when a system needs a repair or PM job." />
              ) : data.open_services.map((r) => (
                <div key={r.record_id} onClick={go(`/service/${r.record_id}`)} style={rowStyle}>
                  <span style={codeStyle}>{r.record_number}</span>
                  <span style={nameStyle}>{SERVICE_TYPE_LABELS[r.service_type] || r.service_type}{r.system_number ? ` · ${r.system_number}` : ''}</span>
                  <span style={metaStyle}>{formatDate(r.service_date)}</span>
                  <Badge label={SERVICE_STATUS_LABELS[r.status] || r.status} hex={SERVICE_STATUS_HEX[r.status] || '#78716c'} />
                </div>
              ))}
            </div>
          </div>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14 }}>
            <div style={{ ...cardStyle, flex: '1 1 380px' }}>
              <p style={sectionTitle}>Recent tests</p>
              {data.recent_tests.length === 0 ? (
                <Empty text={totalSystems === 0 ? 'Add your first system, then record its pressure, leak and functional tests.' : 'No tests yet — plan a test from the Testing tab.'} />
              ) : data.recent_tests.map((t) => (
                <div key={t.test_id} onClick={go(`/testing/${t.test_id}`)} style={rowStyle}>
                  <span style={codeStyle}>{t.test_number}</span>
                  <span style={nameStyle}>{t.title}</span>
                  <span style={metaStyle}>{TEST_TYPE_LABELS[t.test_type] || t.test_type} · {formatDate(t.test_date)}</span>
                  {t.status === 'completed'
                    ? <Badge label={RESULT_LABELS[t.result] || t.result} hex={RESULT_HEX[t.result] || '#78716c'} />
                    : <Badge label={TEST_STATUS_LABELS[t.status] || t.status} hex={TEST_STATUS_HEX[t.status] || '#78716c'} />}
                </div>
              ))}
            </div>
            <div style={{ ...cardStyle, flex: '1 1 380px' }}>
              <p style={sectionTitle}>Spares to reorder</p>
              {data.low_spares.length === 0 ? (
                <Empty text="No spares below minimum stock. Link spares to Store items and set a minimum so shortages show here." />
              ) : data.low_spares.map((s) => (
                <div key={s.spare_part_id} onClick={go(`/spares/${s.spare_part_id}`)} style={rowStyle}>
                  <span style={codeStyle}>{s.part_code}</span>
                  <span style={nameStyle}>{s.name}</span>
                  <Badge label={CRITICALITY_LABELS[s.criticality] || s.criticality} hex={CRITICALITY_HEX[s.criticality] || '#78716c'} />
                  <span style={metaStyle}>{(s.available_qty ?? 0).toLocaleString('en-IN')} / {s.min_stock_qty.toLocaleString('en-IN')} {s.uom}</span>
                  <Badge label={STOCK_LABELS[s.stock_status] || s.stock_status} hex={STOCK_HEX[s.stock_status] || '#78716c'} />
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
