'use client'

import { HrAttendanceCounts, HrAttendanceDay } from '@/types'
import { TEXT, BORDER, GLASS, SHADOWS } from '@/lib/theme'

// Month grid of attendance statuses, shared by My Attendance, the HR month
// view and the employee-detail Attendance tab. Days without a stored row show
// a computed status (holiday / weekly off / not marked) in a lighter style.
const STATUS_LABELS: Record<string, string> = {
  present: 'Present', absent: 'Absent', half_day: 'Half day', on_leave: 'On leave', holiday: 'Holiday',
  weekly_off: 'Weekly off', on_duty: 'On duty', work_from_home: 'WFH', unmarked: 'Not marked',
}
const STATUS_HEX: Record<string, string> = {
  present: '#16A34A', absent: '#DC2626', half_day: '#F59E0B', on_leave: '#7C3AED', holiday: '#0EA5E9',
  weekly_off: '#94A3B8', on_duty: '#2563EB', work_from_home: '#0D9488', unmarked: '#CBD5E1',
}
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

export const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

export function AttendanceLegend({ counts }: { counts?: HrAttendanceCounts | null }) {
  const keys = ['present', 'half_day', 'absent', 'on_leave', 'on_duty', 'work_from_home', 'holiday', 'weekly_off', 'unmarked'] as const
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
      {keys.map((k) => (
        <span key={k} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11.5, fontWeight: 600, padding: '4px 10px', borderRadius: 9999, background: `${STATUS_HEX[k]}1a`, color: k === 'unmarked' ? TEXT.muted : STATUS_HEX[k] }}>
          <span style={{ width: 8, height: 8, borderRadius: 9999, background: STATUS_HEX[k] }} />
          {STATUS_LABELS[k]}{counts ? ` · ${counts[k]}` : ''}
        </span>
      ))}
      {counts && counts.late_days > 0 && (
        <span style={{ fontSize: 11.5, fontWeight: 600, padding: '4px 10px', borderRadius: 9999, background: '#DC26261a', color: '#DC2626' }}>
          Late · {counts.late_days}
        </span>
      )}
    </div>
  )
}

export default function AttendanceCalendar({
  year,
  month,
  days,
  onDayClick,
  selectedDate,
}: {
  year: number
  month: number
  days: HrAttendanceDay[]
  onDayClick?: (day: HrAttendanceDay) => void
  selectedDate?: string | null
}) {
  const first = new Date(year, month - 1, 1)
  const offset = (first.getDay() + 6) % 7 // Monday-first grid
  const cells: (HrAttendanceDay | null)[] = [...Array(offset).fill(null), ...days]
  while (cells.length % 7 !== 0) cells.push(null)
  const todayIso = (() => {
    const t = new Date()
    return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`
  })()

  return (
    <div style={{ borderRadius: 16, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur, border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), padding: 14, overflowX: 'auto' }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(84px, 1fr))', gap: 6, minWidth: 620 }}>
        {WEEKDAYS.map((w) => (
          <div key={w} style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.04em', textTransform: 'uppercase', color: TEXT.muted, padding: '2px 6px' }}>{w}</div>
        ))}
        {cells.map((d, i) => {
          if (!d) return <div key={`e${i}`} />
          const status = d.status || ''
          const hex = STATUS_HEX[status] || '#E2E8F0'
          const dayNum = Number(d.date.slice(8, 10))
          const isToday = d.date === todayIso
          const isSelected = selectedDate === d.date
          const clickable = !!onDayClick
          return (
            <div
              key={d.date}
              onClick={clickable ? () => onDayClick?.(d) : undefined}
              title={[STATUS_LABELS[status] || 'Upcoming', d.holiday_name, d.remarks].filter(Boolean).join(' — ')}
              style={{
                minHeight: 72, borderRadius: 12, padding: '6px 8px', cursor: clickable ? 'pointer' : 'default',
                background: status ? `${hex}${d.computed ? '12' : '22'}` : 'rgba(255,255,255,.45)',
                border: isSelected ? '2px solid #FF6A2A' : isToday ? `2px solid ${TEXT.secondary}` : `1px solid ${d.computed ? BORDER.light : `${hex}55`}`,
                display: 'flex', flexDirection: 'column', gap: 3, boxSizing: 'border-box',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: TEXT.heading }}>{dayNum}</span>
                {d.late_minutes != null && d.late_minutes > 0 && (
                  <span style={{ fontSize: 9.5, fontWeight: 700, color: '#DC2626' }}>+{d.late_minutes}m</span>
                )}
              </div>
              {status && (
                <span style={{ fontSize: 10.5, fontWeight: 700, color: status === 'unmarked' ? TEXT.muted : hex, lineHeight: 1.2 }}>
                  {STATUS_LABELS[status] || status}
                </span>
              )}
              {d.holiday_name && <span style={{ fontSize: 10, color: TEXT.muted, lineHeight: 1.2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.holiday_name}</span>}
              {(d.check_in_time || d.check_out_time) && (
                <span style={{ fontSize: 10, color: TEXT.secondary }}>{d.check_in_time || '--'} – {d.check_out_time || '--'}</span>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

export function MonthPicker({ year, month, onChange }: { year: number; month: number; onChange: (y: number, m: number) => void }) {
  const btn: React.CSSProperties = { padding: '7px 12px', borderRadius: 10, border: `1px solid ${BORDER.normal}`, background: 'rgba(255,255,255,.7)', cursor: 'pointer', fontSize: 13, fontWeight: 700, color: TEXT.secondary }
  const prev = () => (month === 1 ? onChange(year - 1, 12) : onChange(year, month - 1))
  const next = () => (month === 12 ? onChange(year + 1, 1) : onChange(year, month + 1))
  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
      <button type="button" style={btn} onClick={prev} aria-label="Previous month">‹</button>
      <span style={{ fontSize: 14, fontWeight: 700, color: TEXT.heading, minWidth: 140, textAlign: 'center' }}>{MONTH_NAMES[month - 1]} {year}</span>
      <button type="button" style={btn} onClick={next} aria-label="Next month">›</button>
    </div>
  )
}
