'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { erpApi } from '@/lib/api'
import { Project, ServiceRequest, SRStatus } from '@/types'
import ErpNav from '@/components/erp/ErpNav'

const STATUS_LABELS: Record<SRStatus, string> = {
  open: 'Open / Reported',
  acknowledged: 'Acknowledged',
  assigned: 'Assigned',
  scheduled: 'Scheduled',
  in_progress: 'In Progress',
  pending_parts: 'Pending Parts',
  on_hold: 'On Hold',
  work_completed: 'Work Completed',
  review: 'Review',
  closed: 'Closed',
  cancelled: 'Cancelled',
}

// Hex values match the legacy app's status color scheme exactly.
const STATUS_HEX: Record<string, string> = {
  open: '#3B82F6',
  acknowledged: '#8B5CF6',
  assigned: '#F59E0B',
  scheduled: '#06B6D4',
  in_progress: '#F97316',
  pending_parts: '#EF4444',
  on_hold: '#94A3B8',
  work_completed: '#10B981',
  review: '#6366F1',
  closed: '#22C55E',
  cancelled: '#CBD5E1',
}

const STATUS_COLORS: Record<string, { bg: string; fg: string }> = Object.fromEntries(
  Object.entries(STATUS_HEX).map(([k, hex]) => [k, { bg: `${hex}1a`, fg: hex }])
)

const PRIORITY_COLORS: Record<string, string> = {
  critical: '#dc2626',
  high: '#f97316',
  medium: '#eab308',
  low: '#22c55e',
}

const PAGE_SIZE = 20

function ageInDays(dateStr?: string) {
  if (!dateStr) return null
  const diff = Date.now() - new Date(dateStr).getTime()
  return Math.max(0, Math.floor(diff / (1000 * 60 * 60 * 24)))
}

function warrantyLabel(project?: Project) {
  if (!project?.warranty_start_date || !project?.warranty_end_date) return 'No'
  return `${project.warranty_start_date} → ${project.warranty_end_date}`
}

