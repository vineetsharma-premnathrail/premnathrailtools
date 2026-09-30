'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { maintenanceApi } from '@/lib/api'
import { MaintenanceDashboard, MaintenanceLookups } from '@/types'
import { TEXT, GLASS, SHADOWS, GRADIENTS, BORDER } from '@/lib/theme'
import MaintenanceNav from '@/components/maintenance/MaintenanceNav'
import { extractErrorMessages } from '@/lib/validation'
import { formatDate, formatDateTime } from '@/lib/format'
import { formatINR, formatMinutes, PRIORITY_LABELS, WO_STATUS_LABELS } from '@/components/maintenance/labels'

const WO_STATUS_HEX: Record<string, string> = { draft: '#78716c', assigned: '#2563EB', in_progress: '#F59E0B', on_hold: '#9333EA', completed: '#16A34A', closed: '#0f766e', cancelled: '#DC2626' }
const PRIORITY_HEX: Record<string, string> = { low: '#78716c', normal: '#2563EB', high: '#F59E0B', urgent: '#DC2626' }
const CRIT_HEX: Record<string, string> = { A: '#DC2626', B: '#F59E0B', C: '#78716c' }

const cardStyle: React.CSSProperties = {
  borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur,
  border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), padding: 18,
}
const sectionTitle: React.CSSProperties = { fontSize: 12, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.secondary, margin: '0 0 12px' }
const rowStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 10, padding: '9px 0', borderTop: `1px solid ${BORDER.light}`, cursor: 'pointer', flexWrap: 'wrap' }
const selectStyle: React.CSSProperties = {
  padding: '9px 12px', borderRadius: 10, border: `1px solid ${BORDER.normal}`,
  background: 'rgba(255,255,255,.7)', fontSize: 13, outline: 'none', color: TEXT.body,
}

