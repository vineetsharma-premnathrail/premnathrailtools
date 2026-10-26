'use client'

import { primaryBtnStyle, chipBtnStyle, RowCount, pillStyle } from '@/components/shared/ui'
import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { designApi } from '@/lib/api'
import { DesignCustomerSubmission, DesignLookupOption, DesignMyTasks, DesignTaskItem } from '@/types'
import { TEXT, GLASS, SHADOWS, BORDER } from '@/lib/theme'
import DesignNav from '@/components/design/DesignNav'
import { useDesignMe } from '@/components/design/useDesignMe'
import { SUBMISSION_STATUS_LABELS } from '@/components/design/designMeta'
import { extractErrorMessages } from '@/lib/validation'
import { formatDate } from '@/lib/format'
import { recordPath } from '@/lib/recordRef'
import { useDesignFeature } from '@/components/design/useDesignFeature'

const STATUS_HEX: Record<string, string> = { draft: '#78716c', sent: '#2563EB', closed: '#16A34A', cancelled: '#a8a29e' }

const STATUS_TABS = [
  { key: 'draft,sent', label: 'Open' },
  { key: 'sent', label: 'With customer' },
  { key: 'draft', label: 'Draft' },
  { key: 'closed', label: 'Closed' },
  { key: 'cancelled', label: 'Cancelled' },
  { key: '', label: 'All' },
]

// The internal review queues shown here, in workflow order.
const QUEUES: { key: keyof DesignMyTasks; label: string; hex: string }[] = [
  { key: 'to_review', label: 'Check drawing', hex: '#2563EB' },
  { key: 'to_approve', label: 'Approve drawing', hex: '#7C3AED' },
  { key: 'boms_to_review', label: 'Check BOM', hex: '#2563EB' },
  { key: 'boms_to_approve', label: 'Approve BOM', hex: '#7C3AED' },
  { key: 'to_release', label: 'Release (customer approved)', hex: '#16A34A' },
]

const inputStyle: React.CSSProperties = {
  padding: '9px 12px', borderRadius: 10, border: `1px solid ${BORDER.normal}`,
  background: 'rgba(255,255,255,.7)', fontSize: 13, outline: 'none', color: TEXT.body,
}
const sectionStyle: React.CSSProperties = {
  borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur,
  border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), padding: 20, marginBottom: 16,
}
const sectionTitle: React.CSSProperties = { fontSize: 12, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.secondary, margin: '0 0 14px' }
const thStyle: React.CSSProperties = { textAlign: 'left', padding: '8px 10px', fontSize: 11, fontWeight: 600, letterSpacing: '.03em', textTransform: 'uppercase', color: TEXT.muted, background: '#fdf1e6' }
const tdStyle: React.CSSProperties = { padding: '9px 10px', fontSize: 12.5, color: TEXT.body, borderTop: `1px solid ${BORDER.light}`, verticalAlign: 'top' }
const cellStyle: React.CSSProperties = { padding: '10px 14px', fontSize: 13, color: TEXT.body, borderTop: `1px solid ${BORDER.light}`, whiteSpace: 'nowrap' }

function pill(label: string, hex: string) {
  return <span style={pillStyle(hex)}>{label}</span>
}

function taskHref(t: DesignTaskItem): string | null {
  if (t.document_id) return recordPath('/dashboard/design/documents', t, 'document_id')
  if (t.link) return t.link
  if (t.bom_id) return recordPath('/dashboard/design/boms', t, 'bom_id')
  return null
}

