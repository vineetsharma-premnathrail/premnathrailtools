'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { hasErpPermission, useRequireApp } from '@/hooks/useAuth'
import { useCan } from '@/lib/permissions'
import { erpApi } from '@/lib/api'
import { SLA_STATE_HEX, SLA_STATE_LABELS } from '@/lib/eamApi'
import { formatDate } from '@/lib/format'
import { Project, ServiceRequest, SRStatus } from '@/types'
import ErpNav from '@/components/erp/ErpNav'
import { inputStyle } from '@/components/shared/ui'
import Checkbox from '@/components/Checkbox'
import MessageDialog from '@/components/erp/MessageDialog'
import { extractErrorMessages } from '@/lib/validation'
import BulkImportDialog from '@/components/erp/BulkImportDialog'
import ExportDialog from '@/components/erp/ExportDialog'
import { SERVICE_TYPES, serviceTypeLabel } from '@/components/erp/serviceTypes'
import { recordPath } from '@/lib/recordRef'

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
  in_progress: '#D97706',
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
  urgent: '#dc2626',
  standard: '#2563eb',
}


// Resolution time (TAT): reported → closed for a closed SR; for one still
// open, how long it has been open so far (ageing).
function resolutionDays(start?: string | null, end?: string | null) {
  if (!start) return null
  const diff = (end ? new Date(end).getTime() : Date.now()) - new Date(start).getTime()
  return Math.max(0, Math.floor(diff / (1000 * 60 * 60 * 24)))
}

const dayText = (n: number) => (n === 0 ? 'Same day' : `${n} day${n === 1 ? '' : 's'}`)

function warrantyLabel(project?: Project) {
  if (!project?.warranty_start_date || !project?.warranty_end_date) return 'No'
  return `${project.warranty_start_date} → ${project.warranty_end_date}`
}

