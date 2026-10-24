'use client'

// Approval strip for Service records (machine approval, SR closure approval).
// Approvals run on the central approval engine (Organization › Approval
// Workflows); the page shows <ApprovalPanel> for the decision. This strip
// explains the state, and only for an item sent for approval BEFORE the
// engine took over (no engine request) shows the old Approve / Reject buttons —
// the backend decides whether the user is one of its original approvers.

import { useEffect, useState } from 'react'
import { approvalsApi, erpApi } from '@/lib/api'
import ReasonSheet from '@/components/shared/ReasonSheet'
import { primaryBtnStyle, dangerBtnStyle } from '@/components/shared/ui'
import { extractErrorMessages } from '@/lib/validation'

const TONES = {
  pending: { bg: 'rgba(245,158,11,0.08)', border: 'rgba(245,158,11,0.3)', color: '#92400e' },
  rejected: { bg: 'rgba(220,38,38,0.08)', border: 'rgba(220,38,38,0.2)', color: '#b91c1c' },
} as const

export default function ApprovalBanner({
  tone, title, text, entityType, entityId, onlyIfSetting, approveLabel, rejectLabel, rejectPrompt, onApprove, onReject,
}: {
  /** Render only while this boolean setting is on (e.g. SR 'review' means nothing without closure approval). */
  onlyIfSetting?: 'project_approval_required' | 'sr_close_approval_required'
  tone: keyof typeof TONES
  title: string
  text: string
  /** Approval-engine record, used to detect a pre-engine (legacy) item. */
  entityType?: string
  entityId?: number
  approveLabel?: string
  rejectLabel?: string
  rejectPrompt?: string
  onApprove?: (remarks: string) => Promise<void>
  onReject?: (remarks: string) => Promise<void>
}) {
  const [legacy, setLegacy] = useState(false)
  const [dialog, setDialog] = useState<'approve' | 'reject' | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [hidden, setHidden] = useState(!!onlyIfSetting)

  useEffect(() => {
    if (!onlyIfSetting) return
    erpApi.getSettings()
      .then((s) => setHidden(!s.values[onlyIfSetting]))
      .catch(() => setHidden(false))
  }, [onlyIfSetting])

  useEffect(() => {
    if (!onApprove || !entityType || !entityId) return
    approvalsApi.entity(entityType, entityId)
      .then((s) => setLegacy(!s.current))
      .catch(() => setLegacy(false))
  }, [onApprove, entityType, entityId])

  if (hidden) return null

  const run = async (fn: ((r: string) => Promise<void>) | undefined, remarks: string) => {
    setDialog(null)
    if (!fn) return
    setBusy(true)
    setError('')
    try {
      await fn(remarks)
    } catch (err) {
      setError(extractErrorMessages(err, 'Could not save the decision — refresh the page and try again.').join(' '))
    } finally {
      setBusy(false)
    }
  }

  const t = TONES[tone]
  return (
    <div style={{ padding: '12px 16px', marginBottom: 16, borderRadius: 12, background: t.bg, border: `1px solid ${t.border}`, color: t.color }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ fontSize: 13 }}>
          <b>{title}</b> — {text}
          {legacy && <> Sent for approval before approvals moved to Organization › Approval Workflows, so its original approvers decide it here.</>}
        </div>
        {legacy && onApprove && (
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" disabled={busy} style={primaryBtnStyle} onClick={() => setDialog('approve')}>
              {approveLabel || 'Approve'}
            </button>
            <button type="button" disabled={busy} style={dangerBtnStyle} onClick={() => setDialog('reject')}>
              {rejectLabel || 'Reject'}
            </button>
          </div>
        )}
      </div>
      {error && <p style={{ fontSize: 12.5, color: '#b91c1c', margin: '8px 0 0' }}>{error}</p>}

      <ReasonSheet open={dialog === 'approve'} icon="check" label="Remarks" title={approveLabel || 'Approve'} danger={false} confirmLabel={approveLabel || 'Approve'}
        message="Add remarks if needed." placeholder="Optional remarks…"
        onConfirm={(v) => run(onApprove, v)} onCancel={() => setDialog(null)} />
      <ReasonSheet open={dialog === 'reject'} icon="x" title={rejectLabel || 'Reject'} confirmLabel={rejectLabel || 'Reject'} requireValue
        message={rejectPrompt || 'Say what needs to be corrected.'} placeholder="Reason…"
        onConfirm={(v) => run(onReject, v)} onCancel={() => setDialog(null)} />
    </div>
  )
}