export default function DesignReviewsPage() {
  const { isAuthorized, isLoading } = useRequireApp('design')
  const router = useRouter()
  const me = useDesignMe(isAuthorized)

  const [tasks, setTasks] = useState<DesignMyTasks | null>(null)
  const [awaiting, setAwaiting] = useState<DesignLookupOption[]>([])
  const [rows, setRows] = useState<DesignCustomerSubmission[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | string[]>('')
  const [statusTab, setStatusTab] = useState(STATUS_TABS[0].key)
  const [overdue, setOverdue] = useState(false)
  const [search, setSearch] = useState('')

  // Customer submissions are Design-team only — viewers see just their own review queue.
  const isTeam = !!me && me.is_team
  // Role-level feature: Reviews & Approvals › Customer submissions (skip the call when not granted).
  const designFeature = useDesignFeature()
  const showSubs = isTeam && designFeature('reviews', 'customer_submissions', 'view')

  useEffect(() => {
    if (!isAuthorized) return
    designApi.getMyTasks()
      .then(setTasks)
      .catch((err) => setError(extractErrorMessages(err, 'Failed to load your review queue.')))
  }, [isAuthorized])

  useEffect(() => {
    if (!isAuthorized || !isTeam) return
    designApi.lookupAwaitingCustomer()
      .then(setAwaiting)
      .catch((err) => setError(extractErrorMessages(err, 'Failed to load drawings waiting on the customer.')))
  }, [isAuthorized, isTeam])

  useEffect(() => {
    if (!isAuthorized || !showSubs) return
    const params: Record<string, unknown> = {}
    if (statusTab) params.status = statusTab
    if (overdue) params.overdue = true
    if (search.trim()) params.search = search.trim()
    const handle = setTimeout(() => {
      setLoading(true)
      designApi.listSubmissions(params)
        .then((data) => { setRows(Array.isArray(data) ? data : []); setError('') })
        .catch((err) => setError(extractErrorMessages(err, 'Failed to load customer submissions.')))
        .finally(() => setLoading(false))
    }, search ? 250 : 0)
    return () => clearTimeout(handle)
  }, [isAuthorized, showSubs, statusTab, overdue, search])

  const queueRows = useMemo(() => {
    if (!tasks) return []
    return QUEUES.flatMap((q) => (tasks[q.key] || []).map((t) => ({ q, t })))
  }, [tasks])

  // Creating a submission is Design-team only (the backend's require_team).
  const canCreate = isTeam && designFeature('reviews', 'customer_submissions', 'create')

  if (isLoading || !isAuthorized) return null

  return (
    <div>
      <DesignNav />

      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, marginBottom: 20, flexWrap: 'wrap' }}>
        <div>
          <p style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 4px' }}>Design</p>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: TEXT.heading, margin: 0 }}>Reviews &amp; Approvals</h1>
          <p style={{ fontSize: 13, color: TEXT.muted, margin: '4px 0 0' }}>Internal checks waiting on you, drawings waiting on the customer, and the customer submission register.</p>
        </div>
        {canCreate && (
          <button
            data-tour="design-reviews-new-sub-btn"
            onClick={() => router.push('/dashboard/design/reviews/submissions/new')}
            style={primaryBtnStyle}
          >
            + New submission
          </button>
        )}
      </div>

      {error && (
        <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
          {Array.isArray(error) ? error.join(' ') : error}
        </div>
      )}

      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'flex-start' }}>
        {/* Internal reviews waiting on me */}
        <div style={{ flex: '2 1 560px', minWidth: 0, display: 'flex', flexDirection: 'column' }}>
          <div data-tour="design-reviews-internal" style={sectionStyle}>
            <p style={sectionTitle}>Internal reviews — waiting on you</p>
            {!tasks ? (
              <p style={{ fontSize: 13, color: TEXT.muted, margin: 0 }}>Loading…</p>
            ) : queueRows.length === 0 ? (
              <p style={{ fontSize: 13, color: TEXT.muted, margin: 0 }}>Nothing to check, approve or release right now.</p>
            ) : (
              <div style={{ overflowX: 'auto', maxHeight: 360, overflowY: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 640 }}>
                  <thead>
                    <tr>{['Step', 'Drawing / BOM', 'Rev', 'From', 'Waiting'].map((h, hi) => <th key={h} style={{ ...thStyle, position: 'sticky', top: 0, zIndex: 1 }}>{h}{hi === 0 && <RowCount count={queueRows.length} />}</th>)}</tr>
                  </thead>
                  <tbody>
                    {queueRows.map(({ q, t }, idx) => {
                      const href = taskHref(t)
                      return (
                        <tr key={`${q.key}-${t.revision_id ?? idx}-${t.document_id ?? t.bom_id ?? idx}`} onClick={() => href && router.push(href)} style={{ cursor: href ? 'pointer' : 'default' }}>
                          <td style={tdStyle}>{pill(q.label, q.hex)}</td>
                          <td style={tdStyle}>
                            <strong>{t.doc_number || t.bom_number || '—'}</strong>
                            <div style={{ color: TEXT.muted }}>{t.title}</div>
                          </td>
                          <td style={{ ...tdStyle, fontWeight: 700 }}>{t.revision_label || '—'}</td>
                          <td style={tdStyle}>{t.author_name || '—'}</td>
                          <td style={{ ...tdStyle, color: t.days_waiting > 3 ? '#DC2626' : TEXT.body, whiteSpace: 'nowrap' }}>
                            {t.days_waiting} day{t.days_waiting === 1 ? '' : 's'}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        {/* Approved internally, waiting on the customer */}
        {isTeam && (
        <div style={{ flex: '1 1 320px', minWidth: 0, display: 'flex', flexDirection: 'column' }}>
          <div data-tour="design-reviews-awaiting" style={sectionStyle}>
            <p style={sectionTitle}>Approved — waiting on the customer</p>
            {awaiting.length === 0 ? (
              <p style={{ fontSize: 13, color: TEXT.muted, margin: 0 }}>No approved drawings are waiting to be sent to a customer.</p>
            ) : (
              <>
                <p style={{ fontSize: 12.5, color: TEXT.muted, margin: '0 0 10px' }}>
                  These revisions passed internal approval but need the customer&apos;s approval before release. Send them on a submission.
                </p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 300, overflowY: 'auto' }}>
                  {awaiting.map((a) => (
                    <div key={a.id} onClick={() => a.extra && designApi.getDocument(Number(a.extra)).then((d) => router.push(recordPath('/dashboard/design/documents', d))).catch((err) => setError(extractErrorMessages(err, 'Could not open this drawing — it may have been deleted, or your account lacks access.')))} style={{ padding: '8px 12px', borderRadius: 10, border: `1px solid ${BORDER.light}`, background: 'rgba(255,255,255,.55)', cursor: a.extra ? 'pointer' : 'default' }}>
                      <p style={{ fontSize: 13, fontWeight: 600, color: TEXT.heading, margin: 0 }}>{a.code || a.label}</p>
                      <p style={{ fontSize: 12, color: TEXT.muted, margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.label}</p>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
        )}
      </div>

      {/* Customer submission register */}
      {showSubs && (<>
      <p style={{ ...sectionTitle, margin: '8px 0 10px' }}>Customer submissions</p>
      <div data-tour="design-subs-status-tabs" style={{ display: 'flex', gap: 6, marginBottom: 12, flexWrap: 'wrap', alignItems: 'center' }}>
        {STATUS_TABS.map((t) => {
          const active = statusTab === t.key
          return (
            <button key={t.label} type="button" onClick={() => setStatusTab(t.key)} style={chipBtnStyle(active)}>
              {t.label}
            </button>
          )
        })}
        <button type="button" data-tour="design-subs-overdue" onClick={() => setOverdue((v) => !v)} style={{ ...chipBtnStyle(overdue), marginLeft: 6, ...(overdue ? { background: '#DC2626' } : {}) }}>
          {overdue ? '✓ ' : ''}Overdue only
        </button>
      </div>
      <div style={{ marginBottom: 14 }}>
        <input data-tour="design-subs-search" style={{ ...inputStyle, width: '100%', maxWidth: 420 }} placeholder="Search by submission number or customer…" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>

      <div data-tour="design-subs-table" style={{
        borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur,
        border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), overflow: 'auto', maxHeight: 'calc(100vh - 320px)',
      }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 1180 }}>
          <thead>
            <tr>
              {['Submission', 'Customer', 'Project', 'Drawings', 'Sent', 'Due', 'Waiting', 'Response', 'Turnaround', 'Open comments', 'Status'].map((h, hi) => (
                <th key={h} style={{ textAlign: 'left', padding: '10px 14px', fontSize: 11, fontWeight: 600, letterSpacing: '.03em', textTransform: 'uppercase', color: TEXT.muted, position: 'sticky', top: 0, background: '#fdf1e6', zIndex: 1 }}>
                  {h}{hi === 0 && <RowCount count={rows.length} />}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={11} style={{ padding: 20, textAlign: 'center', fontSize: 13, color: TEXT.muted }}>Loading…</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={11} style={{ padding: 20, textAlign: 'center', fontSize: 13, color: TEXT.muted }}>No customer submissions here — use + New submission to send approved drawings to a customer.</td></tr>
            ) : (
              rows.map((s) => (
                <tr key={s.id} onClick={() => router.push(recordPath('/dashboard/design/reviews/submissions', s))} style={{ cursor: 'pointer' }}>
                  <td style={{ ...cellStyle, fontWeight: 600, color: TEXT.heading }}>{s.submission_number}</td>
                  <td style={{ ...cellStyle, maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.customer_name}</td>
                  <td style={{ ...cellStyle, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.pm_project_label || s.erp_project_label || '—'}</td>
                  <td style={cellStyle}>{s.lines.length}</td>
                  <td style={cellStyle}>{formatDate(s.sent_date)}</td>
                  <td style={{ ...cellStyle, color: s.is_overdue ? '#DC2626' : TEXT.body, fontWeight: s.is_overdue ? 700 : 400 }}>
                    {formatDate(s.response_due_date)}{s.is_overdue ? ' · overdue' : ''}
                  </td>
                  <td style={cellStyle}>{s.status === 'sent' ? `${s.days_waiting} d` : '—'}</td>
                  <td style={cellStyle}>{formatDate(s.response_date)}</td>
                  <td style={cellStyle}>{s.turnaround_days != null ? `${s.turnaround_days} d` : '—'}</td>
                  <td style={{ ...cellStyle, color: s.open_comments > 0 ? '#b45309' : TEXT.body, fontWeight: s.open_comments > 0 ? 700 : 400 }}>{s.open_comments || '—'}</td>
                  <td style={cellStyle}>{pill(SUBMISSION_STATUS_LABELS[s.status] || s.status, STATUS_HEX[s.status] || '#78716c')}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      </>)}
    </div>
  )
}
