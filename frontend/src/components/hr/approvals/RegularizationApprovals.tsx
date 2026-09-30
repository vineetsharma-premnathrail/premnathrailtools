'use client'

import { useCallback, useEffect, useState } from 'react'
import { hrApi } from '@/lib/api'
import { HrAttendanceRegularization } from '@/types'
import { TEXT, GLASS, SHADOWS, BORDER } from '@/lib/theme'
import PromptDialog from '@/components/erp/PromptDialog'
import { extractErrorMessages } from '@/lib/validation'

const ATT_LABELS: Record<string, string> = {
  present: 'Present', absent: 'Absent', half_day: 'Half day', on_leave: 'On leave', holiday: 'Holiday',
  weekly_off: 'Weekly off', on_duty: 'On duty', work_from_home: 'Work from home',
}
const td: React.CSSProperties = { padding: '10px 14px', fontSize: 13, color: TEXT.body, borderTop: `1px solid ${BORDER.light}`, verticalAlign: 'top' }
const actionBtn = (color: string): React.CSSProperties => ({
  fontSize: 12, fontWeight: 700, padding: '6px 12px', borderRadius: 9999, border: `1px solid ${color}55`,
  background: `${color}14`, color, cursor: 'pointer', marginRight: 6,
})

function dmy(iso: string | null) {
  return iso ? `${iso.slice(8, 10)}-${iso.slice(5, 7)}-${iso.slice(0, 4)}` : '—'
}

// Attendance corrections waiting for the signed-in user's decision.
export default function RegularizationApprovals() {
  const [items, setItems] = useState<HrAttendanceRegularization[]>([])
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState<string[]>([])
  const [notice, setNotice] = useState('')
  const [dialog, setDialog] = useState<{ kind: 'approve' | 'reject'; reg: HrAttendanceRegularization } | null>(null)

  const load = useCallback(() => {
    hrApi.listRegularizationsPendingForMe()
      .then((d) => setItems(d))
      .catch((err) => setError(extractErrorMessages(err, 'Could not load attendance corrections.')))
      .finally(() => setLoaded(true))
  }, [])

  useEffect(() => { load() }, [load])

  const decide = async (value: string) => {
    if (!dialog) return
    const { kind, reg } = dialog
    if (kind === 'reject' && !value.trim()) {
      setError([`Give a reason for rejecting ${reg.request_no} so ${reg.user_name || 'the employee'} knows what to fix.`])
      setDialog(null)
      return
    }
    setDialog(null)
    setError([])
    try {
      if (kind === 'approve') await hrApi.approveRegularization(reg.id, value.trim())
      else await hrApi.rejectRegularization(reg.id, value.trim())
      setNotice(`${reg.request_no} ${kind === 'approve' ? 'approved — the attendance has been corrected' : 'rejected'}.`)
      load()
    } catch (err) {
      setError(extractErrorMessages(err, `${reg.request_no} could not be ${kind === 'approve' ? 'approved' : 'rejected'}.`))
    }
  }

  if (!loaded || (items.length === 0 && error.length === 0 && !notice)) return null

  return (
    <div style={{ marginBottom: 24 }}>
      <h3 style={{ fontSize: 15, fontWeight: 700, color: TEXT.heading, margin: '0 0 10px' }}>
        Attendance corrections <span style={{ fontSize: 12, fontWeight: 700, color: '#F59E0B' }}>· {items.length} pending</span>
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
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 880 }}>
            <thead>
              <tr>
                {['Employee', 'Date', 'Currently', 'Asked for', 'Times', 'Reason', ''].map((h) => (
                  <th key={h} style={{ textAlign: 'left', padding: '10px 14px', fontSize: 11, fontWeight: 600, letterSpacing: '.03em', textTransform: 'uppercase', color: TEXT.muted, position: 'sticky', top: 0, background: '#fdf1e6', zIndex: 1 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {items.map((r) => (
                <tr key={r.id}>
                  <td style={td}>
                    <div style={{ fontWeight: 600, color: TEXT.heading }}>{r.user_name}</div>
                    <div style={{ fontSize: 11.5, color: TEXT.muted }}>{[r.request_no, r.employee_code].filter(Boolean).join(' · ')}</div>
                    {!r.approver_id && <div style={{ fontSize: 11, color: '#B45309', marginTop: 2 }}>No reporting manager — HR decides</div>}
                  </td>
                  <td style={td}>{dmy(r.attendance_date)}</td>
                  <td style={td}>{r.current_status ? ATT_LABELS[r.current_status] || r.current_status : 'Not marked'}</td>
                  <td style={{ ...td, fontWeight: 600 }}>{ATT_LABELS[r.requested_status] || r.requested_status}</td>
                  <td style={td}>{r.check_in_time || '--'} – {r.check_out_time || '--'}</td>
                  <td style={{ ...td, maxWidth: 260 }}>{r.reason}</td>
                  <td style={{ ...td, whiteSpace: 'nowrap' }}>
                    {r.can_decide && (
                      <>
                        <button type="button" style={actionBtn('#16A34A')} onClick={() => { setNotice(''); setDialog({ kind: 'approve', reg: r }) }}>Approve</button>
                        <button type="button" style={actionBtn('#DC2626')} onClick={() => { setNotice(''); setDialog({ kind: 'reject', reg: r }) }}>Reject</button>
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
        title={dialog?.kind === 'approve' ? `Approve ${dialog.reg.request_no}?` : `Reject ${dialog?.reg.request_no}?`}
        message={dialog ? `${dialog.reg.user_name} · ${dmy(dialog.reg.attendance_date)} → ${ATT_LABELS[dialog.reg.requested_status]}.${dialog.kind === 'approve' ? ' The attendance for that day will be overwritten.' : ' A reason is required.'}` : ''}
        placeholder={dialog?.kind === 'approve' ? 'Optional remarks…' : 'Reason for rejecting (required)…'}
        confirmLabel={dialog?.kind === 'approve' ? 'Approve' : 'Reject'}
        danger={dialog?.kind === 'reject'}
        onConfirm={decide}
        onCancel={() => setDialog(null)}
      />
    </div>
  )
}
