'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useAuth, useRequireApp } from '@/hooks/useAuth'
import { erpApi } from '@/lib/api'
import { ServiceRequest } from '@/types'
import ErpNav from '@/components/erp/ErpNav'
import { Section, StatChip, RowCount } from '@/components/shared/ui'
import { BarChart, PieChart } from '@/components/shared/charts'
import { extractErrorMessages } from '@/lib/validation'
import { recordPath } from '@/lib/recordRef'
import { formatDate } from '@/lib/format'
import { canViewTab } from '@/lib/tabAccess'

const PRIORITY_COLORS: Record<string, string> = {
  urgent: '#dc2626',
  standard: '#2563eb',
}

const STATUS_COLORS: Record<string, string> = {
  open: '#ea580c',
  acknowledged: '#f59e0b',
  assigned: '#3b82f6',
  scheduled: '#6366f1',
  in_progress: '#2563eb',
  pending_parts: '#eab308',
  on_hold: '#a8a29e',
  work_completed: '#22c55e',
  review: '#14b8a6',
  closed: '#78716c',
  cancelled: '#78716c',
}

const CLOSED_STATUSES = ['closed', 'cancelled']

// Text longer than this is cut with "..." (full text on hover); free-text columns may use two rows (50).
const clip = (v?: string | null, max = 25) => (!v ? '—' : v.length > max ? `${v.slice(0, max).trimEnd()}…` : v)
const clip2 = (v?: string | null) => clip(v, 50)

const thStyle: React.CSSProperties = { textAlign: 'left', padding: '10px 8px', fontSize: 10.5, fontWeight: 600, textTransform: 'uppercase', color: '#a8a29e', whiteSpace: 'nowrap', position: 'sticky', top: 0, background: '#fdf1e6', zIndex: 1 }
const tdText: React.CSSProperties = { padding: '10px 8px', fontSize: 12.5, color: '#57534e' }
const glassCard: React.CSSProperties = { borderRadius: 16, background: 'rgba(255,255,255,.16)', backdropFilter: 'blur(28px)', WebkitBackdropFilter: 'blur(28px)', border: '1px solid rgba(255,255,255,.24)', boxShadow: '0 12px 32px rgba(15,23,42,0.16), 0 2px 6px rgba(15,23,42,.08), inset 0 1px 0 rgba(255,255,255,.35)', overflow: 'hidden' }

function ageInDays(dateStr?: string) {
  if (!dateStr) return null
  const diff = Date.now() - new Date(dateStr).getTime()
  return Math.max(0, Math.floor(diff / (1000 * 60 * 60 * 24)))
}

/** What the count chips, bars and legend rows narrow the Recent Service Tickets table to. */
type TicketFilter = { active: boolean; status: string; priority: string }
const NO_FILTER: TicketFilter = { active: false, status: '', priority: '' }
const sameFilter = (a: TicketFilter, b: TicketFilter) => a.active === b.active && a.status === b.status && a.priority === b.priority

