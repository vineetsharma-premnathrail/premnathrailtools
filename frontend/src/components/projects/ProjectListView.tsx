'use client'

import Select from '@/components/shared/Select'
import { Suspense, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { projectsApi } from '@/lib/api'
import { PmProject } from '@/types'
import { TEXT } from '@/lib/theme'
import { formatDate } from '@/lib/format'
import { extractErrorMessages } from '@/lib/validation'
import { recordPath } from '@/lib/recordRef'
import {
  ErrorBanner, PROJECT_HEX, PROJECT_LABELS, Pill,
  inputStyle, sectionStyle, tdStyle, thStyle,
} from '@/components/projects/work/pmUi'
import { RowCount } from '@/components/shared/ui'

/** Every project with its status, customer, project manager and target
 * handover — the management list. */
export default function ProjectListView() {
  return <Suspense fallback={null}><ProjectListViewInner /></Suspense>
}

function addDaysIso(days: number) {
  const t = new Date(); t.setDate(t.getDate() + days)
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`
}

function ProjectListViewInner() {
  const router = useRouter()
  // ?due=soon | passed comes from the Projects Dashboard KPI cards (closing date filter).
  const due = useSearchParams().get('due')
  const [allProjects, setProjects] = useState<PmProject[]>([])
  const [status, setStatus] = useState('')
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | string[]>('')

  useEffect(() => {
    setLoading(true)
    const timer = setTimeout(() => {
      projectsApi.list({ status: status || undefined, search: search.trim() || undefined })
        .then((d) => { setProjects(Array.isArray(d) ? d : []); setError('') })
        .catch((err) => setError(extractErrorMessages(err, 'Failed to load projects.')))
        .finally(() => setLoading(false))
    }, 250)
    return () => clearTimeout(timer)
  }, [status, search])

  const todayStr = addDaysIso(0)
  const in30Str = addDaysIso(30)
  const projects = allProjects.filter((p) => {
    if (due === 'passed') return !!p.target_handover_date && p.target_handover_date < todayStr
    if (due === 'soon') return !!p.target_handover_date && p.target_handover_date >= todayStr && p.target_handover_date <= in30Str
    return true
  })

  return (
    <div style={sectionStyle}>
      <ErrorBanner error={error} />
      {(due === 'soon' || due === 'passed') && (
        <p style={{ fontSize: 13, color: '#475569', margin: '0 0 10px' }}>
          Showing projects {due === 'soon' ? 'closing in the next 30 days' : 'whose closing date has passed'}.{' '}
          <a href="/dashboard/projects/all" style={{ color: '#4338ca', fontWeight: 600 }}>Show all projects</a>
        </p>
      )}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 14 }}>
        <input data-tour="pm-all-search" style={{ ...inputStyle, maxWidth: 280 }} placeholder="Search code, name or customer…" value={search} onChange={(e) => setSearch(e.target.value)} />
        <Select data-tour="pm-all-status-filter" style={{ ...inputStyle, maxWidth: 200 }} value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All statuses</option>
          {Object.entries(PROJECT_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </Select>
      </div>
      {loading ? <p style={{ fontSize: 13, color: TEXT.muted, margin: 0 }}>Loading…</p> : projects.length === 0 ? (
        <p style={{ fontSize: 13, color: TEXT.muted, margin: 0 }}>{search.trim() || status ? 'No projects match this search or status — clear the filters to see every project.' : 'No projects yet — use + New Project to start one.'}</p>
      ) : (
        <div data-tour="pm-all-table" style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 720 }}>
            <thead><tr>
              {['Code', 'Project', 'Customer', 'Status', 'Project manager', 'Closing date'].map((h, i) => <th key={h} style={thStyle}>{h}{i === 0 && <RowCount count={projects.length} />}</th>)}
            </tr></thead>
            <tbody>
              {projects.map((p) => (
                <tr key={p.id} onClick={() => router.push(recordPath('/dashboard/projects', p))} style={{ cursor: 'pointer' }}>
                  <td style={{ ...tdStyle, fontWeight: 700, whiteSpace: 'nowrap' }}>{p.project_code}</td>
                  <td style={tdStyle}>{p.name}</td>
                  <td style={tdStyle}>{p.client_name || '—'}</td>
                  <td style={tdStyle}><Pill value={p.status} labels={PROJECT_LABELS} hex={PROJECT_HEX} /></td>
                  <td style={tdStyle}>{p.project_manager_name || '—'}</td>
                  <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>{formatDate(p.target_handover_date)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
