'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/hooks/useAuth'
import { hrApi } from '@/lib/api'
import { HrDashboard, HrDashboardCount } from '@/types'
import { TEXT, GLASS, SHADOWS, DANGER, WARNING, SUCCESS, INFO, BORDER } from '@/lib/theme'
import { secondaryBtnStyle } from '@/components/shared/ui'
import { extractErrorMessages } from '@/lib/validation'
import HrNav from '@/components/hr/HrNav'

const sectionStyle: React.CSSProperties = {
  borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur,
  border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), padding: 18,
}
const thStyle: React.CSSProperties = {
  textAlign: 'left', fontSize: 10.5, fontWeight: 700, letterSpacing: '.04em', textTransform: 'uppercase',
  color: TEXT.muted, padding: '6px 8px', borderBottom: `1px solid ${BORDER.normal}`, whiteSpace: 'nowrap',
}
const tdStyle: React.CSSProperties = { fontSize: 12.5, color: TEXT.body, padding: '7px 8px', borderBottom: '1px solid rgba(0,0,0,0.04)' }
const linkStyle: React.CSSProperties = { fontSize: 12, fontWeight: 600, color: '#e0521a', textDecoration: 'none', whiteSpace: 'nowrap' }

const EMP_STATUS_LABELS: Record<string, string> = {
  onboarding: 'Onboarding', probation: 'Probation', active: 'Active', notice: 'On notice', no_profile: 'No HR profile',
}
const EMP_STATUS_HEX: Record<string, string> = {
  onboarding: '#0891B2', probation: '#D97706', active: '#16A34A', notice: '#DC2626', no_profile: '#78716C',
}
const EVENT_LABELS: Record<string, string> = { joining: 'Joining', confirmation: 'Confirmation', transfer: 'Transfer', promotion: 'Promotion', exit: 'Exit' }
const EVENT_HEX: Record<string, string> = { joining: '#16A34A', confirmation: '#0891B2', transfer: '#2563EB', promotion: '#7C3AED', exit: '#DC2626' }
const ATT_LABELS: Record<string, string> = {
  present: 'Present', absent: 'Absent', half_day: 'Half day', on_leave: 'On leave', holiday: 'Holiday',
  weekly_off: 'Weekly off', on_duty: 'On duty', work_from_home: 'WFH',
}

type Tone = 'bad' | 'warn' | 'good' | 'info' | 'neutral'

function toneStyle(tone: Tone) {
  if (tone === 'bad') return { background: `${DANGER.primary}14`, border: `1px solid ${DANGER.primary}33`, color: DANGER.primary }
  if (tone === 'warn') return { background: `${WARNING.primary}14`, border: `1px solid ${WARNING.primary}33`, color: WARNING.hover }
  if (tone === 'good') return { background: `${SUCCESS.primary}12`, border: `1px solid ${SUCCESS.primary}30`, color: SUCCESS.primary }
  if (tone === 'info') return { background: `${INFO.primary}10`, border: `1px solid ${INFO.primary}2e`, color: INFO.primary }
  return { background: GLASS.card, border: `1px solid ${GLASS.border}`, color: TEXT.heading }
}

function fmtDate(iso?: string | null) {
  if (!iso) return '—'
  const [y, m, d] = iso.slice(0, 10).split('-')
  return `${d}-${m}-${y}`
}

function fmtTime(iso?: string | null) {
  if (!iso) return '—'
  return new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' })
}

