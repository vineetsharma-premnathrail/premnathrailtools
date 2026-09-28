'use client'

import { useEffect, useState } from 'react'
import { useRequireApp } from '@/hooks/useAuth'
import { projectsApi } from '@/lib/api'
import { PmProject } from '@/types'
import { TEXT, GLASS, SHADOWS, BORDER } from '@/lib/theme'
import ProjectsNav from '@/components/projects/ProjectsNav'
import { extractErrorMessages } from '@/lib/validation'

const sectionStyle: React.CSSProperties = {
  borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur,
  border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), padding: 20, marginBottom: 20,
}

const STATUS_LABELS: Record<string, string> = {
  planning: 'Planning', active: 'Active', on_hold: 'On Hold', completed: 'Completed', cancelled: 'Cancelled',
}
const PRIORITY_LABELS: Record<string, string> = {
  low: 'Low', medium: 'Medium', high: 'High', critical: 'Critical',
}

function countBy(projects: PmProject[], key: 'status' | 'priority') {
  const counts: Record<string, number> = {}
  for (const p of projects) {
    const value = p[key] || 'unknown'
    counts[value] = (counts[value] || 0) + 1
  }
  return counts
}

function BreakdownBar({ label, count, total, color }: { label: string; count: number; total: number; color: string }) {
  const pct = total > 0 ? Math.round((count / total) * 100) : 0
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: TEXT.body }}>{label}</span>
        <span style={{ fontSize: 12.5, color: TEXT.muted }}>{count} ({pct}%)</span>
      </div>
      <div style={{ height: 8, borderRadius: 999, background: BORDER.light, overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: 999 }} />
      </div>
    </div>
  )
}

export default function ProjectReportsPage() {
  const { isAuthorized, isLoading } = useRequireApp('projects')

  const [projects, setProjects] = useState<PmProject[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | string[]>('')

  useEffect(() => {
    if (!isAuthorized) return
    setLoading(true)
    projectsApi.list()
      .then((data) => setProjects(Array.isArray(data) ? data : []))
      .catch((err) => setError(extractErrorMessages(err, 'Failed to load project reports.')))
      .finally(() => setLoading(false))
  }, [isAuthorized])

  if (isLoading || !isAuthorized) return null

  const total = projects.length
  const byStatus = countBy(projects, 'status')
  const byPriority = countBy(projects, 'priority')
  const statusColors: Record<string, string> = { planning: '#2563eb', active: '#16a34a', on_hold: '#f59e0b', completed: '#0d9488', cancelled: '#dc2626' }
  const priorityColors: Record<string, string> = { low: '#64748b', medium: '#2563eb', high: '#f59e0b', critical: '#dc2626' }

  return (
    <div>
      <ProjectsNav />

      <div style={{ marginBottom: 20 }}>
        <p style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 4px' }}>
          Project Management
        </p>
        <h1 style={{ fontSize: 24, fontWeight: 700, color: TEXT.heading, margin: '0 0 4px' }}>Project Reports</h1>
        <p style={{ fontSize: 13.5, color: TEXT.muted, margin: 0 }}>Portfolio-level status and priority breakdown across all projects.</p>
      </div>

      {error && (
        <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
          {Array.isArray(error) ? error.join(' ') : error}
        </div>
      )}

      {loading ? (
        <p style={{ fontSize: 13, color: TEXT.muted }}>Loading…</p>
      ) : total === 0 ? (
        <p style={{ fontSize: 13, color: TEXT.muted }}>No projects yet — reports will populate once projects are created.</p>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 20 }}>
          <div style={sectionStyle}>
            <h2 style={{ fontSize: 15, fontWeight: 700, color: TEXT.heading, margin: '0 0 16px' }}>By Status ({total} total)</h2>
            {Object.entries(byStatus).map(([status, count]) => (
              <BreakdownBar key={status} label={STATUS_LABELS[status] || status} count={count} total={total} color={statusColors[status] || '#64748b'} />
            ))}
          </div>
          <div style={sectionStyle}>
            <h2 style={{ fontSize: 15, fontWeight: 700, color: TEXT.heading, margin: '0 0 16px' }}>By Priority ({total} total)</h2>
            {Object.entries(byPriority).map(([priority, count]) => (
              <BreakdownBar key={priority} label={PRIORITY_LABELS[priority] || priority} count={count} total={total} color={priorityColors[priority] || '#64748b'} />
            ))}
          </div>
        </div>
      )}

      <p style={{ fontSize: 12.5, color: TEXT.muted, margin: '20px 0 0' }}>
        Richer cross-project reporting (budget, schedule variance, resource load) lands as more tabs ship.
      </p>
    </div>
  )
}
