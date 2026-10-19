'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { projectsApi } from '@/lib/api'
import { PmDashboard } from '@/types'
import { TEXT } from '@/lib/theme'
import { formatDate } from '@/lib/format'
import { extractErrorMessages } from '@/lib/validation'
import ProjectsNav from '@/components/projects/ProjectsNav'
import { recordPath } from '@/lib/recordRef'
import { ErrorBanner, PROJECT_HEX, PROJECT_LABELS, Pill, sectionStyle, tdStyle, thStyle, todayIso } from '@/components/projects/work/pmUi'

// Management view: every live project and which handovers are due or late.
// WBS elements are no longer used, so nothing here is WBS-based.
export default function ProjectsDashboardPage() {
  const { isAuthorized, isLoading } = useRequireApp('projects')
  const router = useRouter()
  const [data, setData] = useState<PmDashboard | null>(null)
  const [error, setError] = useState<string | string[]>('')

  useEffect(() => {
    if (!isAuthorized) return
    projectsApi.dashboard().then(setData).catch((err) => setError(extractErrorMessages(err, 'Failed to load the dashboard.')))
  }, [isAuthorized])

  if (isLoading || !isAuthorized) return null
  const today = todayIso()
  const [y, mo, d] = today.split('-').map(Number)
  const plus30 = new Date(y, mo - 1, d + 30)
  const in30 = `${plus30.getFullYear()}-${String(plus30.getMonth() + 1).padStart(2, '0')}-${String(plus30.getDate()).padStart(2, '0')}`
  const live = (data?.projects || []).slice().sort((a, b) => (a.target_handover_date || '9999').localeCompare(b.target_handover_date || '9999'))
  const overdue = live.filter((p) => p.target_handover_date && p.target_handover_date < today)
  const dueSoon = live.filter((p) => p.target_handover_date && p.target_handover_date >= today && p.target_handover_date <= in30)
  const kpis = [
    { label: 'Open projects', value: live.length, color: TEXT.heading },
    { label: 'Handover in next 30 days', value: dueSoon.length, color: '#f59e0b' },
    { label: 'Handover date passed', value: overdue.length, color: '#dc2626' },
  ]

  return (
    <div>
      <ProjectsNav />
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, color: TEXT.heading, margin: '0 0 4px' }}>Projects Dashboard</h1>
        <p style={{ fontSize: 13.5, color: TEXT.muted, margin: 0 }}>Every open project, nearest handover first.</p>
      </div>
      <ErrorBanner error={error} />
      {!data ? (!error && <p style={{ fontSize: 13, color: TEXT.muted }}>Loading…</p>) : (
        <>
          <div data-tour="pm-dash-kpis" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginBottom: 20 }}>
            {kpis.map((k) => (
              <div key={k.label} style={{ ...sectionStyle, marginBottom: 0, padding: 16 }}>
                <p style={{ fontSize: 11.5, fontWeight: 700, color: TEXT.muted, textTransform: 'uppercase', letterSpacing: '.04em', margin: '0 0 6px' }}>{k.label}</p>
                <p style={{ fontSize: 26, fontWeight: 800, color: k.color, margin: 0 }}>{k.value}</p>
              </div>
            ))}
          </div>

          <div data-tour="pm-dash-live" style={sectionStyle}>
            <h2 style={{ fontSize: 16, fontWeight: 700, color: TEXT.heading, margin: '0 0 12px' }}>Open projects</h2>
            {live.length === 0 ? <p style={{ fontSize: 13, color: TEXT.muted, margin: 0 }}>No open projects.</p> : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 720 }}>
                  <thead><tr>
                    {['Project ID', 'Project', 'Customer', 'Status', 'Project manager', 'Target handover'].map((h) => <th key={h} style={thStyle}>{h}</th>)}
                  </tr></thead>
                  <tbody>
                    {live.map((p) => {
                      const late = !!p.target_handover_date && p.target_handover_date < today
                      return (
                        <tr key={p.id} onClick={() => router.push(recordPath('/dashboard/projects', p))} style={{ cursor: 'pointer' }}>
                          <td style={{ ...tdStyle, fontWeight: 700 }}>{p.project_code}</td>
                          <td style={tdStyle}>{p.name}</td>
                          <td style={tdStyle}>{p.client_name || '—'}</td>
                          <td style={tdStyle}><Pill value={p.status} labels={PROJECT_LABELS} hex={PROJECT_HEX} /></td>
                          <td style={tdStyle}>{p.project_manager_name || '—'}</td>
                          <td style={{ ...tdStyle, color: late ? '#dc2626' : TEXT.body, fontWeight: late ? 600 : 400 }}>
                            {formatDate(p.target_handover_date)}{late ? ' · passed' : ''}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