const inr = (n: number) => n.toLocaleString('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 })

function Badge({ label, hex }: { label: string; hex: string }) {
  return (
    <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 9px', borderRadius: 9999, background: `${hex}1a`, color: hex, whiteSpace: 'nowrap' }}>
      {label}
    </span>
  )
}

function Tile({ label, value, sub, tone = 'neutral', href }: { label: string; value: React.ReactNode; sub?: React.ReactNode; tone?: Tone; href?: string }) {
  const t = toneStyle(tone)
  const body = (
    <div style={{
      borderRadius: 18, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur, boxShadow: SHADOWS.glass(),
      padding: 16, background: t.background, border: t.border, height: '100%', boxSizing: 'border-box',
    }}>
      <p style={{ fontSize: 11, fontWeight: 600, letterSpacing: '.04em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 6px' }}>{label}</p>
      <p style={{ fontSize: 26, fontWeight: 700, color: t.color, margin: 0, lineHeight: 1.15 }}>{value}</p>
      {sub && <p style={{ fontSize: 11.5, color: TEXT.muted, margin: '6px 0 0' }}>{sub}</p>}
    </div>
  )
  return href ? <Link href={href} style={{ textDecoration: 'none', display: 'block' }}>{body}</Link> : body
}

function Card({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div style={sectionStyle}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 10 }}>
        <h2 style={{ fontSize: 14.5, fontWeight: 700, color: TEXT.heading, margin: 0 }}>{title}</h2>
        {action}
      </div>
      {children}
    </div>
  )
}

function Empty({ text }: { text: string }) {
  return <p style={{ fontSize: 12.5, color: TEXT.muted, margin: '4px 0' }}>{text}</p>
}

function Bars({ rows, max = 8, labels }: { rows: HrDashboardCount[]; max?: number; labels?: Record<string, string> }) {
  if (!rows.length) return <Empty text="No data yet." />
  const top = Math.max(...rows.map((r) => r.count), 1)
  const shown = rows.slice(0, max)
  const rest = rows.slice(max).reduce((s, r) => s + r.count, 0)
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {shown.map((r) => (
        <div key={r.label} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ flex: '0 0 130px', fontSize: 12, color: TEXT.body, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={labels?.[r.label] || r.label}>
            {labels?.[r.label] || r.label}
          </span>
          <div style={{ flex: 1, height: 8, borderRadius: 9999, background: 'rgba(0,0,0,0.05)', overflow: 'hidden' }}>
            <div style={{ width: `${(r.count / top) * 100}%`, height: '100%', background: '#FF6A2A', borderRadius: 9999 }} />
          </div>
          <span style={{ flex: '0 0 32px', textAlign: 'right', fontSize: 12, fontWeight: 700, color: TEXT.heading }}>{r.count}</span>
        </div>
      ))}
      {rest > 0 && <p style={{ fontSize: 11.5, color: TEXT.muted, margin: '2px 0 0' }}>+ {rest} in {rows.length - max} more</p>}
    </div>
  )
}

function MiniTable({ head, children, empty, colSpan }: { head: string[]; children: React.ReactNode; empty: string | null; colSpan: number }) {
  return (
    <div style={{ overflowX: 'auto', maxHeight: 320, overflowY: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 380 }}>
        <thead>
          <tr>{head.map((h) => <th key={h} style={{ ...thStyle, position: 'sticky', top: 0, background: '#fdf1e6', zIndex: 1 }}>{h}</th>)}</tr>
        </thead>
        <tbody>
          {empty ? <tr><td colSpan={colSpan} style={{ ...tdStyle, color: TEXT.muted }}>{empty}</td></tr> : children}
        </tbody>
      </table>
    </div>
  )
}

function daysLabel(days: number) {
  if (days < 0) return `${-days} day${days === -1 ? '' : 's'} overdue`
  if (days === 0) return 'Today'
  return `in ${days} day${days === 1 ? '' : 's'}`
}

