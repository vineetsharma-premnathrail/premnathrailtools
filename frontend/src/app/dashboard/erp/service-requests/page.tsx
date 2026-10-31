'use client'

import Select from '@/components/shared/Select'
import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { hasErpPermission, useRequireApp } from '@/hooks/useAuth'
import { useCan } from '@/lib/permissions'
import { erpApi } from '@/lib/api'
import { formatDate } from '@/lib/format'
import { Project, ServiceRequest, SRStatus } from '@/types'
import ErpNav from '@/components/erp/ErpNav'
import { Funnel } from '@phosphor-icons/react'
import { inputStyle, secondaryBtnStyle, RowCount, Pill, pillStyle, StatChip } from '@/components/shared/ui'
import { FormSheet, SheetIcon, SHEET, sheetBtn, sheetInput, sheetLabel } from '@/components/shared/FormSheet'
import Checkbox from '@/components/Checkbox'
import MessageDialog from '@/components/erp/MessageDialog'
import { extractErrorMessages } from '@/lib/validation'
import BulkImportDialog from '@/components/erp/BulkImportDialog'
import ExportDialog from '@/components/erp/ExportDialog'
import { SERVICE_TYPES } from '@/components/erp/serviceTypes'
import { recordPath } from '@/lib/recordRef'

