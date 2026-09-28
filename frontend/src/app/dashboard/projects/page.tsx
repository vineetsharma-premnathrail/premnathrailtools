'use client'

import { useEffect, useState } from 'react'
import { useRequireApp } from '@/hooks/useAuth'
import { projectsApi } from '@/lib/api'
import { PmProject } from '@/types'
import { TEXT, GLASS, SHADOWS, DANGER, WARNING, SUCCESS } from '@/lib/theme'
import ProjectsNav from '@/components/projects/ProjectsNav'
import { extractErrorMessages } from '@/lib/validation'

type KpiTone = 'bad' | 'warn' | 'good' | 'neutral'

function cardTone(tone: KpiTone) {
  if (tone === 'bad') return { background: `${DANGER.primary}14`, border: `1px solid ${DANGER.primary}33`, valueColor: DANGER.primary }
  if (tone === 'warn') return { background: `${WARNING.primary}14`, border: `1px solid ${WARNING.primary}33`, valueColor: WARNING.hover }
  if (tone === 'good') return { background: `${SUCCESS.primary}14`, border: `1px solid ${SUCCESS.primary}33`, valueColor: SUCCESS.hover }
  return { background: GLASS.card, border: `1px solid ${GLASS.border}`, valueColor: TEXT.heading }
}

export default function ProjectsDashboardPage() {
  const { isAuthorized, isLoading, user } = useRequireApp('projects')

  const [projects, setProjects] = useState<PmProject[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | string[]>('')

  useEffect(() => {
    if (!isAuthorized) return
    setLoading(true)
    projectsApi.list()
      .then((data) => setProjects(Array.isArray(data) ? data : []))
      .catch((err) => setError(extractErrorMessages(err, 'Failed to load projects.')))
      .finally(() => setLoading(false))
  }, [isAuthorized])

  if (isLoading || !isAuthorized) return null

  const total = projects.length
  const activeCount = projects.filter((p) => p.status === 'active').length
  const onHoldCount = projects.filter((p) => p.status === 'on_hold').length
  const completedCount = projects.filter((p) => p.status === 'completed').length

  const cards: { label: string; value: number; tone: KpiTone }[] = [
    { label: 'Total Projects', value: total, tone: 'neutral' },
    { label: 'Active Projects', value: activeCount, tone: 'good' },
    { label: 'On Hold', value: onHoldCount, tone: 'warn' },
    { label: 'Completed', value: completedCount, tone: 'neutral' },
  ]

  return (
    <div>
      <ProjectsNav />

      <div style={{ marginBottom: 20 }}>
        <p style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 4px' }}>
          Project Management
        </p>
        <h1 style={{ fontSize: 24, fontWeight: 700, color: TEXT.heading, margin: '0 0 4px' }}>Dashboard</h1>
        <p style={{ fontSize: 13.5, color: TEXT.muted, margin: 0 }}>{user?.department ? `${user.department} — ` : ''}Project workspaces, scope, and delivery tracking.</p>
      </div>

      {error && (
        <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
          {Array.isArray(error) ? error.join(' ') : error}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 14, marginBottom: 20 }}>
        {cards.map((c) => {
          const tone = cardTone(c.tone)
          return (
            <div
              key={c.label}
              style={{
                borderRadius: 18, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur,
                boxShadow: SHADOWS.glass(), padding: 18, background: tone.background, border: tone.border,
              }}
            >
              <p style={{ fontSize: 11, fontWeight: 600, letterSpacing: '.04em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 8px' }}>
                {c.label}
              </p>
              <p style={{ fontSize: 28, fontWeight: 700, color: tone.valueColor, margin: 0 }}>
                {loading ? '…' : c.value}
              </p>
            </div>
          )
        })}
      </div>

      <p style={{ fontSize: 12.5, color: TEXT.muted, margin: 0 }}>
        Richer KPIs (tasks due, budget burn, open risks) will appear here as those tabs ship in later phases.
      </p>
    </div>
  )
}