export default function HrDashboardPage() {
  const router = useRouter()
  const { user, isLoading } = useAuth()
  const isHr = !!user?.apps?.includes('hr')

  const [data, setData] = useState<HrDashboard | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string[]>([])

  // The dashboard is an HR-team screen; everyone else lands on My HR.
  useEffect(() => {
    if (!isLoading && user && !isHr) router.replace('/dashboard/hr/me')
  }, [isLoading, user, isHr, router])

  // State is only set in the async callbacks, so the initial load from the
  // effect below doesn't trigger a synchronous re-render.
  const fetchDashboard = useCallback(() => {
    hrApi.getDashboard()
      .then((res) => { setData(res); setError([]) })
      .catch((err) => setError(extractErrorMessages(err, 'Could not load the HR dashboard. Check that the backend is running, then press Refresh.')))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    if (isHr) fetchDashboard()
  }, [isHr, fetchDashboard])

  const load = () => {
    setLoading(true)
    fetchDashboard()
  }

  if (isLoading || !user || !isHr) return null

  const d = data
  const dash = loading && !d ? '…' : '—'
  const a = d?.approvals
  const pendingTotal = a ? a.leave.total + a.regularization.total + a.travel.total + a.expense.total : 0
  const awaitingHr = a ? a.leave.awaiting_hr + a.regularization.awaiting_hr + a.travel.awaiting_hr + a.expense.awaiting_hr : 0
  const att = d?.attendance_today

  return (
    <div>
      <HrNav />

      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
        <div>
          <p style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 4px' }}>
            HR &amp; Administration
          </p>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: TEXT.heading, margin: '0 0 4px' }}>HR Dashboard</h1>
          <p style={{ fontSize: 13.5, color: TEXT.muted, margin: 0 }}>
            {d ? `As of ${fmtDate(d.today)} (IST). ` : ''}Headcount, joiners and leavers, leave and attendance today, pending approvals.
          </p>
        </div>
        <button type="button" onClick={load} disabled={loading} style={{ ...secondaryBtnStyle, opacity: loading ? 0.6 : 1 }}>
          {loading ? 'Refreshing…' : '↻ Refresh'}
        </button>
      </div>

      {error.length > 0 && (
        <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
          {error.join(' ')}
        </div>
      )}

      {d && d.missing_profiles > 0 && (
        <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: `${WARNING.primary}12`, border: `1px solid ${WARNING.primary}33`, color: WARNING.hover, fontSize: 13 }}>
          {d.missing_profiles} of {d.headcount.total} employees have no HR profile yet, so their department, plant, shift and probation are not tracked.{' '}
          <Link href="/dashboard/hr/employees" style={{ color: WARNING.hover, fontWeight: 700 }}>Open Employees and create profiles →</Link>
        </div>
      )}

      {/* KPI tiles */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))', gap: 12, marginBottom: 20 }}>
        <Tile label="Headcount" value={d ? d.headcount.total : dash} sub="Active, not exited" href="/dashboard/hr/employees" />
        <Tile label="Joiners this month" value={d ? d.joiners_count : dash} tone="good" href="/dashboard/hr/lifecycle" />
        <Tile label="Exits this month" value={d ? d.exits_count : dash} tone={d && d.exits_count ? 'bad' : 'neutral'} href="/dashboard/hr/lifecycle" />
        <Tile label="On leave today" value={d ? d.on_leave_today.length : dash} tone="info" href="/dashboard/hr/leave" />
        <Tile
          label="Attendance today"
          value={att ? `${att.present}/${att.headcount}` : dash}
          sub={att ? `${att.absent} absent · ${att.not_marked} not marked` : undefined}
          tone={att && att.not_marked > 0 ? 'warn' : 'neutral'}
          href="/dashboard/hr/attendance"
        />
        <Tile
          label="Pending approvals"
          value={a ? pendingTotal : dash}
          sub={a && awaitingHr ? `${awaitingHr} have no manager — HR decides` : undefined}
          tone={pendingTotal ? 'warn' : 'neutral'}
          href="/dashboard/hr/approvals"
        />
        <Tile label="Open lifecycle events" value={d ? d.lifecycle.total_open : dash} sub={a ? `${a.checklist_items_pending} checklist tasks open` : undefined} href="/dashboard/hr/lifecycle" />
        <Tile label="Assets issued" value={d ? d.assets.issued : dash} sub={d ? `${d.assets.in_stock} in stock · ${d.assets.under_repair} in repair` : undefined} href="/dashboard/hr/assets" />
        <Tile label="Visitors inside" value={d ? d.visitors.inside_now : dash} sub={d ? `${d.visitors.expected_today} more expected today` : undefined} tone="info" href="/dashboard/hr/visitors" />
        <Tile
          label="Documents expiring"
          value={d ? d.documents.expiring_count : dash}
          sub={d ? (d.documents.expired_count ? `${d.documents.expired_count} already expired` : 'Next 30 days') : undefined}
          tone={d && (d.documents.expiring_count || d.documents.expired_count) ? 'warn' : 'neutral'}
        />
        <Tile
          label="Probation ending"
          value={d ? d.probation.count : dash}
          sub={d ? (d.probation.overdue_count ? `${d.probation.overdue_count} past end date` : 'Next 30 days') : undefined}
          tone={d && d.probation.overdue_count ? 'bad' : d && d.probation.count ? 'warn' : 'neutral'}
        />
        <Tile
          label="Claims to pay"
          value={a ? a.claims_to_pay : dash}
          sub={a && a.claims_to_pay ? inr(a.claims_to_pay_amount) : 'Approved, not yet paid'}
          href="/dashboard/hr/travel"
        />
      </div>

      {d && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'flex-start' }}>
          {/* Left column */}
          <div style={{ flex: '1 1 460px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 16 }}>
            <Card title="Pending approvals" action={<Link href="/dashboard/hr/approvals" style={linkStyle}>Open Approvals →</Link>}>
              <MiniTable head={['Type', 'Pending', 'No manager (HR decides)', '']} colSpan={4} empty={null}>
                {([
                  ['Leave', d.approvals.leave, '/dashboard/hr/leave'],
                  ['Attendance corrections', d.approvals.regularization, '/dashboard/hr/attendance'],
                  ['Travel requests', d.approvals.travel, '/dashboard/hr/travel'],
                  ['Expense claims', d.approvals.expense, '/dashboard/hr/travel'],
                ] as const).map(([label, p, href]) => (
                  <tr key={label}>
                    <td style={tdStyle}>{label}</td>
                    <td style={{ ...tdStyle, fontWeight: 700, color: p.total ? WARNING.hover : TEXT.muted }}>{p.total}</td>
                    <td style={{ ...tdStyle, color: p.awaiting_hr ? DANGER.primary : TEXT.muted }}>{p.awaiting_hr}</td>
                    <td style={tdStyle}><Link href={href} style={linkStyle}>View</Link></td>
                  </tr>
                ))}
              </MiniTable>
            </Card>

            <Card title="On leave today" action={<Link href="/dashboard/hr/leave" style={linkStyle}>Leave →</Link>}>
              <MiniTable head={['Employee', 'Type', 'From', 'To']} colSpan={4} empty={d.on_leave_today.length ? null : 'Nobody is on approved leave today.'}>
                {d.on_leave_today.map((l) => (
                  <tr key={l.request_id} onClick={() => router.push(`/dashboard/hr/employees/${l.user_id}`)} style={{ cursor: 'pointer' }}>
                    <td style={tdStyle}>{l.name}{l.half_day && <span style={{ color: TEXT.muted }}> (half day)</span>}</td>
                    <td style={tdStyle} title={l.leave_type_name}>{l.leave_type}</td>
                    <td style={tdStyle}>{fmtDate(l.from_date)}</td>
                    <td style={tdStyle}>{fmtDate(l.to_date)}</td>
                  </tr>
                ))}
              </MiniTable>
            </Card>

            <Card title={`Attendance — ${fmtDate(d.attendance_today.date)}`} action={<Link href="/dashboard/hr/attendance" style={linkStyle}>Register →</Link>}>
              {d.attendance_today.holidays_today.length > 0 && (
                <p style={{ fontSize: 12.5, color: INFO.primary, margin: '0 0 8px' }}>Holiday today: {d.attendance_today.holidays_today.join(', ')}</p>
              )}
              <Bars
                rows={[
                  ...d.attendance_today.by_status,
                  ...(d.attendance_today.not_marked ? [{ label: 'not_marked', count: d.attendance_today.not_marked }] : []),
                ]}
                labels={{ ...ATT_LABELS, not_marked: 'Not marked' }}
                max={10}
              />
            </Card>

            <Card title="Open lifecycle events" action={<Link href="/dashboard/hr/lifecycle" style={linkStyle}>Lifecycle →</Link>}>
              <MiniTable head={['Event', 'Type', 'Employee', 'Due', 'Checklist']} colSpan={5} empty={d.lifecycle.events.length ? null : 'No open joining, transfer, promotion, confirmation or exit events.'}>
                {d.lifecycle.events.map((e) => (
                  <tr key={e.id} onClick={() => router.push(`/dashboard/hr/lifecycle/${e.id}`)} style={{ cursor: 'pointer' }}>
                    <td style={{ ...tdStyle, fontWeight: 600 }}>{e.event_no}</td>
                    <td style={tdStyle}><Badge label={EVENT_LABELS[e.event_type] || e.event_type} hex={EVENT_HEX[e.event_type] || '#78716C'} /></td>
                    <td style={tdStyle}>{e.name || '—'}</td>
                    <td style={tdStyle}>{fmtDate(e.due_date)}</td>
                    <td style={tdStyle}>{e.items_total ? `${e.items_done}/${e.items_total}` : '—'}</td>
                  </tr>
                ))}
              </MiniTable>
            </Card>

            <Card title="Joiners and exits this month">
              <MiniTable
                head={['Employee', 'Movement', 'Date', 'Department']}
                colSpan={4}
                empty={d.joiners_this_month.length || d.exits_this_month.length ? null : 'No joiners or exits dated this month.'}
              >
                {[
                  ...d.joiners_this_month.map((p) => ({ ...p, kind: 'join' as const })),
                  ...d.exits_this_month.map((p) => ({ ...p, kind: 'exit' as const })),
                ].map((p, i) => {
                  const href = p.event_id ? `/dashboard/hr/lifecycle/${p.event_id}` : p.user_id ? `/dashboard/hr/employees/${p.user_id}` : undefined
                  const label = p.kind === 'join' ? (p.pending ? 'Joining (pending)' : 'Joined') : (p.status === 'scheduled' ? 'Exit scheduled' : 'Exited')
                  return (
                    <tr key={`${p.kind}-${p.user_id ?? 'c'}-${p.event_id ?? i}`} onClick={() => href && router.push(href)} style={{ cursor: href ? 'pointer' : 'default' }}>
                      <td style={tdStyle}>{p.name}</td>
                      <td style={tdStyle}><Badge label={label} hex={p.kind === 'join' ? '#16A34A' : '#DC2626'} /></td>
                      <td style={tdStyle}>{fmtDate(p.date)}</td>
                      <td style={tdStyle}>{p.department || '—'}</td>
                    </tr>
                  )
                })}
              </MiniTable>
            </Card>
          </div>

          {/* Right column */}
          <div style={{ flex: '1 1 380px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 16 }}>
            <Card title="Headcount by status" action={<Link href="/dashboard/hr/employees" style={linkStyle}>Employees →</Link>}>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {d.headcount.by_status.length === 0 && <Empty text="No active employees." />}
                {d.headcount.by_status.map((s) => (
                  <span key={s.label} style={{ fontSize: 12, fontWeight: 700, padding: '5px 11px', borderRadius: 9999, background: `${EMP_STATUS_HEX[s.label] || '#78716C'}1a`, color: EMP_STATUS_HEX[s.label] || '#78716C' }}>
                    {EMP_STATUS_LABELS[s.label] || s.label}: {s.count}
                  </span>
                ))}
              </div>
            </Card>

            <Card title="Headcount by department">
              <Bars rows={d.headcount.by_department} />
            </Card>

            <Card title="Headcount by plant">
              <Bars rows={d.headcount.by_branch} />
            </Card>

            <Card title="Probation ending (30 days)">
              <MiniTable head={['Employee', 'Ends', 'When']} colSpan={3} empty={d.probation.items.length ? null : 'No probation periods end in the next 30 days.'}>
                {d.probation.items.map((p) => (
                  <tr key={p.user_id} onClick={() => router.push(`/dashboard/hr/employees/${p.user_id}`)} style={{ cursor: 'pointer' }}>
                    <td style={tdStyle}>{p.name}</td>
                    <td style={tdStyle}>{fmtDate(p.probation_end_date)}</td>
                    <td style={{ ...tdStyle, color: p.days_left < 0 ? DANGER.primary : p.days_left <= 7 ? WARNING.hover : TEXT.body, fontWeight: p.days_left <= 7 ? 700 : 400 }}>{daysLabel(p.days_left)}</td>
                  </tr>
                ))}
              </MiniTable>
              {d.probation.overdue_count > 0 && (
                <p style={{ fontSize: 11.5, color: TEXT.muted, margin: '8px 0 0' }}>
                  Overdue ones are still on probation after their end date. Record a Confirmation under Lifecycle, or extend the end date on the profile.
                </p>
              )}
            </Card>

            <Card title="Documents expiring (30 days)">
              <MiniTable head={['Employee', 'Document', 'Expires']} colSpan={3} empty={d.documents.items.length ? null : 'No employee documents expire in the next 30 days.'}>
                {d.documents.items.map((doc) => (
                  <tr key={doc.document_id} onClick={() => router.push(`/dashboard/hr/employees/${doc.user_id}`)} style={{ cursor: 'pointer' }}>
                    <td style={tdStyle}>{doc.name}</td>
                    <td style={tdStyle}>{doc.document_type} — {doc.document_name}</td>
                    <td style={{ ...tdStyle, color: doc.days_left <= 7 ? DANGER.primary : TEXT.body }}>{fmtDate(doc.expiry_date)} ({daysLabel(doc.days_left)})</td>
                  </tr>
                ))}
              </MiniTable>
              {d.documents.expired_count > 0 && (
                <p style={{ fontSize: 11.5, color: DANGER.primary, margin: '8px 0 0' }}>
                  {d.documents.expired_count} document{d.documents.expired_count === 1 ? ' has' : 's have'} already expired. Open the employee&apos;s Documents tab to upload the renewed copy.
                </p>
              )}
            </Card>

            <Card title="Visitors inside now" action={<Link href="/dashboard/hr/visitors" style={linkStyle}>Visitors →</Link>}>
              <MiniTable head={['Visitor', 'Host', 'In at', 'Badge']} colSpan={4} empty={d.visitors.inside.length ? null : 'No visitors are checked in right now.'}>
                {d.visitors.inside.map((v) => (
                  <tr key={v.id}>
                    <td style={tdStyle}>
                      {v.visitor_name}
                      {v.visitor_company && <span style={{ color: TEXT.muted }}> · {v.visitor_company}</span>}
                      {(v.number_of_persons || 1) > 1 && <span style={{ color: TEXT.muted }}> (+{(v.number_of_persons || 1) - 1})</span>}
                    </td>
                    <td style={tdStyle}>{v.host_name}</td>
                    <td style={tdStyle}>{fmtTime(v.check_in_at)}</td>
                    <td style={tdStyle}>{v.badge_no || '—'}</td>
                  </tr>
                ))}
              </MiniTable>
            </Card>

            <Card title="Assets" action={<Link href="/dashboard/hr/assets" style={linkStyle}>Assets →</Link>}>
              <Bars
                rows={([
                  ['issued', d.assets.issued], ['in_stock', d.assets.in_stock], ['under_repair', d.assets.under_repair],
                  ['lost', d.assets.lost], ['retired', d.assets.retired],
                ] as const).filter(([, c]) => c > 0).map(([label, count]) => ({ label, count }))}
                labels={{ issued: 'Issued', in_stock: 'In stock', under_repair: 'Under repair', lost: 'Lost', retired: 'Retired' }}
              />
              {d.assets.held_by_inactive > 0 && (
                <p style={{ fontSize: 12, color: DANGER.primary, margin: '8px 0 0' }}>
                  {d.assets.held_by_inactive} issued asset{d.assets.held_by_inactive === 1 ? ' is' : 's are'} still held by exited or deactivated employees. Record the return on the asset page.
                </p>
              )}
            </Card>
          </div>
        </div>
      )}
    </div>
  )
}
