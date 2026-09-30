'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { hrApi } from '@/lib/api'
import { HrLifecycleCounts, HrLifecycleEvent, HrLifecycleEventType } from '@/types'
import { TEXT, GLASS, SHADOWS, GRADIENTS, BORDER } from '@/lib/theme'
import { extractErrorMessages } from '@/lib/validation'
import HrNav from '@/components/hr/HrNav'
import MyChecklistTasks from '@/components/hr/lifecycle/MyChecklistTasks'

const TYPE_LABELS: Record<string, string> = { joining: 'Joining', confirmation: 'Confirmation', transfer: 'Transfer', promotion: 'Promotion', exit: 'Exit' }
const TYPE_HEX: Record<string, string> = { joining: '#16A34A', confirmation: '#0891B2', transfer: '#2563EB', promotion: '#7C3AED', exit: '#DC2626' }
const STATUS_LABELS: Record<string, string> = { draft: 'Draft', in_progress: 'In Progress', completed: 'Completed', cancelled: 'Cancelled' }
const STATUS_HEX: Record<string, string> = { draft: '#78716C', in_progress: '#F59E0B', completed: '#16A34A', cancelled: '#DC2626' }
const TYPES: HrLifecycleEventType[] = ['joining', 'confirmation', 'transfer', 'promotion', 'exit']

const inputStyle: React.CSSProperties = {
  padding: '9px 12px', borderRadius: 10, border: `1px solid ${BORDER.normal}`,
  background: 'rgba(255,255,255,.7)', fontSize: 13, outline: 'none', color: TEXT.body,
}
const cardStyle: React.CSSProperties = {
  borderRadius: 16, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur,
  border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), padding: '14px 16px', cursor: 'pointer', textAlign: 'left',
}
const td: React.CSSProperties = { padding: '10px 14px', fontSize: 13, color: TEXT.body, borderTop: `1px solid ${BORDER.light}` }

const fmtDate = (d: string | null) => (d ? d.split('-').reverse().join('-') : '—')

