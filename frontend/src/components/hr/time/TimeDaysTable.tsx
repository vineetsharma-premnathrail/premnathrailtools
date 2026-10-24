'use client'

import { TEXT, GLASS, SHADOWS, BORDER } from '@/lib/theme'
import { TimeDay, hhmm } from '@/components/hr/safety/types'

const OT_LABELS: Record<string, string> = { pending: 'OT pending', approved: 'OT approved', rejected: 'OT rejected', cancelled: 'OT cancelled' }
const OT_HEX: Record<string, string> = { pending: '#F59E0B', approved: '#16A34A', rejected: '#DC2626', cancelled: '#78716C' }
const STATUS_LABELS: Record<string, string> = {
  present: 'Present', absent: 'Absent', half_day: 'Half day', on_leave: 'On leave', holiday: 'Holiday',
  weekly_off: 'Weekly off', on_duty: 'On duty', work_from_home: 'WFH', unmarked: 'Not marked',
}
const th: React.CSSProperties = { textAlign: 'left', padding: '9px 12px', fontSize: 11, fontWeight: 600, letterSpacing: '.03em', textTransform: 'uppercase', color: TEXT.muted, position: 'sticky', top: 0, background: '#fdf1e6', zIndex: 1, whiteSpace: 'nowrap' }
const td: React.CSSProperties = { padding: '8px 12px', fontSize: 12.5, color: TEXT.body, borderTop: `1px solid ${BORDER.light}`, whiteSpace: 'nowrap' }
const dmy = (iso: string) => `${iso.slice(8, 10)}-${iso.slice(5, 7)}`
const dow = (iso: string) => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][new Date(`${iso}T00:00:00`).getDay()]

/** Day-by-day time evaluation: punches, worked vs planned, short, late,
 *  early and overtime with its approval state. `onClaim` shows a "Claim OT"
 *  link on days with unclaimed overtime (My HR). */
export default function TimeDaysTable({ days, onClaim }: { days: TimeDay[]; onClaim?: (d: TimeDay) => void }) {
  const shown = days.filter((d) => d.status && d.status !== 'unmarked' ? true : d.has_punches)
  return (
    <div style={{ borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur, border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), overflow: 'auto', maxHeight: 'calc(100vh - 320px)' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 900 }}>
        <thead>
          <tr>{['Date', 'Status', 'In – Out', 'Planned', 'Worked', 'Short', 'Late', 'Early', 'Overtime', ''].map((h) => <th key={h} style={th}>{h}</th>)}</tr>
        </thead>
        <tbody>
          {shown.length === 0 ? (
            <tr><td colSpan={10} style={{ ...td, textAlign: 'center', color: TEXT.muted }}>No attendance this month yet.</td></tr>
          ) : shown.map((d) => (
            <tr key={d.date}>
              <td style={{ ...td, fontWeight: 600, color: TEXT.heading }}>{dmy(d.date)} <span style={{ color: TEXT.muted, fontWeight: 400 }}>{dow(d.date)}</span></td>
              <td style={td}>{STATUS_LABELS[d.status || ''] || d.status || '—'}{d.day_kind !== 'working' && d.has_punches ? <span style={{ color: '#7C3AED' }}> · off-day work</span> : null}</td>
              <td style={td}>{d.check_in_time || '--'} – {d.check_out_time || '--'}{d.missing_check_out && <span style={{ color: '#b91c1c' }}> · no check-out</span>}</td>
              <td style={td}>{d.planned_minutes ? hhmm(d.planned_minutes) : '—'}</td>
              <td style={td}>{d.worked_minutes ? hhmm(d.worked_minutes) : '—'}{d.worked_minutes && !d.has_punches ? <span style={{ color: TEXT.muted }}> (assumed)</span> : null}</td>
              <td style={{ ...td, color: d.short_minutes ? '#b91c1c' : TEXT.muted }}>{d.short_minutes ? hhmm(d.short_minutes) : '—'}</td>
              <td style={{ ...td, color: d.late_minutes ? '#B45309' : TEXT.muted }}>{d.late_minutes ? `${d.late_minutes} min` : '—'}</td>
              <td style={{ ...td, color: d.early_minutes ? '#B45309' : TEXT.muted }}>{d.early_minutes ? `${d.early_minutes} min` : '—'}</td>
              <td style={td}>
                {d.ot_minutes ? <b style={{ color: TEXT.heading }}>{hhmm(d.ot_minutes)}</b> : '—'}
                {d.ot_weekly_minutes ? <span style={{ color: TEXT.muted }}> (48 h week)</span> : null}
                {d.ot_status && (
                  <span style={{ marginLeft: 6, fontSize: 11, fontWeight: 700, padding: '3px 8px', borderRadius: 9999, background: `${OT_HEX[d.ot_status]}1a`, color: OT_HEX[d.ot_status] }}>
                    {OT_LABELS[d.ot_status] || d.ot_status}{d.ot_status === 'approved' && d.ot_approved_minutes != null ? ` ${hhmm(d.ot_approved_minutes)}` : ''}
                  </span>
                )}
              </td>
              <td style={td}>
                {onClaim && d.ot_minutes > 0 && (!d.ot_status || d.ot_status === 'cancelled') && (
                  <span onClick={() => onClaim(d)} style={{ fontSize: 12, fontWeight: 600, color: '#FF6A2A', cursor: 'pointer' }}>Claim OT</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
