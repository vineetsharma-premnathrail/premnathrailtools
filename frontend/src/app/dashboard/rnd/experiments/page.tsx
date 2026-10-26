'use client'

import Select from '@/components/shared/Select'
import { Suspense, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { rndApi } from '@/lib/api'
import { RndExperiment, RndProject } from '@/types'
import { TEXT, GLASS, SHADOWS, BORDER } from '@/lib/theme'
import { primaryBtnStyle, RowCount, inputStyle as sharedInputStyle, pillStyle } from '@/components/shared/ui'
import SearchableSelect from '@/components/erp/SearchableSelect'
import RndNav from '@/components/rnd/RndNav'
import InvalidRecordLink from '@/components/erp/InvalidRecordLink'
import { recordPath } from '@/lib/recordRef'
import { projectLinkHref, useUrlProjectId } from '@/components/rnd/projectLink'
import { extractErrorMessages } from '@/lib/validation'
import { useCan } from '@/lib/permissions'
import { formatDate } from '@/lib/format'

const STATUS_LABELS: Record<string, string> = { planned: 'Planned', in_progress: 'In Progress', completed: 'Completed', cancelled: 'Cancelled' }
const STATUS_HEX: Record<string, string> = { planned: '#78716c', in_progress: '#2563EB', completed: '#16A34A', cancelled: '#DC2626' }
const RESULT_LABELS: Record<string, string> = { pass: 'Pass', fail: 'Fail', inconclusive: 'Inconclusive' }
const RESULT_HEX: Record<string, string> = { pass: '#16A34A', fail: '#DC2626', inconclusive: '#F59E0B' }
const TYPE_LABELS: Record<string, string> = { research: 'Research', lab_test: 'Lab Test', field_trial: 'Field Trial', simulation: 'Simulation', validation: 'Validation' }

// Shared 34px control scale; list filters keep their own width.
const inputStyle: React.CSSProperties = { ...sharedInputStyle, width: 'auto', background: 'rgba(255,255,255,.7)' }

export default function RndExperimentsListPage() {
  return (
    <Suspense fallback={null}>
      <RndExperimentsListPageInner />
    </Suspense>
  )
}

function RndExperimentsListPageInner() {
  const { isAuthorized, isLoading } = useRequireApp('rnd')
  const { can } = useCan()
  const router = useRouter()
  const searchParams = useSearchParams()

  const [experiments, setExperiments] = useState<RndExperiment[]>([])
  const [projects, setProjects] = useState<RndProject[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | string[]>('')
  const [search, setSearch] = useState('')
  const [projectFilter, setProjectFilter] = useState('')
  const projectLink = useUrlProjectId(searchParams.get('project_id'), setProjectFilter)
  const [typeFilter, setTypeFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [resultFilter, setResultFilter] = useState('')

  useEffect(() => {
    if (!isAuthorized) return
    rndApi.listProjects()
      .then((data) => setProjects(Array.isArray(data) ? data : []))
      .catch((err) => setError(extractErrorMessages(err, 'Failed to load R&D projects.')))
  }, [isAuthorized])

  useEffect(() => {
    if (!isAuthorized || projectLink.loading) return
    const params: Record<string, unknown> = {}
    if (projectFilter) params.project_id = Number(projectFilter)
    if (typeFilter) params.experiment_type = typeFilter
    if (statusFilter) params.status = statusFilter
    if (resultFilter) params.result = resultFilter
    if (search.trim()) params.search = search.trim()
    rndApi.listExperiments(params)
      .then((data) => setExperiments(Array.isArray(data) ? data : []))
      .catch((err) => setError(extractErrorMessages(err, 'Failed to load experiments.')))
      .finally(() => setLoading(false))
  }, [isAuthorized, projectLink.loading, projectFilter, typeFilter, statusFilter, resultFilter, search])

  const newHref = projectLinkHref('/dashboard/rnd/experiments/new', projects, projectFilter)

  if (isLoading || !isAuthorized) return null
  if (projectLink.error) return (<div><RndNav /><InvalidRecordLink message={projectLink.error} listHref="/dashboard/rnd/experiments" listLabel="Back to experiments" /></div>)

  return (
    <div>
      <RndNav />

      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, marginBottom: 20, flexWrap: 'wrap' }}>
        <div>
          <p style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 4px' }}>
            R&amp;D Module
          </p>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: TEXT.heading, margin: 0 }}>Experiments &amp; Tests</h1>
        </div>
        {can('rnd', 'experiments', 'create') && (
          <button
            data-tour="rnd-exp-new-btn"
            onClick={() => router.push(newHref)}
            style={primaryBtnStyle}
          >
            + New Experiment
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
          data-tour="rnd-exp-search"
          style={{ ...inputStyle, flex: '1 1 240px', minWidth: 200 }}
          placeholder="Search by experiment number or title…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <div data-tour="rnd-exp-project-filter" style={{ flex: '1 1 240px', minWidth: 200, maxWidth: 340 }}>
          <SearchableSelect
            value={projectFilter}
            onChange={setProjectFilter}
            options={[
              { value: '', label: 'All projects' },
              ...projects.map((p) => ({ value: String(p.id), label: `${p.project_number} — ${p.title}` })),
            ]}
            placeholder="All projects"
          />
        </div>
        <Select data-tour="rnd-exp-type-filter" style={{ ...inputStyle, flex: '0 1 160px' }} value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
          <option value="">All types</option>
          <option value="research">Research</option>
          <option value="lab_test">Lab Test</option>
          <option value="field_trial">Field Trial</option>
          <option value="simulation">Simulation</option>
          <option value="validation">Validation</option>
        </Select>
        <Select data-tour="rnd-exp-status-filter" style={{ ...inputStyle, flex: '0 1 160px' }} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="">All statuses</option>
          <option value="planned">Planned</option>
          <option value="in_progress">In Progress</option>
          <option value="completed">Completed</option>
          <option value="cancelled">Cancelled</option>
        </Select>
        <Select data-tour="rnd-exp-result-filter" style={{ ...inputStyle, flex: '0 1 160px' }} value={resultFilter} onChange={(e) => setResultFilter(e.target.value)}>
          <option value="">All results</option>
          <option value="pass">Pass</option>
          <option value="fail">Fail</option>
          <option value="inconclusive">Inconclusive</option>
        </Select>
      </div>

      <div style={{
        borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur,
        border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), overflow: 'auto', maxHeight: 'calc(100vh - 320px)',
      }}>
        <table data-tour="rnd-exp-table" style={{ width: '100%', borderCollapse: 'collapse', minWidth: 900 }}>
          <thead>
            <tr>
              {['Experiment No.', 'Title', 'Project', 'Type', 'Status', 'Result', 'Date'].map((h, hi) => (
                <th key={h} style={{ textAlign: 'left', padding: '10px 14px', fontSize: 11, fontWeight: 600, letterSpacing: '.03em', textTransform: 'uppercase', color: TEXT.muted, position: 'sticky', top: 0, background: '#fdf1e6', zIndex: 1 }}>
                  {h}{hi === 0 && <RowCount count={experiments.length} />}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={7} style={{ padding: 20, textAlign: 'center', fontSize: 13, color: TEXT.muted }}>Loading…</td></tr>
            ) : experiments.length === 0 ? (
              <tr><td colSpan={7} style={{ padding: 20, textAlign: 'center', fontSize: 13, color: TEXT.muted }}>No experiments found.</td></tr>
            ) : (
              experiments.map((x) => (
                <tr key={x.id} onClick={() => router.push(recordPath('/dashboard/rnd/experiments', x))} style={{ cursor: 'pointer' }}>
                  <td style={{ padding: '10px 14px', fontSize: 13, fontWeight: 600, color: TEXT.heading, borderTop: `1px solid ${BORDER.light}`, whiteSpace: 'nowrap' }}>{x.experiment_number}</td>
                  <td style={{ padding: '10px 14px', fontSize: 13, color: TEXT.body, borderTop: `1px solid ${BORDER.light}` }}>{x.title}</td>
                  <td style={{ padding: '10px 14px', fontSize: 13, color: TEXT.body, borderTop: `1px solid ${BORDER.light}`, whiteSpace: 'nowrap' }} title={x.project_title || undefined}>{x.project_number || '—'}</td>
                  <td style={{ padding: '10px 14px', fontSize: 13, color: TEXT.body, borderTop: `1px solid ${BORDER.light}`, whiteSpace: 'nowrap' }}>{TYPE_LABELS[x.experiment_type] || x.experiment_type}</td>
                  <td style={{ padding: '10px 14px', borderTop: `1px solid ${BORDER.light}` }}>
                    <span style={pillStyle(STATUS_HEX[x.status])}>
                      {STATUS_LABELS[x.status] || x.status}
                    </span>
                  </td>
                  <td style={{ padding: '10px 14px', fontSize: 13, color: TEXT.muted, borderTop: `1px solid ${BORDER.light}` }}>
                    {x.result ? (
                      <span style={pillStyle(RESULT_HEX[x.result])}>
                        {RESULT_LABELS[x.result] || x.result}
                      </span>
                    ) : '—'}
                  </td>
                  <td style={{ padding: '10px 14px', fontSize: 13, color: TEXT.body, borderTop: `1px solid ${BORDER.light}`, whiteSpace: 'nowrap' }}>{x.experiment_date ? formatDate(x.experiment_date) : '—'}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
