'use client'

import Select from '@/components/shared/Select'
import { Suspense, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { rndApi } from '@/lib/api'
import { RndProject } from '@/types'
import { TEXT, GLASS, SHADOWS, BORDER } from '@/lib/theme'
import { primaryBtnStyle, secondaryBtnStyle, RowCount, inputStyle as sharedInputStyle, pillStyle } from '@/components/shared/ui'
import { FiltersButton, FiltersSheet } from '@/components/p2p/POTrackingShared'
import { sheetInput, sheetLabel } from '@/components/shared/FormSheet'
import RndNav from '@/components/rnd/RndNav'
import { recordPath } from '@/lib/recordRef'
import { extractErrorMessages } from '@/lib/validation'
import { useCan } from '@/lib/permissions'
import { formatDate } from '@/lib/format'
import { PRIORITY_OPTIONS, priorityLabel, priorityTone } from '@/lib/priority'
import { ORIGIN_HEX as ORIGIN_COLORS, ORIGIN_LABELS as ORIGIN_NAMES, normalizeOrigin } from '@/components/rnd/ProjectOriginFields'

const STAGE_LABELS: Record<string, string> = { initiation: 'Initiation', research: 'Research', development: 'Development', feasibility: 'Feasibility', handover: 'Handover', closed: 'Closed' }
const STATUS_LABELS: Record<string, string> = { active: 'Active', on_hold: 'On Hold', cancelled: 'Cancelled' }
const STATUS_HEX: Record<string, string> = { active: '#16A34A', on_hold: '#F59E0B', cancelled: '#DC2626' }
// Why the project exists (Project Origin): Existing Projects or New Project; 'not_recorded' = saved before origin existed.
const ORIGIN_LABELS: Record<string, string> = { ...ORIGIN_NAMES, not_recorded: 'Not recorded' }
const ORIGIN_HEX: Record<string, string> = { ...ORIGIN_COLORS, not_recorded: '#78716c' }

// Shared 34px control scale; list filters keep their own width.
const inputStyle: React.CSSProperties = { ...sharedInputStyle, width: 'auto', background: 'rgba(255,255,255,.7)' }
const tdStyle: React.CSSProperties = { padding: '10px 14px', fontSize: 13, color: TEXT.body, borderTop: `1px solid ${BORDER.light}` }


export default function RndProjectListPage() {
  return (
    <Suspense fallback={null}>
      <RndProjectList />
    </Suspense>
  )
}

function RndProjectList() {
  const { isAuthorized, isLoading } = useRequireApp('rnd')
  const { can } = useCan()
  const router = useRouter()
  const searchParams = useSearchParams()

  const [projects, setProjects] = useState<RndProject[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | string[]>('')
  const [search, setSearch] = useState('')
  const [stageFilter, setStageFilter] = useState(searchParams.get('stage') || '')
  const [statusFilter, setStatusFilter] = useState('')
  const [priorityFilter, setPriorityFilter] = useState('')
  const [originFilter, setOriginFilter] = useState('')
  // The Filters popup edits a draft; Apply copies it into the live filters.
  const [showFilters, setShowFilters] = useState(false)
  const [draft, setDraft] = useState({ stage: '', status: '', priority: '', origin: '' })
  const activeFilterCount = [stageFilter, statusFilter, priorityFilter, originFilter].filter(Boolean).length
  const openFilters = () => { setDraft({ stage: stageFilter, status: statusFilter, priority: priorityFilter, origin: originFilter }); setShowFilters(true) }
  const applyFilters = () => {
    setStageFilter(draft.stage); setStatusFilter(draft.status); setPriorityFilter(draft.priority); setOriginFilter(draft.origin); setShowFilters(false)
  }
  const clearFilters = () => {
    setStageFilter(''); setStatusFilter(''); setPriorityFilter(''); setOriginFilter('')
    setDraft({ stage: '', status: '', priority: '', origin: '' }); setShowFilters(false)
  }

  useEffect(() => {
    if (!isAuthorized) return
    const params: Record<string, unknown> = {}
    if (stageFilter) params.stage = stageFilter
    if (statusFilter) params.status = statusFilter
    if (priorityFilter) params.priority = priorityFilter
    if (originFilter) params.origin = originFilter
    if (search.trim()) params.search = search.trim()
    rndApi.listProjects(params)
      .then((data) => { setProjects(Array.isArray(data) ? [...data].sort((a: RndProject, b: RndProject) => a.project_number.localeCompare(b.project_number, undefined, { numeric: true })) : []); setError('') })
      .catch((err) => setError(extractErrorMessages(err, 'Failed to load R&D projects.')))
      .finally(() => setLoading(false))
  }, [isAuthorized, stageFilter, statusFilter, priorityFilter, originFilter, search])

  if (isLoading || !isAuthorized) return null

  return (
    <div>
      <RndNav />

      {error && (
        <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
          {Array.isArray(error) ? error.join(' ') : error}
        </div>
      )}

      {/* One toolbar row: create on the left, search + Filters (popup) next to it — same as the Procurement lists. */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
        {can('rnd', 'projects', 'create') && (
          <button
            data-tour="rnd-proj-new-btn"
            onClick={() => router.push('/dashboard/rnd/projects/new')}
            style={{ ...primaryBtnStyle, whiteSpace: 'nowrap' }}
          >
            + New R&amp;D Project
          </button>
        )}
        <input
          data-tour="rnd-proj-search"
          aria-label="Search R&D projects"
          style={{ ...inputStyle, flex: '1 1 240px', minWidth: 200 }}
          placeholder="Search by project number, title, or objective…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <FiltersButton count={activeFilterCount} onOpen={openFilters} tour="rnd-proj-filter-btn" />
        {activeFilterCount > 0 && <button type="button" onClick={clearFilters} style={secondaryBtnStyle}>Clear</button>}
      </div>

      {showFilters && (
        <FiltersSheet subtitle="Narrow the R&D project list, then press Apply." tour="rnd-proj-filter-sheet" applyTour="rnd-proj-apply-btn"
          onClose={() => setShowFilters(false)} onClear={clearFilters} onApply={applyFilters}>
          <div>
            <label style={sheetLabel}>Stage</label>
            <Select data-tour="rnd-proj-stage-filter" style={sheetInput} value={draft.stage} onChange={(e) => setDraft((d) => ({ ...d, stage: e.target.value }))}>
              <option value="">All stages</option>
              {Object.entries(STAGE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </Select>
          </div>
          <div>
            <label style={sheetLabel}>Status</label>
            <Select data-tour="rnd-proj-status-filter" style={sheetInput} value={draft.status} onChange={(e) => setDraft((d) => ({ ...d, status: e.target.value }))}>
              <option value="">All statuses</option>
              {Object.entries(STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </Select>
          </div>
          <div>
            <label style={sheetLabel}>Priority</label>
            <Select data-tour="rnd-proj-priority-filter" style={sheetInput} value={draft.priority} onChange={(e) => setDraft((d) => ({ ...d, priority: e.target.value }))}>
              <option value="">All priorities</option>
              {PRIORITY_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </Select>
          </div>
          <div>
            <label style={sheetLabel}>Origin</label>
            <Select data-tour="rnd-proj-origin-filter" style={sheetInput} value={draft.origin} onChange={(e) => setDraft((d) => ({ ...d, origin: e.target.value }))}>
              <option value="">All origins</option>
              {Object.entries(ORIGIN_NAMES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </Select>
          </div>
        </FiltersSheet>
      )}

      <div style={{
        borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur,
        border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), overflow: 'auto', maxHeight: 'calc(100vh - 320px)',
      }}>
        <table data-tour="rnd-proj-table" style={{ width: '100%', borderCollapse: 'collapse', minWidth: 960 }}>
          <thead>
            <tr>
              {['ID', 'Title', 'Origin', 'Priority', 'Status', 'Lead', 'Target End'].map((h, hi) => (
                <th key={h} style={{ textAlign: 'left', padding: '10px 14px', fontSize: 11, fontWeight: 600, letterSpacing: '.03em', textTransform: 'uppercase', color: TEXT.muted, position: 'sticky', top: 0, background: '#fdf1e6', zIndex: 1 }}>
                  {h}{hi === 0 && <RowCount count={projects.length} />}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={7} style={{ padding: 20, textAlign: 'center', fontSize: 13, color: TEXT.muted }}>Loading…</td></tr>
            ) : projects.length === 0 ? (
              <tr><td colSpan={7} style={{ padding: 20, textAlign: 'center', fontSize: 13, color: TEXT.muted }}>No R&amp;D projects found.</td></tr>
            ) : (
              projects.map((p) => {
                return (
                  <tr key={p.id} onClick={() => router.push(recordPath('/dashboard/rnd/projects', p))} style={{ cursor: 'pointer' }}>
                    <td style={{ ...tdStyle, fontWeight: 600, color: TEXT.heading, whiteSpace: 'nowrap' }}>{p.project_number}</td>
                    <td style={tdStyle}>{p.title}</td>
                    <td style={tdStyle} title={p.source_ref || undefined}>
                      <span style={pillStyle(ORIGIN_HEX[normalizeOrigin(p.origin) || 'not_recorded'])}>
                        {ORIGIN_LABELS[normalizeOrigin(p.origin) || 'not_recorded']}
                      </span>
                    </td>
                    <td style={tdStyle}>
                      <span style={pillStyle(priorityTone(p.priority).color)}>
                        {priorityLabel(p.priority)}
                      </span>
                    </td>
                    <td style={tdStyle}>
                      <span style={pillStyle(STATUS_HEX[p.status])}>
                        {STATUS_LABELS[p.status] || p.status}
                      </span>
                    </td>
                    <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>{p.lead_name || '—'}</td>
                    <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>{p.target_end_date ? formatDate(p.target_end_date) : 'Not decided'}</td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
