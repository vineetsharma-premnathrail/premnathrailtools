'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { designApi } from '@/lib/api'
import { DesignChangeNoticeDetail } from '@/types'
import { TEXT, GLASS, SHADOWS, GRADIENTS, BORDER } from '@/lib/theme'
import DesignNav from '@/components/design/DesignNav'
import ChangeNoticeForm from '@/components/design/ChangeNoticeForm'
import ConfirmDialog from '@/components/erp/ConfirmDialog'
import PromptDialog from '@/components/erp/PromptDialog'
import { secondaryBtnStyle, dangerBtnStyle, InfoRow } from '@/components/shared/ui'
import { ECN_PRIORITY_LABELS, ECN_REASON_LABELS } from '@/components/design/designMeta'
import { extractErrorMessages } from '@/lib/validation'
import { formatDate, formatDateTime } from '@/lib/format'

const STATUS_LABELS: Record<string, string> = { draft: 'Draft', submitted: 'Awaiting Approval', approved: 'Approved', rejected: 'Rejected', implemented: 'Implemented', cancelled: 'Cancelled' }
const STATUS_HEX: Record<string, string> = { draft: '#78716c', submitted: '#F59E0B', approved: '#2563EB', rejected: '#DC2626', implemented: '#16A34A', cancelled: '#a8a29e' }
const IMPL_LABELS: Record<string, string> = { pending: 'No revision yet', draft: 'Draft', in_review: 'In Review', in_approval: 'In Approval', released: 'Released' }
const IMPL_HEX: Record<string, string> = { pending: '#DC2626', draft: '#78716c', in_review: '#2563EB', in_approval: '#7C3AED', released: '#16A34A' }
const EVENT_LABELS: Record<string, string> = {
  ecn_created: 'raised the change notice', ecn_updated: 'edited it', ecn_submitted: 'submitted it for approval', ecn_approved: 'approved it',
  ecn_rejected: 'rejected it', ecn_implemented: 'marked it implemented', ecn_cancelled: 'cancelled it', comment: 'commented',
  document_revision_started: 'started a revision under it', document_released: 'released a revision under it',
}

const sectionStyle: React.CSSProperties = {
  borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur,
  border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), padding: 20, marginBottom: 16,
}
const sectionTitle: React.CSSProperties = { fontSize: 12, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.secondary, margin: '0 0 14px' }
const primaryBtn: React.CSSProperties = {
  padding: '10px 18px', borderRadius: 12, border: 'none', cursor: 'pointer', background: GRADIENTS.primary,
  color: '#fff', fontSize: 13, fontWeight: 600, boxShadow: `0 6px 16px ${SHADOWS.glowOrange}`,
}
const inputStyle: React.CSSProperties = {
  width: '100%', padding: '9px 12px', borderRadius: 10, border: `1px solid ${BORDER.normal}`,
  background: 'rgba(255,255,255,.7)', fontSize: 13, outline: 'none', color: TEXT.body, boxSizing: 'border-box',
}
const thStyle: React.CSSProperties = { textAlign: 'left', padding: '8px 10px', fontSize: 11, fontWeight: 600, letterSpacing: '.03em', textTransform: 'uppercase', color: TEXT.muted, background: '#fdf1e6' }
const tdStyle: React.CSSProperties = { padding: '9px 10px', fontSize: 12.5, color: TEXT.body, borderTop: `1px solid ${BORDER.light}`, verticalAlign: 'top' }

function pill(label: string, hex: string) {
  return <span style={{ fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 9999, background: `${hex}1a`, color: hex, whiteSpace: 'nowrap' }}>{label}</span>
}

type Confirm = 'submit' | 'implement' | 'delete' | null
type Prompt = 'approve' | 'reject' | 'cancel' | null

