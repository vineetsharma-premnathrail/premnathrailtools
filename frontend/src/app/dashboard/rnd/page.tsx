'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { rndApi } from '@/lib/api'
import { TEXT, GLASS, SHADOWS, GRADIENTS, BORDER } from '@/lib/theme'
import RndNav from '@/components/rnd/RndNav'
import { extractErrorMessages } from '@/lib/validation'

const STAGES = [
  { key: 'initiation', label: 'Initiation' },
  { key: 'research', label: 'Research' },
  { key: 'development', label: 'Development' },
  { key: 'feasibility', label: 'Feasibility' },
  { key: 'handover', label: 'Handover' },
  { key: 'closed', label: 'Closed' },
] as const
const STAGE_HEX: Record<string, string> = { initiation: '#78716c', research: '#2563EB', development: '#7C3AED', feasibility: '#F59E0B', handover: '#0891B2', closed: '#16A34A' }
const STAGE_LABELS: Record<string, string> = Object.fromEntries(STAGES.map((s) => [s.key, s.label]))
const STATUS_LABELS: Record<string, string> = { active: 'Active', on_hold: 'On Hold', cancelled: 'Cancelled' }
const STATUS_HEX: Record<string, string> = { active: '#16A34A', on_hold: '#F59E0B', cancelled: '#DC2626' }
const EXP_STATUS_LABELS: Record<string, string> = { planned: 'Planned', in_progress: 'In Progress', completed: 'Completed', cancelled: 'Cancelled' }
const EXP_STATUS_HEX: Record<string, string> = { planned: '#78716c', in_progress: '#2563EB', completed: '#16A34A', cancelled: '#DC2626' }
const RESULT_LABELS: Record<string, string> = { pass: 'Pass', fail: 'Fail', inconclusive: 'Inconclusive' }
const RESULT_HEX: Record<string, string> = { pass: '#16A34A', fail: '#DC2626', inconclusive: '#F59E0B' }
const PROTO_LABELS: Record<string, string> = { design: 'Design', building: 'Building', testing: 'Testing', validated: 'Validated', rejected: 'Rejected' }
const PROTO_HEX: Record<string, string> = { design: '#78716c', building: '#2563EB', testing: '#7C3AED', validated: '#16A34A', rejected: '#DC2626' }

const cardStyle: React.CSSProperties = {
  borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur,
  border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), padding: 20,
}

interface RndDashboardData {
  projects: { total: number; active: number; on_hold: number; cancelled: number; by_stage: Record<string, number> }
  experiments: { open: number; completed: number; pass: number; fail: number; inconclusive: number; pass_rate: number | null }
  prototypes: Record<string, number>
  budget: { total_budget: number; total_spend: number }
  recent_projects: { id: number; project_number: string; title: string; stage: string; status: string; priority: string; lead_name?: string | null; target_end_date?: string | null }[]
  recent_experiments: { id: number; experiment_number: string; title: string; status: string; result?: string | null; experiment_date?: string | null }[]
}

