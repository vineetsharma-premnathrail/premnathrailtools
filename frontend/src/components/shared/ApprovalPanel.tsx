'use client'

import { useCallback, useEffect, useState } from 'react'
import { approvalsApi } from '@/lib/api'
import { ApprovalEntityStatus, ApprovalRequestInfo, ApprovalStep } from '@/types'
import { BORDER, TEXT } from '@/lib/theme'
import { Section, dangerBtnStyle, inputStyle, primaryBtnStyle, secondaryBtnStyle, pillStyle } from '@/components/shared/ui'
import ConfirmDialog from '@/components/erp/ConfirmDialog'
import { extractErrorMessages } from '@/lib/validation'

const REQ_LABEL: Record<string, string> = { pending: 'Waiting for approval', approved: 'Approved', rejected: 'Rejected', returned: 'Returned for changes', cancelled: 'Cancelled' }
const REQ_HEX: Record<string, string> = { pending: '#F59E0B', approved: '#16A34A', rejected: '#DC2626', returned: '#7c3aed', cancelled: '#78716c' }
const STEP_LABEL: Record<string, string> = { waiting: 'Not yet', pending: 'Waiting', approved: 'Approved', rejected: 'Rejected', returned: 'Returned', skipped: 'Not needed', cancelled: 'Cancelled' }
const STEP_HEX: Record<string, string> = { waiting: '#a8a29e', pending: '#F59E0B', approved: '#16A34A', rejected: '#DC2626', returned: '#7c3aed', skipped: '#a8a29e', cancelled: '#a8a29e' }
const VIA_LABEL: Record<string, string> = { delegation: 'as delegate', escalation: 'after escalation', admin: 'admin stand-in' }

function fmt(d?: string | null) {
  if (!d) return ''
  const x = new Date(d)
  return `${x.toLocaleDateString('en-GB')} ${x.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`
}

function Pill({ text, hex }: { text: string; hex: string }) {
  return <span style={pillStyle(hex)}>{text}</span>
}

