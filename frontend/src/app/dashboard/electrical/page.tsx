'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { useCan } from '@/lib/permissions'
import { electricalApi } from '@/lib/api'
import { recordPath } from '@/lib/recordRef'
import { ElectricalDashboard, ElectricalJob } from '@/types'
import { TEXT, GLASS, SHADOWS, BORDER } from '@/lib/theme'
import { primaryBtnStyle, Pill } from '@/components/shared/ui'
import { JOB_STATUS_LABELS as STATUS_LABELS, JOB_STATUS_HEX as STATUS_HEX, PHASE_HEX } from '@/components/electrical/shared'
import ElectricalNav from '@/components/electrical/ElectricalNav'
import { extractErrorMessages } from '@/lib/validation'
import { formatDate } from '@/lib/format'


const cardStyle: React.CSSProperties = {
  borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur,
  border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), padding: 18,
}
const sectionTitle: React.CSSProperties = { fontSize: 12, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.secondary, margin: '0 0 12px' }

function Kpi({ label, value, sub, hex, onClick, tour }: { label: string; value: string | number; sub?: string; hex?: string; onClick?: () => void; tour?: string }) {
  return (
    <div data-tour={tour} onClick={onClick} style={{ ...cardStyle, cursor: onClick ? 'pointer' : 'default' }}>
      <p style={{ fontSize: 11, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 6px' }}>{label}</p>
      <p style={{ fontSize: 26, fontWeight: 700, margin: 0, color: hex || TEXT.heading }}>{value}</p>
      {sub && <p style={{ fontSize: 12, color: TEXT.muted, margin: '4px 0 0' }}>{sub}</p>}
    </div>
  )
}

function JobRows({ rows, empty, onOpen }: { rows: ElectricalJob[]; empty: string; onOpen: (job: ElectricalJob) => void }) {
  if (!rows.length) return <p style={{ fontSize: 13, color: TEXT.muted, margin: 0 }}>{empty}</p>
  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      {rows.map((j) => (
        <div key={j.id} onClick={() => onOpen(j)} style={{
          display: 'flex', alignItems: 'center', gap: 10, padding: '9px 0', borderTop: `1px solid ${BORDER.light}`, cursor: 'pointer', flexWrap: 'wrap',
        }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: TEXT.heading, minWidth: 110, whiteSpace: 'nowrap' }}>{j.job_number}</span>
          <span title={[j.title, j.current_stage_label].filter(Boolean).join(' · ')} style={{ fontSize: 13, color: TEXT.body, flex: '1 1 160px', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {j.title}{j.current_stage_label ? <span style={{ color: TEXT.muted }}> · {j.current_stage_label}</span> : null}
          </span>
          <span title="Stages done" style={{ fontSize: 12, color: TEXT.muted, whiteSpace: 'nowrap', minWidth: 72, textAlign: 'right' }}>{j.done_stages}/{j.total_stages} stages</span>
          <span title={j.is_overdue ? 'Target handover — overdue' : 'Target handover'} style={{ fontSize: 12, color: j.is_overdue ? '#DC2626' : TEXT.muted, fontWeight: j.is_overdue ? 600 : 400, minWidth: 80, whiteSpace: 'nowrap' }}>{j.target_handover_date ? formatDate(j.target_handover_date) : '—'}</span>
          <Pill label={STATUS_LABELS[j.status] || j.status} hex={STATUS_HEX[j.status]} />
        </div>
      ))}
    </div>
  )
}

export default function ElectricalDashboardPage() {
  const { isAuthorized, isLoading } = useRequireApp('electrical')
  const router = useRouter()
  const { can } = useCan()
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
  const open = (job: ElectricalJob) => router.push(recordPath('/dashboard/electrical/jobs', job))
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
          <p style={{ fontSize: 13, color: TEXT.muted, margin: '6px 0 0' }}>
            Where every RRV electrical job stands — click a tile or a job to open it.
          </p>
        </div>
        {can('electrical', 'jobs', 'create') && (
          <button
            data-tour="elec-dash-new-job-btn"
            onClick={() => router.push('/dashboard/electrical/jobs/new')}
            style={primaryBtnStyle}
          >
            + New RRV Electrical Job
          </button>
        )}
      </div>

      {error && (
        <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
          {Array.isArray(error) ? error.join(' ') : error}
        </div>
      )}

      {!data && !error && <p style={{ fontSize: 13, color: TEXT.muted }}>Loading the electrical dashboard…</p>}

      {k && data && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 14, marginBottom: 14 }}>
            <Kpi tour="elec-dash-kpi-active" label="Active Jobs" value={k.in_progress} sub={`${k.draft} draft · ${k.on_hold} on hold`} hex="#F59E0B" onClick={() => router.push('/dashboard/electrical/jobs')} />
            <Kpi tour="elec-dash-kpi-overdue" label="Overdue" value={k.overdue} sub="Past target handover" hex={k.overdue ? '#DC2626' : undefined} />
            <Kpi tour="elec-dash-kpi-handed-over" label="Handed Over" value={k.handed_over} sub="Awaiting as-built / close" hex="#2563EB" />
            <Kpi tour="elec-dash-kpi-awaiting-qc" label="Awaiting QC" value={k.awaiting_qc} sub="Inspections pending in Quality" hex={k.awaiting_qc ? '#2563EB' : undefined} />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 14, marginBottom: 20 }}>
            <Kpi tour="elec-dash-kpi-drawings" label="Drawings to Approve" value={k.drawings_pending_approval} sub="Revisions awaiting a decision" hex={k.drawings_pending_approval ? '#F59E0B' : undefined} onClick={() => router.push('/dashboard/electrical/drawings')} />
            <Kpi tour="elec-dash-kpi-to-buy" label="Components to Buy" value={k.purchase_pending} sub="BOM lines with no PR yet" hex={k.purchase_pending ? '#DC2626' : undefined} onClick={() => router.push('/dashboard/electrical/purchase')} />
            <Kpi tour="elec-dash-kpi-failed-tests" label="Failed Tests" value={k.open_failures} sub="Awaiting a passing retest" hex={k.open_failures ? '#DC2626' : undefined} onClick={() => router.push('/dashboard/electrical/testing')} />
            <Kpi tour="elec-dash-kpi-open-issues" label="Open Issues" value={k.open_issues} sub={k.critical_issues ? `${k.critical_issues} critical` : 'Troubleshooting log'} hex={k.critical_issues ? '#DC2626' : undefined} onClick={() => router.push('/dashboard/electrical/troubleshooting')} />
          </div>

          <div data-tour="elec-dash-by-phase" style={{ ...cardStyle, marginBottom: 14 }}>
            <p style={sectionTitle}>Open jobs by phase</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {data.by_phase.map((p) => (
                <div key={p.phase} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <span title={p.label} style={{ fontSize: 13, color: TEXT.body, flex: '0 1 190px', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.label}</span>
                  <div style={{ flex: '1 1 80px', minWidth: 60, height: 10, borderRadius: 5, background: 'rgba(0,0,0,0.06)', overflow: 'hidden' }}>
                    <div style={{ width: `${(p.jobs / maxPhase) * 100}%`, height: '100%', background: PHASE_HEX[p.phase] }} />
                  </div>
                  <span style={{ fontSize: 13, fontWeight: 600, color: TEXT.heading, width: 28, textAlign: 'right' }}>{p.jobs}</span>
                </div>
              ))}
            </div>
          </div>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14 }}>
            <div data-tour="elec-dash-due-soon" style={{ ...cardStyle, flex: '1 1 380px' }}>
              <p style={sectionTitle}>Handover due in the next 14 days</p>
              <JobRows rows={data.due_soon} empty="No handovers due in the next two weeks." onOpen={open} />
            </div>
            <div data-tour="elec-dash-recent" style={{ ...cardStyle, flex: '1 1 380px' }}>
              <p style={sectionTitle}>Recent jobs</p>
              <JobRows rows={data.recent} empty="No electrical jobs yet — create one for each RRV whose electrical system you're building." onOpen={open} />
            </div>
          </div>
        </>
      )}
    </div>
  )
}
