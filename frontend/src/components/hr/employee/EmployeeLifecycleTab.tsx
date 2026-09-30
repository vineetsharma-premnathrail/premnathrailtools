'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { hrApi } from '@/lib/api'
import { HrLifecycleEvent } from '@/types'
import { TEXT, GLASS, SHADOWS, BORDER } from '@/lib/theme'
import { extractErrorMessages } from '@/lib/validation'

const TYPE_LABELS: Record<string, string> = { joining: 'Joining', confirmation: 'Confirmation', transfer: 'Transfer', promotion: 'Promotion', exit: 'Exit' }
const TYPE_HEX: Record<string, string> = { joining: '#16A34A', confirmation: '#0891B2', transfer: '#2563EB', promotion: '#7C3AED', exit: '#DC2626' }
const STATUS_LABELS: Record<string, string> = { draft: 'Draft', in_progress: 'In Progress', completed: 'Completed', cancelled: 'Cancelled' }
const STATUS_HEX: Record<string, string> = { draft: '#78716C', in_progress: '#F59E0B', completed: '#16A34A', cancelled: '#DC2626' }
const NEW_TYPES = [['transfer', 'Transfer'], ['promotion', 'Promotion'], ['confirmation', 'Confirmation'], ['exit', 'Exit']] as const

const sectionStyle: React.CSSProperties = {
  borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur,
  border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), padding: 20, marginBottom: 20,
}
const badge = (hex: string): React.CSSProperties => ({ fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 9999, background: `${hex}1a`, color: hex, whiteSpace: 'nowrap' })
const fmtDate = (d: string | null) => (d ? d.slice(0, 10).split('-').reverse().join('-') : '—')

function describe(e: HrLifecycleEvent): string {
  if (e.event_type === 'exit') return [e.exit_type?.replace(/_/g, ' '), e.last_working_day ? `last day ${fmtDate(e.last_working_day)}` : null].filter(Boolean).join(' · ')
  const parts: string[] = []
  if (e.to_department_name) parts.push(`${e.from_department_name || '—'} → ${e.to_department_name}`)
  if (e.to_designation_name) parts.push(`${e.from_designation_name || '—'} → ${e.to_designation_name}`)
  if (e.to_grade_name) parts.push(`grade ${e.to_grade_name}`)
  if (e.to_branch_name) parts.push(`plant ${e.to_branch_name}`)
  if (e.to_manager_name) parts.push(`reports to ${e.to_manager_name}`)
  return parts.join(' · ')
}

/** Employee detail > Lifecycle: every joining / move / exit event for this user. */
export default function EmployeeLifecycleTab({ userId }: { userId: number }) {
  const router = useRouter()
  const [events, setEvents] = useState<HrLifecycleEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string[]>([])

  useEffect(() => {
    if (!userId) return
    hrApi.listUserLifecycleEvents(userId)
      .then((d) => setEvents(Array.isArray(d) ? d : []))
      .catch((err) => setError(extractErrorMessages(err, 'Could not load the lifecycle history.')))
      .finally(() => setLoading(false))
  }, [userId])

  const latestExit = events.find((e) => e.event_type === 'exit' && e.status === 'completed')

  return (
    <div style={sectionStyle}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginBottom: 14, flexWrap: 'wrap' }}>
        <h3 style={{ fontSize: 15, fontWeight: 700, color: TEXT.heading, margin: 0 }}>Lifecycle</h3>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {(latestExit ? ([['joining', 'Rehire (joining)']] as const) : NEW_TYPES).map(([t, label]) => (
            <button
              key={t}
              type="button"
              onClick={() => router.push(`/dashboard/hr/lifecycle/new?type=${t}&user_id=${userId}`)}
              style={{ fontSize: 12, fontWeight: 600, padding: '6px 12px', borderRadius: 9999, border: `1px solid ${TYPE_HEX[t]}55`, background: '#fff', color: TYPE_HEX[t], cursor: 'pointer' }}
            >
              + {label}
            </button>
          ))}
        </div>
      </div>

      {error.length > 0 && (
        <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
          {error.join(' ')}
        </div>
      )}

      {loading ? (
        <p style={{ fontSize: 13, color: TEXT.muted, margin: 0 }}>Loading…</p>
      ) : events.length === 0 ? (
        <p style={{ fontSize: 13, color: TEXT.muted, margin: 0 }}>No lifecycle events yet for this employee.</p>
      ) : (
        <div style={{ position: 'relative', paddingLeft: 18 }}>
          <div style={{ position: 'absolute', left: 5, top: 6, bottom: 6, width: 2, background: BORDER.light }} />
          {events.map((e) => (
            <div
              key={e.id}
              onClick={() => router.push(`/dashboard/hr/lifecycle/${e.id}`)}
              style={{ position: 'relative', padding: '10px 12px', marginBottom: 8, borderRadius: 12, border: `1px solid ${BORDER.light}`, background: 'rgba(255,255,255,0.65)', cursor: 'pointer' }}
            >
              <span style={{ position: 'absolute', left: -18, top: 16, width: 12, height: 12, borderRadius: 9999, background: TYPE_HEX[e.event_type], border: '2px solid #fff' }} />
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <span style={badge(TYPE_HEX[e.event_type])}>{TYPE_LABELS[e.event_type]}</span>
                <span style={{ fontSize: 13, fontWeight: 600, color: TEXT.heading }}>{e.event_no}</span>
                <span style={badge(STATUS_HEX[e.status])}>{STATUS_LABELS[e.status]}</span>
                <span style={{ marginLeft: 'auto', fontSize: 12, color: TEXT.muted }}>
                  {e.status === 'completed' && e.completed_at ? `completed ${fmtDate(e.completed_at)}` : `effective ${fmtDate(e.effective_date)}`}
                </span>
              </div>
              {describe(e) && <div style={{ fontSize: 12.5, color: TEXT.body, marginTop: 4 }}>{describe(e)}</div>}
              {(e.status === 'draft' || e.status === 'in_progress') && e.items_total > 0 && (
                <div style={{ fontSize: 11.5, color: TEXT.muted, marginTop: 2 }}>Checklist: {e.items_total - e.items_pending} / {e.items_total} closed</div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
