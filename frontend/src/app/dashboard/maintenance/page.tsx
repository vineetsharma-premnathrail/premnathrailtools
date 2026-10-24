'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { useCan } from '@/lib/permissions'
import { maintenanceApi } from '@/lib/api'
import { MaintenanceDashboard, MaintenanceLookups } from '@/types'
import { TEXT, GLASS, SHADOWS, GRADIENTS, BORDER } from '@/lib/theme'
import MaintenanceNav from '@/components/maintenance/MaintenanceNav'
import { recordPath } from '@/lib/recordRef'
import { extractErrorMessages } from '@/lib/validation'
import { formatDate, formatDateTime } from '@/lib/format'
import { formatINR, formatMinutes, PRIORITY_LABELS, WO_STATUS_LABELS } from '@/components/maintenance/labels'
import Select from '@/components/shared/Select'

const WO_STATUS_HEX: Record<string, string> = { draft: '#78716c', assigned: '#2563EB', in_progress: '#F59E0B', on_hold: '#9333EA', completed: '#16A34A', closed: '#0f766e', cancelled: '#78716c' }
const PRIORITY_HEX: Record<string, string> = { low: '#78716c', normal: '#2563EB', high: '#F59E0B', urgent: '#DC2626' }
const CRIT_HEX: Record<string, string> = { A: '#DC2626', B: '#F59E0B', C: '#78716c' }