const inr = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`

function Pill({ label, hex }: { label: string; hex: string }) {
  return (
    <span style={{ fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 9999, background: `${hex}1a`, color: hex, whiteSpace: 'nowrap' }}>
      {label}
    </span>
  )
}

function StatTile({ label, value, sub, hex }: { label: string; value: string | number; sub?: string; hex: string }) {
  return (
    <div style={{ ...cardStyle, padding: 18 }}>
      <p style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '.04em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 8px' }}>{label}</p>
      <p style={{ fontSize: 26, fontWeight: 700, color: hex, margin: 0, lineHeight: 1.1 }}>{value}</p>
      {sub && <p style={{ fontSize: 12, color: TEXT.muted, margin: '6px 0 0' }}>{sub}</p>}
    </div>
  )
}

export default function RndDashboardPage() {
  const { isAuthorized, isLoading } = useRequireApp('rnd')
  const router = useRouter()
  const [data, setData] = useState<RndDashboardData | null>(null)
  const [error, setError] = useState<string | string[]>('')

  useEffect(() => {
    if (!isAuthorized) return
    rndApi.getDashboard()
      .then(setData)
      .catch((err) => setError(extractErrorMessages(err, 'Failed to load the R&D dashboard.')))
  }, [isAuthorized])

  if (isLoading || !isAuthorized) return null

  const budgetUsedPct = data && data.budget.total_budget > 0 ? Math.round((data.budget.total_spend / data.budget.total_budget) * 100) : null
  const maxStage = data ? Math.max(1, ...Object.values(data.projects.by_stage)) : 1

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
            Projects from initiation to production handover — experiments, prototypes, and feasibility in one place.
          </p>
        </div>
        <button
          onClick={() => router.push('/dashboard/rnd/projects/new')}
          style={{ padding: '12px 22px', borderRadius: 12, border: 'none', cursor: 'pointer', background: GRADIENTS.primary, color: '#fff', fontSize: 14, fontWeight: 600, boxShadow: `0 8px 20px ${SHADOWS.glowOrange}` }}
        >
          + New R&amp;D Project
        </button>
      </div>

      {error && (
        <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
          {Array.isArray(error) ? error.join(' ') : error}
        </div>
      )}

      {data && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 14, marginBottom: 20 }}>
            <StatTile label="Active Projects" value={data.projects.active} sub={`${data.projects.on_hold} on hold · ${data.projects.total} total`} hex="#FF6A2A" />
            <StatTile label="Open Experiments" value={data.experiments.open} sub={`${data.experiments.completed} completed`} hex="#2563EB" />
            <StatTile
              label="Test Pass Rate"
              value={data.experiments.pass_rate === null ? '—' : `${data.experiments.pass_rate}%`}
              sub={`${data.experiments.pass} pass · ${data.experiments.fail} fail · ${data.experiments.inconclusive} inconclusive`}
              hex="#16A34A"
            />
            <StatTile
              label="Budget Used"
              value={budgetUsedPct === null ? '—' : `${budgetUsedPct}%`}
              sub={`${inr(data.budget.total_spend)} of ${inr(data.budget.total_budget)} (prototype BOMs)`}
              hex={budgetUsedPct !== null && budgetUsedPct > 100 ? '#DC2626' : '#7C3AED'}
            />
          </div>

          <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', marginBottom: 20, alignItems: 'flex-start' }}>
            <div style={{ ...cardStyle, flex: '2 1 420px' }}>
              <h2 style={{ fontSize: 15, fontWeight: 700, color: TEXT.heading, margin: '0 0 14px' }}>Projects by Stage</h2>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {STAGES.map((s) => {
                  const count = data.projects.by_stage[s.key] || 0
                  return (
                    <Link key={s.key} href={`/dashboard/rnd/projects?stage=${s.key}`} style={{ display: 'flex', alignItems: 'center', gap: 12, textDecoration: 'none' }}>
                      <span style={{ flex: '0 0 96px', fontSize: 12.5, fontWeight: 600, color: TEXT.secondary }}>{s.label}</span>
                      <span style={{ flex: 1, height: 10, borderRadius: 9999, background: 'rgba(0,0,0,0.05)', overflow: 'hidden' }}>
                        <span style={{ display: 'block', height: '100%', width: `${(count / maxStage) * 100}%`, background: STAGE_HEX[s.key], borderRadius: 9999 }} />
                      </span>
                      <span style={{ flex: '0 0 28px', textAlign: 'right', fontSize: 13, fontWeight: 700, color: TEXT.heading }}>{count}</span>
                    </Link>
                  )
                })}
              </div>
            </div>
            <div style={{ ...cardStyle, flex: '1 1 260px' }}>
              <h2 style={{ fontSize: 15, fontWeight: 700, color: TEXT.heading, margin: '0 0 14px' }}>Prototypes</h2>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {Object.entries(PROTO_LABELS).map(([key, label]) => (
                  <Link key={key} href={`/dashboard/rnd/prototypes?status=${key}`} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', textDecoration: 'none' }}>
                    <Pill label={label} hex={PROTO_HEX[key]} />
                    <span style={{ fontSize: 13, fontWeight: 700, color: TEXT.heading }}>{data.prototypes[key] || 0}</span>
                  </Link>
                ))}
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', alignItems: 'flex-start' }}>
            <div style={{ ...cardStyle, flex: '1 1 420px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <h2 style={{ fontSize: 15, fontWeight: 700, color: TEXT.heading, margin: 0 }}>Recently Updated Projects</h2>
                <Link href="/dashboard/rnd/projects" style={{ fontSize: 12, fontWeight: 600, color: '#FF6A2A', textDecoration: 'none' }}>View all</Link>
              </div>
              {data.recent_projects.length === 0 ? (
                <p style={{ fontSize: 13, color: TEXT.muted, margin: 0 }}>No R&amp;D projects yet — create the first one to get started.</p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {data.recent_projects.map((p) => (
                    <Link
                      key={p.id}
                      href={`/dashboard/rnd/projects/${p.id}`}
                      style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: 10, border: `1px solid ${BORDER.light}`, background: 'rgba(255,255,255,.5)', textDecoration: 'none' }}
                    >
                      <span style={{ flex: '0 0 auto', fontSize: 12.5, fontWeight: 700, color: TEXT.heading }}>{p.project_number}</span>
                      <span style={{ flex: '1 1 auto', minWidth: 0, fontSize: 12.5, color: TEXT.body, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.title}</span>
                      {p.status !== 'active' && <Pill label={STATUS_LABELS[p.status] || p.status} hex={STATUS_HEX[p.status] || '#78716c'} />}
                      <Pill label={STAGE_LABELS[p.stage] || p.stage} hex={STAGE_HEX[p.stage] || '#78716c'} />
                    </Link>
                  ))}
                </div>
              )}
            </div>
            <div style={{ ...cardStyle, flex: '1 1 380px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <h2 style={{ fontSize: 15, fontWeight: 700, color: TEXT.heading, margin: 0 }}>Recent Experiments</h2>
                <Link href="/dashboard/rnd/experiments" style={{ fontSize: 12, fontWeight: 600, color: '#FF6A2A', textDecoration: 'none' }}>View all</Link>
              </div>
              {data.recent_experiments.length === 0 ? (
                <p style={{ fontSize: 13, color: TEXT.muted, margin: 0 }}>No experiments recorded yet.</p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {data.recent_experiments.map((e) => (
                    <Link
                      key={e.id}
                      href={`/dashboard/rnd/experiments/${e.id}`}
                      style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: 10, border: `1px solid ${BORDER.light}`, background: 'rgba(255,255,255,.5)', textDecoration: 'none' }}
                    >
                      <span style={{ flex: '0 0 auto', fontSize: 12.5, fontWeight: 700, color: TEXT.heading }}>{e.experiment_number}</span>
                      <span style={{ flex: '1 1 auto', minWidth: 0, fontSize: 12.5, color: TEXT.body, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.title}</span>
                      {e.result
                        ? <Pill label={RESULT_LABELS[e.result] || e.result} hex={RESULT_HEX[e.result] || '#78716c'} />
                        : <Pill label={EXP_STATUS_LABELS[e.status] || e.status} hex={EXP_STATUS_HEX[e.status] || '#78716c'} />}
                    </Link>
                  ))}
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
