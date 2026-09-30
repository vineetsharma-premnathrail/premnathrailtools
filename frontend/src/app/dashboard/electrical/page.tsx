'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { electricalApi } from '@/lib/api'
import { ElectricalDashboard, ElectricalJob } from '@/types'
import { TEXT, GLASS, SHADOWS, GRADIENTS, BORDER } from '@/lib/theme'
import ElectricalNav from '@/components/electrical/ElectricalNav'
import { extractErrorMessages } from '@/lib/validation'
import { formatDate } from '@/lib/format'

const STATUS_LABELS: Record<string, string> = { draft: 'Draft', in_progress: 'In Progress', on_hold: 'On Hold', handed_over: 'Handed Over', closed: 'Closed', cancelled: 'Cancelled' }
const STATUS_HEX: Record<string, string> = { draft: '#78716c', in_progress: '#F59E0B', on_hold: '#9333EA', handed_over: '#2563EB', closed: '#16A34A', cancelled: '#DC2626' }
const PHASE_HEX: Record<string, string> = { design: '#2563EB', procurement: '#9333EA', build: '#F59E0B', test_qc: '#0d9488', handover: '#16A34A' }

const cardStyle: React.CSSProperties = {
  borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur,
  border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), padding: 18,
}
const sectionTitle: React.CSSProperties = { fontSize: 12, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.secondary, margin: '0 0 12px' }

