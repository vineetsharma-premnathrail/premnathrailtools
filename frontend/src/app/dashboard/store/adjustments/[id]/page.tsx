'use client'

import { useCallback, useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { approvalsApi, storeApi } from '@/lib/api'
import { StoreStockAdjustment } from '@/types'
import { TEXT } from '@/lib/theme'
import { primaryBtnStyle, secondaryBtnStyle, RowCount, Pill, TableScroll, thStyle, tdStyle, numThStyle, numTdStyle, DetailCard, DetailSummary, DetailGroup, DetailRow } from '@/components/shared/ui'
import StoreNav from '@/components/store/StoreNav'
import InvalidRecordLink from '@/components/erp/InvalidRecordLink'
import { useRecordId } from '@/lib/recordRef'
import MessageDialog from '@/components/erp/MessageDialog'
import ConfirmDialog from '@/components/erp/ConfirmDialog'
import PromptDialog from '@/components/erp/PromptDialog'
import ApprovalPanel from '@/components/shared/ApprovalPanel'
import { formatDate } from '@/lib/format'
import { extractErrorMessages } from '@/lib/validation'
import { useCan } from '@/lib/permissions'

const STATUS_LABELS: Record<string, string> = { pending_approval: 'Pending Approval', approved: 'Approved', rejected: 'Rejected', cancelled: 'Withdrawn' }
const STATUS_HEX: Record<string, string> = { pending_approval: '#f59e0b', approved: '#22c55e', rejected: '#dc2626', cancelled: '#78716c' }
const fmtQty = (v: number) => v.toLocaleString('en-IN', { maximumFractionDigits: 3 })

export default function StoreStockAdjustmentDetailPage() {
  const { isAuthorized, isLoading, user } = useRequireApp('store')
  const { can } = useCan()
  const router = useRouter()
  const params = useParams()
  const ref = params.id as string
  const { id: resolvedAdjustmentId, error: linkError } = useRecordId(ref)
  const adjustmentId = resolvedAdjustmentId ?? 0

  const [adjustment, setAdjustment] = useState<StoreStockAdjustment | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [actionError, setActionError] = useState<string | string[]>('')
  const [busy, setBusy] = useState(false)
  const [confirmApprove, setConfirmApprove] = useState(false)
  const [rejectOpen, setRejectOpen] = useState(false)
  // Adjustments raised since the move to Organization › Approval Workflows
  // are decided in the ApprovalPanel; older ones keep the named-approver buttons.
  const [onEngine, setOnEngine] = useState<boolean | null>(null)

  const load = useCallback(() => {
    storeApi.getStockAdjustment(adjustmentId).then(setAdjustment).catch((err) => setLoadError(extractErrorMessages(err, 'The server did not respond — check your connection and reload the page.').join(' '))).finally(() => setLoading(false))
    approvalsApi.entity('stock_adjustment', adjustmentId).then((s) => setOnEngine(!!s.current)).catch(() => setOnEngine(null))
  }, [adjustmentId])

  useEffect(() => {
    if (!isAuthorized || !adjustmentId) return
    load()
  }, [isAuthorized, adjustmentId, load])

  // Maker-checker: the creator can never decide their own adjustment; the
  // approver named on it (or an admin standing in) can. The backend enforces
  // the same rule — this only avoids showing buttons that would be refused.
  const isPending = adjustment?.status === 'pending_approval' && onEngine === false
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
  if (linkError) return (<div><StoreNav /><InvalidRecordLink message={linkError} listHref="/dashboard/store/adjustments" listLabel="Back to adjustments" /></div>)
  if (!adjustmentId) return <div><StoreNav /></div>

  return (
    <div>
      <StoreNav />
      <MessageDialog open={!!loadError} variant="error" title="Failed to Load Stock Adjustment" message={loadError} onClose={() => setLoadError('')} actionLabel="Back to Adjustments" onAction={() => router.push('/dashboard/store/adjustments')} />
      <MessageDialog open={!!actionError} variant="error" title="Cannot Complete Action" message={actionError} onClose={() => setActionError('')} />
      <ConfirmDialog
        open={confirmApprove}
        title="Approve and post this adjustment?"
        message="Each line's difference will be posted to stock at this store. This can't be undone from here."
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
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap', marginBottom: 20 }}>
            <div>
              <p style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 4px' }}>
                Store &amp; Inventory · Stock Adjustment
              </p>
              <h1 style={{ fontSize: 22, fontWeight: 700, color: TEXT.heading, margin: 0 }}>{adjustment.adjustment_number}</h1>
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
                  {can('store', 'adjustments', 'reject') && <button type="button" data-tour="adjustment-detail-reject-btn" disabled={busy} onClick={() => setRejectOpen(true)} style={{ ...secondaryBtnStyle, color: '#b91c1c', opacity: busy ? 0.6 : 1 }}>Reject</button>}
                  {can('store', 'adjustments', 'approve') && <button type="button" data-tour="adjustment-detail-approve-btn" disabled={busy} onClick={() => setConfirmApprove(true)} style={{ ...primaryBtnStyle, opacity: busy ? 0.6 : 1 }}>{busy ? 'Working…' : 'Approve & Post'}</button>}
                </div>
              )}
            </div>
          )}

          {onEngine && (
            <div data-tour="adjustment-detail-approval-panel">
              <ApprovalPanel entityType="stock_adjustment" entityId={adjustment.id} onChanged={load} />
            </div>
          )}

          {/* One record view: what was corrected and why, then every fact as label–value rows. */}
          <DetailCard tour="adjustment-detail-summary">
            <DetailSummary
              title={adjustment.adjustment_number}
              text={`Corrects the book stock of ${adjustment.items.length} item line${adjustment.items.length === 1 ? '' : 's'} at ${adjustment.location_name || 'the store'} to the physically counted quantity${adjustment.reason ? ` — ${adjustment.reason}` : ''}.`}
              meta={<>
                <Pill label={STATUS_LABELS[adjustment.status] || adjustment.status} hex={STATUS_HEX[adjustment.status] || '#78716c'} />
                <span>· {formatDate(adjustment.adjustment_date)}</span>
                {adjustment.created_by_name && <span>· Raised by <strong style={{ color: TEXT.heading }}>{adjustment.created_by_name}</strong></span>}
              </>}
            />
            <DetailGroup title="Adjustment">
              <DetailRow label="Store">{adjustment.location_name}</DetailRow>
              <DetailRow label="Reason">{adjustment.reason}</DetailRow>
              <DetailRow label={adjustment.status === 'pending_approval' ? 'Approver' : adjustment.status === 'rejected' ? 'Rejected By' : 'Approved By'}>{adjustment.approved_by_name}</DetailRow>
              {adjustment.status === 'rejected' && <DetailRow label="Rejection Reason">{adjustment.rejected_reason}</DetailRow>}
            </DetailGroup>
            <DetailGroup last>
              <DetailRow label="Remarks">{adjustment.remarks}</DetailRow>
            </DetailGroup>
          </DetailCard>

          <p style={{ fontSize: 12, fontWeight: 700, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 10px' }}>Items</p>
          <div data-tour="adjustment-detail-items">
            <TableScroll maxHeight="none" minWidth={620}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={thStyle}>Item <RowCount count={adjustment.items.length} /></th>
                    <th style={numThStyle}>Qty at Count</th>
                    <th style={numThStyle}>Counted Qty</th>
                    <th style={numThStyle}>Difference</th>
                    <th style={thStyle}>Remarks</th>
                  </tr>
                </thead>
                <tbody>
                  {adjustment.items.map((line) => (
                    <tr key={line.id}>
                      <td style={{ ...tdStyle, fontWeight: 600 }}>{line.item_code} — {line.item_name}</td>
                      <td style={numTdStyle}>{fmtQty(line.existing_quantity)} {line.uom}</td>
                      <td style={numTdStyle}>{fmtQty(line.actual_quantity)} {line.uom}</td>
                      <td style={{ ...numTdStyle, fontWeight: 700, color: line.difference === 0 ? TEXT.muted : line.difference > 0 ? '#15803d' : '#b91c1c' }}>
                        {line.difference > 0 ? '+' : ''}{fmtQty(line.difference)}
                      </td>
                      <td style={tdStyle}>{line.remarks || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableScroll>
          </div>
        </>
      )}
    </div>
  )
}
