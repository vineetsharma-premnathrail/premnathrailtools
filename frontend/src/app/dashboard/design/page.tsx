'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { designApi } from '@/lib/api'
import { DesignDashboard, DesignTaskItem } from '@/types'
import { TEXT, GLASS, SHADOWS, GRADIENTS, BORDER } from '@/lib/theme'
import DesignNav from '@/components/design/DesignNav'
import { extractErrorMessages } from '@/lib/validation'
import { formatDate } from '@/lib/format'

const TASK_LABELS: Record<string, string> = {
  review: 'Check', approve: 'Approve', returned: 'Returned to you', draft: 'Draft', ecn_approve: 'ECN approval', ecn_implement: 'ECN to implement',
}
const TASK_HEX: Record<string, string> = {
  review: '#2563EB', approve: '#7C3AED', returned: '#DC2626', draft: '#78716c', ecn_approve: '#F59E0B', ecn_implement: '#0f766e',
}

const cardStyle: React.CSSProperties = {
  borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur,
  border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), padding: 18,
}

function Kpi({ label, value, hex, sub, onClick }: { label: string; value: number | string; hex?: string; sub?: string; onClick?: () => void }) {
  return (
    <div onClick={onClick} style={{ ...cardStyle, cursor: onClick ? 'pointer' : 'default' }}>
      <p style={{ fontSize: 11, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 8px' }}>{label}</p>
      <p style={{ fontSize: 26, fontWeight: 700, color: hex || TEXT.heading, margin: 0 }}>{value}</p>
      {sub && <p style={{ fontSize: 12, color: TEXT.muted, margin: '4px 0 0' }}>{sub}</p>}
    </div>
  )
}

function taskHref(t: DesignTaskItem) {
  return t.ecn_id && t.kind.startsWith('ecn') ? `/dashboard/design/change-notices/${t.ecn_id}` : `/dashboard/design/documents/${t.document_id}`
}

function TaskRows({ rows, empty }: { rows: DesignTaskItem[]; empty: string }) {
  const router = useRouter()
  if (!rows.length) return <p style={{ fontSize: 13, color: TEXT.muted, margin: 0 }}>{empty}</p>
  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      {rows.map((t) => (
        <div key={`${t.kind}-${t.revision_id ?? t.ecn_id}`} onClick={() => router.push(taskHref(t))}
          style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 0', borderTop: `1px solid ${BORDER.light}`, cursor: 'pointer' }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <p style={{ fontSize: 13, fontWeight: 600, color: TEXT.heading, margin: 0 }}>
              {t.kind.startsWith('ecn') ? t.ecn_number : `${t.doc_number} ${t.revision_label}`}
            </p>
            <p style={{ fontSize: 12, color: TEXT.muted, margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {t.title}{t.author_name ? ` · by ${t.author_name}` : ''}
            </p>
          </div>
          <span style={{ fontSize: 11, color: t.days_waiting >= 7 ? '#DC2626' : TEXT.muted, whiteSpace: 'nowrap' }}>
            {t.days_waiting === 0 ? 'today' : `${t.days_waiting}d`}
          </span>
          <span style={{ fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 9999, background: `${TASK_HEX[t.kind]}1a`, color: TASK_HEX[t.kind], whiteSpace: 'nowrap' }}>
            {TASK_LABELS[t.kind] || t.kind}
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

  return (
    <div>
      <DesignNav />

      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, marginBottom: 20, flexWrap: 'wrap' }}>
        <div>
          <p style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 4px' }}>Design Module</p>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: TEXT.heading, margin: 0 }}>Engineering Document Control</h1>
        </div>
        <button
          onClick={() => router.push('/dashboard/design/documents/new')}
          style={{ padding: '12px 22px', borderRadius: 12, border: 'none', cursor: 'pointer', background: GRADIENTS.primary, color: '#fff', fontSize: 14, fontWeight: 600, boxShadow: `0 8px 20px ${SHADOWS.glowOrange}` }}
        >
          + New Document
        </button>
      </div>

      {error && (
        <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
          {Array.isArray(error) ? error.join(' ') : error}
        </div>
      )}

      {data && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 14, marginBottom: 14 }}>
            <Kpi label="Waiting on me" value={data.waiting_on_me} hex={data.waiting_on_me ? '#FF6A2A' : undefined} sub="checks, approvals & returns" onClick={() => router.push('/dashboard/design/tasks')} />
            <Kpi label="Active documents" value={data.active_documents} sub={`${data.released_documents} released`} onClick={() => router.push('/dashboard/design/documents')} />
            <Kpi label="Released this month" value={data.released_this_month} hex={data.released_this_month ? '#16A34A' : undefined} />
            <Kpi label="Open change notices" value={data.open_ecns} onClick={() => router.push('/dashboard/design/change-notices')} />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 14, marginBottom: 20 }}>
            <Kpi label="Drafts" value={data.drafts} onClick={docs('draft')} />
            <Kpi label="In review" value={data.in_review} hex={data.in_review ? '#2563EB' : undefined} onClick={docs('in_review')} />
            <Kpi label="In approval" value={data.in_approval} hex={data.in_approval ? '#7C3AED' : undefined} onClick={docs('in_approval')} />
            <Kpi label={`Stuck > ${data.overdue_days} days`} value={data.overdue_in_workflow} hex={data.overdue_in_workflow ? '#DC2626' : undefined} sub="in review or approval" />
          </div>

          <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'flex-start' }}>
            <div style={{ ...cardStyle, flex: '1 1 380px' }}>
              <p style={{ fontSize: 12, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.secondary, margin: '0 0 10px' }}>Waiting on me</p>
              <TaskRows rows={data.my_tasks} empty="Nothing needs your check or approval right now." />
            </div>
            <div style={{ ...cardStyle, flex: '1 1 380px' }}>
              <p style={{ fontSize: 12, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.secondary, margin: '0 0 10px' }}>Recently released</p>
              {data.recent_releases.length === 0 ? (
                <p style={{ fontSize: 13, color: TEXT.muted, margin: 0 }}>No revisions released yet. Create a document, upload its drawing and submit it for check.</p>
              ) : data.recent_releases.map((r) => (
                <div key={r.revision_id} onClick={() => router.push(`/dashboard/design/documents/${r.document_id}`)}
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
            {data.overdue.length > 0 && (
              <div style={{ ...cardStyle, flex: '1 1 380px' }}>
                <p style={{ fontSize: 12, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: '#DC2626', margin: '0 0 10px' }}>
                  Stuck in workflow (over {data.overdue_days} days)
                </p>
                <TaskRows rows={data.overdue} empty="" />
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