export default function ServiceRequestsPage() {
  const { isAuthorized, isLoading } = useRequireApp('erp')
  const router = useRouter()
  const [srs, setSrs] = useState<ServiceRequest[]>([])
  const [projects, setProjects] = useState<Project[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [priorityFilter, setPriorityFilter] = useState('all')
  const [overdueOnly, setOverdueOnly] = useState(false)
  const [page, setPage] = useState(1)

  const load = async () => {
    setLoading(true)
    setError('')
    try {
      const [srData, projectData] = await Promise.all([
        erpApi.listServiceRequests({
          search: search || undefined,
          status: statusFilter !== 'all' ? statusFilter : undefined,
          priority: priorityFilter !== 'all' ? priorityFilter : undefined,
          limit: 1000,
        }),
        erpApi.listProjects({ limit: 5000 }),
      ])
      setSrs(srData)
      setProjects(projectData)
    } catch {
      setError('Failed to load service requests.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (isAuthorized) load()
    setPage(1)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthorized, statusFilter, priorityFilter])

  useEffect(() => {
    if (!isAuthorized) return
    const t = setTimeout(() => {
      load()
      setPage(1)
    }, 300)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search])

  const projectById = useMemo(() => new Map(projects.map((p) => [p.id, p])), [projects])

  const clearFilters = () => {
    setSearch('')
    setStatusFilter('all')
    setPriorityFilter('all')
    setOverdueOnly(false)
  }

  const filteredSrs = useMemo(
    () =>
      overdueOnly
        ? srs.filter((sr) => sr.expected_completion_date && new Date(sr.expected_completion_date) < new Date() && sr.status !== 'closed')
        : srs,
    [srs, overdueOnly]
  )

  const totalPages = Math.max(1, Math.ceil(filteredSrs.length / PAGE_SIZE))
  const pagedSrs = filteredSrs.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  if (isLoading || !isAuthorized) return null

  return (
    <div>
      <ErpNav />
      <p style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: '.05em', textTransform: 'uppercase', color: '#a8a29e', margin: '0 0 4px' }}>Service Operations</p>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, marginBottom: 20, flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 800, color: '#1f1108', margin: '0 0 4px' }}>Service Request Registry</h1>
          <p style={{ fontSize: 13, color: '#78716c', margin: 0 }}>{srs.length} Service Requests Found</p>
        </div>
        <Link
          href="/dashboard/erp/service-requests/new"
          style={{
            fontSize: 13.5,
            fontWeight: 700,
            padding: '10px 20px',
            borderRadius: 10,
            background: 'linear-gradient(140deg,#fa9b9b,#ffe3d0)',
            color: '#fff',
            textDecoration: 'none',
            whiteSpace: 'nowrap',
          }}
        >
          + New Service Request
        </Link>
      </div>

      {error && (
        <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
          {error}
        </div>
      )}

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: 16 }}>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="SR#, title, serial, client..."
          style={{ flex: '1 1 260px', padding: '10px 14px', borderRadius: 10, border: '1px solid rgba(0,0,0,0.1)', background: '#fff', fontSize: 13.5, outline: 'none' }}
        />
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} style={selectStyle}>
          <option value="all">All Statuses</option>
          {Object.entries(STATUS_LABELS).map(([v, l]) => (
            <option key={v} value={v}>{l}</option>
          ))}
        </select>
        <select value={priorityFilter} onChange={(e) => setPriorityFilter(e.target.value)} style={selectStyle}>
          <option value="all">All Priorities</option>
          <option value="critical">Critical</option>
          <option value="high">High</option>
          <option value="medium">Medium</option>
          <option value="low">Low</option>
        </select>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0 6px', fontSize: 13, fontWeight: 600, color: '#57534e', cursor: 'pointer' }}>
          <input type="checkbox" checked={overdueOnly} onChange={(e) => { setOverdueOnly(e.target.checked); setPage(1) }} style={{ width: 16, height: 16, accentColor: '#fa9b9b' }} />
          Overdue Only
        </label>
        <button onClick={clearFilters} style={secondaryBtnStyle}>Clear</button>
      </div>

      <div style={{ borderRadius: 18, background: 'rgba(255,255,255,.16)', backdropFilter: 'blur(28px)', WebkitBackdropFilter: 'blur(28px)', border: '1px solid rgba(255,255,255,.24)', boxShadow: '0 12px 32px rgba(15,23,42,0.16), 0 2px 6px rgba(15,23,42,.08), inset 0 1px 0 rgba(255,255,255,.35)', overflow: 'auto', maxHeight: 'calc(100vh - 320px)' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 1150 }}>
          <thead>
            <tr style={{ background: 'rgba(244,113,59,0.06)' }}>
              {['SR Number', 'Machine Serial', 'Client & Site', 'Issue Summary', 'Priority', 'Status', 'Opening Date', 'Closing Date', 'Age', 'Warranty', 'Actions'].map((h) => (
                <th key={h} style={{ textAlign: 'left', padding: '12px 16px', fontSize: 11, fontWeight: 700, letterSpacing: '.05em', textTransform: 'uppercase', color: '#a8a29e', whiteSpace: 'nowrap', position: 'sticky', top: 0, background: '#fdf1e6', zIndex: 1 }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan={11} style={{ padding: 24, textAlign: 'center', color: '#a8a29e', fontSize: 13 }}>Loading…</td></tr>
            )}
            {!loading && pagedSrs.length === 0 && (
              <tr><td colSpan={11} style={{ padding: 24, textAlign: 'center', color: '#a8a29e', fontSize: 13 }}>No service requests found.</td></tr>
            )}
            {pagedSrs.map((sr) => {
              const statusStyle = STATUS_COLORS[sr.status] || STATUS_COLORS.open
              const project = projectById.get(sr.project_id)
              const age = ageInDays(sr.opened_at || sr.created_at)
              return (
                <tr
                  key={sr.id}
                  onClick={() => router.push(`/dashboard/erp/service-requests/${sr.id}`)}
                  style={{ borderTop: '1px solid rgba(0,0,0,0.05)', cursor: 'pointer' }}
                >
                  <td style={{ padding: '12px 16px' }}>
                    <span style={{ fontSize: 13, fontWeight: 700, color: '#fa9b9b' }}>
                      {sr.request_number}
                    </span>
                  </td>
                  <td style={{ padding: '12px 16px', fontSize: 13, color: '#57534e', whiteSpace: 'nowrap' }}>{project?.serial_number || '—'}</td>
                  <td style={{ padding: '12px 16px', fontSize: 12.5, color: '#57534e' }}>
                    <div>{project?.client_company || '—'}</div>
                    <div style={{ color: '#a8a29e', fontSize: 11.5 }}>{project?.site_name || ''}</div>
                  </td>
                  <td style={{ padding: '12px 16px', fontSize: 13, color: '#57534e', maxWidth: 240 }}>{sr.issue_title}</td>
                  <td style={{ padding: '12px 16px' }}>
                    <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: PRIORITY_COLORS[sr.priority] || '#64748b' }}>
                      {sr.priority}
                    </span>
                  </td>
                  <td style={{ padding: '12px 16px' }}>
                    <span style={{ fontSize: 11.5, fontWeight: 700, padding: '4px 10px', borderRadius: 9999, background: statusStyle.bg, color: statusStyle.fg, whiteSpace: 'nowrap' }}>
                      {STATUS_LABELS[sr.status] || sr.status}
                    </span>
                  </td>
                  <td style={{ padding: '12px 16px', fontSize: 12.5, color: '#78716c', whiteSpace: 'nowrap' }}>
                    {sr.opened_at ? new Date(sr.opened_at).toLocaleDateString() : '—'}
                  </td>
                  <td style={{ padding: '12px 16px', fontSize: 12.5, color: '#78716c', whiteSpace: 'nowrap' }}>
                    {sr.closed_at ? new Date(sr.closed_at).toLocaleDateString() : 'Open'}
                  </td>
                  <td style={{ padding: '12px 16px', fontSize: 12.5, color: '#78716c', whiteSpace: 'nowrap' }}>{age !== null ? `${age}d` : '—'}</td>
                  <td style={{ padding: '12px 16px', fontSize: 11.5, color: '#78716c', whiteSpace: 'nowrap' }}>{warrantyLabel(project)}</td>
                  <td style={{ padding: '12px 16px', whiteSpace: 'nowrap' }} onClick={(e) => e.stopPropagation()}>
                    <span style={{ fontSize: 11.5, fontWeight: 700, color: '#2563eb', marginRight: 10 }}>View</span>
                    <Link href={`/dashboard/erp/service-requests/${sr.id}/edit`} style={{ fontSize: 11.5, fontWeight: 700, color: '#57534e', textDecoration: 'none' }}>Edit</Link>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {!loading && filteredSrs.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 14, flexWrap: 'wrap', gap: 10 }}>
          <span style={{ fontSize: 12.5, color: '#78716c' }}>
            {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, filteredSrs.length)} of {filteredSrs.length}
          </span>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1} style={pageBtnStyle(page === 1)}>‹</button>
            {Array.from({ length: totalPages }, (_, i) => i + 1)
              .filter((p) => p === 1 || p === totalPages || Math.abs(p - page) <= 1)
              .reduce<number[]>((acc, p) => {
                if (acc.length && p - acc[acc.length - 1] > 1) acc.push(-1)
                acc.push(p)
                return acc
              }, [])
              .map((p, i) =>
                p === -1 ? (
                  <span key={`gap-${i}`} style={{ fontSize: 12.5, color: '#a8a29e', padding: '0 4px' }}>…</span>
                ) : (
                  <button key={p} onClick={() => setPage(p)} style={{ ...pageBtnStyle(false), background: p === page ? '#fa9b9b' : '#fff', color: p === page ? '#fff' : '#57534e' }}>
                    {p}
                  </button>
                )
              )}
            <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page === totalPages} style={pageBtnStyle(page === totalPages)}>›</button>
          </div>
        </div>
      )}
    </div>
  )
}

const selectStyle: React.CSSProperties = {
  padding: '10px 14px',
  borderRadius: 10,
  border: '1px solid rgba(0,0,0,0.1)',
  background: '#fff',
  fontSize: 13,
  fontWeight: 500,
  color: '#57534e',
}

const secondaryBtnStyle: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 600,
  padding: '10px 18px',
  borderRadius: 10,
  border: '1px solid rgba(0,0,0,0.1)',
  background: '#fff',
  color: '#57534e',
  cursor: 'pointer',
  whiteSpace: 'nowrap',
}

function pageBtnStyle(disabled: boolean): React.CSSProperties {
  return {
    fontSize: 12.5,
    fontWeight: 700,
    padding: '6px 11px',
    borderRadius: 8,
    border: '1px solid rgba(0,0,0,0.1)',
    background: '#fff',
    color: '#57534e',
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.5 : 1,
  }
}
