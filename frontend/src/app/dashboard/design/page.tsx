'use client'

import { primaryBtnStyle, RowCount, pillStyle } from '@/components/shared/ui'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { designApi } from '@/lib/api'
import { DesignDashboard, DesignTaskItem } from '@/types'
import { TEXT, GLASS, SHADOWS, BORDER } from '@/lib/theme'
import DesignNav from '@/components/design/DesignNav'
import { TEAM_ROLE_LABELS } from '@/components/design/designMeta'
import { extractErrorMessages } from '@/lib/validation'
import { formatDate } from '@/lib/format'
import { recordPath } from '@/lib/recordRef'

const TASK_LABELS: Record<string, string> = {
  review: 'Check', approve: 'Approve', returned: 'Returned to you', draft: 'Draft', ecn_approve: 'ECN approval', ecn_implement: 'ECN to implement',
  bom_review: 'BOM check', bom_approve: 'BOM approval', bom_returned: 'BOM returned', ecr_vote: 'ECR vote', ecr_impact: 'ECR impact check',
  ecr_decide: 'ECR decision', ecn_acknowledge: 'ECN acknowledge', release: 'Release (customer approved)', customer_comment: 'Customer comment',
}
const TASK_HEX: Record<string, string> = {
  review: '#2563EB', approve: '#7C3AED', returned: '#DC2626', draft: '#78716c', ecn_approve: '#F59E0B', ecn_implement: '#0f766e',
  bom_review: '#2563EB', bom_approve: '#7C3AED', bom_returned: '#DC2626', ecr_vote: '#F59E0B', ecr_impact: '#b45309', ecr_decide: '#F59E0B',
  ecn_acknowledge: '#0f766e', release: '#16A34A', customer_comment: '#0891B2',
}