const STATUS_LABELS: Record<SRStatus, string> = {
  open: 'Open',
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

// Header wrap floors for TableFit (px): these columns keep the full width of their widest cell, only the header may wrap.
// Client & Site and Issue Summary are the only columns TableFit may cut.
const WRAP_MIN: Record<string, number> = { 'SR Number': 100, 'Machine Serial': 90, 'Client & Site': 96, 'Issue Summary': 84, Priority: 78, Status: 114, 'Opening Date': 84, 'Closing Date': 84, Age: 76, Warranty: 100 }

const dayText = (n: number) => (n === 0 ? 'Same day' : `${n} day${n === 1 ? '' : 's'}`)

function warrantyLabel(project?: Project) {
  if (!project?.warranty_start_date || !project?.warranty_end_date) return 'No'
  return `${formatDate(project.warranty_start_date)} → ${formatDate(project.warranty_end_date)}`
}

export default function ServiceRequestsPage() {
  const { user, isAuthorized, isLoading } = useRequireApp('erp')
  const canCreate = hasErpPermission(user, 'sr_create')
  const { can } = useCan()
  const canExport = can('erp', 'service_requests', 'export')
  const canImport = can('erp', 'service_requests', 'import') && canCreate
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
  // Status picked by clicking a count chip: narrows the loaded rows on screen only (so the other chips keep their counts).
  // The Filters sheet shows it as its Status and Apply turns it into the normal server-side status filter.
  const [chipStatus, setChipStatus] = useState('')
  const [showFilters, setShowFilters] = useState(false)
  const [draft, setDraft] = useState({ status: 'all', priority: 'all', service_type: 'all', overdue: false })
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
  }, [isAuthorized, statusFilter, priorityFilter, serviceTypeFilter])

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
    setStatusFilter('all')
    setPriorityFilter('all')
    setServiceTypeFilter('all')
    setOverdueOnly(false)
    setChipStatus('')
    setShowFilters(false)
  }
  // Count chips: click = show that status, click again = back to all. Works on top of the Status filter.
  const pickStatusChip = (value: string) => {
    if (statusFilter === value) { setStatusFilter('all'); return }
    if (chipStatus === value) { setChipStatus(''); return }
    setStatusFilter('all')
    setChipStatus(value)
  }
  const clearStatusChips = () => { setStatusFilter('all'); setChipStatus('') }
  const applyFilters = () => {
    setStatusFilter(draft.status)
    setPriorityFilter(draft.priority)
    setServiceTypeFilter(draft.service_type)
    setOverdueOnly(draft.overdue)
    setChipStatus('')
    setShowFilters(false)
  }
  const openFilters = () => {
    setDraft({ status: statusFilter !== 'all' ? statusFilter : chipStatus || 'all', priority: priorityFilter, service_type: serviceTypeFilter, overdue: overdueOnly })
    setShowFilters(true)
  }
  const activeFilterCount = [statusFilter, priorityFilter, serviceTypeFilter].filter((v) => v !== 'all').length + (overdueOnly ? 1 : 0) + (chipStatus && statusFilter === 'all' ? 1 : 0)

  const filteredSrs = useMemo(
    () =>
      overdueOnly
        // Date-only compare in local time: an SR due today is not overdue yet.
        ? srs.filter((sr) => sr.expected_completion_date && sr.expected_completion_date.slice(0, 10) < new Date().toLocaleDateString('en-CA') && !['closed', 'cancelled'].includes(sr.status))
        : srs,
    [srs, overdueOnly]
  )

  const visibleSrs = useMemo(() => (chipStatus ? filteredSrs.filter((sr) => sr.status === chipStatus) : filteredSrs), [filteredSrs, chipStatus])
  const pagedSrs = visibleSrs
  const statusActive = (v: string) => statusFilter === v || chipStatus === v

  if (isLoading || !isAuthorized) return null

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <ErpNav />
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, marginBottom: 14, flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: '#1f1108', margin: 0 }}>Service Request Registry</h1>
          <div data-tour="erp-sr-stats" style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 10 }}>
            <StatChip label="Requests" value={filteredSrs.length} color="#3b82f6" onClick={clearStatusChips} active={statusFilter === 'all' && !chipStatus} />
            <StatChip label="Open" value={filteredSrs.filter((sr) => sr.status === 'open').length} color="#ea580c" onClick={() => pickStatusChip('open')} active={statusActive('open')} />
            <StatChip label="In progress" value={filteredSrs.filter((sr) => sr.status === 'in_progress').length} color="#ca8a04" onClick={() => pickStatusChip('in_progress')} active={statusActive('in_progress')} />
            <StatChip label="Closed" value={filteredSrs.filter((sr) => sr.status === 'closed').length} color="#16a34a" onClick={() => pickStatusChip('closed')} active={statusActive('closed')} />
          </div>
        </div>
      </div>

      <BulkImportDialog kind="service-requests" open={showImport} onClose={() => setShowImport(false)} onImported={load} />
      {showExport && (
        <ExportDialog kind="service-requests" onClose={() => setShowExport(false)} filename="service_requests" noun="service requests"
          items={visibleSrs.map((sr) => {
            const p = projectById.get(sr.project_id)
            return { id: sr.id, label: `${sr.request_number} — ${sr.issue_title}`, sub: [p?.serial_number, p?.client_company, STATUS_LABELS[sr.status] || sr.status].filter(Boolean).join(' · ') }
          })}
          dateLabel="Reported date"
          filterParams={{
            search: search || undefined,
            status: statusFilter !== 'all' ? statusFilter : chipStatus || undefined,
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

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
        {canCreate && (
          <Link
            href="/dashboard/erp/service-requests/new"
            data-tour="erp-sr-add-btn"
            style={{
              fontSize: 13.5,
              fontWeight: 600,
              padding: '10px 14px',
              borderRadius: 10,
              background: '#ea580c',
              border: '1px solid #c2410c',
              color: '#fff',
              textDecoration: 'none',
              whiteSpace: 'nowrap',
            }}
          >
            + New Service Request
          </Link>
        )}
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="SR#, title, serial, client..."
            aria-label="Search service requests"
            data-tour="erp-sr-search"
            style={{ ...inputStyle, width: 280, maxWidth: '100%' }}
          />
          <button type="button" onClick={openFilters} data-tour="erp-sr-filter-btn" aria-label="Filters" title="Filters"
            style={{ ...secondaryBtnStyle, display: 'inline-flex', alignItems: 'center', gap: 6, ...(activeFilterCount ? { borderColor: '#ea580c', color: '#c2410c' } : {}) }}>
            <Funnel size={16} weight={activeFilterCount ? 'fill' : 'regular'} />
            Filters
            {activeFilterCount > 0 && <span style={{ minWidth: 18, height: 18, padding: '0 5px', borderRadius: 9, background: '#ea580c', color: '#fff', fontSize: 11, fontWeight: 700, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>{activeFilterCount}</span>}
          </button>
          {activeFilterCount > 0 && (
            <button type="button" onClick={clearFilters} style={secondaryBtnStyle} data-tour="erp-sr-clear-btn">Clear</button>
          )}
          {canExport && (
            <button data-tour="erp-sr-export-btn" onClick={() => setShowExport(true)} style={secondaryBtnStyle}>Export</button>
          )}
          {canImport && (
            <button data-tour="erp-sr-import-btn" onClick={() => setShowImport(true)} style={secondaryBtnStyle}>Import</button>
          )}
        </div>
      </div>

      {showFilters && (
        <FormSheet icon="search" title="Filters" subtitle="Narrow the service requests, then press Apply." width={560} busy={false} onClose={() => setShowFilters(false)} tour="erp-sr-filter-sheet"
          footer={<>
            <button type="button" onClick={clearFilters} style={sheetBtn('secondary', SHEET.INK)}>Clear Filters</button>
            <button type="button" onClick={applyFilters} style={sheetBtn('primary', SHEET.BLUE)} data-tour="erp-sr-apply-btn"><SheetIcon name="check" size={16} />Apply Filters</button>
          </>}>
          <div style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div>
              <label style={sheetLabel}>Status</label>
              <Select value={draft.status} onChange={(e) => setDraft((d) => ({ ...d, status: e.target.value }))} style={sheetInput} data-tour="erp-sr-status-filter">
                <option value="all">All Statuses</option>
                {Object.entries(STATUS_LABELS).map(([v, l]) => (
                  <option key={v} value={v}>{l}</option>
                ))}
              </Select>
            </div>
            <div>
              <label style={sheetLabel}>Priority</label>
              <Select value={draft.priority} onChange={(e) => setDraft((d) => ({ ...d, priority: e.target.value }))} style={sheetInput} data-tour="erp-sr-priority-filter">
                <option value="all">All Priorities</option>
                <option value="standard">Standard</option>
                <option value="urgent">Urgent</option>
              </Select>
            </div>
            <div>
              <label style={sheetLabel}>Service Type</label>
              <Select value={draft.service_type} onChange={(e) => setDraft((d) => ({ ...d, service_type: e.target.value }))} style={sheetInput} data-tour="erp-sr-type-filter">
                <option value="all">All Service Types</option>
                {SERVICE_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </Select>
            </div>
            <label data-tour="erp-sr-overdue" style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 600, color: '#57534e', cursor: 'pointer' }}>
              <Checkbox checked={draft.overdue} onChange={(e) => setDraft((d) => ({ ...d, overdue: e.target.checked }))} />
              Overdue Only
            </label>
          </div>
        </FormSheet>
      )}

      <div style={{ borderRadius: 18, background: 'rgba(255,255,255,.16)', backdropFilter: 'blur(28px)', WebkitBackdropFilter: 'blur(28px)', border: '1px solid rgba(255,255,255,.24)', boxShadow: '0 12px 32px rgba(15,23,42,0.16), 0 2px 6px rgba(15,23,42,.08), inset 0 1px 0 rgba(255,255,255,.35)', overflow: 'hidden', flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        <div style={{ overflow: 'auto', flex: 1, minHeight: 0 }}>
        <table data-tour="erp-sr-table" style={{ width: '100%', borderCollapse: 'collapse', minWidth: 0 }}>
          <thead>
            <tr style={{ background: 'rgba(244,113,59,0.06)' }}>
              {['SR Number', 'Machine Serial', 'Client & Site', 'Issue Summary', 'Priority', 'Status', 'Opening Date', 'Closing Date', 'Age', 'Warranty'].map((h, hi) => (
                <th key={h} data-fit-min={WRAP_MIN[h]} data-fit-wrap-head data-fit-cut={h === 'Client & Site' || h === 'Issue Summary' ? '' : undefined} style={{ textAlign: 'left', padding: '12px 8px', fontSize: 12, fontWeight: 600, letterSpacing: '.04em', textTransform: 'uppercase', color: '#57534e', whiteSpace: 'nowrap', position: 'sticky', top: 0, background: '#fdf1e6', zIndex: 1, ...(WRAP_MIN[h] ? { whiteSpace: 'normal' as const } : {}), ...(h === 'Priority' ? { minWidth: 76, overflow: 'visible', textOverflow: 'clip' } : {}) }}>
                  {h}{hi === 0 && <RowCount count={visibleSrs.length} />}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan={10} style={{ padding: 24, textAlign: 'center', color: '#a8a29e', fontSize: 13 }}>Loading…</td></tr>
            )}
            {!loading && pagedSrs.length === 0 && (
              <tr><td colSpan={10} style={{ padding: 24, textAlign: 'center', color: '#a8a29e', fontSize: 13 }}>No service requests found.</td></tr>
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
                  <td style={{ padding: '12px 8px', whiteSpace: 'nowrap' }}>
                    <span style={{ fontSize: 13, fontWeight: 600, color: '#c2410c' }}>
                      {sr.request_number}
                    </span>
                  </td>
                  <td style={{ padding: '12px 8px', fontSize: 13, color: '#57534e', whiteSpace: 'nowrap' }}>{project?.serial_number || '—'}</td>
                  <td style={{ padding: '12px 8px', fontSize: 12.5, color: '#57534e' }}>
                    <div>{project?.client_company || '—'}</div>
                    <div style={{ color: '#57534e', fontSize: 12 }}>{project?.site_name || ''}</div>
                  </td>
                  <td data-fit-clamp style={{ padding: '12px 8px', fontSize: 13, color: '#57534e' }}>
                    {/* One line, cut with "…" by TableFit — it shares the leftover width by its real text length; full text on hover and on the SR page. */}
                    <div title={sr.issue_title} style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{sr.issue_title}</div>
                  </td>
                  <td style={{ padding: '12px 8px', minWidth: 76, whiteSpace: 'nowrap', overflow: 'visible', textOverflow: 'clip' }}>
                    <span style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', whiteSpace: 'nowrap', color: PRIORITY_COLORS[sr.priority] || '#64748b' }}>
                      {sr.priority}
                    </span>
                  </td>
                  <td style={{ padding: '12px 8px' }}>
                    <span style={{ ...pillStyle(statusStyle.fg), background: statusStyle.bg }}>
                      {STATUS_LABELS[sr.status] || sr.status}
                    </span>
                  </td>
                  <td style={{ padding: '12px 6px', fontSize: 12.5, color: '#57534e' }}>
                    {formatDate(sr.opened_at)}
                  </td>
                  <td style={{ padding: '12px 6px', fontSize: 12.5, color: '#57534e' }}>
                    {sr.closed_at ? formatDate(sr.closed_at) : 'Open'}
                  </td>
                  <td style={{ padding: '12px 6px', fontSize: 12.5 }}
                    title={sr.closed_at ? 'Time taken from opening to closing' : 'Not closed yet — time since it was opened'}>
                    {tat === null ? '—' : sr.closed_at
                      ? <span style={{ color: '#1f1108', fontWeight: 600 }}>{dayText(tat)}</span>
                      : <span style={{ color: '#b45309' }}>{dayText(tat)}</span>}
                  </td>
                  <td style={{ padding: '12px 8px', fontSize: 12, color: '#57534e' }}>{warrantyLabel(project)}</td>
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

