'use client'

import Select from '@/components/shared/Select'
import { Suspense, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { rndApi } from '@/lib/api'
import { RndProject } from '@/types'
import { TEXT, GLASS, SHADOWS, BORDER } from '@/lib/theme'
import { primaryBtnStyle, RowCount, inputStyle as sharedInputStyle, pillStyle } from '@/components/shared/ui'
import RndNav from '@/components/rnd/RndNav'
import { recordPath } from '@/lib/recordRef'
import { extractErrorMessages } from '@/lib/validation'
import { useCan } from '@/lib/permissions'
import { formatDate } from '@/lib/format'

const STAGE_LABELS: Record<string, string> = { initiation: 'Initiation', research: 'Research', development: 'Development', feasibility: 'Feasibility', handover: 'Handover', closed: 'Closed' }
const STATUS_LABELS: Record<string, string> = { active: 'Active', on_hold: 'On Hold', cancelled: 'Cancelled' }
const STATUS_HEX: Record<string, string> = { active: '#16A34A', on_hold: '#F59E0B', cancelled: '#DC2626' }
const PRIORITY_LABELS: Record<string, string> = { low: 'Low', medium: 'Medium', high: 'High', critical: 'Critical' }
const PRIORITY_HEX: Record<string, string> = { low: '#78716c', medium: '#2563EB', high: '#F59E0B', critical: '#DC2626' }
// Why the project exists (Project Origin); 'not_recorded' = saved before origin existed.
const ORIGIN_LABELS: Record<string, string> = {
  customer_requirement: 'Customer requirement', product_improvement: 'Product improvement',
  new_development: 'New product (internal)', process_research: 'Process / tech research', not_recorded: 'Not recorded',
}
const ORIGIN_HEX: Record<string, string> = {
  customer_requirement: '#2563EB', product_improvement: '#D97706', new_development: '#7C3AED', process_research: '#0D9488', not_recorded: '#78716c',
}

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

  useEffect(() => {
    if (!isAuthorized) return
    const params: Record<string, unknown> = {}
    if (stageFilter) params.stage = stageFilter
    if (statusFilter) params.status = statusFilter
    if (priorityFilter) params.priority = priorityFilter
    if (originFilter) params.origin = originFilter
    if (search.trim()) params.search = search.trim()
    rndApi.listProjects(params)
      .then((data) => { setProjects(Array.isArray(data) ? data : []); setError('') })
      .catch((err) => setError(extractErrorMessages(err, 'Failed to load R&D projects.')))
      .finally(() => setLoading(false))
  }, [isAuthorized, stageFilter, statusFilter, priorityFilter, originFilter, search])

  if (isLoading || !isAuthorized) return null

  return (
    <div>
      <RndNav />

      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, marginBottom: 20, flexWrap: 'wrap' }}>
        <div>
          <p style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 4px' }}>
            R&amp;D Module
          </p>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: TEXT.heading, margin: 0 }}>Prototype / Research</h1>
        </div>
        {can('rnd', 'projects', 'create') && (
          <button
            data-tour="rnd-proj-new-btn"
            onClick={() => router.push('/dashboard/rnd/projects/new')}
            style={primaryBtnStyle}
          >
            + New Project
          </button>
        )}
      </div>

      {error && (
        <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
          {Array.isArray(error) ? error.join(' ') : error}
        </div>
      )}

      <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
        <input
          data-tour="rnd-proj-search"
          style={{ ...inputStyle, flex: '1 1 240px', minWidth: 200 }}
          placeholder="Search by project number, title, or objective…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <Select data-tour="rnd-proj-stage-filter" style={{ ...inputStyle, flex: '0 1 170px' }} value={stageFilter} onChange={(e) => setStageFilter(e.target.value)}>
          <option value="">All stages</option>
          {Object.entries(STAGE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </Select>
        <Select data-tour="rnd-proj-status-filter" style={{ ...inputStyle, flex: '0 1 150px' }} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="">All statuses</option>
          {Object.entries(STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </Select>
        <Select data-tour="rnd-proj-priority-filter" style={{ ...inputStyle, flex: '0 1 150px' }} value={priorityFilter} onChange={(e) => setPriorityFilter(e.target.value)}>
          <option value="">All priorities</option>
          {Object.entries(PRIORITY_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </Select>
        <Select data-tour="rnd-proj-origin-filter" style={{ ...inputStyle, flex: '0 1 190px' }} value={originFilter} onChange={(e) => setOriginFilter(e.target.value)}>
          <option value="">All origins</option>
          {Object.entries(ORIGIN_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </Select>
      </div>

      <div style={{
        borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur,
        border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), overflow: 'auto', maxHeight: 'calc(100vh - 320px)',
      }}>
        <table data-tour="rnd-proj-table" style={{ width: '100%', borderCollapse: 'collapse', minWidth: 960 }}>
          <thead>
            <tr>
              {['ID', 'Title', 'Origin', 'Priority', 'Status', 'Lead', 'Target End', ''].map((h, hi) => (
                <th key={h} style={{ textAlign: 'left', padding: '10px 14px', fontSize: 11, fontWeight: 600, letterSpacing: '.03em', textTransform: 'uppercase', color: TEXT.muted, position: 'sticky', top: 0, background: '#fdf1e6', zIndex: 1 }}>
                  {h}{hi === 0 && <RowCount count={projects.length} />}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={8} style={{ padding: 20, textAlign: 'center', fontSize: 13, color: TEXT.muted }}>Loading…</td></tr>
            ) : projects.length === 0 ? (
              <tr><td colSpan={8} style={{ padding: 20, textAlign: 'center', fontSize: 13, color: TEXT.muted }}>No R&amp;D projects found.</td></tr>
            ) : (
              projects.map((p) => {
                return (
                  <tr key={p.id} onClick={() => router.push(recordPath('/dashboard/rnd/projects', p))} style={{ cursor: 'pointer' }}>
                    <td style={{ ...tdStyle, fontWeight: 600, color: TEXT.heading, whiteSpace: 'nowrap' }}>{p.project_number}</td>
                    <td style={tdStyle}>{p.title}</td>
                    <td style={tdStyle} title={p.source_ref || undefined}>
                      <span style={pillStyle(ORIGIN_HEX[p.origin || 'not_recorded'])}>
                        {ORIGIN_LABELS[p.origin || 'not_recorded'] || p.origin}
                      </span>
                    </td>
                    <td style={tdStyle}>
                      <span style={pillStyle(PRIORITY_HEX[p.priority])}>
                        {PRIORITY_LABELS[p.priority] || p.priority}
                      </span>
                    </td>
                    <td style={tdStyle}>
                      <span style={pillStyle(STATUS_HEX[p.status])}>
                        {STATUS_LABELS[p.status] || p.status}
                      </span>
                    </td>
                    <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>{p.lead_name || '—'}</td>
                    <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>{p.target_end_date ? formatDate(p.target_end_date) : 'Not decided'}</td>
                    <td onClick={(e) => e.stopPropagation()} style={tdStyle}>
                      <span onClick={() => router.push(recordPath('/dashboard/rnd/projects', p))} style={{ fontSize: 12, fontWeight: 600, color: '#FF6A2A', cursor: 'pointer' }}>View</span>
                    </td>
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