const cardStyle: React.CSSProperties = {
  borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur,
  border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), padding: 18,
}
const cardTitle: React.CSSProperties = { fontSize: 12, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.secondary, margin: '0 0 10px' }
const groupTitle: React.CSSProperties = { fontSize: 11, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 8px' }
const thStyle: React.CSSProperties = { textAlign: 'left', padding: '8px 10px', fontSize: 11, fontWeight: 600, letterSpacing: '.03em', textTransform: 'uppercase', color: TEXT.muted, background: '#fdf1e6' }
const tdStyle: React.CSSProperties = { padding: '9px 10px', fontSize: 12.5, color: TEXT.body, borderTop: `1px solid ${BORDER.light}` }

function Kpi({ label, value, hex, sub, onClick }: { label: string; value: number | string; hex?: string; sub?: string; onClick?: () => void }) {
  return (
    <div onClick={onClick} style={{ ...cardStyle, cursor: onClick ? 'pointer' : 'default' }}>
      <p style={{ fontSize: 11, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 8px' }}>{label}</p>
      <p style={{ fontSize: 26, fontWeight: 700, color: hex || TEXT.heading, margin: 0 }}>{value}</p>
      {sub && <p style={{ fontSize: 12, color: sub.includes('overdue') && !sub.startsWith('0') ? '#DC2626' : TEXT.muted, margin: '4px 0 0' }}>{sub}</p>}
    </div>
  )
}

// Non-drawing tasks (BOMs, ECRs, acknowledgements, customer comments) carry
// their own link; drawing and ECN tasks fall back to the original rule.
function taskHref(t: DesignTaskItem) {
  if (t.link) return t.link
  return t.ecn_id && t.kind.startsWith('ecn') ? recordPath('/dashboard/design/change-notices', t, 'ecn_id') : recordPath('/dashboard/design/documents', t, 'document_id')
}

function taskRef(t: DesignTaskItem) {
  if (t.kind.startsWith('bom')) return `${t.bom_number || 'BOM'} ${t.revision_label || ''}`.trim()
  if (t.kind.startsWith('ecr')) return t.ecr_number || 'ECR'
  if (t.kind.startsWith('ecn')) return t.ecn_number || 'ECN'
  if (t.kind === 'customer_comment') return t.comment || 'Customer comment'
  return `${t.doc_number} ${t.revision_label}`
}

function TaskRows({ rows, empty }: { rows: DesignTaskItem[]; empty: string }) {
  const router = useRouter()
  if (!rows.length) return <p style={{ fontSize: 13, color: TEXT.muted, margin: 0 }}>{empty}</p>
  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      {rows.map((t, i) => (
        <div key={`${t.kind}-${t.revision_id ?? t.bom_id ?? t.ecr_id ?? t.ecn_id ?? t.submission_id}-${i}`} onClick={() => router.push(taskHref(t))}
          style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 0', borderTop: `1px solid ${BORDER.light}`, cursor: 'pointer' }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <p style={{ fontSize: 13, fontWeight: 600, color: TEXT.heading, margin: 0 }}>{taskRef(t)}</p>
            <p style={{ fontSize: 12, color: TEXT.muted, margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {t.title}{t.author_name ? ` · by ${t.author_name}` : ''}
            </p>
          </div>
          <span style={{ fontSize: 11, color: t.days_waiting >= 7 ? '#DC2626' : TEXT.muted, whiteSpace: 'nowrap' }}>
            {t.days_waiting === 0 ? 'today' : `${t.days_waiting}d`}
          </span>
          <span style={pillStyle(TASK_HEX[t.kind] || '#78716c')}>
            {TASK_LABELS[t.kind] || t.kind.replace(/_/g, ' ')}
          </span>
        </div>
      ))}
    </div>
  )
}

export default function DesignDashboardPage() {
  const { isAuthorized, isLoading } = useRequireApp('design')
  const router = useRouter()
  const [data, setData] = useState<DesignDashboard | null>(null)
  const [error, setError] = useState<string | string[]>('')

  useEffect(() => {
    if (!isAuthorized) return
    designApi.getDashboard()
      .then(setData)
      .catch((err) => setError(extractErrorMessages(err, 'Failed to load the Design dashboard.')))
  }, [isAuthorized])

  if (isLoading || !isAuthorized) return null

  const docs = (status: string) => () => router.push(`/dashboard/design/documents?status=${status}`)
  const go = (href: string) => () => router.push(href)

  return (
    <div>
      <DesignNav />

      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, marginBottom: 20, flexWrap: 'wrap' }}>
        <div>
          <p style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 4px' }}>Design Module</p>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: TEXT.heading, margin: 0 }}>Engineering Document Control</h1>
          {data && <p style={{ fontSize: 13, color: TEXT.muted, margin: '4px 0 0' }}>Your role: {TEAM_ROLE_LABELS[data.my_role] || data.my_role}</p>}
        </div>
        {data && data.my_role !== 'viewer' && (
          <button
            data-tour="design-dash-new-doc-btn"
            onClick={() => router.push('/dashboard/design/documents/new')}
            style={primaryBtnStyle}
          >
            + New Document
          </button>
        )}
      </div>

      {error && (
        <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
          {Array.isArray(error) ? error.join(' ') : error}
        </div>
      )}

      {data && (
        <>
          <p style={groupTitle}>My work</p>
          <div data-tour="design-dash-my-work-kpis" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 14, marginBottom: 20 }}>
            <Kpi label="Waiting on me" value={data.waiting_on_me} hex={data.waiting_on_me ? '#FF6A2A' : undefined} sub="checks, approvals, votes & returns" onClick={go('/dashboard/design/tasks')} />
            <Kpi label="My PM tasks this week" value={data.my_pm_tasks_due} hex={data.my_pm_tasks_overdue ? '#DC2626' : undefined}
              sub={`${data.my_pm_tasks_overdue} overdue`} onClick={go('/dashboard/design/tasks')} />
            <Kpi label="Requests waiting on Design" value={data.requests_waiting} hex={data.requests_overdue ? '#DC2626' : undefined}
              sub={`${data.requests_overdue} overdue`} onClick={go('/dashboard/design/project-work')} />
            <Kpi label="Customer approvals pending" value={data.customer_pending} hex={data.customer_overdue ? '#DC2626' : data.customer_pending ? '#0891B2' : undefined}
              sub={`${data.customer_overdue} overdue${data.customer_pending ? ` · oldest ${data.oldest_customer_days}d` : ''}`} onClick={go('/dashboard/design/reviews')} />
          </div>

          <p style={groupTitle}>Drawings</p>
          <div data-tour="design-dash-drawing-kpis" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 14, marginBottom: 14 }}>
            <Kpi label="Active documents" value={data.active_documents} sub={`${data.released_documents} released`} onClick={() => router.push('/dashboard/design/documents')} />
            <Kpi label="Released this month" value={data.released_this_month} hex={data.released_this_month ? '#16A34A' : undefined} />
            <Kpi label="Drafts" value={data.drafts} onClick={docs('draft')} />
            <Kpi label="In review" value={data.in_review} hex={data.in_review ? '#2563EB' : undefined} onClick={docs('in_review')} />
          </div>
          <div data-tour="design-dash-workflow-kpis" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 14, marginBottom: 20 }}>
            <Kpi label="In approval" value={data.in_approval} hex={data.in_approval ? '#7C3AED' : undefined} onClick={docs('in_approval')} />
            <Kpi label={`Stuck > ${data.overdue_days} days`} value={data.overdue_in_workflow} hex={data.overdue_in_workflow ? '#DC2626' : undefined} sub="in review or approval" />
            <Kpi label="BOMs in workflow" value={data.boms_in_workflow} hex={data.boms_in_workflow ? '#2563EB' : undefined} sub={`${data.released_boms} released BOMs`} onClick={go('/dashboard/design/boms')} />
            <Kpi label="Open change notices" value={data.open_ecns} onClick={go('/dashboard/design/change-notices')} />
          </div>

          <p style={groupTitle}>Changes</p>
          <div data-tour="design-dash-change-kpis" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 14, marginBottom: 20 }}>
            <Kpi label="Open change requests (ECR)" value={data.open_ecrs} hex={data.open_ecrs ? '#F59E0B' : undefined} sub="impact check or board vote" onClick={go('/dashboard/design/change-notices')} />
            <Kpi label="ECNs awaiting acknowledgement" value={data.ecns_awaiting_ack} hex={data.ecns_awaiting_ack ? '#0f766e' : undefined} sub="released, departments to confirm" onClick={go('/dashboard/design/change-notices')} />
          </div>

          <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'flex-start' }}>
            <div data-tour="design-dash-waiting-card" style={{ ...cardStyle, flex: '1 1 380px' }}>
              <p style={cardTitle}>Waiting on me</p>
              <TaskRows rows={data.my_tasks} empty="Nothing needs your action right now." />
            </div>
            <div data-tour="design-dash-released-card" style={{ ...cardStyle, flex: '1 1 380px' }}>
              <p style={cardTitle}>Recently released</p>
              {data.recent_releases.length === 0 ? (
                <p style={{ fontSize: 13, color: TEXT.muted, margin: 0 }}>No revisions released yet. Create a document, upload its drawing and submit it for check.</p>
              ) : data.recent_releases.map((r) => (
                <div key={r.revision_id} onClick={() => router.push(recordPath('/dashboard/design/documents', r, 'document_id'))}
                  style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 0', borderTop: `1px solid ${BORDER.light}`, cursor: 'pointer' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ fontSize: 13, fontWeight: 600, color: TEXT.heading, margin: 0 }}>{r.doc_number} {r.revision_label}</p>
                    <p style={{ fontSize: 12, color: TEXT.muted, margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.title}</p>
                  </div>
                  <span style={{ fontSize: 12, color: TEXT.muted, whiteSpace: 'nowrap' }}>
                    {formatDate(r.released_at)}{r.approved_by_name ? ` · ${r.approved_by_name}` : ''}
                  </span>
                </div>
              ))}
            </div>
            {data.customer_pending_list.length > 0 && (
              <div data-tour="design-dash-customers-card" style={{ ...cardStyle, flex: '1 1 380px' }}>
                <p style={cardTitle}>Waiting on customers</p>
                {data.customer_pending_list.map((c) => (
                  <div key={c.id} onClick={() => router.push(recordPath('/dashboard/design/reviews/submissions', c))}
                    style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 0', borderTop: `1px solid ${BORDER.light}`, cursor: 'pointer' }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p style={{ fontSize: 13, fontWeight: 600, color: TEXT.heading, margin: 0 }}>{c.submission_number}</p>
                      <p style={{ fontSize: 12, color: TEXT.muted, margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.customer_name}</p>
                    </div>
                    <span style={{ fontSize: 11.5, color: c.overdue ? '#DC2626' : TEXT.muted, fontWeight: c.overdue ? 700 : 400, whiteSpace: 'nowrap' }}>
                      {c.days_waiting === 0 ? 'sent today' : `${c.days_waiting} day${c.days_waiting === 1 ? '' : 's'}`}{c.overdue ? ' · overdue' : ''}
                    </span>
                  </div>
                ))}
              </div>
            )}
            {data.overdue.length > 0 && (
              <div data-tour="design-dash-stuck-card" style={{ ...cardStyle, flex: '1 1 380px' }}>
                <p style={{ ...cardTitle, color: '#DC2626' }}>
                  Stuck in workflow (over {data.overdue_days} days)
                </p>
                <TaskRows rows={data.overdue} empty="" />
              </div>
            )}
          </div>

          {data.workload.length > 0 && (
            <div data-tour="design-dash-workload" style={{ ...cardStyle, marginTop: 14 }}>
              <p style={cardTitle}>Team workload</p>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 640 }}>
                  <thead>
                    <tr>{['Person', 'Role', 'Open PM tasks', 'Overdue', 'Draft revisions', 'Drawings to check'].map((h, hi) => <th key={h} style={thStyle}>{h}{hi === 0 && <RowCount count={data.workload.length} />}</th>)}</tr>
                  </thead>
                  <tbody>
                    {data.workload.map((w) => (
                      <tr key={w.user_id}>
                        <td style={{ ...tdStyle, fontWeight: 600, color: TEXT.heading }}>{w.name || `User #${w.user_id}`}</td>
                        <td style={tdStyle}>{TEAM_ROLE_LABELS[w.role] || w.role}</td>
                        <td style={tdStyle}>{w.open_tasks}</td>
                        <td style={{ ...tdStyle, color: w.overdue_tasks ? '#DC2626' : TEXT.body, fontWeight: w.overdue_tasks ? 700 : 400 }}>{w.overdue_tasks}</td>
                        <td style={tdStyle}>{w.drafts}</td>
                        <td style={tdStyle}>{w.to_check}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