export default function ServiceRequestsPage() {
  const { user, isAuthorized, isLoading } = useRequireApp('erp')
  const canCreate = hasErpPermission(user, 'sr_create')
  const { can } = useCan()
  const canExport = can('erp', 'service_requests', 'export')
  const canImport = can('erp', 'service_requests', 'import') && canCreate
  // Mirrors the backend's `_can_edit` in service_requests.py — admins always
  // pass, everyone else must both own the SR and hold "sr_edit".
  const canEditSr = (sr: ServiceRequest) =>
    user?.role === 'admin' || (sr.created_by_id === user?.id && hasErpPermission(user, 'sr_edit'))
  const router = useRouter()
  const [srs, setSrs] = useState<ServiceRequest[]>([])
  const [projects, setProjects] = useState<Project[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | string[]>('')

  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [priorityFilter, setPriorityFilter] = useState('all')
  const [serviceTypeFilter, setServiceTypeFilter] = useState('all')
  const [overdueOnly, setOverdueOnly] = useState(false)
  const [slaFilter, setSlaFilter] = useState('all')
  const [showImport, setShowImport] = useState(false)
  const [showExport, setShowExport] = useState(false)

  const load = async () => {
    setLoading(true)
    setError('')
    try {
      const [srData, projectData] = await Promise.all([
        erpApi.listServiceRequests({
          search: search || undefined,
          status: statusFilter !== 'all' ? statusFilter : undefined,
          priority: priorityFilter !== 'all' ? priorityFilter : undefined,
          service_type: serviceTypeFilter !== 'all' ? serviceTypeFilter : undefined,
          sla: slaFilter !== 'all' ? slaFilter : undefined,
          limit: 1000,
        }),
        erpApi.listProjects({ limit: 5000 }),
      ])
      setSrs(srData)
      setProjects(projectData)
    } catch (err) {
      setError(extractErrorMessages(err, 'Failed to load service requests.').join(' '))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (isAuthorized) load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthorized, statusFilter, priorityFilter, serviceTypeFilter, slaFilter])

  useEffect(() => {
    if (!isAuthorized) return
    const t = setTimeout(() => {
      load()
    }, 300)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search])

  const projectById = useMemo(() => new Map(projects.map((p) => [p.id, p])), [projects])

  const clearFilters = () => {
    setSearch('')
    setStatusFilter('all')
    setPriorityFilter('all')
    setServiceTypeFilter('all')
    setOverdueOnly(false)
    setSlaFilter('all')
  }

  const filteredSrs = useMemo(
    () =>
      overdueOnly
        ? srs.filter((sr) => sr.expected_completion_date && new Date(sr.expected_completion_date) < new Date() && !['closed', 'cancelled'].includes(sr.status))
        : srs,
    [srs, overdueOnly]
  )

  const pagedSrs = filteredSrs

  if (isLoading || !isAuthorized) return null

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <ErpNav />
      <p style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: '#a8a29e', margin: '0 0 4px' }}>Service Operations</p>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, marginBottom: 20, flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: '#1f1108', margin: '0 0 4px' }}>Service Request Registry</h1>
          <p style={{ fontSize: 13, color: '#78716c', margin: 0 }}>{srs.length} Service Requests Found</p>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        {canExport && (
          <button data-tour="erp-sr-export-btn" onClick={() => setShowExport(true)} style={secondaryBtnStyle}>Export</button>
        )}
        {canImport && (
          <button data-tour="erp-sr-import-btn" onClick={() => setShowImport(true)} style={secondaryBtnStyle}>Import</button>
        )}
        {canCreate && (
          <Link
            href="/dashboard/erp/service-requests/new"
            data-tour="erp-sr-add-btn"
            style={{
              fontSize: 13.5,
              fontWeight: 600,
              padding: '10px 20px',
              borderRadius: 10,
              background: 'linear-gradient(140deg,#FF7A45,#ffe3d0)',
              color: '#fff',
              textDecoration: 'none',
              whiteSpace: 'nowrap',
            }}
          >
            + New Service Request
          </Link>
        )}
        </div>
      </div>

      <BulkImportDialog kind="service-requests" open={showImport} onClose={() => setShowImport(false)} onImported={load} />
      {showExport && (
        <ExportDialog kind="service-requests" onClose={() => setShowExport(false)} filename="service_requests" noun="service requests"
          items={filteredSrs.map((sr) => {
            const p = projectById.get(sr.project_id)
            return { id: sr.id, label: `${sr.request_number} — ${sr.issue_title}`, sub: [p?.serial_number, p?.client_company, STATUS_LABELS[sr.status] || sr.status].filter(Boolean).join(' · ') }
          })}
          dateLabel="Reported date"
          filterParams={{
            search: search || undefined,
            status: statusFilter !== 'all' ? statusFilter : undefined,
            priority: priorityFilter !== 'all' ? priorityFilter : undefined,
            service_type: serviceTypeFilter !== 'all' ? serviceTypeFilter : undefined,
          }} />
      )}

      <MessageDialog
        open={!!error}
        variant="error"
        title="Failed to Load Service Requests"
        message={error}
        onClose={() => setError('')}
        actionLabel="Reload"
        onAction={() => window.location.reload()}
      />

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: 16 }}>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="SR#, title, serial, client..."
          data-tour="erp-sr-search"
          style={{ ...inputStyle, flex: '1 1 260px', width: 'auto' }}
        />
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} style={{ ...inputStyle, width: 'auto' }} data-tour="erp-sr-status-filter">
          <option value="all">All Statuses</option>
          {Object.entries(STATUS_LABELS).map(([v, l]) => (
            <option key={v} value={v}>{l}</option>
          ))}
        </select>
        <select value={priorityFilter} onChange={(e) => setPriorityFilter(e.target.value)} style={{ ...inputStyle, width: 'auto' }} data-tour="erp-sr-priority-filter">
          <option value="all">All Priorities</option>
          <option value="standard">Standard</option>
          <option value="urgent">Urgent</option>
        </select>
        <select value={serviceTypeFilter} onChange={(e) => setServiceTypeFilter(e.target.value)} style={{ ...inputStyle, width: 'auto' }} data-tour="erp-sr-type-filter">
          <option value="all">All Service Types</option>
          {SERVICE_TYPES.map((t) => (
            <option key={t.value} value={t.value}>{t.label}</option>
          ))}
        </select>
        <select value={slaFilter} onChange={(e) => setSlaFilter(e.target.value)} style={{ ...inputStyle, width: 'auto' }}>
          <option value="all">Any SLA</option>
          <option value="breached">SLA breached</option>
          <option value="at_risk">SLA at risk</option>
          <option value="met">SLA met</option>
        </select>
        <span data-tour="erp-sr-overdue" style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0 6px', fontSize: 13, fontWeight: 600, color: '#57534e' }}>
          <Checkbox checked={overdueOnly} onChange={(e) => { setOverdueOnly(e.target.checked) }} />
          Overdue Only
        </span>
        <button onClick={clearFilters} style={secondaryBtnStyle} data-tour="erp-sr-clear-btn">Clear</button>
      </div>

      <div style={{ borderRadius: 18, background: 'rgba(255,255,255,.16)', backdropFilter: 'blur(28px)', WebkitBackdropFilter: 'blur(28px)', border: '1px solid rgba(255,255,255,.24)', boxShadow: '0 12px 32px rgba(15,23,42,0.16), 0 2px 6px rgba(15,23,42,.08), inset 0 1px 0 rgba(255,255,255,.35)', overflow: 'hidden', flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        <div style={{ overflow: 'auto', flex: 1, minHeight: 0 }}>
        <table data-tour="erp-sr-table" style={{ width: '100%', borderCollapse: 'collapse', minWidth: 1150 }}>
          <thead>
            <tr style={{ background: 'rgba(244,113,59,0.06)' }}>
              {['SR Number', 'Machine Serial', 'Client & Site', 'Issue Summary', 'Service Type', 'Priority', 'Status', 'Opening Date', 'Closing Date', 'Resolution Time', 'SLA', 'Warranty', 'Actions'].map((h) => (
                <th key={h} style={{ textAlign: 'left', padding: '12px 16px', fontSize: 11, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: '#a8a29e', whiteSpace: 'nowrap', position: 'sticky', top: 0, background: '#fdf1e6', zIndex: 1 }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan={12} style={{ padding: 24, textAlign: 'center', color: '#a8a29e', fontSize: 13 }}>Loading…</td></tr>
            )}
            {!loading && pagedSrs.length === 0 && (
              <tr><td colSpan={12} style={{ padding: 24, textAlign: 'center', color: '#a8a29e', fontSize: 13 }}>No service requests found.</td></tr>
            )}
            {pagedSrs.map((sr) => {
              const statusStyle = STATUS_COLORS[sr.status] || STATUS_COLORS.open
              const project = projectById.get(sr.project_id)
              const tat = resolutionDays(sr.opened_at || sr.created_at, sr.closed_at)
              return (
                <tr
                  key={sr.id}
                  onClick={() => router.push(recordPath('/dashboard/erp/service-requests', sr))}
                  style={{ borderTop: '1px solid rgba(0,0,0,0.05)', cursor: 'pointer' }}
                >
                  <td style={{ padding: '12px 16px' }}>
                    <span style={{ fontSize: 13, fontWeight: 600, color: '#FF7A45' }}>
                      {sr.request_number}
                    </span>
                  </td>
                  <td style={{ padding: '12px 16px', fontSize: 13, color: '#57534e', whiteSpace: 'nowrap' }}>{project?.serial_number || '—'}</td>
                  <td style={{ padding: '12px 16px', fontSize: 12.5, color: '#57534e' }}>
                    <div>{project?.client_company || '—'}</div>
                    <div style={{ color: '#a8a29e', fontSize: 11.5 }}>{project?.site_name || ''}</div>
                  </td>
                  <td style={{ padding: '12px 16px', fontSize: 13, color: '#57534e' }}>
                    {/* One line, cut with "…" — the full text is on hover and on the SR page. */}
                    <div title={sr.issue_title} style={{ maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{sr.issue_title}</div>
                  </td>
                  <td style={{ padding: '12px 16px', fontSize: 12.5, color: '#57534e', whiteSpace: 'nowrap' }}>{serviceTypeLabel(sr.service_type)}</td>
                  <td style={{ padding: '12px 16px' }}>
                    <span style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', color: PRIORITY_COLORS[sr.priority] || '#64748b' }}>
                      {sr.priority}
                    </span>
                  </td>
                  <td style={{ padding: '12px 16px' }}>
                    <span style={{ fontSize: 11.5, fontWeight: 600, padding: '4px 10px', borderRadius: 9999, background: statusStyle.bg, color: statusStyle.fg, whiteSpace: 'nowrap' }}>
                      {STATUS_LABELS[sr.status] || sr.status}
                    </span>
                  </td>
                  <td style={{ padding: '12px 16px', fontSize: 12.5, color: '#78716c', whiteSpace: 'nowrap' }}>
                    {formatDate(sr.opened_at)}
                  </td>
                  <td style={{ padding: '12px 16px', fontSize: 12.5, color: '#78716c', whiteSpace: 'nowrap' }}>
                    {sr.closed_at ? formatDate(sr.closed_at) : 'Open'}
                  </td>
                  <td style={{ padding: '12px 16px', fontSize: 12.5, whiteSpace: 'nowrap' }}
                    title={sr.closed_at ? 'Time taken from opening to closing' : 'Not closed yet — time since it was opened'}>
                    {tat === null ? '—' : sr.closed_at
                      ? <span style={{ color: '#1f1108', fontWeight: 600 }}>{dayText(tat)}</span>
                      : <span style={{ color: '#b45309' }}>Open · {dayText(tat)}</span>}
                  </td>
                  <td style={{ padding: '12px 16px', whiteSpace: 'nowrap' }}>
                    {(() => {
                      const st = [sr.sla_response_state, sr.sla_resolution_state].includes('breached') ? 'breached'
                        : [sr.sla_response_state, sr.sla_resolution_state].includes('at_risk') ? 'at_risk'
                        : sr.sla_resolution_state || sr.sla_response_state
                      return st ? <span style={{ fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 9999, background: `${SLA_STATE_HEX[st] || '#78716c'}1a`, color: SLA_STATE_HEX[st] || '#78716c' }}>{SLA_STATE_LABELS[st] || st}</span> : <span style={{ color: '#a8a29e' }}>—</span>
                    })()}
                  </td>
                  <td style={{ padding: '12px 16px', fontSize: 11.5, color: '#78716c', whiteSpace: 'nowrap' }}>{warrantyLabel(project)}</td>
                  <td style={{ padding: '12px 16px', whiteSpace: 'nowrap' }} onClick={(e) => e.stopPropagation()}>
                    <span style={{ fontSize: 11.5, fontWeight: 600, color: '#2563eb', marginRight: 10 }}>View</span>
                    {canEditSr(sr) && (
                      <Link href={`${recordPath('/dashboard/erp/service-requests', sr)}/edit`} style={{ fontSize: 11.5, fontWeight: 600, color: '#57534e', textDecoration: 'none' }}>Edit</Link>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
        </div>
      </div>

    </div>
  )
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