export default function ChangeNoticeDetailPage() {
  const { isAuthorized, isLoading, user } = useRequireApp('design')
  const router = useRouter()
  const params = useParams()
  const id = Number(params.id)

  const [ecn, setEcn] = useState<DesignChangeNoticeDetail | null>(null)
  const [busy, setBusy] = useState(false)
  const [editing, setEditing] = useState(false)
  const [error, setError] = useState<string | string[]>('')
  const [success, setSuccess] = useState('')
  const [confirm, setConfirm] = useState<Confirm>(null)
  const [prompt, setPrompt] = useState<Prompt>(null)
  const [comment, setComment] = useState('')

  useEffect(() => {
    if (!isAuthorized || !id) return
    designApi.getChangeNotice(id)
      .then(setEcn)
      .catch((err) => setError(extractErrorMessages(err, 'Failed to load the change notice.')))
  }, [isAuthorized, id])

  if (isLoading || !isAuthorized) return null

  const can = (a: string) => !!ecn?.allowed_actions.includes(a)

  const act = async (fn: () => Promise<DesignChangeNoticeDetail>, fallback: string, done: string) => {
    setBusy(true)
    setError('')
    setSuccess('')
    try {
      setEcn(await fn())
      setSuccess(done)
      return true
    } catch (err) {
      setError(extractErrorMessages(err, fallback))
      return false
    } finally {
      setBusy(false)
    }
  }

  const runConfirm = async () => {
    const which = confirm
    setConfirm(null)
    if (!ecn || !which) return
    if (which === 'submit') await act(() => designApi.submitChangeNotice(ecn.id), 'Submitting failed.', `${ecn.ecn_number} submitted — ${ecn.approver_name || 'the approver'} has been notified.`)
    if (which === 'implement') await act(() => designApi.implementChangeNotice(ecn.id), 'Marking implemented failed.', `${ecn.ecn_number} implemented — Production and Store have been notified.`)
    if (which === 'delete') {
      setBusy(true)
      try {
        await designApi.deleteChangeNotice(ecn.id)
        router.push('/dashboard/design/change-notices')
      } catch (err) {
        setError(extractErrorMessages(err, 'Deleting failed.'))
        setBusy(false)
      }
    }
  }

  const runPrompt = async (value: string) => {
    const which = prompt
    setPrompt(null)
    if (!ecn || !which) return
    if ((which === 'reject' || which === 'cancel') && !value.trim()) {
      setError(which === 'reject' ? 'Give a reason for rejecting — the person who raised it sees it.' : 'Give a reason for cancelling.')
      return
    }
    if (which === 'approve') await act(() => designApi.approveChangeNotice(ecn.id, value), 'Approval failed.', `${ecn.ecn_number} approved — document owners have been asked to start their revisions.`)
    if (which === 'reject') await act(() => designApi.rejectChangeNotice(ecn.id, value), 'Rejecting failed.', `${ecn.ecn_number} rejected.`)
    if (which === 'cancel') await act(() => designApi.cancelChangeNotice(ecn.id, value), 'Cancelling failed.', `${ecn.ecn_number} cancelled.`)
  }

  const save = async (payload: Record<string, unknown>) => {
    if (!ecn) return
    if (await act(() => designApi.updateChangeNotice(ecn.id, payload), 'Saving failed.', 'Change notice saved.')) setEditing(false)
  }

  const postComment = async () => {
    if (!ecn || !comment.trim()) return
    if (await act(() => designApi.addChangeNoticeComment(ecn.id, comment.trim()), 'Posting the comment failed.', 'Comment added.')) setComment('')
  }

  const pendingDocs = ecn ? ecn.documents.filter((d) => d.implementation_status !== 'released') : []

  return (
    <div>
      <DesignNav />

      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, marginBottom: 16, flexWrap: 'wrap' }}>
        <div style={{ minWidth: 0 }}>
          <p style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 4px' }}>Engineering Change Notice</p>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: TEXT.heading, margin: 0, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            {ecn ? <>{ecn.ecn_number} <span style={{ fontWeight: 500, color: TEXT.secondary }}>— {ecn.title}</span> {pill(STATUS_LABELS[ecn.status] || ecn.status, STATUS_HEX[ecn.status] || '#78716c')}</> : 'Change Notice'}
          </h1>
        </div>
        <button onClick={() => router.push('/dashboard/design/change-notices')} type="button" style={secondaryBtnStyle}>← Back</button>
      </div>

      {error && (
        <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
          {Array.isArray(error) ? error.join(' ') : error}
        </div>
      )}
      {success && (
        <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(22,163,74,0.08)', border: '1px solid rgba(22,163,74,0.2)', color: '#15803d', fontSize: 13 }}>
          {success}
        </div>
      )}

      {ecn && editing ? (
        <ChangeNoticeForm initial={ecn} currentUserId={user?.id} submitLabel="Save Changes" saving={busy} onSubmit={save} onCancel={() => setEditing(false)} onError={setError} />
      ) : ecn && (
        <>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
            {can('edit') && <button disabled={busy} style={secondaryBtnStyle} onClick={() => setEditing(true)}>Edit</button>}
            {can('submit') && <button disabled={busy} style={primaryBtn} onClick={() => setConfirm('submit')}>Submit for Approval</button>}
            {can('approve') && <button disabled={busy} style={primaryBtn} onClick={() => setPrompt('approve')}>Approve</button>}
            {can('reject') && <button disabled={busy} style={dangerBtnStyle} onClick={() => setPrompt('reject')}>Reject</button>}
            {can('implement') && <button disabled={busy} style={primaryBtn} onClick={() => setConfirm('implement')}>Mark Implemented</button>}
            {can('cancel') && <button disabled={busy} style={dangerBtnStyle} onClick={() => setPrompt('cancel')}>Cancel ECN</button>}
            {can('delete') && <button disabled={busy} style={dangerBtnStyle} onClick={() => setConfirm('delete')}>Delete</button>}
          </div>

          {ecn.status === 'approved' && pendingDocs.length > 0 && (
            <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(37,99,235,0.07)', border: '1px solid rgba(37,99,235,0.2)', color: '#1e40af', fontSize: 13 }}>
              Approved. {pendingDocs.length} of {ecn.document_count} document{ecn.document_count === 1 ? '' : 's'} still need a released revision raised under {ecn.ecn_number} before it can be marked implemented — open each document and use “New Revision”, picking this ECN.
            </div>
          )}

          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'flex-start' }}>
            <div style={{ flex: '2 1 560px', minWidth: 0, display: 'flex', flexDirection: 'column' }}>
              <div style={sectionStyle}>
                <p style={sectionTitle}>Affected documents</p>
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 640 }}>
                    <thead>
                      <tr>{['Document', 'What changes', 'Owner', 'Controlled rev', 'Under this ECN'].map((h) => <th key={h} style={thStyle}>{h}</th>)}</tr>
                    </thead>
                    <tbody>
                      {ecn.documents.map((d) => (
                        <tr key={d.id} onClick={() => router.push(`/dashboard/design/documents/${d.document_id}`)} style={{ cursor: 'pointer' }}>
                          <td style={tdStyle}><strong>{d.doc_number}</strong><div style={{ color: TEXT.muted }}>{d.title}</div></td>
                          <td style={{ ...tdStyle, maxWidth: 260 }}>{d.change_description || '—'}</td>
                          <td style={tdStyle}>{d.owner_name || '—'}</td>
                          <td style={tdStyle}>{d.released_revision_label || '—'}</td>
                          <td style={tdStyle}>
                            {ecn.status === 'draft' || ecn.status === 'submitted' ? <span style={{ color: TEXT.muted }}>After approval</span> : (
                              <>{d.ecn_revision_label && <strong style={{ marginRight: 6 }}>{d.ecn_revision_label}</strong>}
                                {pill(IMPL_LABELS[d.implementation_status] || d.implementation_status, IMPL_HEX[d.implementation_status] || '#78716c')}</>
                            )}
                          </td>
                        </tr>
                      ))}
                      {ecn.documents.length === 0 && (
                        <tr><td colSpan={5} style={{ ...tdStyle, textAlign: 'center', color: TEXT.muted }}>No affected documents yet — use Edit to add them.</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              <div style={sectionStyle}>
                <p style={sectionTitle}>Change</p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <InfoRow label="Description" value={ecn.description || '—'} />
                  <InfoRow label="Impact" value={ecn.impact_assessment || '—'} />
                </div>
              </div>
            </div>

            <div style={{ flex: '1 1 320px', minWidth: 0, display: 'flex', flexDirection: 'column' }}>
              <div style={sectionStyle}>
                <p style={sectionTitle}>Details</p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <InfoRow label="Reason" value={ECN_REASON_LABELS[ecn.reason] || ecn.reason} />
                  <InfoRow label="Priority" value={ECN_PRIORITY_LABELS[ecn.priority] || ecn.priority} />
                  <InfoRow label="Target date" value={formatDate(ecn.target_date)} />
                  <InfoRow label="Project" value={ecn.pm_project_label || '—'} />
                  <InfoRow label="Machine" value={ecn.erp_project_label || '—'} />
                  <InfoRow label="Raised by" value={`${ecn.created_by_name || '—'} · ${formatDate(ecn.created_at)}`} />
                  <InfoRow label="Approver" value={ecn.approver_name || 'Not named yet'} />
                  {ecn.decided_at && <InfoRow label={ecn.status === 'rejected' ? 'Rejected by' : 'Approved by'} value={`${ecn.decided_by_name || '—'} · ${formatDate(ecn.decided_at)}${ecn.decision_comment ? ` — ${ecn.decision_comment}` : ''}`} />}
                  {ecn.implemented_at && <InfoRow label="Implemented" value={`${ecn.implemented_by_name || '—'} · ${formatDate(ecn.implemented_at)}`} />}
                  {ecn.cancelled_at && <InfoRow label="Cancelled" value={`${formatDate(ecn.cancelled_at)} — ${ecn.cancel_reason || ''}`} />}
                </div>
              </div>

              <div style={sectionStyle}>
                <p style={sectionTitle}>Timeline</p>
                <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
                  <input style={inputStyle} value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Add a comment…" onKeyDown={(e) => { if (e.key === 'Enter') postComment() }} />
                  <button type="button" disabled={busy || !comment.trim()} style={{ ...secondaryBtnStyle, whiteSpace: 'nowrap' }} onClick={postComment}>Post</button>
                </div>
                {ecn.events.map((e) => (
                  <div key={e.id} style={{ padding: '8px 0', borderTop: `1px solid ${BORDER.light}` }}>
                    <p style={{ fontSize: 12.5, color: TEXT.body, margin: 0 }}>
                      <strong>{e.actor_name || 'System'}</strong> {EVENT_LABELS[e.action] || e.action.replace(/_/g, ' ')}
                      {e.doc_number ? <span style={{ color: TEXT.muted }}> · {e.doc_number}{e.revision_label ? ` ${e.revision_label}` : ''}</span> : null}
                    </p>
                    {e.comment && e.action !== 'document_released' && <p style={{ fontSize: 12.5, color: TEXT.secondary, margin: '2px 0 0', whiteSpace: 'pre-wrap' }}>{e.comment}</p>}
                    <p style={{ fontSize: 11, color: TEXT.muted, margin: '2px 0 0' }}>{formatDateTime(e.created_at)}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </>
      )}

      <ConfirmDialog
        open={confirm !== null}
        title={confirm === 'submit' ? 'Submit for approval?' : confirm === 'implement' ? 'Mark implemented?' : 'Delete this draft?'}
        message={
          confirm === 'submit' ? `${ecn?.ecn_number} goes to ${ecn?.approver_name || 'the approver'} for a decision. It can't be edited after this.`
            : confirm === 'implement' ? 'Every affected document has a released revision under this ECN. Production and Store users will be notified to check BOMs and item masters.'
              : 'The draft change notice is deleted.'
        }
        confirmLabel={confirm === 'submit' ? 'Submit' : confirm === 'implement' ? 'Mark Implemented' : 'Delete'}
        danger={confirm === 'delete'}
        onConfirm={runConfirm}
        onCancel={() => setConfirm(null)}
      />
      <PromptDialog
        open={prompt !== null}
        title={prompt === 'approve' ? 'Approve change notice' : prompt === 'reject' ? 'Reject change notice' : 'Cancel change notice'}
        message={prompt === 'approve' ? 'Document owners are notified to raise their next revisions under this ECN.' : prompt === 'reject' ? 'This is final — the person who raised it sees your reason.' : 'The ECN is kept on record as cancelled.'}
        placeholder={prompt === 'approve' ? 'Remarks (optional)' : 'Reason…'}
        confirmLabel={prompt === 'approve' ? 'Approve' : prompt === 'reject' ? 'Reject' : 'Cancel ECN'}
        danger={prompt !== 'approve'}
        onConfirm={runPrompt}
        onCancel={() => setPrompt(null)}
      />
    </div>
  )
}
