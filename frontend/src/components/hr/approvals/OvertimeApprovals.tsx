'use client'

import { useCallback, useEffect, useState } from 'react'
import { hrTimeApi } from '@/lib/api'
import { TEXT, GLASS, SHADOWS, BORDER } from '@/lib/theme'
import PromptDialog from '@/components/erp/PromptDialog'
import { extractErrorMessages } from '@/lib/validation'
import { OvertimeRequest, hhmm } from '@/components/hr/safety/types'

const td: React.CSSProperties = { padding: '10px 14px', fontSize: 13, color: TEXT.body, borderTop: `1px solid ${BORDER.light}`, verticalAlign: 'top' }
const actionBtn = (color: string): React.CSSProperties => ({
  fontSize: 12, fontWeight: 700, padding: '6px 12px', borderRadius: 9999, border: `1px solid ${color}55`,
  background: `${color}14`, color, cursor: 'pointer', marginRight: 6,
})
const dmy = (iso: string) => `${iso.slice(8, 10)}-${iso.slice(5, 7)}-${iso.slice(0, 4)}`

// Overtime claims waiting for the signed-in user's decision (central engine, hr.overtime).
export default function OvertimeApprovals() {
  const [items, setItems] = useState<OvertimeRequest[]>([])
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState<string[]>([])
  const [notice, setNotice] = useState('')
  const [dialog, setDialog] = useState<{ kind: 'approve' | 'reject'; ot: OvertimeRequest } | null>(null)
  const [minutes, setMinutes] = useState<Record<number, string>>({})

  const load = useCallback(() => {
    hrTimeApi.overtimePendingForMe()
      .then(setItems)
      .catch((err) => setError(extractErrorMessages(err, 'Could not load overtime claims.')))
      .finally(() => setLoaded(true))
  }, [])
  useEffect(() => { load() }, [load])

  const decide = async (value: string) => {
    if (!dialog) return
    const { kind, ot } = dialog
    setDialog(null)
    setError([])
    try {
      if (kind === 'approve') {
        const m = minutes[ot.id] ? Number(minutes[ot.id]) : undefined
        await hrTimeApi.approveOvertime(ot.id, { remarks: value.trim() || null, approved_minutes: m && m !== ot.claimed_minutes ? m : null })
      } else {
        await hrTimeApi.rejectOvertime(ot.id, value.trim())
      }
      setNotice(`${ot.request_no} ${kind === 'approve' ? 'approved' : 'rejected'}.`)
      load()
    } catch (err) {
      setError(extractErrorMessages(err, `${ot.request_no} could not be ${kind === 'approve' ? 'approved' : 'rejected'}.`))
    }
  }

  if (!loaded || (items.length === 0 && error.length === 0 && !notice)) return null

  return (
    <div style={{ marginBottom: 24 }}>
      <h3 style={{ fontSize: 15, fontWeight: 700, color: TEXT.heading, margin: '0 0 10px' }}>
        Overtime <span style={{ fontSize: 12, fontWeight: 700, color: '#F59E0B' }}>· {items.length} pending</span>
      </h3>
      {error.length > 0 && <div style={{ padding: '10px 14px', marginBottom: 12, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>{error.join(' ')}</div>}
      {notice && <div style={{ padding: '10px 14px', marginBottom: 12, borderRadius: 10, background: 'rgba(22,163,74,0.08)', border: '1px solid rgba(22,163,74,0.25)', color: '#166534', fontSize: 13 }}>{notice}</div>}
      {items.length > 0 && (
        <div style={{ borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur, border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), overflow: 'auto', maxHeight: 'calc(100vh - 320px)' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 900 }}>
            <thead>
              <tr>
                {['Employee', 'Date', 'In – Out', 'Worked', 'OT claimed', 'Approve (min)', 'Reason', ''].map((h) => (
                  <th key={h} style={{ textAlign: 'left', padding: '10px 14px', fontSize: 11, fontWeight: 600, letterSpacing: '.03em', textTransform: 'uppercase', color: TEXT.muted, position: 'sticky', top: 0, background: '#fdf1e6', zIndex: 1 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {items.map((o) => (
                <tr key={o.id}>
                  <td style={td}>
                    <div style={{ fontWeight: 600, color: TEXT.heading }}>{o.user_name}</div>
                    <div style={{ fontSize: 11.5, color: TEXT.muted }}>{[o.request_no, o.employee_code].filter(Boolean).join(' · ')}</div>
                  </td>
                  <td style={td}>{dmy(o.work_date)}</td>
                  <td style={td}>{o.check_in_time || '--'} – {o.check_out_time || '--'}</td>
                  <td style={td}>{o.worked_minutes != null ? hhmm(o.worked_minutes) : '—'}</td>
                  <td style={{ ...td, fontWeight: 700 }}>
                    {hhmm(o.claimed_minutes)}
                    {o.current_ot_minutes != null && o.current_ot_minutes !== o.claimed_minutes && (
                      <div style={{ fontSize: 11, color: '#B45309', fontWeight: 600 }}>Punches now give {hhmm(o.current_ot_minutes)}</div>
                    )}
                  </td>
                  <td style={td}>
                    {o.can_decide && <input value={minutes[o.id] ?? String(o.claimed_minutes)} onChange={(e) => setMinutes({ ...minutes, [o.id]: e.target.value.replace(/\D/g, '').slice(0, 4) })} style={{ width: 70, padding: '6px 8px', borderRadius: 8, border: `1px solid ${BORDER.normal}`, fontSize: 12.5 }} />}
                  </td>
                  <td style={{ ...td, maxWidth: 240 }}>{o.reason}</td>
                  <td style={{ ...td, whiteSpace: 'nowrap' }}>
                    {o.can_decide && (
                      <>
                        <button type="button" style={actionBtn('#16A34A')} onClick={() => { setNotice(''); setDialog({ kind: 'approve', ot: o }) }}>Approve</button>
                        <button type="button" style={actionBtn('#DC2626')} onClick={() => { setNotice(''); setDialog({ kind: 'reject', ot: o }) }}>Reject</button>
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
        title={dialog?.kind === 'approve' ? `Approve ${dialog.ot.request_no}?` : `Reject ${dialog?.ot.request_no}?`}
        message={dialog ? `${dialog.ot.user_name} · ${dmy(dialog.ot.work_date)}. ${dialog.kind === 'approve' ? 'Approving fewer minutes than claimed needs a reason.' : 'A reason is required.'}` : ''}
        placeholder={dialog?.kind === 'approve' ? 'Remarks…' : 'Reason for rejecting (required)…'}
        confirmLabel={dialog?.kind === 'approve' ? 'Approve' : 'Reject'}
        danger={dialog?.kind === 'reject'}
        requireValue={dialog?.kind === 'reject'}
        onConfirm={decide}
        onCancel={() => setDialog(null)}
      />
    </div>
  )
}