function Kpi({ label, value, sub, hex, onClick }: { label: string; value: string | number; sub?: string; hex?: string; onClick?: () => void }) {
  return (
    <div onClick={onClick} style={{ ...cardStyle, cursor: onClick ? 'pointer' : 'default' }}>
      <p style={{ fontSize: 11, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 6px' }}>{label}</p>
      <p style={{ fontSize: 26, fontWeight: 700, margin: 0, color: hex || TEXT.heading }}>{value}</p>
      {sub && <p style={{ fontSize: 12, color: TEXT.muted, margin: '4px 0 0' }}>{sub}</p>}
    </div>
  )
}

function JobRows({ rows, empty, onOpen }: { rows: ElectricalJob[]; empty: string; onOpen: (id: number) => void }) {
  if (!rows.length) return <p style={{ fontSize: 13, color: TEXT.muted, margin: 0 }}>{empty}</p>
  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      {rows.map((j) => (
        <div key={j.id} onClick={() => onOpen(j.id)} style={{
          display: 'flex', alignItems: 'center', gap: 10, padding: '9px 0', borderTop: `1px solid ${BORDER.light}`, cursor: 'pointer', flexWrap: 'wrap',
        }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: TEXT.heading, minWidth: 110 }}>{j.job_number}</span>
          <span style={{ fontSize: 13, color: TEXT.body, flex: '1 1 160px', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {j.title}{j.current_stage_label ? <span style={{ color: TEXT.muted }}> · {j.current_stage_label}</span> : null}
          </span>
          <span style={{ fontSize: 12, color: TEXT.muted }}>{j.done_stages}/{j.total_stages}</span>
          <span style={{ fontSize: 12, color: j.is_overdue ? '#DC2626' : TEXT.muted, minWidth: 90 }}>{j.target_handover_date ? formatDate(j.target_handover_date) : '—'}</span>
          <span style={{ fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 9999, background: `${STATUS_HEX[j.status]}1a`, color: STATUS_HEX[j.status], whiteSpace: 'nowrap' }}>
            {STATUS_LABELS[j.status] || j.status}
          </span>
        </div>
      ))}
    </div>
  )
}

export default function ElectricalDashboardPage() {
  const { isAuthorized, isLoading } = useRequireApp('electrical')
  const router = useRouter()
  const [data, setData] = useState<ElectricalDashboard | null>(null)
  const [error, setError] = useState<string | string[]>('')

  useEffect(() => {
    if (!isAuthorized) return
    electricalApi.getDashboard()
      .then(setData)
      .catch((err) => setError(extractErrorMessages(err, 'Failed to load the electrical dashboard.')))
  }, [isAuthorized])

  if (isLoading || !isAuthorized) return null

  const k = data?.kpis
  const open = (id: number) => router.push(`/dashboard/electrical/jobs/${id}`)
  const maxPhase = Math.max(1, ...(data?.by_phase.map((p) => p.jobs) || [0]))

  return (
    <div>
      <ElectricalNav />

      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, marginBottom: 20, flexWrap: 'wrap' }}>
        <div>
          <p style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 4px' }}>
            Electrical Module
          </p>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: TEXT.heading, margin: 0 }}>Electrical Dashboard</h1>
        </div>
        <button
          onClick={() => router.push('/dashboard/electrical/jobs/new')}
          style={{
            padding: '12px 22px', borderRadius: 12, border: 'none', cursor: 'pointer',
            background: GRADIENTS.primary, color: '#fff', fontSize: 14, fontWeight: 600,
            boxShadow: `0 8px 20px ${SHADOWS.glowOrange}`,
          }}
        >
          + New RRV Electrical Job
        </button>
      </div>

      {error && (
        <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
          {Array.isArray(error) ? error.join(' ') : error}
        </div>
      )}

      {k && data && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 14, marginBottom: 14 }}>
            <Kpi label="Active Jobs" value={k.in_progress} sub={`${k.draft} draft · ${k.on_hold} on hold`} hex="#F59E0B" onClick={() => router.push('/dashboard/electrical/jobs')} />
            <Kpi label="Overdue" value={k.overdue} sub="Past target handover" hex={k.overdue ? '#DC2626' : undefined} />
            <Kpi label="Handed Over" value={k.handed_over} sub="Awaiting as-built / close" hex="#2563EB" />
            <Kpi label="Awaiting QC" value={k.awaiting_qc} sub="Inspections pending in Quality" hex={k.awaiting_qc ? '#2563EB' : undefined} />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 14, marginBottom: 20 }}>
            <Kpi label="Drawings to Approve" value={k.drawings_pending_approval} hex={k.drawings_pending_approval ? '#F59E0B' : undefined} onClick={() => router.push('/dashboard/electrical/drawings')} />
            <Kpi label="Components to Buy" value={k.purchase_pending} sub="BOM lines with no PR yet" hex={k.purchase_pending ? '#DC2626' : undefined} onClick={() => router.push('/dashboard/electrical/purchase')} />
            <Kpi label="Failed Tests" value={k.open_failures} sub="Awaiting a passing retest" hex={k.open_failures ? '#DC2626' : undefined} onClick={() => router.push('/dashboard/electrical/testing')} />
            <Kpi label="Open Issues" value={k.open_issues} sub={k.critical_issues ? `${k.critical_issues} critical` : 'Troubleshooting log'} hex={k.critical_issues ? '#DC2626' : undefined} onClick={() => router.push('/dashboard/electrical/troubleshooting')} />
          </div>

          <div style={{ ...cardStyle, marginBottom: 14 }}>
            <p style={sectionTitle}>Open jobs by phase</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {data.by_phase.map((p) => (
                <div key={p.phase} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <span style={{ fontSize: 13, color: TEXT.body, width: 190, flex: 'none' }}>{p.label}</span>
                  <div style={{ flex: 1, height: 10, borderRadius: 5, background: 'rgba(0,0,0,0.06)', overflow: 'hidden' }}>
                    <div style={{ width: `${(p.jobs / maxPhase) * 100}%`, height: '100%', background: PHASE_HEX[p.phase] }} />
                  </div>
                  <span style={{ fontSize: 13, fontWeight: 600, color: TEXT.heading, width: 28, textAlign: 'right' }}>{p.jobs}</span>
                </div>
              ))}
            </div>
          </div>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14 }}>
            <div style={{ ...cardStyle, flex: '1 1 380px' }}>
              <p style={sectionTitle}>Handover due in the next 14 days</p>
              <JobRows rows={data.due_soon} empty="No handovers due in the next two weeks." onOpen={open} />
            </div>
            <div style={{ ...cardStyle, flex: '1 1 380px' }}>
              <p style={sectionTitle}>Recent jobs</p>
              <JobRows rows={data.recent} empty="No electrical jobs yet — create one for each RRV whose electrical system you're building." onOpen={open} />
            </div>
          </div>
        </>
      )}
    </div>
  )
}
