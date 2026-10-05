'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useProtectedPage } from '@/hooks/useAuth'
import { storeApi } from '@/lib/api'
import { StoreMaterialReturn } from '@/types'
import { TEXT, GLASS, SHADOWS } from '@/lib/theme'
import { Row, InfoRow, primaryBtnStyle, secondaryBtnStyle } from '@/components/shared/ui'
import StoreNav from '@/components/store/StoreNav'
import MessageDialog from '@/components/erp/MessageDialog'
import ConfirmDialog from '@/components/erp/ConfirmDialog'
import PromptDialog from '@/components/erp/PromptDialog'
import { extractErrorMessages } from '@/lib/validation'

const STATUS_LABELS: Record<string, string> = { pending_approval: 'Pending Approval', approved: 'Approved', rejected: 'Rejected' }
const STATUS_HEX: Record<string, string> = { pending_approval: '#d97706', approved: '#16a34a', rejected: '#dc2626' }
const STEP_LABELS: Record<string, string> = { pending: 'Pending', approved: 'Approved', rejected: 'Rejected' }

const card = { borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur, border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass() }
const pill = (hex: string) => ({ fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 9999, background: `${hex}1a`, color: hex, whiteSpace: 'nowrap' as const })

export default function StoreMaterialReturnDetailPage() {
  // Not useRequireApp('store'): a department head / QC approver often has
  // no Store access but must open this page to approve. The API decides.
  const { isAuthorized, isLoading, user } = useProtectedPage()
  const router = useRouter()
  const params = useParams()
  const returnId = Number(params.id)
  const hasStore = !!user && (user.role === 'admin' || (user.assigned_apps || []).includes('store'))

  const [ret, setRet] = useState<StoreMaterialReturn | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [actionErrors, setActionErrors] = useState<string[]>([])
  const [confirmApprove, setConfirmApprove] = useState(false)
  const [rejectOpen, setRejectOpen] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!isAuthorized || !returnId) return
    setLoading(true)
    storeApi.getMaterialReturn(returnId)
      .then(setRet)
      .catch((err) => setLoadError(extractErrorMessages(err, 'Failed to load this material return.').join(' ')))
      .finally(() => setLoading(false))
  }, [isAuthorized, returnId])

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
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <h1 style={{ fontSize: 22, fontWeight: 700, color: TEXT.heading, margin: 0 }}>{ret.return_number}</h1>
                <span style={pill(STATUS_HEX[ret.status])}>{STATUS_LABELS[ret.status] || ret.status}</span>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
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

          <div data-tour="return-detail-summary" style={{ ...card, padding: 20, marginBottom: 20 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <Row>
                <InfoRow label="Store" value={ret.location_name || '—'} />
                <InfoRow label="Source" value={ret.source_type_label || ret.source_type} />
                <InfoRow label={ret.source_issue_number ? 'Material Issue' : 'Source Description'} value={ret.source_issue_number || ret.source_description || '—'} />
              </Row>
              <Row>
                <InfoRow label="Department" value={ret.department_name || '—'} />
                <InfoRow label="Return Date" value={ret.return_date} />
                <InfoRow label="Returned By" value={ret.returned_by_name || '—'} />
              </Row>
              <Row>
                <InfoRow label="Reason" value={ret.reason || '—'} />
                <InfoRow label="Remarks" value={ret.remarks || '—'} />
              </Row>
            </div>
          </div>

          {ret.approvals.length > 0 && (
            <>
              <p style={{ fontSize: 12, fontWeight: 700, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 10px' }}>Approvals</p>
              <div data-tour="return-detail-approvals" style={{ ...card, padding: '6px 0', marginBottom: 20 }}>
                {ret.approvals.map((a) => (
                  <div key={a.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, padding: '12px 20px', borderTop: '1px solid rgba(0,0,0,0.04)' }}>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 600, color: TEXT.body }}>{a.label}</div>
                      <div style={{ fontSize: 12, color: TEXT.muted, marginTop: 2 }}>
                        {a.status === 'pending'
                          ? `Any one of: ${a.approver_names.join(', ') || '—'}`
                          : `${STEP_LABELS[a.status]} by ${a.acted_by_name || '—'}${a.acted_at ? ` on ${new Date(a.acted_at).toLocaleDateString('en-GB')}` : ''}${a.comment ? ` — ${a.comment}` : ''}`}
                      </div>
                    </div>
                    <span style={pill(STATUS_HEX[a.status === 'pending' ? 'pending_approval' : a.status])}>{STEP_LABELS[a.status]}</span>
                  </div>
                ))}
              </div>
            </>
          )}

          <p style={{ fontSize: 12, fontWeight: 700, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 10px' }}>Items</p>
          <div data-tour="return-detail-items" style={{ ...card, overflow: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 560 }}>
              <thead>
                <tr>
                  {['Item', 'Quantity', 'Condition', 'Batch', 'Remarks'].map((h) => (
                    <th key={h} style={{ textAlign: 'left', padding: '12px 16px', fontSize: 11, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {ret.items.map((line) => (
                  <tr key={line.id} style={{ borderTop: '1px solid rgba(0,0,0,0.05)' }}>
                    <td style={{ padding: '12px 16px', fontSize: 13, fontWeight: 600, color: TEXT.body }}>{line.item_code} — {line.item_name}</td>
                    <td style={{ padding: '12px 16px', fontSize: 13, color: TEXT.secondary }}>{line.quantity} {line.uom}</td>
                    <td style={{ padding: '12px 16px' }}>
                      <span style={pill(line.condition === 'good' ? '#16a34a' : '#d97706')}>{line.condition_label || line.condition}</span>
                    </td>
                    <td style={{ padding: '12px 16px', fontSize: 13, color: TEXT.secondary }}>{line.batch_number || '—'}</td>
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
