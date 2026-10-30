'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRequireApp } from '@/hooks/useAuth'
import { rndApi } from '@/lib/api'
import { TEXT, GLASS, SHADOWS, BORDER } from '@/lib/theme'
import RndNav from '@/components/rnd/RndNav'
import { extractErrorMessages } from '@/lib/validation'
import { formatDate } from '@/lib/format'
import { recordPath } from '@/lib/recordRef'
import { RndTask } from '@/types'
import { REVISION_STATUS_HEX, REVISION_STATUS_LABEL, type RndRequirementRow } from '@/types/rndIntake'
import { Pill, StatChip } from '@/components/shared/ui'

const STAGE_HEX: Record<string, string> = { initiation: '#78716c', research: '#2563EB', development: '#7C3AED', feasibility: '#F59E0B', handover: '#0891B2', closed: '#16A34A' }
const STAGE_LABELS: Record<string, string> = { initiation: 'Initiation', research: 'Research', development: 'Development', feasibility: 'Feasibility', handover: 'Handover', closed: 'Closed' }

const cardStyle: React.CSSProperties = {
  borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur,
  border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), padding: 20,
}
const rowStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 12, padding: '8px 12px', minHeight: 44, boxSizing: 'border-box', borderRadius: 10,
  border: `1px solid ${BORDER.light}`, background: 'rgba(255,255,255,.5)', textDecoration: 'none',
}
// Fixed slots on the right of a row so dates / names / badges line up in a
// column down the list, and a row without a badge keeps the same layout.
const slot = (width: number): React.CSSProperties => ({ flex: `0 0 ${width}px`, display: 'flex', justifyContent: 'flex-end', fontSize: 11.5, color: TEXT.muted, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' })
const ellipsis: React.CSSProperties = { flex: '1 1 auto', minWidth: 0, fontSize: 12.5, color: TEXT.body, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }

interface RndDashboardData {
  projects: { total: number; active: number; ongoing: number; on_hold: number; cancelled: number }
  // Ongoing projects (active, not closed), most recently updated first.
  recent_projects: { id: number; project_number: string; title: string; stage: string; status: string; priority: string; lead_name?: string | null; target_end_date?: string | null }[]
}

// Counter chips in the header, same as the Service dashboard; each opens its list.
const chipLink: React.CSSProperties = { textDecoration: 'none', display: 'inline-flex' }

function CardHeader({ title, href }: { title: string; href: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
      <h2 style={{ fontSize: 15, fontWeight: 700, color: TEXT.heading, margin: 0 }}>{title}</h2>
      <Link href={href} style={{ fontSize: 13, fontWeight: 600, color: '#c2410c', textDecoration: 'none', padding: '8px 12px', margin: '-8px -12px', minHeight: 24, display: 'inline-flex', alignItems: 'center' }}>View all</Link>
    </div>
  )
}

export default function RndDashboardPage() {
  const { isAuthorized, isLoading } = useRequireApp('rnd')
  const [data, setData] = useState<RndDashboardData | null>(null)
  // null = not loaded, or no access to R&D › Requirements (the requirement tile/card are then hidden).
  const [requirements, setRequirements] = useState<RndRequirementRow[] | null>(null)
  const [tasks, setTasks] = useState<RndTask[] | null>(null)
  const [error, setError] = useState<string | string[]>('')

  useEffect(() => {
    if (!isAuthorized) return
    rndApi.getDashboard()
      .then(setData)
      .catch((err) => setError(extractErrorMessages(err, 'Failed to load the R&D dashboard. Refresh the page; if it persists, check your connection.')))
    rndApi.listRequirements().then(setRequirements).catch(() => setRequirements(null))
    // My open tasks: requirement tasks + project tasks assigned to me.
    Promise.all([rndApi.myTasks().catch(() => [] as RndTask[]), rndApi.myProjectTasks().catch(() => [] as RndTask[])])
      .then(([reqTasks, projectTasks]) => setTasks([...reqTasks, ...projectTasks]))
  }, [isAuthorized])

  if (isLoading || !isAuthorized) return null

  // Waiting for R&D's accept / return.
  const awaiting = (requirements || []).filter((r) => r.status === 'submitted').length
  // Local date (toISOString is UTC — yesterday before 05:30 IST).
  const now = new Date()
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
  const overdue = (tasks || []).filter((t) => t.status === 'open' && t.due_date < today).length

  return (
    <div>
      <RndNav />

      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: TEXT.heading, margin: 0 }}>Research &amp; Development</h1>
          <p style={{ fontSize: 13, color: TEXT.muted, margin: '4px 0 0' }}>
            Requirements from the business team, ongoing projects and your tasks at a glance.
          </p>
        </div>
      </div>

      {error && (
        <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
          {Array.isArray(error) ? error.join(' ') : error}
        </div>
      )}

      <div data-tour="rnd-dash-stats" style={{ display: 'flex', flexWrap: 'wrap', gap: 8, margin: '10px 0 18px' }}>
        {requirements && (<>
          <Link href="/dashboard/rnd/requirements" style={chipLink}><StatChip label="Requirements" value={requirements.length} color="#3b82f6" /></Link>
          <Link href="/dashboard/rnd/requirements" style={chipLink}><StatChip label="Awaiting review" value={awaiting} color="#ea580c" /></Link>
        </>)}
        {data && (<>
          <Link href="/dashboard/rnd/projects" style={chipLink}><StatChip label="Ongoing projects" value={data.projects.ongoing} color="#10b981" /></Link>
          <Link href="/dashboard/rnd/projects" style={chipLink}><StatChip label="On hold" value={data.projects.on_hold} color="#78716c" /></Link>
        </>)}
        {tasks && (<>
          <Link href="/dashboard/rnd/tasks" style={chipLink}><StatChip label="My open tasks" value={tasks.length} color="#ca8a04" /></Link>
          <Link href="/dashboard/rnd/tasks" style={chipLink}><StatChip label="Overdue" value={overdue} color="#dc2626" /></Link>
        </>)}
      </div>

      <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', marginBottom: 20, alignItems: 'stretch' }}>
        {requirements && (
          <div data-tour="rnd-dash-requirements" style={{ ...cardStyle, flex: '1 1 420px' }}>
            <CardHeader title="Recently Received Requirements" href="/dashboard/rnd/requirements" />
            {requirements.length === 0 ? (
              <p style={{ fontSize: 13, color: TEXT.muted, margin: 0 }}>No requirements yet — they arrive, with an R&amp;D ID, when the business team sends a Technical Offer Request.</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {requirements.slice(0, 6).map((r) => {
                  const st = r.status
                  return (
                    <Link key={`${r.source}-${r.record_id}`} href={recordPath(`/dashboard/rnd/requirements/${r.source}`, r, 'record_id')} style={rowStyle}>
                      <span style={{ flex: '0 0 auto', fontSize: 12, fontWeight: 600, color: TEXT.muted }}>{r.rd_number || r.universal_id}</span>
                      <span style={{ ...ellipsis, fontWeight: 600, color: TEXT.heading }}>{[r.org_name, r.product].filter(Boolean).join(' · ') || '—'}</span>
                      <span style={slot(78)}>{r.last_sent_at ? formatDate(r.last_sent_at) : '—'}</span>
                      <span style={slot(150)}>{st ? <Pill label={REVISION_STATUS_LABEL[st]} hex={REVISION_STATUS_HEX[st]} /> : <Pill label="Not sent to R&D" hex="#78716c" />}</span>
                    </Link>
                  )
                })}
              </div>
            )}
          </div>
        )}

        {data && (
          <div data-tour="rnd-dash-recent" style={{ ...cardStyle, flex: '1 1 420px' }}>
            <CardHeader title="Ongoing Projects" href="/dashboard/rnd/projects" />
            {data.recent_projects.length === 0 ? (
              <p style={{ fontSize: 13, color: TEXT.muted, margin: 0 }}>No ongoing R&amp;D projects — start one from Projects › + New Project.</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {data.recent_projects.map((p) => (
                  <Link key={p.id} href={recordPath('/dashboard/rnd/projects', p)} style={rowStyle}>
                    <span style={{ flex: '0 0 auto', fontSize: 12, fontWeight: 500, color: TEXT.muted }}>{p.project_number}</span>
                    <span style={ellipsis}>{p.title}</span>
                    <span style={slot(130)}>{p.lead_name || '—'}</span>
                    <span style={slot(104)}><Pill label={STAGE_LABELS[p.stage] || p.stage} hex={STAGE_HEX[p.stage] || '#78716c'} /></span>
                  </Link>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
