'use client'

import { useCallback, useEffect, useState } from 'react'
import { hrApi } from '@/lib/api'
import { HrLeaveRequest } from '@/types'
import { TEXT, GLASS, SHADOWS, BORDER } from '@/lib/theme'
import PromptDialog from '@/components/erp/PromptDialog'
import { extractErrorMessages } from '@/lib/validation'

const SESSION_SHORT: Record<string, string> = { full: '', first_half: ' (1st half)', second_half: ' (2nd half)' }
const td: React.CSSProperties = { padding: '10px 14px', fontSize: 13, color: TEXT.body, borderTop: `1px solid ${BORDER.light}`, verticalAlign: 'top' }
const actionBtn = (color: string): React.CSSProperties => ({
  fontSize: 12, fontWeight: 700, padding: '6px 12px', borderRadius: 9999, border: `1px solid ${color}55`,
  background: `${color}14`, color, cursor: 'pointer', marginRight: 6,
})

function num(v: string | number) {
  const n = Number(v || 0)
  return Number.isInteger(n) ? String(n) : n.toFixed(1)
}
function dmy(iso: string | null) {
  return iso ? `${iso.slice(8, 10)}-${iso.slice(5, 7)}-${iso.slice(0, 4)}` : '—'
}

// Leave requests waiting for the signed-in user's decision (direct reports,
// plus — for HR — requests from people with no reporting manager).
export default function LeaveApprovals() {
  const [items, setItems] = useState<HrLeaveRequest[]>([])
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState<string[]>([])
  const [notice, setNotice] = useState('')
  const [dialog, setDialog] = useState<{ kind: 'approve' | 'reject'; req: HrLeaveRequest } | null>(null)

  const load = useCallback(() => {
    hrApi.listLeaveRequestsPendingForMe()
      .then((d) => setItems(d))
      .catch((err) => setError(extractErrorMessages(err, 'Could not load leave approvals.')))
      .finally(() => setLoaded(true))
  }, [])

  useEffect(() => { load() }, [load])

  const decide = async (value: string) => {
    if (!dialog) return
    const { kind, req } = dialog
    if (kind === 'reject' && !value.trim()) {
      setError([`Give a reason for rejecting ${req.request_no} so ${req.user_name || 'the employee'} knows what to change.`])
      setDialog(null)
      return
    }
    setDialog(null)
    setError([])
    try {
      if (kind === 'approve') await hrApi.approveLeaveRequest(req.id, value.trim())
      else await hrApi.rejectLeaveRequest(req.id, value.trim())
      setNotice(`${req.request_no} ${kind === 'approve' ? 'approved' : 'rejected'}. ${req.user_name || 'The employee'} has been notified.`)
      load()
    } catch (err) {
      setError(extractErrorMessages(err, `${req.request_no} could not be ${kind === 'approve' ? 'approved' : 'rejected'}.`))
    }
  }

  const openAttachment = async (r: HrLeaveRequest) => {
    try {
      const blob = await hrApi.getLeaveAttachmentBlob(r.id)
      window.open(URL.createObjectURL(blob), '_blank', 'noopener')
    } catch (err) {
      setError(extractErrorMessages(err, 'The attachment could not be opened.'))
    }
  }

  if (!loaded || (items.length === 0 && error.length === 0 && !notice)) return null

  return (
    <div style={{ marginBottom: 24 }}>
      <h3 style={{ fontSize: 15, fontWeight: 700, color: TEXT.heading, margin: '0 0 10px' }}>
        Leave requests <span style={{ fontSize: 12, fontWeight: 700, color: '#F59E0B' }}>· {items.length} pending</span>
      </h3>
      {error.length > 0 && (
        <div style={{ padding: '10px 14px', marginBottom: 12, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
          {error.join(' ')}
        </div>
      )}
      {notice && (
        <div style={{ padding: '10px 14px', marginBottom: 12, borderRadius: 10, background: 'rgba(22,163,74,0.08)', border: '1px solid rgba(22,163,74,0.25)', color: '#166534', fontSize: 13 }}>
          {notice}
        </div>
      )}
      {items.length > 0 && (
        <div style={{ borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur, border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), overflow: 'auto', maxHeight: 'calc(100vh - 320px)' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 900 }}>
            <thead>
              <tr>
                {['Employee', 'Leave', 'Dates', 'Days', 'Reason', 'Applied', ''].map((h) => (
                  <th key={h} style={{ textAlign: 'left', padding: '10px 14px', fontSize: 11, fontWeight: 600, letterSpacing: '.03em', textTransform: 'uppercase', color: TEXT.muted, position: 'sticky', top: 0, background: '#fdf1e6', zIndex: 1 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {items.map((r) => (
                <tr key={r.id}>
                  <td style={td}>
                    <div style={{ fontWeight: 600, color: TEXT.heading }}>{r.user_name}</div>
                    <div style={{ fontSize: 11.5, color: TEXT.muted }}>{[r.employee_code, r.department_name].filter(Boolean).join(' · ')}</div>
                    {!r.approver_id && <div style={{ fontSize: 11, color: '#B45309', marginTop: 2 }}>No reporting manager — HR decides</div>}
                  </td>
                  <td style={td}>
                    <div>{r.leave_type_name}</div>
                    <div style={{ fontSize: 11.5, color: TEXT.muted }}>{r.request_no}</div>
                  </td>
                  <td style={td}>
                    {dmy(r.from_date)}{SESSION_SHORT[r.from_session]}
                    {r.to_date !== r.from_date && <> → {dmy(r.to_date)}{SESSION_SHORT[r.to_session]}</>}
                  </td>
                  <td style={{ ...td, fontWeight: 700 }}>{num(r.days)}</td>
                  <td style={{ ...td, maxWidth: 260 }}>
                    {r.reason}
                    {r.contact_during_leave && <div style={{ fontSize: 11.5, color: TEXT.muted, marginTop: 2 }}>Contact: {r.contact_during_leave}</div>}
                    {r.attachment_path && <div><span onClick={() => openAttachment(r)} style={{ fontSize: 12, fontWeight: 600, color: '#2563EB', cursor: 'pointer' }}>View attachment</span></div>}
                  </td>
                  <td style={{ ...td, fontSize: 12 }}>{r.created_at ? dmy(r.created_at.slice(0, 10)) : '—'}</td>
                  <td style={{ ...td, whiteSpace: 'nowrap' }}>
                    {r.can_decide && (
                      <>
                        <button type="button" style={actionBtn('#16A34A')} onClick={() => { setNotice(''); setDialog({ kind: 'approve', req: r }) }}>Approve</button>
                        <button type="button" style={actionBtn('#DC2626')} onClick={() => { setNotice(''); setDialog({ kind: 'reject', req: r }) }}>Reject</button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <PromptDialog
        open={!!dialog}
        title={dialog?.kind === 'approve' ? `Approve ${dialog.req.request_no}?` : `Reject ${dialog?.req.request_no}?`}
        message={dialog ? `${dialog.req.user_name} · ${dialog.req.leave_type_name} · ${num(dialog.req.days)} day(s) from ${dmy(dialog.req.from_date)}.${dialog.kind === 'approve' ? ' Their balance is deducted and the days are marked on leave.' : ' A reason is required.'}` : ''}
        placeholder={dialog?.kind === 'approve' ? 'Optional remarks…' : 'Reason for rejecting (required)…'}
        confirmLabel={dialog?.kind === 'approve' ? 'Approve' : 'Reject'}
        danger={dialog?.kind === 'reject'}
        onConfirm={decide}
        onCancel={() => setDialog(null)}
      />
    </div>
  )
}