function Kpi({ label, value, sub, hex, onClick }: { label: string; value: string | number; sub?: string; hex?: string; onClick?: () => void }) {
  return (
    <div onClick={onClick} style={{ ...cardStyle, cursor: onClick ? 'pointer' : 'default' }}>
      <p style={{ fontSize: 11, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 6px' }}>{label}</p>
      <p style={{ fontSize: 26, fontWeight: 700, margin: 0, color: hex || TEXT.heading }}>{value}</p>
      {sub && <p style={{ fontSize: 12, color: TEXT.muted, margin: '4px 0 0' }}>{sub}</p>}
    </div>
  )
}

function Pill({ text, hex }: { text: string; hex: string }) {
  return (
    <span style={{ fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 9999, background: `${hex}1a`, color: hex, whiteSpace: 'nowrap' }}>{text}</span>
  )
}

export default function MaintenanceDashboardPage() {
  const { isAuthorized, isLoading } = useRequireApp('maintenance')
  const router = useRouter()
  const [data, setData] = useState<MaintenanceDashboard | null>(null)
  const [lookups, setLookups] = useState<MaintenanceLookups | null>(null)
  const [branchId, setBranchId] = useState('')
  const [error, setError] = useState<string | string[]>('')

  useEffect(() => {
    if (!isAuthorized) return
    maintenanceApi.getLookups().then(setLookups).catch(() => { /* plant filter is optional */ })
  }, [isAuthorized])

  useEffect(() => {
    if (!isAuthorized) return
    const load = () => maintenanceApi.getDashboard(branchId ? { branch_id: Number(branchId) } : {})
      .then((d) => { setData(d); setError('') })
      .catch((err) => setError(extractErrorMessages(err, 'Failed to load maintenance dashboard.')))
    load()
    // Downtime clocks on "machines down" should keep moving.
    const t = setInterval(load, 60000)
    return () => clearInterval(t)
  }, [isAuthorized, branchId])

  if (isLoading || !isAuthorized) return null

  const c = data?.counts
  const m = data?.last_30_days

  return (
    <div>
      <MaintenanceNav />

      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, marginBottom: 20, flexWrap: 'wrap' }}>
        <div>
          <p style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 4px' }}>
            Maintenance Module
          </p>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: TEXT.heading, margin: 0 }}>Maintenance Dashboard</h1>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          {lookups && lookups.branches.length > 1 && (
            <select style={selectStyle} value={branchId} onChange={(e) => setBranchId(e.target.value)}>
              <option value="">All plants</option>
              {lookups.branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          )}
          <button
            onClick={() => router.push('/dashboard/maintenance/requests/new')}
            style={{
              padding: '12px 22px', borderRadius: 12, border: 'none', cursor: 'pointer',
              background: GRADIENTS.primary, color: '#fff', fontSize: 14, fontWeight: 600,
              boxShadow: `0 8px 20px ${SHADOWS.glowOrange}`,
            }}
          >
            + Report Breakdown
          </button>
        </div>
      </div>

      {error && (
        <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
          {Array.isArray(error) ? error.join(' ') : error}
        </div>
      )}

      {c && m && data && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 14, marginBottom: 14 }}>
            <Kpi label="Machines Down" value={c.down} sub={`of ${c.assets} assets`} hex={c.down ? '#DC2626' : '#16A34A'} onClick={() => router.push('/dashboard/maintenance/assets?status=breakdown')} />
            <Kpi label="Open Requests" value={c.open_requests} sub="Awaiting acknowledgement" hex={c.open_requests ? '#F59E0B' : undefined} onClick={() => router.push('/dashboard/maintenance/requests?status=open')} />
            <Kpi label="Open Work Orders" value={c.open_work_orders} sub={`${c.my_work_orders} assigned to me`} onClick={() => router.push('/dashboard/maintenance/work-orders')} />
            <Kpi label="Awaiting Close" value={c.awaiting_close} sub="Completed, not yet closed" hex={c.awaiting_close ? '#2563EB' : undefined} onClick={() => router.push('/dashboard/maintenance/work-orders?status=completed')} />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 14, marginBottom: 20 }}>
            <Kpi label="Breakdowns (30 days)" value={m.breakdowns} />
            <Kpi label="Downtime (30 days)" value={formatMinutes(m.downtime_minutes)} hex={m.downtime_minutes ? '#DC2626' : undefined} />
            <Kpi label="MTTR (30 days)" value={formatMinutes(m.mttr_minutes)} sub="Mean time to repair" />
            <Kpi label="Maintenance Cost (30 days)" value={formatINR(m.maintenance_cost)} sub="Spares + labour + external" />
          </div>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, marginBottom: 14 }}>
            <div style={{ ...cardStyle, flex: '1 1 420px' }}>
              <p style={sectionTitle}>Machines down now</p>
              {data.machines_down.length === 0 ? (
                <p style={{ fontSize: 13, color: TEXT.muted, margin: 0 }}>Every asset is running.</p>
              ) : data.machines_down.map((d) => (
                <div key={d.asset_id} style={rowStyle}
                  onClick={() => router.push(d.work_order_id ? `/dashboard/maintenance/work-orders/${d.work_order_id}` : `/dashboard/maintenance/assets/${d.asset_id}`)}>
                  <Pill text={d.criticality} hex={CRIT_HEX[d.criticality] || '#78716c'} />
                  <span style={{ fontSize: 13, fontWeight: 600, color: TEXT.heading, minWidth: 90 }}>{d.asset_code}</span>
                  <span style={{ fontSize: 13, color: TEXT.body, flex: '1 1 140px', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.name}</span>
                  <span style={{ fontSize: 12, color: TEXT.muted }}>{d.wo_number || 'No work order yet'}</span>
                  <span style={{ fontSize: 13, fontWeight: 700, color: '#DC2626', minWidth: 70, textAlign: 'right' }}>{formatMinutes(d.down_minutes)}</span>
                </div>
              ))}
            </div>
            <div style={{ ...cardStyle, flex: '1 1 420px' }}>
              <p style={sectionTitle}>Open requests</p>
              {data.open_requests.length === 0 ? (
                <p style={{ fontSize: 13, color: TEXT.muted, margin: 0 }}>No requests waiting.</p>
              ) : data.open_requests.map((r) => (
                <div key={r.id} style={rowStyle} onClick={() => router.push(`/dashboard/maintenance/requests/${r.id}`)}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: TEXT.heading, minWidth: 120 }}>{r.request_number}</span>
                  <span style={{ fontSize: 13, color: TEXT.body, flex: '1 1 160px', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.problem_description}>
                    {r.asset_code} — {r.problem_description}
                  </span>
                  {r.machine_down && <Pill text="Machine down" hex="#DC2626" />}
                  <Pill text={PRIORITY_LABELS[r.priority] || r.priority} hex={PRIORITY_HEX[r.priority] || '#78716c'} />
                  <span style={{ fontSize: 12, color: TEXT.muted }}>{formatDateTime(r.reported_at)}</span>
                </div>
              ))}
            </div>
          </div>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14 }}>
            <div style={{ ...cardStyle, flex: '1 1 420px' }}>
              <p style={sectionTitle}>My work orders</p>
              {data.my_work_orders.length === 0 ? (
                <p style={{ fontSize: 13, color: TEXT.muted, margin: 0 }}>Nothing assigned to you.</p>
              ) : data.my_work_orders.map((w) => (
                <div key={w.id} style={rowStyle} onClick={() => router.push(`/dashboard/maintenance/work-orders/${w.id}`)}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: TEXT.heading, minWidth: 120 }}>{w.wo_number}</span>
                  <span style={{ fontSize: 13, color: TEXT.body, flex: '1 1 160px', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{w.asset_code} — {w.title}</span>
                  <Pill text={PRIORITY_LABELS[w.priority] || w.priority} hex={PRIORITY_HEX[w.priority] || '#78716c'} />
                  <Pill text={WO_STATUS_LABELS[w.status] || w.status} hex={WO_STATUS_HEX[w.status] || '#78716c'} />
                  {w.planned_start && <span style={{ fontSize: 12, color: TEXT.muted }}>{formatDate(w.planned_start)}</span>}
                </div>
              ))}
            </div>
            <div style={{ ...cardStyle, flex: '1 1 420px' }}>
              <p style={sectionTitle}>Completed — awaiting close</p>
              {data.awaiting_close.length === 0 ? (
                <p style={{ fontSize: 13, color: TEXT.muted, margin: 0 }}>Nothing waiting to be closed.</p>
              ) : data.awaiting_close.map((w) => (
                <div key={w.id} style={rowStyle} onClick={() => router.push(`/dashboard/maintenance/work-orders/${w.id}`)}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: TEXT.heading, minWidth: 120 }}>{w.wo_number}</span>
                  <span style={{ fontSize: 13, color: TEXT.body, flex: '1 1 160px', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{w.asset_code} — {w.title}</span>
                  {w.awaiting_confirmation
                    ? <Pill text="Waiting for requester" hex="#F59E0B" />
                    : <Pill text="Ready to close" hex="#16A34A" />}
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
