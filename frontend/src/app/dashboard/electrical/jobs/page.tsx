'use client'

import Select from '@/components/shared/Select'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { useCan } from '@/lib/permissions'
import { electricalApi } from '@/lib/api'
import { recordPath } from '@/lib/recordRef'
import { ElectricalJob } from '@/types'
import { TEXT, GLASS, SHADOWS } from '@/lib/theme'
import { primaryBtnStyle, segmentBtnStyle, thStyle, tdStyle, Pill, RowCount } from '@/components/shared/ui'
import { inputStyle, JOB_STATUS_LABELS as STATUS_LABELS, JOB_STATUS_HEX as STATUS_HEX, PRIORITY_HEX } from '@/components/electrical/shared'
import { normalizePriority, priorityLabel } from '@/lib/priority'
import ElectricalNav from '@/components/electrical/ElectricalNav'
import { extractErrorMessages } from '@/lib/validation'
import { formatDate } from '@/lib/format'
import { useVisibility } from '@/lib/visibility'
import { VisTd, VisTh } from '@/lib/visibilityComponents'
import { sampleJobs } from '@/lib/electricalPreviewSamples'

const PHASE_LABELS: Record<string, string> = { design: 'Design', procurement: 'Procurement', build: 'Assembly', test_qc: 'Testing & QC', handover: 'Handover' }

const cellStyle: React.CSSProperties = tdStyle
// Columns a role may hide (Role & Permissions › Electrical › RRV Electrical Jobs › Visibility); number, title and status always show.
const COLS: { label: string; key?: string }[] = [
  { label: 'Job No.' }, { label: 'Title / RRV' }, { label: 'Customer', key: 'customer' }, { label: 'Lead Engineer', key: 'lead_engineer' },
  { label: 'Current Stage', key: 'current_stage' }, { label: 'Progress', key: 'progress' }, { label: 'Target Handover', key: 'target_handover' },
  { label: 'Priority', key: 'priority' }, { label: 'Status' },
]

