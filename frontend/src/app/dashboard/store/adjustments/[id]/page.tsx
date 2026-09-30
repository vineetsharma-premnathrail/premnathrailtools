'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { storeApi } from '@/lib/api'
import { StoreStockAdjustment } from '@/types'
import { TEXT, BRAND, GLASS, SHADOWS } from '@/lib/theme'
import { Row, InfoRow, primaryBtnStyle, secondaryBtnStyle } from '@/components/shared/ui'
import StoreNav from '@/components/store/StoreNav'
import MessageDialog from '@/components/erp/MessageDialog'
import ConfirmDialog from '@/components/erp/ConfirmDialog'
import PromptDialog from '@/components/erp/PromptDialog'
import { extractErrorMessages } from '@/lib/validation'

const STATUS_LABELS: Record<string, string> = { pending_approval: 'Pending Approval', approved: 'Approved', rejected: 'Rejected' }
const STATUS_HEX: Record<string, string> = { pending_approval: '#f59e0b', approved: '#22c55e', rejected: '#dc2626' }

export default function StoreStockAdjustmentDetailPage() {
  const { isAuthorized, isLoading, user } = useRequireApp('store')
  const router = useRouter()
  const params = useParams()
  const adjustmentId = Number(params.id)

  const [adjustment, setAdjustment] = useState<StoreStockAdjustment | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [actionError, setActionError] = useState<string | string[]>('')
  const [busy, setBusy] = useState(false)
  const [confirmApprove, setConfirmApprove] = useState(false)
  const [rejectOpen, setRejectOpen] = useState(false)

  useEffect(() => {
    if (!isAuthorized || !adjustmentId) return
    setLoading(true)
    storeApi.getStockAdjustment(adjustmentId).then(setAdjustment).catch(() => setLoadError('Failed to load this stock adjustment.')).finally(() => setLoading(false))
  }, [isAuthorized, adjustmentId])

  // Maker-checker: the creator can never decide their own adjustment; the
  // approver named on it (or an admin standing in) can. The backend enforces
  // the same rule — this only avoids showing buttons that would be refused.
  const isPending = adjustment?.status === 'pending_approval'
  const isCreator = !!adjustment && adjustment.created_by_id === user?.id
  const canDecide = !!adjustment && isPending && !isCreator && (adjustment.approved_by_id === user?.id || user?.role === 'admin')

  const decide = async (fn: () => Promise<StoreStockAdjustment>) => {
    setBusy(true)
    setActionError('')
    try {
      setAdjustment(await fn())
    } catch (err) {
      setActionError(extractErrorMessages(err, 'Failed to update this stock adjustment.'))
    } finally {
      setBusy(false)
    }
  }

  const doApprove = () => { setConfirmApprove(false); decide(() => storeApi.approveStockAdjustment(adjustmentId)) }
  const doReject = (reason: string) => {
    if (!reason.trim()) { setActionError('Enter a reason for rejecting, so the store keeper knows what to recount or fix.'); return }
    setRejectOpen(false)
    decide(() => storeApi.rejectStockAdjustment(adjustmentId, reason.trim()))
  }

  if (isLoading || !isAuthorized) return null

  return (
    <div>
      <StoreNav />
      <MessageDialog open={!!loadError} variant="error" title="Failed to Load Stock Adjustment" message={loadError} onClose={() => setLoadError('')} actionLabel="Back to Adjustments" onAction={() => router.push('/dashboard/store/adjustments')} />
      <MessageDialog open={!!actionError} variant="error" title="Cannot Complete Action" message={actionError} onClose={() => setActionError('')} />
      <ConfirmDialog
        open={confirmApprove}
        title="Approve and post this adjustment?"
        message="Each line's difference will be posted to stock at this warehouse. This can't be undone from here."
        confirmLabel="Approve & Post"
        danger={false}
        onConfirm={doApprove}
        onCancel={() => setConfirmApprove(false)}
      />
      <PromptDialog
        open={rejectOpen}
        title="Reject this adjustment?"
        placeholder="Reason (required) — e.g. recount bin A-3, count sheet missing"
        confirmLabel="Reject"
        danger
        onConfirm={doReject}
        onCancel={() => (busy ? null : setRejectOpen(false))}
      />

      {loading || !adjustment ? (
        <p style={{ fontSize: 13, color: TEXT.muted }}>Loading…</p>
      ) : (
        <>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
            <div>
              <p style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 4px' }}>
                Store &amp; Inventory · Stock Adjustment
              </p>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <h1 style={{ fontSize: 22, fontWeight: 700, color: TEXT.heading, margin: 0 }}>{adjustment.adjustment_number}</h1>
                <span style={{ fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 9999, background: `${STATUS_HEX[adjustment.status]}1a`, color: STATUS_HEX[adjustment.status], whiteSpace: 'nowrap' }}>
                  {STATUS_LABELS[adjustment.status] || adjustment.status}
                </span>
              </div>
            </div>
            <button type="button" data-tour="adjustment-detail-back-btn" onClick={() => router.push('/dashboard/store/adjustments')} style={secondaryBtnStyle}>← Back</button>
          </div>

          {isPending && (
            <div data-tour="adjustment-detail-approval" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap', padding: '12px 16px', marginBottom: 20, borderRadius: 12, background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.25)' }}>
              <p style={{ fontSize: 13, color: TEXT.body, margin: 0 }}>
                {canDecide
                  ? 'This adjustment has not changed stock yet. Approving posts each line\'s difference to stock.'
                  : isCreator
                    ? `Waiting for ${adjustment.approved_by_name || 'the named approver'} to approve — you can't approve an adjustment you created. Stock is unchanged until then.`
                    : `Waiting for ${adjustment.approved_by_name || 'the named approver'} to approve. Stock is unchanged until then.`}
              </p>
              {canDecide && (
                <div style={{ display: 'flex', gap: 10 }}>
                  <button type="button" disabled={busy} onClick={() => setRejectOpen(true)} style={{ ...secondaryBtnStyle, color: '#b91c1c', opacity: busy ? 0.6 : 1 }}>Reject</button>
                  <button type="button" disabled={busy} onClick={() => setConfirmApprove(true)} style={{ ...primaryBtnStyle, opacity: busy ? 0.6 : 1 }}>{busy ? 'Working…' : 'Approve & Post'}</button>
                </div>
              )}
            </div>
          )}

          <div data-tour="adjustment-detail-summary" style={{ borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur, border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), padding: 20, marginBottom: 20 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <Row>
                <InfoRow label="Warehouse" value={adjustment.location_name || '—'} />
                <InfoRow label="Adjustment Date" value={adjustment.adjustment_date} />
                <InfoRow label={adjustment.status === 'pending_approval' ? 'Approver' : adjustment.status === 'rejected' ? 'Rejected By' : 'Approved By'} value={adjustment.approved_by_name || '—'} />
              </Row>
              <Row>
                <InfoRow label="Reason" value={adjustment.reason || '—'} />
                <InfoRow label="Created By" value={adjustment.created_by_name || '—'} />
              </Row>
              <InfoRow label="Remarks" value={adjustment.remarks || '—'} />
              {adjustment.status === 'rejected' && <InfoRow label="Rejection Reason" value={adjustment.rejected_reason || '—'} />}
            </div>
          </div>

          <p style={{ fontSize: 12, fontWeight: 700, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 10px' }}>Items</p>
          <div data-tour="adjustment-detail-items" style={{ borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur, border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), overflow: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 620 }}>
              <thead>
                <tr>
                  {['Item', 'Qty at Count', 'Counted Qty', 'Difference', 'Remarks'].map((h) => (
                    <th key={h} style={{ textAlign: 'left', padding: '12px 16px', fontSize: 11, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {adjustment.items.map((line) => (
                  <tr key={line.id} style={{ borderTop: '1px solid rgba(0,0,0,0.05)' }}>
                    <td style={{ padding: '12px 16px', fontSize: 13, fontWeight: 600, color: TEXT.body }}>{line.item_code} — {line.item_name}</td>
                    <td style={{ padding: '12px 16px', fontSize: 13, color: TEXT.secondary }}>{line.existing_quantity} {line.uom}</td>
                    <td style={{ padding: '12px 16px', fontSize: 13, color: TEXT.secondary }}>{line.actual_quantity} {line.uom}</td>
                    <td style={{ padding: '12px 16px', fontSize: 13, fontWeight: 700, color: line.difference === 0 ? TEXT.muted : line.difference > 0 ? BRAND.primaryActive : '#b91c1c' }}>
                      {line.difference > 0 ? '+' : ''}{line.difference}
                    </td>
                    <td style={{ padding: '12px 16px', fontSize: 13, color: TEXT.secondary }}>{line.remarks || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}
