'use client'

import FilterMenu from '@/components/shared/FilterMenu'
import { Suspense, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { rndApi } from '@/lib/api'
import { RndProject } from '@/types'
import { TEXT, GLASS, SHADOWS, BORDER } from '@/lib/theme'
import { primaryBtnStyle, secondaryBtnStyle, RowCount, inputStyle as sharedInputStyle, pillStyle } from '@/components/shared/ui'
import RndNav from '@/components/rnd/RndNav'
import { recordPath } from '@/lib/recordRef'
import { extractErrorMessages } from '@/lib/validation'
import { useCan } from '@/lib/permissions'
import { formatDate } from '@/lib/format'
import { PRIORITY_OPTIONS, priorityLabel, priorityTone } from '@/lib/priority'
import { ORIGIN_HEX as ORIGIN_COLORS, ORIGIN_LABELS as ORIGIN_NAMES, normalizeOrigin } from '@/components/rnd/ProjectOriginFields'
import { useVisibility } from '@/lib/visibility'
import { VisTd, VisTh } from '@/lib/visibilityComponents'
import { sampleProjects } from '@/lib/rndPreviewSamples'

const STAGE_LABELS: Record<string, string> = { initiation: 'Initiation', research: 'Research', development: 'Development', feasibility: 'Feasibility', handover: 'Handover', closed: 'Closed' }
const STATUS_LABELS: Record<string, string> = { active: 'Active', on_hold: 'On Hold', cancelled: 'Cancelled' }
const STATUS_HEX: Record<string, string> = { active: '#16A34A', on_hold: '#F59E0B', cancelled: '#DC2626' }
// Why the project exists (Project Origin): Existing Projects or New Project; 'not_recorded' = saved before origin existed.
const ORIGIN_LABELS: Record<string, string> = { ...ORIGIN_NAMES, not_recorded: 'Not recorded' }
const ORIGIN_HEX: Record<string, string> = { ...ORIGIN_COLORS, not_recorded: '#78716c' }

// Shared 34px control scale; list filters keep their own width.
const inputStyle: React.CSSProperties = { ...sharedInputStyle, width: 'auto', background: 'rgba(255,255,255,.7)' }
const tdStyle: React.CSSProperties = { padding: '10px 14px', fontSize: 13, color: TEXT.body, borderTop: `1px solid ${BORDER.light}` }
const thStyle: React.CSSProperties = { textAlign: 'left', padding: '10px 14px', fontSize: 11, fontWeight: 600, letterSpacing: '.03em', textTransform: 'uppercase', color: TEXT.muted, position: 'sticky', top: 0, background: '#fdf1e6', zIndex: 1 }
const COLUMNS = ['ID', 'Title', 'Origin', 'Priority', 'Status', 'Lead', 'Target End']
// Columns a role may hide (Role editor > R&D > Prototype / Research > Visibility). ID, Title and Status always show.
const HIDEABLE: Record<string, string> = { Origin: 'origin', Priority: 'priority', Lead: 'lead', 'Target End': 'target_end' }


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
  const vis = useVisibility('rnd:projects')

  const [projects, setProjects] = useState<RndProject[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | string[]>('')
  const [search, setSearch] = useState('')
  const [stageFilter, setStageFilter] = useState(searchParams.get('stage') || '')
  const [statusFilter, setStatusFilter] = useState('')
  const [priorityFilter, setPriorityFilter] = useState('')
  const [originFilter, setOriginFilter] = useState('')
  const activeFilterCount = [stageFilter, statusFilter, priorityFilter, originFilter].filter(Boolean).length
  const clearFilters = () => { setStageFilter(''); setStatusFilter(''); setPriorityFilter(''); setOriginFilter('') }

  useEffect(() => {
    if (!isAuthorized) return
    // Role editor preview: made-up rows, nothing is loaded.
    if (vis.preview) { setProjects(sampleProjects); setLoading(false); return }
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
  }, [isAuthorized, stageFilter, statusFilter, priorityFilter, originFilter, search, vis.preview])

  if (isLoading || !isAuthorized) return null
  // The preview draws every column (hidden ones dimmed, with a toggle); normal use drops the hidden ones.
  const columns = COLUMNS.filter((h) => !HIDEABLE[h] || vis.preview || vis.showColumn('projects', HIDEABLE[h]))

  return (
    <div>
      {!vis.preview && <RndNav />}

      {error && (
        <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
          {Array.isArray(error) ? error.join(' ') : error}
        </div>
      )}

      {/* One toolbar row: create on the left, search + Filter menu next to it — same as the Procurement lists. */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
        {can('rnd', 'projects', 'create') && (
          <button
            data-tour="rnd-proj-new-btn"
            onClick={() => router.push('/dashboard/rnd/projects/new')}
            disabled={vis.preview}
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
        <FilterMenu
          tourId="rnd-proj-filter-btn"
          fields={[
            { key: 'stage', label: 'Stage', value: stageFilter, allLabel: 'All stages', options: Object.entries(STAGE_LABELS).map(([k, v]) => ({ value: k, label: v })) },
            { key: 'status', label: 'Status', value: statusFilter, allLabel: 'All statuses', options: Object.entries(STATUS_LABELS).map(([k, v]) => ({ value: k, label: v })) },
            { key: 'priority', label: 'Priority', value: priorityFilter, allLabel: 'All priorities', options: PRIORITY_OPTIONS.map((o) => ({ value: o.value, label: o.label })) },
            { key: 'origin', label: 'Origin', value: originFilter, allLabel: 'All origins', options: Object.entries(ORIGIN_NAMES).map(([k, v]) => ({ value: k, label: v })) },
          ]}
          onChange={(key, v) => {
            if (key === 'stage') setStageFilter(v)
            else if (key === 'status') setStatusFilter(v)
            else if (key === 'priority') setPriorityFilter(v)
            else setOriginFilter(v)
          }}
          onClear={clearFilters}
        />
        {activeFilterCount > 0 && <button type="button" onClick={clearFilters} style={secondaryBtnStyle}>Clear</button>}
      </div>

      <div style={{
        borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur,
        border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), overflow: 'auto', maxHeight: 'calc(100vh - 320px)',
      }}>
        <table data-tour="rnd-proj-table" style={{ width: '100%', borderCollapse: 'collapse', minWidth: 960 }}>
          <thead>
            <tr>
              {columns.map((h, hi) => HIDEABLE[h]
                ? <VisTh key={h} vis={vis} table="projects" k={HIDEABLE[h]} style={thStyle}>{h}</VisTh>
                : <th key={h} style={thStyle}>{h}{hi === 0 && <RowCount count={projects.length} />}</th>)}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={columns.length} style={{ padding: 20, textAlign: 'center', fontSize: 13, color: TEXT.muted }}>Loading…</td></tr>
            ) : projects.length === 0 ? (
              <tr><td colSpan={columns.length} style={{ padding: 20, textAlign: 'center', fontSize: 13, color: TEXT.muted }}>No R&amp;D projects found.</td></tr>
            ) : (
              projects.map((p) => {
                return (
                  <tr key={p.id} onClick={vis.preview ? undefined : () => router.push(recordPath('/dashboard/rnd/projects', p))} style={{ cursor: 'pointer' }}>
                    <td style={{ ...tdStyle, fontWeight: 600, color: TEXT.heading, whiteSpace: 'nowrap' }}>{p.project_number}</td>
                    <td style={tdStyle}>{p.title}</td>
                    <VisTd vis={vis} table="projects" k="origin" style={tdStyle} title={p.source_ref || undefined}>
                      <span style={pillStyle(ORIGIN_HEX[normalizeOrigin(p.origin) || 'not_recorded'])}>
                        {ORIGIN_LABELS[normalizeOrigin(p.origin) || 'not_recorded']}
                      </span>
                    </VisTd>
                    <VisTd vis={vis} table="projects" k="priority" style={tdStyle}>
                      <span style={pillStyle(priorityTone(p.priority).color)}>
                        {priorityLabel(p.priority)}
                      </span>
                    </VisTd>
                    <td style={tdStyle}>
                      <span style={pillStyle(STATUS_HEX[p.status])}>
                        {STATUS_LABELS[p.status] || p.status}
                      </span>
                    </td>
                    <VisTd vis={vis} table="projects" k="lead" style={{ ...tdStyle, whiteSpace: 'nowrap' }}>{p.lead_name || '—'}</VisTd>
                    <VisTd vis={vis} table="projects" k="target_end" style={{ ...tdStyle, whiteSpace: 'nowrap' }}>{p.target_end_date ? formatDate(p.target_end_date) : 'Not decided'}</VisTd>
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
