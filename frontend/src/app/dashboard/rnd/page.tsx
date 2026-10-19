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
import { RndRequirement, RndTask } from '@/types'

const STAGE_HEX: Record<string, string> = { initiation: '#78716c', research: '#2563EB', development: '#7C3AED', feasibility: '#F59E0B', handover: '#0891B2', closed: '#16A34A' }
const STAGE_LABELS: Record<string, string> = { initiation: 'Initiation', research: 'Research', development: 'Development', feasibility: 'Feasibility', handover: 'Handover', closed: 'Closed' }
const REQ_STATUS_LABELS: Record<string, string> = { open: 'Awaiting R&D', responded: 'Responded', superseded: 'Superseded' }
const REQ_STATUS_HEX: Record<string, string> = { open: '#F59E0B', responded: '#16A34A', superseded: '#78716c' }

const cardStyle: React.CSSProperties = {
  borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur,
  border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), padding: 20,
}
const rowStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: 10,
  border: `1px solid ${BORDER.light}`, background: 'rgba(255,255,255,.5)', textDecoration: 'none',
}
const ellipsis: React.CSSProperties = { flex: '1 1 auto', minWidth: 0, fontSize: 12.5, color: TEXT.body, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }

interface RndDashboardData {
  projects: { total: number; active: number; ongoing: number; on_hold: number; cancelled: number }
  // Ongoing projects (active, not closed), most recently updated first.
  recent_projects: { id: number; project_number: string; title: string; stage: string; status: string; priority: string; lead_name?: string | null; target_end_date?: string | null }[]
}

function Pill({ label, hex }: { label: string; hex: string }) {
  return (
    <span style={{ fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 9999, background: `${hex}1a`, color: hex, whiteSpace: 'nowrap' }}>
      {label}
    </span>
  )
}

function StatTile({ label, value, sub, hex, href }: { label: string; value: string | number; sub?: string; hex: string; href: string }) {
  return (
    <Link href={href} style={{ ...cardStyle, padding: 18, textDecoration: 'none', display: 'block' }}>
      <p style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '.04em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 8px' }}>{label}</p>
      <p style={{ fontSize: 26, fontWeight: 700, color: hex, margin: 0, lineHeight: 1.1 }}>{value}</p>
      {sub && <p style={{ fontSize: 12, color: TEXT.muted, margin: '6px 0 0' }}>{sub}</p>}
    </Link>
  )
}

function CardHeader({ title, href }: { title: string; href: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
      <h2 style={{ fontSize: 15, fontWeight: 700, color: TEXT.heading, margin: 0 }}>{title}</h2>
      <Link href={href} style={{ fontSize: 12, fontWeight: 600, color: '#FF6A2A', textDecoration: 'none' }}>View all</Link>
    </div>
  )
}

export default function RndDashboardPage() {
  const { isAuthorized, isLoading } = useRequireApp('rnd')
  const [data, setData] = useState<RndDashboardData | null>(null)
  // null = not loaded, or no access to R&D › Requirements (the requirement tile/card are then hidden).
  const [requirements, setRequirements] = useState<RndRequirement[] | null>(null)
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

  const awaiting = (requirements || []).filter((r) => r.rnd_request?.status === 'open').length
  const today = new Date().toISOString().slice(0, 10)
  const overdue = (tasks || []).filter((t) => t.status === 'open' && t.due_date < today).length

  return (
    <div>
      <RndNav />

      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, marginBottom: 20, flexWrap: 'wrap' }}>
        <div>
          <p style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 4px' }}>
            R&amp;D Module
          </p>
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

      <div data-tour="rnd-dash-stats" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 14, marginBottom: 20 }}>
        {requirements && (
          <StatTile label="Requirements" value={requirements.length} sub={`${awaiting} awaiting R&D response`} hex="#2563EB" href="/dashboard/rnd/requirements" />
        )}
        {data && (
          <StatTile label="Ongoing Projects" value={data.projects.ongoing} sub={`${data.projects.on_hold} on hold · ${data.projects.total} total`} hex="#FF6A2A" href="/dashboard/rnd/projects" />
        )}
        <StatTile label="My Open Tasks" value={tasks ? tasks.length : '…'} sub={overdue ? `${overdue} overdue` : 'None overdue'} hex={overdue ? '#DC2626' : '#16A34A'} href="/dashboard/rnd/tasks" />
      </div>

      <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', marginBottom: 20, alignItems: 'flex-start' }}>
        {requirements && (
          <div data-tour="rnd-dash-requirements" style={{ ...cardStyle, flex: '1 1 420px' }}>
            <CardHeader title="Recently Received Requirements" href="/dashboard/rnd/requirements" />
            {requirements.length === 0 ? (
              <p style={{ fontSize: 13, color: TEXT.muted, margin: 0 }}>No requirements yet — they arrive when the business team sends a Technical Offer Request.</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {requirements.slice(0, 6).map((r) => {
                  const st = r.rnd_request?.status
                  return (
                    <Link key={`${r.source}-${r.record_id}`} href={recordPath(`/dashboard/rnd/requirements/${r.source}`, r, 'record_id')} style={rowStyle}>
                      <span style={{ flex: '0 0 auto', fontSize: 12.5, fontWeight: 700, color: TEXT.heading }}>{r.universal_id}</span>
                      <span style={ellipsis}>{[r.org_name, r.product].filter(Boolean).join(' · ') || '—'}</span>
                      {r.last_sent_at && <span style={{ flex: 'none', fontSize: 11.5, color: TEXT.muted, whiteSpace: 'nowrap' }}>{formatDate(r.last_sent_at)}</span>}
                      {st && <Pill label={REQ_STATUS_LABELS[st] || st} hex={REQ_STATUS_HEX[st] || '#78716c'} />}
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
              <p style={{ fontSize: 13, color: TEXT.muted, margin: 0 }}>No ongoing R&amp;D projects.</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {data.recent_projects.map((p) => (
                  <Link key={p.id} href={recordPath('/dashboard/rnd/projects', p)} style={rowStyle}>
                    <span style={{ flex: '0 0 auto', fontSize: 12.5, fontWeight: 700, color: TEXT.heading }}>{p.project_number}</span>
                    <span style={ellipsis}>{p.title}</span>
                    {p.lead_name && <span style={{ flex: 'none', fontSize: 11.5, color: TEXT.muted, whiteSpace: 'nowrap' }}>{p.lead_name}</span>}
                    <Pill label={STAGE_LABELS[p.stage] || p.stage} hex={STAGE_HEX[p.stage] || '#78716c'} />
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
