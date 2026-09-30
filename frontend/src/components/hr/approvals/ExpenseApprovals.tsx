'use client'

import { useCallback, useEffect, useState } from 'react'
import { hrApi } from '@/lib/api'
import { extractErrorMessages } from '@/lib/validation'
import { openAttachmentBlob } from '@/hooks/useAttachmentBlobUrl'
import type { HrExpenseClaim } from '@/types'
import PromptDialog from '@/components/erp/PromptDialog'
import { dangerBtnStyle } from '@/components/shared/ui'
import { EXPENSE_CATEGORY_LABELS } from '@/components/hr/admin/ClaimDetail'
import { ErrorBanner, SuccessBanner, Pill, sectionStyle, primaryActionStyle, linkActionStyle, thStyle, tdStyle, fmtDate, fmtDateTime, fmtINR } from '@/components/hr/admin/adminUi'
import { TEXT, BORDER } from '@/lib/theme'

// Submitted expense claims waiting for the signed-in user's decision, with
// the lines and receipts inline so a manager (who may not have the HR app)
// can review without leaving the page. Renders nothing when there are none.
export default function ExpenseApprovals() {
  const [rows, setRows] = useState<HrExpenseClaim[] | null>(null)
  const [error, setError] = useState<string[]>([])
  const [notice, setNotice] = useState('')
  const [expanded, setExpanded] = useState<Record<number, boolean>>({})
  const [pending, setPending] = useState<{ kind: 'approve' | 'reject'; c: HrExpenseClaim } | null>(null)

  const load = useCallback(() => {
    hrApi.claimApprovals()
      .then((r) => { setRows(r); setError([]) })
      .catch((err) => { setRows([]); setError(extractErrorMessages(err, 'Expense claim approvals could not be loaded.')) })
  }, [])

  useEffect(() => { load() }, [load])

  const decide = async (remarks: string) => {
    if (!pending) return
    const { kind, c } = pending
    setPending(null)
    try {
      if (kind === 'approve') await hrApi.approveClaim(c.id, remarks)
      else await hrApi.rejectClaim(c.id, remarks)
      setNotice(`${c.claim_no} ${kind === 'approve' ? 'approved — HR will record the payment' : 'rejected and sent back for correction'}.`)
      load()
    } catch (err) {
      setError(extractErrorMessages(err, 'The claim could not be updated.'))
    }
  }

  const viewReceipt = async (claimId: number, itemId: number) => {
    try {
      await openAttachmentBlob(() => hrApi.getClaimReceiptBlob(claimId, itemId))
    } catch (err) {
      setError(extractErrorMessages(err, 'The receipt could not be opened.'))
    }
  }

  if (rows === null) return null
  if (rows.length === 0 && !error.length && !notice) return null

  return (
    <div style={sectionStyle}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <p style={{ fontSize: 12, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.secondary, margin: 0 }}>Expense claims</p>
        <span style={{ fontSize: 12, fontWeight: 700, color: '#F59E0B' }}>{rows.length} pending · {fmtINR(rows.reduce((a, c) => a + Number(c.total_amount || 0), 0))}</span>
      </div>
      <ErrorBanner error={error} />
      <SuccessBanner message={notice} />
      {rows.length === 0 ? (
        <p style={{ fontSize: 13, color: TEXT.muted, margin: 0 }}>Nothing else waiting.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {rows.map((c) => {
            const open = !!expanded[c.id]
            const missing = (c.items || []).filter((i) => i.receipt_required && !i.has_receipt).length
            return (
              <div key={c.id} style={{ padding: '12px 14px', borderRadius: 12, background: 'rgba(255,255,255,.7)', border: `1px solid ${BORDER.light}` }}>
                <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'flex-start' }}>
                  <div style={{ flex: '0 1 200px', minWidth: 160 }}>
                    <p style={{ fontSize: 13.5, fontWeight: 700, color: TEXT.heading, margin: '0 0 2px' }}>{c.user_name}</p>
                    <p style={{ fontSize: 12, color: TEXT.muted, margin: 0 }}>{c.user_department || '—'}</p>
                    <p style={{ fontSize: 11.5, color: TEXT.muted, margin: '4px 0 0' }}>{c.claim_no} · submitted {fmtDateTime(c.submitted_at)}</p>
                    {!c.approver_id && <p style={{ fontSize: 11.5, color: '#2563EB', margin: '4px 0 0' }}>No manager set — any HR user can decide</p>}
                  </div>
                  <div style={{ flex: '1 1 260px' }}>
                    <p style={{ fontSize: 14, fontWeight: 700, color: TEXT.heading, margin: '0 0 2px' }}>{c.title}</p>
                    <p style={{ fontSize: 12.5, color: TEXT.muted, margin: 0 }}>
                      {c.item_count} line{c.item_count === 1 ? '' : 's'} · claim date {fmtDate(c.claim_date)}{c.travel_request_no ? ` · trip ${c.travel_request_no} (${c.travel_route})` : ''}
                    </p>
                    {missing > 0 && <p style={{ fontSize: 12, color: '#DC2626', margin: '4px 0 0' }}>{missing} line(s) have no receipt</p>}
                    <button type="button" style={{ ...linkActionStyle, marginTop: 6 }} onClick={() => setExpanded((p) => ({ ...p, [c.id]: !open }))}>{open ? 'Hide lines' : 'Show lines & receipts'}</button>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 8 }}>
                    <span style={{ fontSize: 18, fontWeight: 800, color: TEXT.heading }}>{fmtINR(c.total_amount)}</span>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button type="button" style={{ ...primaryActionStyle, padding: '8px 16px' }} onClick={() => setPending({ kind: 'approve', c })}>Approve</button>
                      <button type="button" style={dangerBtnStyle} onClick={() => setPending({ kind: 'reject', c })}>Reject</button>
                    </div>
                  </div>
                </div>
                {open && (
                  <div style={{ overflowX: 'auto', marginTop: 10 }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 600 }}>
                      <thead><tr>{['Date', 'Category', 'Description', 'Amount', 'Receipt'].map((h) => <th key={h} style={{ ...thStyle, position: 'static', textAlign: h === 'Amount' ? 'right' : 'left' }}>{h}</th>)}</tr></thead>
                      <tbody>
                        {(c.items || []).map((i) => (
                          <tr key={i.id}>
                            <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>{fmtDate(i.expense_date)}</td>
                            <td style={tdStyle}>{EXPENSE_CATEGORY_LABELS[i.category] || i.category}</td>
                            <td style={tdStyle}>{i.description || '—'}</td>
                            <td style={{ ...tdStyle, textAlign: 'right', fontWeight: 600, whiteSpace: 'nowrap' }}>{fmtINR(i.amount)}</td>
                            <td style={tdStyle}>
                              {i.has_receipt
                                ? <button type="button" style={linkActionStyle} onClick={() => viewReceipt(c.id, i.id)}>View</button>
                                : i.receipt_required ? <Pill hex="#DC2626" label="Missing" /> : <span style={{ color: TEXT.muted }}>—</span>}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
      {rows.length > 0 && <p style={{ fontSize: 11.5, color: TEXT.muted, margin: '10px 0 0' }}>Approving does not pay the employee — HR records the payment after it is made.</p>}
      <PromptDialog
        open={!!pending}
        title={pending ? `${pending.kind === 'approve' ? 'Approve' : 'Reject'} ${pending.c.claim_no}?` : ''}
        message={pending ? `${pending.c.user_name} · ${fmtINR(pending.c.total_amount)}.${pending.kind === 'reject' ? ' Say what needs correcting (required) — they can fix and resubmit.' : ''}` : undefined}
        placeholder={pending?.kind === 'reject' ? 'What needs to be corrected…' : 'Remarks (optional)…'}
        confirmLabel={pending?.kind === 'approve' ? 'Approve' : 'Reject'}
        cancelLabel="Back"
        danger={pending?.kind === 'reject'}
        onConfirm={decide}
        onCancel={() => setPending(null)}
      />
    </div>
  )
}
