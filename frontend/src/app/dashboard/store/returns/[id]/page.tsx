'use client'

import { useCallback, useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useProtectedPage } from '@/hooks/useAuth'
import { storeApi } from '@/lib/api'
import { StoreMaterialReturn } from '@/types'
import { TEXT, GLASS, SHADOWS } from '@/lib/theme'
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

const STATUS_LABELS: Record<string, string> = { pending_approval: 'Pending Approval', approved: 'Approved', rejected: 'Rejected', cancelled: 'Withdrawn' }
const STATUS_HEX: Record<string, string> = { pending_approval: '#d97706', approved: '#16a34a', rejected: '#dc2626', cancelled: '#78716c' }
const STEP_LABELS: Record<string, string> = { pending: 'Pending', approved: 'Approved', rejected: 'Rejected' }

const card = { borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur, border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass() }

export default function StoreMaterialReturnDetailPage() {
  // Not useRequireApp('store'): a department head / QC approver often has
  // no Store access but must open this page to approve. The API decides.
  const { isAuthorized, isLoading, user } = useProtectedPage()
  const router = useRouter()
  const params = useParams()
  const ref = params.id as string
  const { id: resolvedReturnId, error: linkError } = useRecordId(ref)
  const returnId = resolvedReturnId ?? 0
  const hasStore = !!user && (user.role === 'admin' || (user.assigned_apps || []).includes('store'))

  const [ret, setRet] = useState<StoreMaterialReturn | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [actionErrors, setActionErrors] = useState<string[]>([])
  const [confirmApprove, setConfirmApprove] = useState(false)
  const [rejectOpen, setRejectOpen] = useState(false)
  const [busy, setBusy] = useState(false)

  const load = useCallback(() => {
    storeApi.getMaterialReturn(returnId)
      .then(setRet)
      .catch((err) => setLoadError(extractErrorMessages(err, 'Failed to load this material return.').join(' ')))
      .finally(() => setLoading(false))
  }, [returnId])

  useEffect(() => {
    if (!isAuthorized || !returnId) return
    load()
  }, [isAuthorized, returnId, load])

  const decide = async (fn: () => Promise<StoreMaterialReturn>) => {
    setBusy(true)
    try {
      setRet(await fn())
    } catch (err) {
      setActionErrors(extractErrorMessages(err, 'Could not save your decision.'))
    } finally {
      setBusy(false)
    }
  }

  if (isLoading || !isAuthorized) return null
  if (linkError) return (<div>{hasStore && <StoreNav />}<InvalidRecordLink message={linkError} listHref={hasStore ? '/dashboard/store/returns' : '/dashboard'} listLabel={hasStore ? 'Back to returns' : 'Back to dashboard'} /></div>)
  if (!returnId) return <div>{hasStore && <StoreNav />}</div>

  const back = () => router.push(hasStore ? '/dashboard/store/returns' : '/dashboard')

  return (
    <div>
      {hasStore && <StoreNav />}
      <MessageDialog open={!!loadError} variant="error" title="Failed to Load Material Return" message={loadError} onClose={() => setLoadError('')} actionLabel="Go Back" onAction={back} />
      <MessageDialog open={actionErrors.length > 0} variant="error" title="Action Failed" message={actionErrors} onClose={() => setActionErrors([])} />
      <ConfirmDialog
        open={confirmApprove}
        title="Approve this return?"
        message={ret && ret.approvals.filter((a) => a.status === 'pending').length <= 1
          ? 'Yours is the last approval — the returned quantities post to stock (usable lines to on-hand, quarantine lines to quarantine).'
          : 'Other approvals are still pending — stock changes only after all of them approve.'}
        confirmLabel="Approve"
        onCancel={() => setConfirmApprove(false)}
        onConfirm={() => { setConfirmApprove(false); decide(() => storeApi.approveMaterialReturn(returnId)) }}
      />
      <PromptDialog
        open={rejectOpen}
        title="Reject this return?"
        message="Nothing is posted to stock. The store keeper sees your reason."
        placeholder="Reason (required) — e.g. quantity doesn't match, material not received"
        confirmLabel="Reject"
        requireValue
        onCancel={() => setRejectOpen(false)}
        onConfirm={(reason) => { setRejectOpen(false); decide(() => storeApi.rejectMaterialReturn(returnId, reason)) }}
      />

      {loading || !ret ? (
        <p style={{ fontSize: 13, color: TEXT.muted }}>{loading ? 'Loading…' : ''}</p>
      ) : (
        <>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20, gap: 12, flexWrap: 'wrap' }}>
            <div>
              <p style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 4px' }}>
                Store &amp; Inventory · Material Return
              </p>
              <h1 style={{ fontSize: 22, fontWeight: 700, color: TEXT.heading, margin: 0 }}>{ret.return_number}</h1>
            </div>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              {ret.can_act && (
                <>
                  <button type="button" data-tour="return-reject-btn" disabled={busy} onClick={() => setRejectOpen(true)} style={{ ...secondaryBtnStyle, color: '#b91c1c' }}>Reject</button>
                  <button type="button" data-tour="return-approve-btn" disabled={busy} onClick={() => setConfirmApprove(true)} style={{ ...primaryBtnStyle, opacity: busy ? 0.7 : 1 }}>Approve</button>
                </>
              )}
              <button type="button" data-tour="return-detail-back-btn" onClick={back} style={secondaryBtnStyle}>← Back</button>
            </div>
          </div>

          {ret.status === 'rejected' && ret.rejected_reason && (
            <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
              Rejected — {ret.rejected_reason}. Nothing was posted to stock.
            </div>
          )}

          {/* One record view: what came back, from where — then every fact as label–value rows. */}
          <DetailCard tour="return-detail-summary">
            <DetailSummary
              title={ret.return_number}
              text={`${ret.items.length} item line${ret.items.length === 1 ? '' : 's'} returned to ${ret.location_name || 'the store'}${ret.source_issue_number ? ` against material issue ${ret.source_issue_number}` : ret.source_type_label ? ` from ${ret.source_type_label.toLowerCase()}` : ''}${ret.reason ? ` — ${ret.reason}` : ''}.`}
              meta={<>
                <Pill label={STATUS_LABELS[ret.status] || ret.status} hex={STATUS_HEX[ret.status] || '#78716c'} />
                <span>· {formatDate(ret.return_date)}</span>
                {ret.returned_by_name && <span>· Returned by <strong style={{ color: TEXT.heading }}>{ret.returned_by_name}</strong></span>}
              </>}
            />
            <DetailGroup title="Return">
              <DetailRow label="Store">{ret.location_name}</DetailRow>
              <DetailRow label="Source">{ret.source_type_label || ret.source_type}</DetailRow>
              <DetailRow label={ret.source_issue_number ? 'Material Issue' : 'Source Description'}>{ret.source_issue_number || ret.source_description}</DetailRow>
              <DetailRow label="Department">{ret.department_name}</DetailRow>
            </DetailGroup>
            <DetailGroup last>
              <DetailRow label="Reason">{ret.reason}</DetailRow>
              <DetailRow label="Remarks">{ret.remarks}</DetailRow>
            </DetailGroup>
          </DetailCard>

          {/* Approval routed by Organization › Approval Workflows › Material return. */}
          <div data-tour="return-detail-approval-panel">
            <ApprovalPanel entityType="material_return" entityId={ret.id} onChanged={load} />
          </div>

          {ret.approvals.length > 0 && (
            <>
              <p style={{ fontSize: 12, fontWeight: 700, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 10px' }}>Approvals (raised before Approval Workflows)</p>
              <div data-tour="return-detail-approvals" style={{ ...card, padding: '6px 0', marginBottom: 20 }}>
                {ret.approvals.map((a) => (
                  <div key={a.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, padding: '12px 20px', borderTop: '1px solid rgba(0,0,0,0.04)' }}>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 600, color: TEXT.body }}>{a.label}</div>
                      <div style={{ fontSize: 12, color: TEXT.muted, marginTop: 2 }}>
                        {a.status === 'pending'
                          ? `Any one of: ${a.approver_names.join(', ') || '—'}`
                          : `${STEP_LABELS[a.status]} by ${a.acted_by_name || '—'}${a.acted_at ? ` on ${formatDate(a.acted_at)}` : ''}${a.comment ? ` — ${a.comment}` : ''}`}
                      </div>
                    </div>
                    <Pill label={STEP_LABELS[a.status] || a.status} hex={STATUS_HEX[a.status === 'pending' ? 'pending_approval' : a.status] || '#78716c'} />
                  </div>
                ))}
              </div>
            </>
          )}

          <p style={{ fontSize: 12, fontWeight: 700, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 10px' }}>Items</p>
          <div data-tour="return-detail-items">
            <TableScroll maxHeight="none" minWidth={560}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={thStyle}>Item <RowCount count={ret.items.length} /></th>
                    <th style={numThStyle}>Quantity</th>
                    <th style={thStyle}>Condition</th>
                    <th style={thStyle}>Batch</th>
                    <th style={thStyle}>Remarks</th>
                  </tr>
                </thead>
                <tbody>
                  {ret.items.map((line) => (
                    <tr key={line.id}>
                      <td style={{ ...tdStyle, fontWeight: 600 }}>{line.item_code} — {line.item_name}</td>
                      <td style={numTdStyle}>{line.quantity.toLocaleString('en-IN', { maximumFractionDigits: 3 })} {line.uom}</td>
                      <td style={tdStyle}>
                        <Pill label={line.condition_label || line.condition} hex={line.condition === 'good' ? '#16a34a' : '#d97706'} />
                      </td>
                      <td style={tdStyle}>{line.batch_number || '—'}</td>
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
