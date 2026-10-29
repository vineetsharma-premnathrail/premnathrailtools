'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { useCan } from '@/lib/permissions'
import { projectsApi } from '@/lib/api'
import { TEXT } from '@/lib/theme'
import ProjectsNav from '@/components/projects/ProjectsNav'
import ProjectListView from '@/components/projects/ProjectListView'
import PastProjectsList from '@/components/projects/PastProjectsList'
import { primaryBtnStyle, secondaryBtnStyle } from '@/components/shared/ui'
import FromSalesOrderSheet, { AwaitingSalesOrder } from '@/components/projects/FromSalesOrderSheet'

export default function AllProjectsPage() {
  const { isAuthorized, isLoading } = useRequireApp('projects')
  const router = useRouter()
  const { can } = useCan()
  const canCurrent = can('projects', 'all_projects', 'view')
  const canPast = can('projects', 'service_projects', 'view')
  const [segment, setSegment] = useState<'current' | 'past'>('current')
  const [canCreate, setCanCreate] = useState(false)
  // Confirmed New Project sales orders waiting for the Project Manager to create their project.
  const [awaiting, setAwaiting] = useState<AwaitingSalesOrder[]>([])
  const [fromSoOpen, setFromSoOpen] = useState(false)

  useEffect(() => {
    if (isAuthorized) projectsApi.meta().then((m) => setCanCreate(m.can_create)).catch(() => setCanCreate(false))
  }, [isAuthorized])
  useEffect(() => {
    if (canCreate && canCurrent) projectsApi.salesOrdersAwaitingProject().then(setAwaiting).catch(() => setAwaiting([]))
  }, [canCreate, canCurrent])

  if (isLoading || !isAuthorized) return null

  // Only one permission: show just that part. Both: a Current | Past switch.
  const view: 'current' | 'past' = canCurrent && canPast ? segment : canPast && !canCurrent ? 'past' : 'current'
  const segBtn = (key: 'current' | 'past', text: string) => (
    <button type="button" onClick={() => setSegment(key)} aria-pressed={view === key}
      style={{ ...secondaryBtnStyle, borderRadius: 999, ...(view === key ? { background: '#6366f1', borderColor: '#6366f1', color: '#fff' } : {}) }}>{text}</button>
  )

  return (
    <div>
      <ProjectsNav />
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, marginBottom: 20, flexWrap: 'wrap' }}>
        <div>
          <p style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 4px' }}>Project Management</p>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: TEXT.heading, margin: 0 }}>{view === 'past' ? 'Past Projects' : 'All Projects'}</h1>
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          {canCreate && canCurrent && (
          <button
            data-tour="pm-all-from-so-btn"
            onClick={() => setFromSoOpen(true)}
            type="button"
            aria-label={`From Sales Order — ${awaiting.length} confirmed order${awaiting.length === 1 ? '' : 's'} waiting for a project`}
            style={{ ...secondaryBtnStyle, borderRadius: 999, display: 'inline-flex', alignItems: 'center', gap: 8 }}
          >
            From Sales Order
            {/* ui-audit-ignore-next-line custom-pill — count badge on a button, not a status badge */}
            <span aria-hidden="true" style={{ minWidth: 20, padding: '1px 7px', borderRadius: 999, fontSize: 11.5, fontWeight: 700, lineHeight: '18px', textAlign: 'center', background: awaiting.length ? '#f59e0b' : '#e2e8f0', color: awaiting.length ? '#fff' : '#64748b' }}>{awaiting.length}</span>
          </button>
          )}
          {canCreate && canCurrent && (
          <button
            data-tour="pm-all-new-btn"
            onClick={() => router.push('/dashboard/projects/new')}
            type="button"
            style={{ ...primaryBtnStyle, background: '#6366f1' }}
          >
            + New Project
          </button>
          )}
        </div>
      </div>
      {canCurrent && canPast && (
        <div data-tour="pm-all-segment" style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
          {segBtn('current', 'Current')}
          {segBtn('past', 'Past')}
        </div>
      )}
      {view === 'past' ? <PastProjectsList /> : <ProjectListView />}
      {fromSoOpen && <FromSalesOrderSheet orders={awaiting} onClose={() => setFromSoOpen(false)} />}
    </div>
  )
}