export default function HrLifecyclePage() {
  const { isAuthorized, isLoading } = useRequireApp('hr')
  const router = useRouter()

  const [events, setEvents] = useState<HrLifecycleEvent[]>([])
  const [counts, setCounts] = useState<HrLifecycleCounts | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string[]>([])
  const [search, setSearch] = useState('')
  const [debounced, setDebounced] = useState('')
  const [typeFilter, setTypeFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('open')

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search), 300)
    return () => clearTimeout(t)
  }, [search])

  useEffect(() => {
    if (!isAuthorized) return
    hrApi.getLifecycleCounts().then(setCounts).catch(() => setCounts(null))
  }, [isAuthorized])

  useEffect(() => {
    if (!isAuthorized) return
    setLoading(true)
    setError([])
    const params: Record<string, unknown> = {}
    if (typeFilter) params.event_type = typeFilter
    if (statusFilter === 'open') params.open_only = true
    else if (statusFilter) params.status = statusFilter
    if (debounced.trim()) params.q = debounced.trim()
    hrApi.listLifecycleEvents(params)
      .then((data) => setEvents(Array.isArray(data) ? data : []))
      .catch((err) => setError(extractErrorMessages(err, 'Could not load lifecycle events.')))
      .finally(() => setLoading(false))
  }, [isAuthorized, typeFilter, statusFilter, debounced])

  if (isLoading || !isAuthorized) return null

  return (
    <div>
      <HrNav />

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, marginBottom: 20, flexWrap: 'wrap' }}>
        <div>
          <p style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 4px' }}>
            HR &amp; Administration
          </p>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: TEXT.heading, margin: '0 0 4px' }}>Lifecycle</h1>
          <p style={{ fontSize: 13.5, color: TEXT.muted, margin: 0 }}>Joining, confirmation, transfer, promotion and exit events with their checklists.</p>
        </div>
        <button
          type="button"
          onClick={() => router.push('/dashboard/hr/lifecycle/new')}
          style={{
            padding: '12px 22px', borderRadius: 12, border: 'none', cursor: 'pointer',
            background: GRADIENTS.primary, color: '#fff', fontSize: 14, fontWeight: 600,
            boxShadow: `0 8px 20px ${SHADOWS.glowOrange}`,
          }}
        >
          + New Event
        </button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12, marginBottom: 18 }}>
        {TYPES.map((t) => {
          const active = typeFilter === t
          return (
            <button
              key={t}
              type="button"
              onClick={() => { setTypeFilter(active ? '' : t); setStatusFilter('open') }}
              style={{ ...cardStyle, border: active ? `1px solid ${TYPE_HEX[t]}` : cardStyle.border }}
            >
              <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.04em', textTransform: 'uppercase', color: TYPE_HEX[t] }}>{TYPE_LABELS[t]}</div>
              <div style={{ fontSize: 24, fontWeight: 700, color: TEXT.heading, marginTop: 4 }}>{counts ? counts.open_by_type[t] ?? 0 : '—'}</div>
              <div style={{ fontSize: 11.5, color: TEXT.muted }}>open</div>
            </button>
          )
        })}
      </div>

      <MyChecklistTasks compact />

      {error.length > 0 && (
        <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
          {error.join(' ')}
        </div>
      )}

      <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
        <input
          style={{ ...inputStyle, flex: '1 1 240px', maxWidth: 340 }}
          placeholder="Search event no, employee or candidate…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select style={{ ...inputStyle, flex: '0 1 170px' }} value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
          <option value="">All types</option>
          {TYPES.map((t) => <option key={t} value={t}>{TYPE_LABELS[t]}</option>)}
        </select>
        <select style={{ ...inputStyle, flex: '0 1 170px' }} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="open">Open (draft + in progress)</option>
          <option value="">All statuses</option>
          <option value="draft">Draft</option>
          <option value="in_progress">In Progress</option>
          <option value="completed">Completed</option>
          <option value="cancelled">Cancelled</option>
        </select>
      </div>

      <div style={{
        borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur,
        border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), overflow: 'auto', maxHeight: 'calc(100vh - 320px)',
      }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 940 }}>
          <thead>
            <tr>
              {['Event No', 'Type', 'Employee / Candidate', 'Effective', 'Checklist', 'Status', 'Raised', ''].map((h) => (
                <th key={h} style={{ textAlign: 'left', padding: '10px 14px', fontSize: 11, fontWeight: 600, letterSpacing: '.03em', textTransform: 'uppercase', color: TEXT.muted, position: 'sticky', top: 0, background: '#fdf1e6', zIndex: 1 }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={8} style={{ padding: 20, textAlign: 'center', fontSize: 13, color: TEXT.muted }}>Loading…</td></tr>
            ) : events.length === 0 ? (
              <tr><td colSpan={8} style={{ padding: 20, textAlign: 'center', fontSize: 13, color: TEXT.muted }}>
                {debounced || typeFilter || statusFilter !== 'open' ? 'No lifecycle events match these filters.' : 'No open lifecycle events. Use + New Event to start a joining, transfer or exit.'}
              </td></tr>
            ) : (
              events.map((e) => {
                const done = e.items_total - e.items_pending
                const pct = e.items_total ? Math.round((done / e.items_total) * 100) : 0
                return (
                  <tr key={e.id} onClick={() => router.push(`/dashboard/hr/lifecycle/${e.id}`)} style={{ cursor: 'pointer' }}>
                    <td style={{ ...td, fontWeight: 600, color: TEXT.heading, whiteSpace: 'nowrap' }}>{e.event_no}</td>
                    <td style={td}>
                      <span style={{ fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 9999, background: `${TYPE_HEX[e.event_type]}1a`, color: TYPE_HEX[e.event_type], whiteSpace: 'nowrap' }}>
                        {TYPE_LABELS[e.event_type] || e.event_type}
                      </span>
                    </td>
                    <td style={td}>
                      <div style={{ fontWeight: 600, color: TEXT.heading }}>{e.subject_name || '—'}</div>
                      <div style={{ fontSize: 11.5, color: TEXT.muted }}>
                        {e.employee_code ? `${e.employee_code} · ` : ''}{e.subject_email || ''}
                        {e.event_type === 'joining' && !e.user_id && <span style={{ color: '#B45309', fontWeight: 600 }}> · not linked yet</span>}
                      </div>
                    </td>
                    <td style={{ ...td, whiteSpace: 'nowrap' }}>{fmtDate(e.event_type === 'exit' ? (e.last_working_day || e.effective_date) : e.effective_date)}</td>
                    <td style={{ ...td, minWidth: 130 }}>
                      {e.items_total ? (
                        <>
                          <div style={{ fontSize: 12, color: TEXT.body, marginBottom: 4 }}>{done} / {e.items_total} done</div>
                          <div style={{ height: 5, borderRadius: 9999, background: 'rgba(0,0,0,0.07)', overflow: 'hidden' }}>
                            <div style={{ width: `${pct}%`, height: '100%', background: pct === 100 ? '#16A34A' : '#F59E0B' }} />
                          </div>
                        </>
                      ) : <span style={{ color: TEXT.muted }}>No items</span>}
                    </td>
                    <td style={td}>
                      <span style={{ fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 9999, background: `${STATUS_HEX[e.status]}1a`, color: STATUS_HEX[e.status], whiteSpace: 'nowrap' }}>
                        {STATUS_LABELS[e.status] || e.status}
                      </span>
                    </td>
                    <td style={{ ...td, whiteSpace: 'nowrap' }}>
                      <div>{e.created_at ? fmtDate(e.created_at.slice(0, 10)) : '—'}</div>
                      <div style={{ fontSize: 11.5, color: TEXT.muted }}>{e.created_by_name || ''}</div>
                    </td>
                    <td onClick={(ev) => ev.stopPropagation()} style={td}>
                      <span onClick={() => router.push(`/dashboard/hr/lifecycle/${e.id}`)} style={{ fontSize: 12, fontWeight: 600, color: '#FF6A2A', cursor: 'pointer' }}>View</span>
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
