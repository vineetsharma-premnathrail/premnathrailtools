'use client'

import Select from '@/components/shared/Select'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
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

/** Every project with its status, customer, project manager and target
 * handover — the management list. */
export default function ProjectListView() {
  const router = useRouter()
  const [projects, setProjects] = useState<PmProject[]>([])
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

  return (
    <div style={sectionStyle}>
      <ErrorBanner error={error} />
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 14 }}>
        <input data-tour="pm-all-search" style={{ ...inputStyle, maxWidth: 280 }} placeholder="Search code, name or customer…" value={search} onChange={(e) => setSearch(e.target.value)} />
        <Select data-tour="pm-all-status-filter" style={{ ...inputStyle, maxWidth: 200 }} value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All statuses</option>
          {Object.entries(PROJECT_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </Select>
      </div>
      {loading ? <p style={{ fontSize: 13, color: TEXT.muted, margin: 0 }}>Loading…</p> : projects.length === 0 ? (
        <p style={{ fontSize: 13, color: TEXT.muted, margin: 0 }}>No projects match.</p>
      ) : (
        <div data-tour="pm-all-table" style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 720 }}>
            <thead><tr>
              {['Code', 'Project', 'Customer', 'Status', 'Project manager', 'Target handover'].map((h) => <th key={h} style={thStyle}>{h}</th>)}
            </tr></thead>
            <tbody>
              {projects.map((p) => (
                <tr key={p.id} onClick={() => router.push(recordPath('/dashboard/projects', p))} style={{ cursor: 'pointer' }}>
                  <td style={{ ...tdStyle, fontWeight: 700 }}>{p.project_code}</td>
                  <td style={tdStyle}>{p.name}</td>
                  <td style={tdStyle}>{p.client_name || '—'}</td>
                  <td style={tdStyle}><Pill value={p.status} labels={PROJECT_LABELS} hex={PROJECT_HEX} /></td>
                  <td style={tdStyle}>{p.project_manager_name || '—'}</td>
                  <td style={tdStyle}>{formatDate(p.target_handover_date)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
