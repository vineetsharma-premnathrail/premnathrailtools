'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { maintenanceApi } from '@/lib/api'
import { MaintenanceLookups, MaintenancePmCalendarEntry, MaintenancePmPlan } from '@/types'
import { TEXT, GLASS, SHADOWS, GRADIENTS, BORDER } from '@/lib/theme'
import MaintenanceNav from '@/components/maintenance/MaintenanceNav'
import { recordPath } from '@/lib/recordRef'
import { extractErrorMessages } from '@/lib/validation'
import { useCan } from '@/lib/permissions'
import { formatDate } from '@/lib/format'
import { PM_DUE_STATE_LABELS, WO_STATUS_LABELS, WO_TYPE_LABELS } from '@/components/maintenance/labels'

const DUE_HEX: Record<string, string> = { overdue: '#DC2626', due_soon: '#F59E0B', scheduled: '#2563EB', inactive: '#78716c' }
// Calendar entry states: projected (overdue / due / upcoming) + generated work-order statuses.
const ENTRY_HEX: Record<string, string> = {
  overdue: '#DC2626', due: '#F59E0B', upcoming: '#2563EB',
  draft: '#78716c', assigned: '#2563EB', in_progress: '#F59E0B', on_hold: '#9333EA', completed: '#16A34A', closed: '#0f766e', cancelled: '#78716c',
}
const ENTRY_LABELS: Record<string, string> = { overdue: 'Overdue', due: 'Due — job raised soon', upcoming: 'Upcoming', ...WO_STATUS_LABELS }

const inputStyle: React.CSSProperties = {
  padding: '9px 12px', borderRadius: 10, border: `1px solid ${BORDER.normal}`,
  background: 'rgba(255,255,255,.7)', fontSize: 13, outline: 'none', color: TEXT.body,
}
const cellStyle: React.CSSProperties = { padding: '10px 14px', fontSize: 13, color: TEXT.body, borderTop: `1px solid ${BORDER.light}` }
const glassBox: React.CSSProperties = {
  borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur,
  border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(),
}

function Pill({ hex, label }: { hex: string; label: string }) {
  return <span style={{ fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 9999, background: `${hex}1a`, color: hex, whiteSpace: 'nowrap' }}>{label}</span>
}

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const parseIso = (s: string) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d) }
const mondayOf = (d: Date) => { const x = new Date(d); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x }
const shortDate = (d: Date) => d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })

export default function MaintenanceSchedulePage() {
  const { isAuthorized, isLoading } = useRequireApp('maintenance')
  const { can } = useCan()
  const router = useRouter()
  const searchParams = useSearchParams()

  const [view, setView] = useState<'plans' | 'upcoming'>(searchParams.get('view') === 'upcoming' ? 'upcoming' : 'plans')
  const [lookups, setLookups] = useState<MaintenanceLookups | null>(null)
  const [error, setError] = useState<string | string[]>('')

  // Plans view
  const [plans, setPlans] = useState<MaintenancePmPlan[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  // Dashboard KPI drill-downs pass the plant they counted (?branch_id=N).
  const [branchId, setBranchId] = useState(searchParams.get('branch_id') || '')
  const [activeFilter, setActiveFilter] = useState<'active' | 'inactive' | ''>('active')
  const [dueFilter, setDueFilter] = useState(searchParams.get('due') || '')

  // Upcoming view
  const [weeks, setWeeks] = useState(8)
  const [entries, setEntries] = useState<MaintenancePmCalendarEntry[]>([])
  const [calLoading, setCalLoading] = useState(false)

  useEffect(() => {
    if (!isAuthorized) return
    maintenanceApi.getLookups().then(setLookups).catch(() => { /* plant filter is optional */ })
  }, [isAuthorized])

  useEffect(() => {
    if (!isAuthorized || view !== 'plans') return
    const params: Record<string, unknown> = {}
    if (search.trim()) params.search = search.trim()
    if (branchId) params.branch_id = Number(branchId)
    if (activeFilter) params.is_active = activeFilter === 'active'
    if (dueFilter === 'overdue') params.overdue = true
    else if (dueFilter) params.due_within_days = Number(dueFilter)
    setLoading(true)
    maintenanceApi.listPmPlans(params)
      .then((data) => { setPlans(Array.isArray(data) ? data : []); setError('') })
      .catch((err) => setError(extractErrorMessages(err, 'Failed to load PM plans.')))
      .finally(() => setLoading(false))
  }, [isAuthorized, view, search, branchId, activeFilter, dueFilter])

  useEffect(() => {
    if (!isAuthorized || view !== 'upcoming') return
    const today = new Date()
    const from = new Date(today); from.setDate(from.getDate() - 60) // pick up overdue jobs
    const to = new Date(today); to.setDate(to.getDate() + weeks * 7)
    setCalLoading(true)
    maintenanceApi.getPmCalendar({ from: iso(from), to: iso(to), ...(branchId ? { branch_id: Number(branchId) } : {}) })
      .then((data) => { setEntries(Array.isArray(data) ? data : []); setError('') })
      .catch((err) => setError(extractErrorMessages(err, 'Failed to load the PM calendar.')))
      .finally(() => setCalLoading(false))
  }, [isAuthorized, view, weeks, branchId])

  // Overdue first, then grouped by week (Mon–Sun). Past entries that are done
  // (closed / completed / cancelled) aren't interesting in an "upcoming" view.
  const groups = useMemo(() => {
    const todayIso = iso(new Date())
    const overdue = entries.filter((e) => e.state === 'overdue')
    const rest = entries.filter((e) => e.state !== 'overdue' && e.date >= iso(mondayOf(new Date())))
    const byWeek = new Map<string, MaintenancePmCalendarEntry[]>()
    for (const e of rest) {
      const key = iso(mondayOf(parseIso(e.date)))
      byWeek.set(key, [...(byWeek.get(key) || []), e])
    }
    const thisWeek = iso(mondayOf(new Date()))
    const out: { key: string; label: string; items: MaintenancePmCalendarEntry[]; tone?: string }[] = []
    if (overdue.length) out.push({ key: 'overdue', label: `Overdue (${overdue.length})`, items: overdue, tone: '#DC2626' })
    for (const [key, items] of Array.from(byWeek.entries()).sort(([a], [b]) => a.localeCompare(b))) {
      const start = parseIso(key)
      const end = new Date(start); end.setDate(end.getDate() + 6)
      const prefix = key === thisWeek ? 'This week' : key < todayIso ? 'Earlier' : `Week of ${shortDate(start)}`
      out.push({ key, label: `${prefix} · ${shortDate(start)} – ${shortDate(end)} (${items.length})`, items })
    }
    return out
  }, [entries])

  if (isLoading || !isAuthorized) return null

  const toggleBtn = (key: 'plans' | 'upcoming', label: string) => (
    <button data-tour={`maint-pm-view-${key}`} type="button" onClick={() => setView(key)} style={{
      padding: '8px 16px', border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 600, borderRadius: 9,
      background: view === key ? '#fff' : 'transparent', color: view === key ? '#FF6A2A' : TEXT.secondary,
      boxShadow: view === key ? '0 1px 4px rgba(0,0,0,0.08)' : 'none',
    }}>{label}</button>
  )

  return (
    <div>
      <MaintenanceNav />

      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, marginBottom: 20, flexWrap: 'wrap' }}>
        <div>
          <p style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 4px' }}>
            Maintenance Module
          </p>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: TEXT.heading, margin: 0 }}>PM Schedule</h1>
          <p style={{ fontSize: 13, color: TEXT.muted, margin: '4px 0 0' }}>
            Preventive plans raise their work orders automatically every morning, a few days before they fall due.
          </p>
        </div>
        {can('maintenance', 'schedule', 'create') && <button
          data-tour="maint-pm-new-btn"
          onClick={() => router.push('/dashboard/maintenance/schedule/new')}
          style={{
            padding: '12px 22px', borderRadius: 12, border: 'none', cursor: 'pointer',
            background: GRADIENTS.primary, color: '#fff', fontSize: 14, fontWeight: 600,
            boxShadow: `0 8px 20px ${SHADOWS.glowOrange}`,
          }}
        >
          + New PM Plan
        </button>}
      </div>

      {error && (
        <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
          {Array.isArray(error) ? error.join(' ') : error}
        </div>
      )}

      <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap', alignItems: 'center' }}>
        <div style={{ display: 'flex', gap: 2, padding: 3, borderRadius: 11, background: 'rgba(0,0,0,0.05)' }}>
          {toggleBtn('plans', 'Plans')}
          {toggleBtn('upcoming', 'Upcoming')}
        </div>
        <select data-tour="maint-pm-plant-filter" style={{ ...inputStyle, flex: '0 1 190px' }} value={branchId} onChange={(e) => setBranchId(e.target.value)}>
          <option value="">All plants</option>
          {(lookups?.branches || []).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
        {view === 'plans' ? (
          <>
            <input data-tour="maint-pm-search" style={{ ...inputStyle, flex: '1 1 220px', minWidth: 180, maxWidth: 360 }} placeholder="Search plan, title or asset…" value={search} onChange={(e) => setSearch(e.target.value)} />
            <select data-tour="maint-pm-active-filter" style={{ ...inputStyle, flex: '0 1 150px' }} value={activeFilter} onChange={(e) => setActiveFilter(e.target.value as 'active' | 'inactive' | '')}>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
              <option value="">All plans</option>
            </select>
            <select data-tour="maint-pm-due-filter" style={{ ...inputStyle, flex: '0 1 170px' }} value={dueFilter} onChange={(e) => setDueFilter(e.target.value)}>
              <option value="">Any due date</option>
              <option value="overdue">Overdue</option>
              <option value="7">Due within 7 days</option>
              <option value="30">Due within 30 days</option>
            </select>
          </>
        ) : (
          <select data-tour="maint-pm-weeks" style={{ ...inputStyle, flex: '0 1 160px' }} value={weeks} onChange={(e) => setWeeks(Number(e.target.value))}>
            <option value={4}>Next 4 weeks</option>
            <option value={8}>Next 8 weeks</option>
            <option value={13}>Next 3 months</option>
            <option value={26}>Next 6 months</option>
          </select>
        )}
      </div>

      {view === 'plans' ? (
        <div data-tour="maint-pm-table" style={{ ...glassBox, overflow: 'auto', maxHeight: 'calc(100vh - 320px)' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 1150 }}>
            <thead>
              <tr>
                {['Plan', 'Asset', 'Title', 'Type', 'Frequency', 'Next Due', 'Last Done', 'Technician', 'Current Job', 'Status', ''].map((h) => (
                  <th key={h} style={{ textAlign: 'left', padding: '10px 14px', fontSize: 11, fontWeight: 600, letterSpacing: '.03em', textTransform: 'uppercase', color: TEXT.muted, position: 'sticky', top: 0, background: '#fdf1e6', zIndex: 1 }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={11} style={{ padding: 20, textAlign: 'center', fontSize: 13, color: TEXT.muted }}>Loading…</td></tr>
              ) : plans.length === 0 ? (
                <tr><td colSpan={11} style={{ padding: 20, textAlign: 'center', fontSize: 13, color: TEXT.muted }}>
                  {search || branchId || dueFilter || activeFilter !== 'active' ? 'No PM plans match these filters.' : 'No PM plans yet. Create one per machine for lubrication, inspections, calibration and other routine servicing.'}
                </td></tr>
              ) : plans.map((p) => {
                const state = p.due_state || 'scheduled'
                return (
                  <tr key={p.id} onClick={() => router.push(recordPath('/dashboard/maintenance/schedule', p))} style={{ cursor: 'pointer' }}>
                    <td style={{ ...cellStyle, fontWeight: 600, color: TEXT.heading, whiteSpace: 'nowrap' }}>{p.plan_code}</td>
                    <td style={cellStyle}><span style={{ fontWeight: 600 }}>{p.asset_code}</span> <span style={{ color: TEXT.muted }}>{p.asset_name}</span></td>
                    <td style={{ ...cellStyle, maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={p.title}>{p.title}</td>
                    <td style={cellStyle}>{WO_TYPE_LABELS[p.wo_type] || p.wo_type}</td>
                    <td style={{ ...cellStyle, whiteSpace: 'nowrap' }}>{p.frequency_label}</td>
                    <td style={{ ...cellStyle, whiteSpace: 'nowrap', fontWeight: 600, color: state === 'overdue' ? '#DC2626' : TEXT.body }}>{p.trigger_type === 'meter' ? '—' : formatDate(p.next_due_date)}{p.next_due_meter != null && <span style={{ display: 'block', fontSize: 11.5, fontWeight: 500, color: TEXT.muted }}>due at {p.next_due_meter} {p.meter_unit || ''} (now {p.current_meter_reading ?? '—'})</span>}</td>
                    <td style={{ ...cellStyle, whiteSpace: 'nowrap' }}>{p.last_done_date ? formatDate(p.last_done_date) : '—'}</td>
                    <td style={cellStyle}>{p.default_assignee_name || <span style={{ color: TEXT.muted }}>Unassigned</span>}</td>
                    <td style={{ ...cellStyle, whiteSpace: 'nowrap' }} onClick={(e) => e.stopPropagation()}>
                      {p.open_work_order_id ? (
                        <span onClick={() => router.push(recordPath('/dashboard/maintenance/work-orders', p, 'open_work_order_id'))} style={{ fontWeight: 600, color: '#FF6A2A', cursor: 'pointer' }}>
                          {p.open_work_order_number}
                        </span>
                      ) : '—'}
                    </td>
                    <td style={cellStyle}><Pill hex={DUE_HEX[state] || '#78716c'} label={PM_DUE_STATE_LABELS[state] || state} /></td>
                    <td onClick={(e) => e.stopPropagation()} style={cellStyle}>
                      <span onClick={() => router.push(recordPath('/dashboard/maintenance/schedule', p))} style={{ fontSize: 12, fontWeight: 600, color: '#FF6A2A', cursor: 'pointer' }}>View</span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div data-tour="maint-pm-upcoming" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {calLoading ? (
            <div style={{ ...glassBox, padding: 20, textAlign: 'center', fontSize: 13, color: TEXT.muted }}>Loading…</div>
          ) : groups.length === 0 ? (
            <div style={{ ...glassBox, padding: 20, textAlign: 'center', fontSize: 13, color: TEXT.muted }}>Nothing due in this window.</div>
          ) : groups.map((g) => (
            <div key={g.key} style={{ ...glassBox, overflow: 'auto' }}>
              <p style={{ fontSize: 12, fontWeight: 700, letterSpacing: '.04em', textTransform: 'uppercase', color: g.tone || TEXT.secondary, margin: 0, padding: '14px 16px 8px' }}>
                {g.label}
              </p>
              <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 760 }}>
                <tbody>
                  {g.items.map((e) => (
                    <tr key={`${e.kind}-${e.plan_id}-${e.date}-${e.work_order_id || ''}`} style={{ cursor: 'pointer' }}
                      onClick={() => router.push(e.work_order_id ? recordPath('/dashboard/maintenance/work-orders', e, 'work_order_id') : recordPath('/dashboard/maintenance/schedule', e, 'plan_id'))}>
                      <td style={{ ...cellStyle, width: 110, whiteSpace: 'nowrap', fontWeight: 600 }}>{formatDate(e.date)}</td>
                      <td style={{ ...cellStyle, width: 200 }}><span style={{ fontWeight: 600 }}>{e.asset_code}</span> <span style={{ color: TEXT.muted }}>{e.asset_name}</span></td>
                      <td style={cellStyle}>{e.title} <span style={{ color: TEXT.muted, fontSize: 12 }}>· {e.plan_code} · {WO_TYPE_LABELS[e.wo_type] || e.wo_type}</span></td>
                      <td style={{ ...cellStyle, width: 170, whiteSpace: 'nowrap' }}>
                        {e.wo_number ? <span style={{ fontWeight: 600, color: '#FF6A2A' }}>{e.wo_number}</span> : <span style={{ color: TEXT.muted }}>Not raised yet</span>}
                        {e.assigned_to_name && <span style={{ display: 'block', fontSize: 12, color: TEXT.muted }}>{e.assigned_to_name}</span>}
                      </td>
                      <td style={{ ...cellStyle, width: 170 }}><Pill hex={ENTRY_HEX[e.state] || '#78716c'} label={ENTRY_LABELS[e.state] || e.state} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