export default function ErpDashboardPage() {
  const { user } = useAuth()
  const { isAuthorized, isLoading } = useRequireApp('erp')
  const router = useRouter()
  const [srs, setSrs] = useState<ServiceRequest[]>([])
  const [loading, setLoading] = useState(true)
  const [loadErrors, setLoadErrors] = useState<string[]>([])
  const [filter, setFilter] = useState<TicketFilter>(NO_FILTER)
  // Clicking what is already applied clears it, so every chip is a toggle.
  const applyFilter = (next: TicketFilter) => setFilter((cur) => (sameFilter(cur, next) ? NO_FILTER : next))

  // Role & Permissions › Service Module › Dashboard decides who sees this page; anyone without it lands on
  // the first Service tab they may open. The figures themselves come from the Service Requests list
  // (server-gated by Service Requests › View and data access).
  const seeDashboard = canViewTab('erp', 'dashboard', user)
  useEffect(() => {
    if (!isAuthorized || seeDashboard) return
    const next = ([['service_requests', '/dashboard/erp/service-requests'], ['service_contracts', '/dashboard/erp/service-contracts'],
      ['reports', '/dashboard/erp/reports'], ['recycle_bin', '/dashboard/erp/recycle-bin']] as const)
      .find(([key]) => canViewTab('erp', key, user))
    router.replace(next ? next[1] : '/dashboard')
  }, [isAuthorized, seeDashboard, user, router])

  useEffect(() => {
    if (!isAuthorized || !seeDashboard) return
    erpApi.listServiceRequests({ limit: 1000 })
      .then(setSrs)
      .catch((e) => setLoadErrors([`Service requests: ${extractErrorMessages(e, 'could not be loaded — check your connection and reload.').join(' ')}`]))
      .finally(() => setLoading(false))
  }, [isAuthorized, seeDashboard])

  const stats = useMemo(() => {
    return {
      totalSrs: srs.length,
      activeTickets: srs.filter((s) => !CLOSED_STATUSES.includes(s.status)).length,
      inProgress: srs.filter((s) => s.status === 'in_progress').length,
      closed: srs.filter((s) => s.status === 'closed').length,
    }
  }, [srs])

  const statusBreakdown = useMemo(() => {
    const counts: Record<string, number> = {}
    srs.forEach((s) => {
      counts[s.status] = (counts[s.status] || 0) + 1
    })
    return Object.entries(counts).sort((a, b) => b[1] - a[1])
  }, [srs])

  const activeTicketsByPriority = useMemo(() => {
    const counts: Record<string, number> = {}
    srs.filter((s) => !CLOSED_STATUSES.includes(s.status)).forEach((s) => {
      counts[s.priority] = (counts[s.priority] || 0) + 1
    })
    return Object.entries(counts)
  }, [srs])

  // Enough rows to fill the page; the layout fits the table to the window bottom and it scrolls inside.
  const recentSrs = useMemo(
    () => srs
      .filter((s) => (!filter.active || !CLOSED_STATUSES.includes(s.status)) && (!filter.status || s.status === filter.status) && (!filter.priority || s.priority === filter.priority))
      .sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''))
      .slice(0, 50),
    [srs, filter]
  )
  const isFiltered = !sameFilter(filter, NO_FILTER)

  if (isLoading || !isAuthorized || !seeDashboard) return null

  return (
    <div>
      <ErpNav />
      {loadErrors.length > 0 && (
        <div role="alert" style={{ padding: '10px 14px', marginBottom: 14, borderRadius: 10, background: 'rgba(220,38,38,0.06)', border: '1px solid rgba(220,38,38,0.2)', fontSize: 12.5, color: '#b91c1c' }}>
          <strong>Some figures below are incomplete.</strong>
          {loadErrors.map((e) => <div key={e}>{e}</div>)}
        </div>
      )}
      <h1 style={{ fontSize: 24, fontWeight: 700, color: '#1f1108', margin: '0 0 4px' }}>Dashboard Panel</h1>
      <p style={{ fontSize: 13, color: '#78716c', margin: 0 }}>
        Welcome back, {user?.name || 'there'}. Here is the current state of your service requests.
      </p>
      <div data-tour="erp-dash-stats" style={{ display: 'flex', flexWrap: 'wrap', gap: 8, margin: '10px 0 18px' }}>
        <StatChip label="Service requests" value={stats.totalSrs} color="#ea580c" onClick={() => setFilter(NO_FILTER)} active={!isFiltered} />
        <StatChip label="Active tickets" value={stats.activeTickets} color="#ca8a04" onClick={() => applyFilter({ ...NO_FILTER, active: true })} active={sameFilter(filter, { ...NO_FILTER, active: true })} />
        <StatChip label="In progress" value={stats.inProgress} color="#2563eb" onClick={() => applyFilter({ ...NO_FILTER, status: 'in_progress' })} active={sameFilter(filter, { ...NO_FILTER, status: 'in_progress' })} />
        <StatChip label="Closed" value={stats.closed} color="#78716c" onClick={() => applyFilter({ ...NO_FILTER, status: 'closed' })} active={sameFilter(filter, { ...NO_FILTER, status: 'closed' })} />
      </div>

      <div className="grid-2" data-tour="erp-dash-charts" style={{ gap: 16, marginBottom: 20 }}>
        <Section title="Tickets by Status">
          {statusBreakdown.length === 0 ? (
            <p style={{ fontSize: 13, color: '#a8a29e' }}>No service requests yet.</p>
          ) : (
            <BarChart data={statusBreakdown} colorMap={STATUS_COLORS}
              isActive={(label) => sameFilter(filter, { ...NO_FILTER, status: label })}
              onSelect={(label) => applyFilter({ ...NO_FILTER, status: label })} />
          )}
        </Section>

        <Section title="Active Tickets Breakdown">
          {activeTicketsByPriority.length === 0 ? (
            <p style={{ fontSize: 13, color: '#a8a29e' }}>No open tickets.</p>
          ) : (
            <PieChart data={activeTicketsByPriority} colorMap={PRIORITY_COLORS}
              isActive={(label) => sameFilter(filter, { active: true, status: '', priority: label })}
              onSelect={(label) => applyFilter({ active: true, status: '', priority: label })} />
          )}
        </Section>
      </div>

      <div data-tour="erp-dash-recent-srs">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <h2 style={{ fontSize: 15, fontWeight: 600, color: '#1f1108', margin: 0 }}>
            Recent Service Tickets
            {isFiltered && (
              <span style={{ fontSize: 12, fontWeight: 500, color: '#78716c', marginLeft: 8 }}>
                (filtered: {[filter.active ? 'active' : '', filter.status.replace(/_/g, ' '), filter.priority].filter(Boolean).join(' · ')} — click the count again to show all)
              </span>
            )}
          </h2>
          <Link href="/dashboard/erp/service-requests" data-tour="erp-dash-srs-viewall" style={{ fontSize: 12, color: '#ea580c', textDecoration: 'none', fontWeight: 600 }}>View all →</Link>
        </div>
        <div style={glassCard}>
        <div style={{ overflow: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 0 }}>
            <thead>
              <tr style={{ background: 'rgba(244,113,59,0.06)' }}>
                {['SR Number', 'Issue Summary', 'Type', 'Priority', 'Status', 'Assigned To', 'Target Date', 'Age'].map((h, hi) => (
                  <th key={h} data-fit-min={60} data-fit-cut={['Issue Summary', 'Type', 'Assigned To'].includes(h) ? '' : undefined} style={thStyle}>{h}{hi === 0 && <RowCount count={recentSrs.length} />}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading && <tr><td colSpan={8} style={{ padding: 20, textAlign: 'center', color: '#a8a29e', fontSize: 13 }}>Loading…</td></tr>}
              {!loading && recentSrs.length === 0 && <tr><td colSpan={8} style={{ padding: 20, textAlign: 'center', color: '#a8a29e', fontSize: 13 }}>{isFiltered ? 'No service tickets match this count. Click the highlighted count again to show all.' : 'No service requests yet.'}</td></tr>}
              {recentSrs.map((sr) => {
                const age = ageInDays(sr.opened_at || sr.created_at)
                return (
                  <tr
                    key={sr.id}
                    onClick={() => router.push(recordPath('/dashboard/erp/service-requests', sr))}
                    style={{ borderTop: '1px solid rgba(0,0,0,0.05)', cursor: 'pointer' }}
                  >
                    <td style={{ padding: '10px 8px', whiteSpace: 'nowrap' }}>
                      <span style={{ fontSize: 12.5, fontWeight: 600, color: '#ea580c' }}>{sr.request_number}</span>
                    </td>
                    <td data-fit-clamp style={tdText}><div title={sr.issue_title}>{clip2(sr.issue_title)}</div></td>
                    <td data-fit-clamp style={{ ...tdText, textTransform: 'capitalize' }}><div title={sr.service_type?.replace(/_/g, ' ')}>{sr.service_type ? clip2(sr.service_type.replace(/_/g, ' ')) : '—'}</div></td>
                    <td style={{ padding: '10px 8px', whiteSpace: 'nowrap' }}>
                      <span style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', color: PRIORITY_COLORS[sr.priority] || '#64748b' }}>{sr.priority}</span>
                    </td>
                    <td style={{ padding: '10px 8px', fontSize: 12, textTransform: 'capitalize', whiteSpace: 'nowrap' }}>{sr.status.replace(/_/g, ' ')}</td>
                    <td data-fit-clamp style={tdText}><div title={sr.assigned_to_name || undefined}>{clip(sr.assigned_to_name)}</div></td>
                    <td style={{ padding: '10px 8px', fontSize: 12, color: '#78716c', whiteSpace: 'nowrap' }}>{sr.expected_completion_date ? formatDate(sr.expected_completion_date) : '—'}</td>
                    <td style={{ padding: '10px 8px', fontSize: 12, color: '#78716c', whiteSpace: 'nowrap' }}>{age !== null ? `${age}d` : '—'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        </div>
      </div>
    </div>
  )
}