const cardStyle: React.CSSProperties = {
  borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur,
  border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), padding: 18,
}
const sectionTitle: React.CSSProperties = { fontSize: 12, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.secondary, margin: '0 0 12px' }
const rowStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 10, padding: '9px 0', borderTop: `1px solid ${BORDER.light}`, cursor: 'pointer', flexWrap: 'wrap' }

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
  // Maintenance costs switch (maintenance:work_orders.costs:view) — the server blanks the number without it.
  const showCosts = useCan().canFeature('maintenance', 'work_orders', 'costs', 'view')
  const router = useRouter()
  const [data, setData] = useState<MaintenanceDashboard | null>(null)
  const [lookups, setLookups] = useState<MaintenanceLookups | null>(null)
  const [branchId, setBranchId] = useState('')
  // KPI drill-downs carry the plant picked here, so the list opened shows the
  // same records the tile counted.
  const plantQs = branchId ? `&branch_id=${branchId}` : ''
  const [error, setError] = useState<string | string[]>('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!isAuthorized) return
    maintenanceApi.getLookups().then(setLookups).catch(() => { /* plant filter is optional */ })
  }, [isAuthorized])

  useEffect(() => {
    if (!isAuthorized) return
    const load = () => maintenanceApi.getDashboard(branchId ? { branch_id: Number(branchId) } : {})
      .then((d) => { setData(d); setError('') })
      .catch((err) => setError(extractErrorMessages(err, 'Failed to load maintenance dashboard.')))
      .finally(() => setLoading(false))
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
            <Select data-tour="maint-dash-plant-filter" style={{ width: 200 }} value={branchId} onChange={(e) => setBranchId(e.target.value)}>
              <option value="">All plants</option>
              {lookups.branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </Select>
          )}
          <button
            data-tour="maint-dash-report-btn"
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

      {!data && !error && (
        <div style={{ ...cardStyle, fontSize: 13, color: TEXT.muted }}>{loading ? 'Loading dashboard…' : 'No dashboard data.'}</div>
      )}

      {c && m && data && (
        <>
          <div data-tour="maint-dash-kpi-live" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 14, marginBottom: 14 }}>
            <Kpi label="Machines Down" value={c.down} sub={`of ${c.assets} assets`} hex={c.down ? '#DC2626' : '#16A34A'} onClick={() => router.push(`/dashboard/maintenance/assets?status=down${plantQs}`)} />
            <Kpi label="Open Requests" value={c.open_requests} sub="Awaiting acknowledgement" hex={c.open_requests ? '#F59E0B' : undefined} onClick={() => router.push(`/dashboard/maintenance/requests?status=open${plantQs}`)} />
            <Kpi label="Open Work Orders" value={c.open_work_orders} sub={`${c.my_work_orders} assigned to me`} onClick={() => router.push(`/dashboard/maintenance/work-orders${plantQs ? `?${plantQs.slice(1)}` : ''}`)} />
            <Kpi label="Awaiting Close" value={c.awaiting_close} sub="Completed, not yet closed" hex={c.awaiting_close ? '#2563EB' : undefined} onClick={() => router.push(`/dashboard/maintenance/work-orders?status=completed${plantQs}`)} />
          </div>
          <div data-tour="maint-dash-kpi-30d" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 14, marginBottom: 20 }}>
            <Kpi label="Breakdowns (30 days)" value={m.breakdowns} />
            <Kpi label="Downtime (30 days)" value={formatMinutes(m.downtime_minutes)} hex={m.downtime_minutes ? '#DC2626' : undefined} />
            <Kpi label="MTTR (30 days)" value={formatMinutes(m.mttr_minutes)} sub="Mean time to repair" />
            {showCosts && <Kpi label="Maintenance Cost (30 days)" value={formatINR(m.maintenance_cost)} sub="Spares + labour + external" />}
          </div>
          {data.this_month && (
            <div data-tour="maint-dash-kpi-month" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 14, marginBottom: 20 }}>
              <Kpi label="MTTR (this month)" value={formatMinutes(data.this_month.mttr_minutes)} sub="Avg. repair time per breakdown" onClick={() => router.push('/dashboard/maintenance/reports')} />
              <Kpi label="Availability (this month)" value={data.this_month.availability_pct == null ? '—' : `${data.this_month.availability_pct}%`}
                hex={data.this_month.availability_pct == null ? undefined : data.this_month.availability_pct >= 95 ? '#16A34A' : data.this_month.availability_pct >= 85 ? '#F59E0B' : '#DC2626'}
                sub="Working hours not lost to breakdowns" onClick={() => router.push('/dashboard/maintenance/reports')} />
              <Kpi label="PM Due This Week" value={data.pm_due_this_week?.count ?? 0} sub={`Preventive jobs due in ${data.pm_due_this_week?.window_days ?? 7} days`} onClick={() => router.push(`/dashboard/maintenance/schedule?view=upcoming${plantQs}`)} />
              <Kpi label="PM Overdue" value={data.pm_overdue?.count ?? 0} hex={data.pm_overdue?.count ? '#DC2626' : undefined} sub="Open PM jobs past due date" onClick={() => router.push(`/dashboard/maintenance/schedule?due=overdue${plantQs}`)} />
              <Kpi label="Critical Spares Low" value={data.critical_spares_below_min?.count ?? 0} hex={data.critical_spares_below_min?.count ? '#DC2626' : undefined} sub="Below minimum stock" onClick={() => router.push('/dashboard/maintenance/spares')} />
            </div>
          )}

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, marginBottom: 14 }}>
            <div data-tour="maint-dash-machines-down" style={{ ...cardStyle, flex: '1 1 420px' }}>
              <p style={sectionTitle}>Machines down now</p>
              {data.machines_down.length === 0 ? (
                <p style={{ fontSize: 13, color: TEXT.muted, margin: 0 }}>Every asset is running.</p>
              ) : data.machines_down.map((d) => (
                <div key={d.asset_id} style={rowStyle}
                  onClick={() => router.push(d.work_order_id ? recordPath('/dashboard/maintenance/work-orders', d, 'work_order_id') : recordPath('/dashboard/maintenance/assets', d, 'asset_id'))}>
                  <Pill text={d.criticality} hex={CRIT_HEX[d.criticality] || '#78716c'} />
                  <span style={{ fontSize: 13, fontWeight: 600, color: TEXT.heading, minWidth: 90 }}>{d.asset_code}</span>
                  <span style={{ fontSize: 13, color: TEXT.body, flex: '1 1 140px', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.name}</span>
                  <span style={{ fontSize: 12, color: TEXT.muted }}>{d.wo_number || 'No work order yet'}</span>
                  <span style={{ fontSize: 13, fontWeight: 700, color: '#DC2626', minWidth: 70, textAlign: 'right' }}>{formatMinutes(d.down_minutes)}</span>
                </div>
              ))}
            </div>
            <div data-tour="maint-dash-open-requests" style={{ ...cardStyle, flex: '1 1 420px' }}>
              <p style={sectionTitle}>Open requests</p>
              {data.open_requests.length === 0 ? (
                <p style={{ fontSize: 13, color: TEXT.muted, margin: 0 }}>No requests waiting.</p>
              ) : data.open_requests.map((r) => (
                <div key={r.id} style={rowStyle} onClick={() => router.push(recordPath('/dashboard/maintenance/requests', r))}>
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
            <div data-tour="maint-dash-my-wos" style={{ ...cardStyle, flex: '1 1 420px' }}>
              <p style={sectionTitle}>My work orders</p>
              {data.my_work_orders.length === 0 ? (
                <p style={{ fontSize: 13, color: TEXT.muted, margin: 0 }}>Nothing assigned to you.</p>
              ) : data.my_work_orders.map((w) => (
                <div key={w.id} style={rowStyle} onClick={() => router.push(recordPath('/dashboard/maintenance/work-orders', w))}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: TEXT.heading, minWidth: 120 }}>{w.wo_number}</span>
                  <span style={{ fontSize: 13, color: TEXT.body, flex: '1 1 160px', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{w.asset_code} — {w.title}</span>
                  <Pill text={PRIORITY_LABELS[w.priority] || w.priority} hex={PRIORITY_HEX[w.priority] || '#78716c'} />
                  <Pill text={WO_STATUS_LABELS[w.status] || w.status} hex={WO_STATUS_HEX[w.status] || '#78716c'} />
                  {w.planned_start && <span style={{ fontSize: 12, color: TEXT.muted }}>{formatDate(w.planned_start)}</span>}
                </div>
              ))}
            </div>
            <div data-tour="maint-dash-awaiting-close" style={{ ...cardStyle, flex: '1 1 420px' }}>
              <p style={sectionTitle}>Completed — awaiting close</p>
              {data.awaiting_close.length === 0 ? (
                <p style={{ fontSize: 13, color: TEXT.muted, margin: 0 }}>Nothing waiting to be closed.</p>
              ) : data.awaiting_close.map((w) => (
                <div key={w.id} style={rowStyle} onClick={() => router.push(recordPath('/dashboard/maintenance/work-orders', w))}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: TEXT.heading, minWidth: 120 }}>{w.wo_number}</span>
                  <span style={{ fontSize: 13, color: TEXT.body, flex: '1 1 160px', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{w.asset_code} — {w.title}</span>
                  {w.awaiting_confirmation
                    ? <Pill text="Waiting for requester" hex="#F59E0B" />
                    : <Pill text="Ready to close" hex="#16A34A" />}
                </div>
              ))}
            </div>
          </div>

          {(data.pm_due_this_week || data.pm_overdue || data.critical_spares_below_min) && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, marginTop: 14 }}>
              <div data-tour="maint-dash-pm-due" style={{ ...cardStyle, flex: '1 1 420px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                  <p style={sectionTitle}>Preventive maintenance — overdue & due this week</p>
                  <span onClick={() => router.push('/dashboard/maintenance/schedule')} style={{ fontSize: 12, fontWeight: 600, color: '#FF6A2A', cursor: 'pointer' }}>PM schedule →</span>
                </div>
                {!(data.pm_overdue?.items.length || data.pm_due_this_week?.items.length) ? (
                  <p style={{ fontSize: 13, color: TEXT.muted, margin: 0 }}>Nothing overdue and nothing due this week.</p>
                ) : (
                  <>
                    {data.pm_overdue?.items.map((w) => (
                      <div key={`o${w.id}`} style={rowStyle} onClick={() => router.push(recordPath('/dashboard/maintenance/work-orders', w))}>
                        <span style={{ fontSize: 13, fontWeight: 600, color: TEXT.heading, minWidth: 120 }}>{w.wo_number}</span>
                        <span style={{ fontSize: 13, color: TEXT.body, flex: '1 1 160px', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{w.asset_code} — {w.title}</span>
                        <Pill text={`${w.days_overdue}d overdue`} hex="#DC2626" />
                        <span style={{ fontSize: 12, color: TEXT.muted }}>Due {formatDate(w.due_date)}</span>
                      </div>
                    ))}
                    {data.pm_due_this_week?.items.map((p) => (
                      <div key={`${p.kind}${p.id}`} style={rowStyle}
                        onClick={() => router.push(recordPath(p.kind === 'work_order' ? '/dashboard/maintenance/work-orders' : '/dashboard/maintenance/schedule', p))}>
                        <span style={{ fontSize: 13, fontWeight: 600, color: TEXT.heading, minWidth: 120 }}>{p.number}</span>
                        <span style={{ fontSize: 13, color: TEXT.body, flex: '1 1 160px', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.asset_code} — {p.title}</span>
                        {p.kind === 'plan' ? <Pill text="Job not generated yet" hex="#78716c" /> : <Pill text={WO_STATUS_LABELS[p.status] || p.status} hex={WO_STATUS_HEX[p.status] || '#78716c'} />}
                        <span style={{ fontSize: 12, color: TEXT.muted }}>Due {formatDate(p.due_date)}</span>
                      </div>
                    ))}
                  </>
                )}
              </div>
              <div data-tour="maint-dash-spares-low" style={{ ...cardStyle, flex: '1 1 420px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                  <p style={sectionTitle}>Critical spares below minimum</p>
                  <span onClick={() => router.push('/dashboard/maintenance/spares')} style={{ fontSize: 12, fontWeight: 600, color: '#FF6A2A', cursor: 'pointer' }}>Spares →</span>
                </div>
                {!data.critical_spares_below_min?.items.length ? (
                  <p style={{ fontSize: 13, color: TEXT.muted, margin: 0 }}>All critical spares are at or above minimum stock.</p>
                ) : data.critical_spares_below_min.items.map((s) => (
                  <div key={s.store_item_id} style={rowStyle} onClick={() => router.push('/dashboard/maintenance/spares')}>
                    <span style={{ fontSize: 13, fontWeight: 600, color: TEXT.heading, minWidth: 100 }}>{s.item_code}</span>
                    <span style={{ fontSize: 13, color: TEXT.body, flex: '1 1 160px', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.item_name}</span>
                    <span style={{ fontSize: 12, color: TEXT.muted }}>{s.asset_count} asset(s)</span>
                    <span style={{ fontSize: 13, fontWeight: 700, color: '#DC2626' }}>{s.on_hand} / {s.minimum_stock} {s.uom || ''}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