export default function ElectricalJobsPage() {
  const { isAuthorized, isLoading } = useRequireApp('electrical')
  const router = useRouter()
  const { can } = useCan()
  // Role editor "Preview & choose": three made-up jobs, nothing is loaded.
  const vis = useVisibility('electrical:jobs')

  const [jobs, setJobs] = useState<ElectricalJob[]>(vis.preview ? sampleJobs : [])
  const [loading, setLoading] = useState(!vis.preview)
  const [error, setError] = useState<string | string[]>('')
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('open')
  const [phaseFilter, setPhaseFilter] = useState('')
  const [mine, setMine] = useState(false)

  useEffect(() => {
    if (!isAuthorized || vis.preview) return
    const params: Record<string, unknown> = {}
    if (statusFilter) params.status = statusFilter
    if (phaseFilter) params.phase = phaseFilter
    if (mine) params.mine = true
    if (search.trim()) params.search = search.trim()
    electricalApi.listJobs(params)
      .then((data) => { setJobs(Array.isArray(data) ? data : []); setError('') })
      .catch((err) => setError(extractErrorMessages(err, 'Failed to load electrical jobs.')))
      .finally(() => setLoading(false))
  }, [isAuthorized, statusFilter, phaseFilter, mine, search, vis.preview])

  if (isLoading || !isAuthorized) return null
  const colCount = COLS.filter((c) => !c.key || vis.preview || vis.showColumn('jobs', c.key)).length

  return (
    <div>
      {!vis.preview && <ElectricalNav />}

      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, marginBottom: 20, flexWrap: 'wrap' }}>
        <div>
          <p style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 4px' }}>
            Electrical Module
          </p>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: TEXT.heading, margin: 0 }}>RRV Electrical Jobs</h1>
          <p style={{ fontSize: 13, color: TEXT.muted, margin: '6px 0 0' }}>
            One job per RRV whose electrical system is being built — open a job to work its stages, BOM, drawings and tests.
          </p>
        </div>
        {can('electrical', 'jobs', 'create') && !vis.preview && (
          <button
            data-tour="elec-jobs-new-btn"
            onClick={() => router.push('/dashboard/electrical/jobs/new')}
            style={primaryBtnStyle}
          >
            + New Job
          </button>
        )}
      </div>

      {error && (
        <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
          {Array.isArray(error) ? error.join(' ') : error}
        </div>
      )}

      <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap', alignItems: 'center' }}>
        <input data-tour="elec-jobs-search" style={{ ...inputStyle, width: 'auto', flex: '1 1 240px', minWidth: 200, maxWidth: 420 }} placeholder="Search job no., title, model, vehicle, customer…" value={search} onChange={(e) => setSearch(e.target.value)} />
        <Select data-tour="elec-jobs-status-filter" style={{ ...inputStyle, width: 'auto', flex: '0 1 220px' }} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="open">Open (draft / active / hold)</option>
          <option value="">All statuses</option>
          {Object.entries(STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </Select>
        <Select data-tour="elec-jobs-phase-filter" style={{ ...inputStyle, width: 'auto', flex: '0 1 170px' }} value={phaseFilter} onChange={(e) => setPhaseFilter(e.target.value)}>
          <option value="">Any phase</option>
          {Object.entries(PHASE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </Select>
        <button data-tour="elec-jobs-mine" type="button" aria-pressed={mine} onClick={() => setMine((v) => !v)} style={segmentBtnStyle(mine)}>
          {mine ? '✓ ' : ''}My jobs
        </button>
      </div>

      <div data-tour="elec-jobs-table" style={{
        borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur,
        border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), overflow: 'auto', maxHeight: 'calc(100vh - 320px)',
      }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 1050 }}>
          <thead>
            <tr>
              {COLS.map((c, hi) => c.key
                ? <VisTh key={c.label} vis={vis} table="jobs" k={c.key} style={thStyle}>{c.label}</VisTh>
                : <th key={c.label} style={thStyle}>{c.label}{hi === 0 && <RowCount count={jobs.length} />}</th>)}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={colCount} style={{ padding: 20, textAlign: 'center', fontSize: 13, color: TEXT.muted }}>Loading…</td></tr>
            ) : jobs.length === 0 ? (
              <tr><td colSpan={colCount} style={{ padding: 20, textAlign: 'center', fontSize: 13, color: TEXT.muted }}>
                {search.trim() || phaseFilter || mine || statusFilter !== 'open'
                  ? 'No electrical jobs match these filters — clear the search or pick another status.'
                  : `No open electrical jobs.${can('electrical', 'jobs', 'create') ? ' Use "+ New Job" for each RRV whose electrical system you’re building.' : ''}`}
              </td></tr>
            ) : (
              jobs.map((j) => (
                <tr key={j.id} onClick={() => { if (!vis.preview) router.push(recordPath('/dashboard/electrical/jobs', j)) }} style={{ cursor: 'pointer' }}>
                  <td style={{ ...cellStyle, fontWeight: 600, color: TEXT.heading, whiteSpace: 'nowrap' }}>{j.job_number}</td>
                  <td style={{ ...cellStyle, maxWidth: 280 }} title={j.title}>
                    <div style={{ fontWeight: 600, color: TEXT.heading, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{j.title}</div>
                    <div style={{ fontSize: 12, color: TEXT.muted }}>{[j.rrv_model, j.vehicle_number].filter(Boolean).join(' · ') || '—'}</div>
                  </td>
                  <VisTd vis={vis} table="jobs" k="customer" style={cellStyle}>{j.customer_name || '—'}</VisTd>
                  <VisTd vis={vis} table="jobs" k="lead_engineer" style={cellStyle}>{j.lead_engineer_name || '—'}</VisTd>
                  <VisTd vis={vis} table="jobs" k="current_stage" style={cellStyle}>
                    {j.current_stage_label ? (
                      <>
                        <div>{j.current_stage_label}</div>
                        <div style={{ fontSize: 11.5, color: TEXT.muted }}>{PHASE_LABELS[j.current_phase || ''] || ''}</div>
                      </>
                    ) : <span style={{ color: '#16A34A', fontWeight: 600 }}>All stages done</span>}
                  </VisTd>
                  <VisTd vis={vis} table="jobs" k="progress" style={{ ...cellStyle, minWidth: 130 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <div style={{ flex: 1, height: 6, borderRadius: 3, background: 'rgba(0,0,0,0.07)', overflow: 'hidden' }}>
                        <div style={{ width: `${j.progress_percent}%`, height: '100%', background: '#16A34A' }} />
                      </div>
                      <span style={{ fontSize: 12, color: TEXT.muted, whiteSpace: 'nowrap' }}>{j.done_stages}/{j.total_stages}</span>
                    </div>
                  </VisTd>
                  <VisTd vis={vis} table="jobs" k="target_handover" style={{ ...cellStyle, color: j.is_overdue ? '#DC2626' : TEXT.body, fontWeight: j.is_overdue ? 600 : 400, whiteSpace: 'nowrap' }}>
                    {j.target_handover_date ? formatDate(j.target_handover_date) : '—'}
                  </VisTd>
                  <VisTd vis={vis} table="jobs" k="priority" style={cellStyle}><Pill label={priorityLabel(j.priority)} hex={PRIORITY_HEX[normalizePriority(j.priority)]} /></VisTd>
                  <td style={cellStyle}><Pill label={STATUS_LABELS[j.status] || j.status} hex={STATUS_HEX[j.status]} /></td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
