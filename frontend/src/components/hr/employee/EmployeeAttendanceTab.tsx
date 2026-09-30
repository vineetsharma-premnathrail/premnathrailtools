'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { hrApi } from '@/lib/api'
import { HrAttendanceMonth } from '@/types'
import { TEXT, GLASS, SHADOWS } from '@/lib/theme'
import AttendanceCalendar, { AttendanceLegend, MonthPicker } from '@/components/hr/attendance/AttendanceCalendar'
import { extractErrorMessages } from '@/lib/validation'

const sectionStyle: React.CSSProperties = {
  borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur,
  border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), padding: 20, marginBottom: 20,
}

// One employee's attendance month (HR employee detail). Editing happens on
// the HR Attendance page's "Employee month" tab.
export default function EmployeeAttendanceTab({ userId }: { userId: number }) {
  const now = new Date()
  const [year, setYear] = useState(now.getFullYear())
  const [month, setMonth] = useState(now.getMonth() + 1)
  const [data, setData] = useState<HrAttendanceMonth | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string[]>([])

  useEffect(() => {
    setLoading(true)
    hrApi.getEmployeeAttendanceMonth(userId, year, month)
      .then((d) => { setData(d); setError([]) })
      .catch((err) => setError(extractErrorMessages(err, "Could not load this employee's attendance.")))
      .finally(() => setLoading(false))
  }, [userId, year, month])

  return (
    <div style={sectionStyle}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginBottom: 12, flexWrap: 'wrap' }}>
        <h3 style={{ fontSize: 15, fontWeight: 700, color: TEXT.heading, margin: 0 }}>
          Attendance{data?.shift_name ? <span style={{ fontSize: 12.5, fontWeight: 500, color: TEXT.muted }}> · {data.shift_name}</span> : null}
        </h3>
        <div style={{ display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap' }}>
          <MonthPicker year={year} month={month} onChange={(y, m) => { setYear(y); setMonth(m) }} />
          <Link href="/dashboard/hr/attendance" style={{ fontSize: 12.5, fontWeight: 600, color: '#E85A1F', textDecoration: 'none' }}>Mark / correct →</Link>
        </div>
      </div>

      {error.length > 0 && (
        <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
          {error.join(' ')}
        </div>
      )}

      {loading && !data ? (
        <p style={{ fontSize: 13, color: TEXT.muted, margin: 0 }}>Loading…</p>
      ) : data ? (
        <>
          <div style={{ marginBottom: 12 }}><AttendanceLegend counts={data.counts} /></div>
          <AttendanceCalendar year={year} month={month} days={data.days} />
        </>
      ) : null}
    </div>
  )
}