function StageList({ req }: { req: ApprovalRequestInfo }) {
  const stages: { seq: number; name: string; mode: string; steps: ApprovalStep[] }[] = []
  for (const s of req.steps) {
    const g = stages.find((x) => x.seq === s.sequence)
    if (g) g.steps.push(s)
    else stages.push({ seq: s.sequence, name: s.stage_name, mode: s.approval_mode, steps: [s] })
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {stages.map((g) => (
        <div key={g.seq} style={{ borderLeft: `3px solid ${g.seq === req.current_sequence ? '#F59E0B' : BORDER.light}`, paddingLeft: 12 }}>
          <div style={{ fontSize: 12.5, fontWeight: 700, color: TEXT.heading, marginBottom: 4 }}>
            {g.seq}. {g.name}
            {g.steps.length > 1 && <span style={{ fontWeight: 500, color: TEXT.muted }}> — {g.mode === 'all' ? 'every one must approve' : 'any one approves'}</span>}
          </div>
          {g.steps.map((s) => (
            <div key={s.id} style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap', fontSize: 12.5, color: TEXT.body, marginBottom: 2 }}>
              <Pill text={STEP_LABEL[s.status] || s.status} hex={STEP_HEX[s.status] || '#78716c'} />
              <span>{s.approver_name || '—'}</span>
              {s.decided_by_name && s.decided_by_id !== s.approver_id && (
                <span style={{ color: TEXT.muted }}>decided by {s.decided_by_name}{s.via && VIA_LABEL[s.via] ? ` (${VIA_LABEL[s.via]})` : ''}</span>
              )}
              {s.decided_at && <span style={{ color: TEXT.muted }}>{fmt(s.decided_at)}</span>}
              {s.status === 'pending' && s.due_at && <span style={{ color: TEXT.muted }}>escalates {fmt(s.due_at)}</span>}
              {s.comment && <span style={{ fontStyle: 'italic' }}>&ldquo;{s.comment}&rdquo;</span>}
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}

/**
 * Approval status + actions for one record, from the central approval engine.
 * Drop it on any record page: <ApprovalPanel entityType="p2p_request" entityId={id} onChanged={reload} />
 * `onChanged` fires after a decision/cancel so the page can reload its own status.
 */
export default function ApprovalPanel({ entityType, entityId, onChanged, title = 'Approval' }: {
  entityType: string
  entityId: number
  onChanged?: (req: ApprovalRequestInfo) => void
  title?: string
}) {
  const [data, setData] = useState<ApprovalEntityStatus | null>(null)
  const [comment, setComment] = useState('')
  const [error, setError] = useState<string | string[]>('')
  const [busy, setBusy] = useState(false)
  const [confirmCancel, setConfirmCancel] = useState(false)
  const [showHistory, setShowHistory] = useState(false)

  const load = useCallback(() => {
    approvalsApi.entity(entityType, entityId).then(setData).catch((e) => setError(extractErrorMessages(e, 'Failed to load the approval status.')))
  }, [entityType, entityId])
  useEffect(() => { load() }, [load])

  if (!data || (!data.current && data.history.length === 0)) return error ? <Section title={title}><div style={{ color: '#b91c1c', fontSize: 13 }}>{Array.isArray(error) ? error.join(' ') : error}</div></Section> : null
  const req = data.current

  const act = async (fn: () => Promise<ApprovalRequestInfo>) => {
    setError('')
    setBusy(true)
    try {
      const out = await fn()
      setComment('')
      load()
      onChanged?.(out)
    } catch (err) {
      setError(extractErrorMessages(err, 'The approval action failed.'))
    } finally {
      setBusy(false)
    }
  }
  const canAct = !!req && req.status === 'pending' && (req.can_decide || req.can_stand_in)

  return (
    <Section title={title} style={{ marginBottom: 16 }}>
      {req && (
        <>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
            <Pill text={REQ_LABEL[req.status] || req.status} hex={REQ_HEX[req.status] || '#78716c'} />
            <span style={{ fontSize: 12.5, color: TEXT.muted }}>
              Submitted by {req.requester_name || '—'} on {fmt(req.submitted_at)}{req.revision > 1 ? ` · submission #${req.revision}` : ''}
            </span>
          </div>
          <StageList req={req} />
        </>
      )}

      {error && (
        <div style={{ padding: '10px 14px', margin: '12px 0 0', borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
          {Array.isArray(error) ? error.join(' ') : error}
        </div>
      )}

      {req && canAct && (
        <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
          {req.acting_for && <div style={{ fontSize: 12.5, color: TEXT.muted }}>You are deciding on behalf of {req.acting_for}.</div>}
          {!req.can_decide && req.can_stand_in && <div style={{ fontSize: 12.5, color: TEXT.muted }}>You are not an approver of this stage — as an admin you can stand in; a comment is required.</div>}
          <textarea style={{ ...inputStyle, minHeight: 60, resize: 'vertical' }} value={comment} onChange={(e) => setComment(e.target.value)}
            placeholder="Comment (required to reject or return)" />
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button type="button" style={primaryBtnStyle} disabled={busy} onClick={() => act(() => approvalsApi.decide(req.id, 'approve', comment))}>Approve</button>
            <button type="button" style={secondaryBtnStyle} disabled={busy} onClick={() => act(() => approvalsApi.decide(req.id, 'return', comment))}>Return for changes</button>
            <button type="button" style={dangerBtnStyle} disabled={busy} onClick={() => act(() => approvalsApi.decide(req.id, 'reject', comment))}>Reject</button>
          </div>
        </div>
      )}

      {req && req.status === 'pending' && req.can_cancel && (
        <div style={{ marginTop: 12 }}>
          <button type="button" style={secondaryBtnStyle} disabled={busy} onClick={() => setConfirmCancel(true)}>Withdraw approval request</button>
        </div>
      )}

      {data.history.length > 0 && (
        <div style={{ marginTop: 14 }}>
          <span style={{ fontSize: 12.5, fontWeight: 600, color: '#FF6A2A', cursor: 'pointer' }} onClick={() => setShowHistory((v) => !v)}>
            {showHistory ? 'Hide' : 'Show'} earlier submissions ({data.history.length})
          </span>
          {showHistory && data.history.map((h) => (
            <div key={h.id} style={{ marginTop: 10, paddingTop: 10, borderTop: `1px solid ${BORDER.light}` }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6 }}>
                <Pill text={REQ_LABEL[h.status] || h.status} hex={REQ_HEX[h.status] || '#78716c'} />
                <span style={{ fontSize: 12, color: TEXT.muted }}>Submission #{h.revision} · {fmt(h.submitted_at)}</span>
              </div>
              <StageList req={h} />
            </div>
          ))}
        </div>
      )}

      <ConfirmDialog
        open={confirmCancel}
        title="Withdraw approval request?"
        message="The approvers will no longer see it. You can submit it again later."
        confirmLabel="Withdraw"
        onConfirm={() => { setConfirmCancel(false); if (req) act(() => approvalsApi.cancel(req.id)) }}
        onCancel={() => setConfirmCancel(false)}
      />
    </Section>
  )
}
