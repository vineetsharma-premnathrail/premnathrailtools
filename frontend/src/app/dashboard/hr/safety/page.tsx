'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { useCan } from '@/lib/permissions'
import { hrSafetyApi } from '@/lib/api'
import { TEXT, GLASS, SHADOWS, GRADIENTS, BORDER } from '@/lib/theme'
import { extractErrorMessages } from '@/lib/validation'
import { recordPath } from '@/lib/recordRef'
import HrNav from '@/components/hr/HrNav'
import DateField from '@/components/erp/DateField'
import { secondaryBtnStyle } from '@/components/shared/ui'
import { SafetyIncidentRow, SafetyStats, TYPE_LABELS, downloadBlob } from '@/components/hr/safety/types'

const STATUS_LABELS: Record<string, string> = {
  reported: 'Reported', under_investigation: 'Under investigation', actions_open: 'Actions open',
  closure_pending: 'Closure pending', closed: 'Closed',
}
const STATUS_HEX: Record<string, string> = {
  reported: '#DC2626', under_investigation: '#F59E0B', actions_open: '#2563EB', closure_pending: '#7C3AED', closed: '#16A34A',
}
const SEVERITY_LABELS: Record<string, string> = { low: 'Low', medium: 'Medium', high: 'High', fatal: 'Fatal' }
const SEVERITY_HEX: Record<string, string> = { low: '#16A34A', medium: '#F59E0B', high: '#EA580C', fatal: '#991B1B' }

const inputStyle: React.CSSProperties = {
  padding: '9px 12px', borderRadius: 10, border: `1px solid ${BORDER.normal}`,
  background: 'rgba(255,255,255,.7)', fontSize: 13, outline: 'none', color: TEXT.body,
}
const cardStyle: React.CSSProperties = {
  borderRadius: 16, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur,
  border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), padding: '14px 16px',
}
const tableWrap: React.CSSProperties = {
  borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur,
  border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), overflow: 'auto', maxHeight: 'calc(100vh - 320px)',
}
const th: React.CSSProperties = { textAlign: 'left', padding: '10px 14px', fontSize: 11, fontWeight: 600, letterSpacing: '.03em', textTransform: 'uppercase', color: TEXT.muted, position: 'sticky', top: 0, background: '#fdf1e6', zIndex: 1 }
const td: React.CSSProperties = { padding: '10px 14px', fontSize: 13, color: TEXT.body, borderTop: `1px solid ${BORDER.light}` }
const errorBox: React.CSSProperties = { padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }
const pill = (hex: string): React.CSSProperties => ({ fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 9999, background: `${hex}1a`, color: hex, whiteSpace: 'nowrap' })

const fmtDT = (iso: string) => {
  const d = new Date(iso)
  return `${String(d.getDate()).padStart(2, '0')}-${String(d.getMonth() + 1).padStart(2, '0')}-${d.getFullYear()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}
const fmtD = (iso: string | null) => (iso ? iso.slice(0, 10).split('-').reverse().join('-') : '—')

type MyAction = { id: number; incident_id: number; incident_id_ref?: string; incident_no: string; incident_title: string; description: string; due_date: string; is_overdue: boolean }

export default function HrSafetyPage() {
  const { isAuthorized, isLoading } = useRequireApp('hr')
  const { can } = useCan()
  const router = useRouter()
  const isEhs = can('hr', 'safety', 'view')

  const [view, setView] = useState<'incidents' | 'register'>('incidents')
  const [rows, setRows] = useState<SafetyIncidentRow[]>([])
  const [stats, setStats] = useState<SafetyStats | null>(null)
  const [actions, setActions] = useState<MyAction[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string[]>([])
  const [search, setSearch] = useState('')
  const [debounced, setDebounced] = useState('')
  const [status, setStatus] = useState('open')
  const [type, setType] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [reportableOnly, setReportableOnly] = useState(false)
  const [registerRows, setRegisterRows] = useState<Record<string, unknown>[]>([])

  useEffect(() => { const t = setTimeout(() => setDebounced(search), 300); return () => clearTimeout(t) }, [search])

  useEffect(() => {
    if (!isAuthorized) return
    hrSafetyApi.myActions().then(setActions).catch(() => setActions([]))
  }, [isAuthorized])

  useEffect(() => {
    if (!isAuthorized || !isEhs) return
    const p: Record<string, unknown> = {}
    if (from) p.date_from = from
    if (to) p.date_to = to
    hrSafetyApi.stats(p).then(setStats).catch((err) => setError(extractErrorMessages(err, 'Could not load the safety KPIs.')))
  }, [isAuthorized, isEhs, from, to])

  useEffect(() => {
    if (!isAuthorized) return
    setLoading(true)
    setError([])
    if (!isEhs) {
      hrSafetyApi.mine().then(setRows).catch((err) => setError(extractErrorMessages(err, 'Could not load your incidents.'))).finally(() => setLoading(false))
      return
    }
    const p: Record<string, unknown> = {}
    if (from) p.date_from = from
    if (to) p.date_to = to
    if (view === 'register') {
      if (reportableOnly) p.reportable_only = true
      hrSafetyApi.register(p).then((d) => setRegisterRows(d.items || []))
        .catch((err) => setError(extractErrorMessages(err, 'Could not load the accident register.'))).finally(() => setLoading(false))
      return
    }
    if (status === 'open') p.open_only = true
    else if (status) p.status = status
    if (type) p.incident_type = type
    if (debounced.trim()) p.q = debounced.trim()
    hrSafetyApi.list(p).then(setRows).catch((err) => setError(extractErrorMessages(err, 'Could not load the incidents.'))).finally(() => setLoading(false))
  }, [isAuthorized, isEhs, view, status, type, debounced, from, to, reportableOnly])

  const exportRegister = async () => {
    try {
      const p: Record<string, unknown> = {}
      if (from) p.date_from = from
      if (to) p.date_to = to
      if (reportableOnly) p.reportable_only = true
      downloadBlob(await hrSafetyApi.exportRegister(p), 'accident_register.csv')
    } catch (err) { setError(extractErrorMessages(err, 'The register could not be exported.')) }
  }

  if (isLoading || !isAuthorized) return null

  const kpis: [string, React.ReactNode, string][] = stats ? [
    ['Incidents', stats.total, `${stats.open} open`],
    ['Lost-time injuries', stats.lti, `${stats.lost_days} days lost`],
    ['LTIFR', stats.ltifr ?? '—', `per 10 lakh man-hours (${Math.round(stats.man_hours).toLocaleString('en-IN')} h)`],
    ['Severity rate', stats.severity_rate ?? '—', 'days lost per 10 lakh man-hours'],
    ['Near misses', stats.by_type.near_miss || 0, 'reported'],
    ['Form 18 pending', stats.form18_pending, 'reportable, not yet sent'],
    ['Overdue CAPA', stats.overdue_actions, 'past due date'],
  ] : []

  return (
    <div>
      <HrNav />

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, marginBottom: 20, flexWrap: 'wrap' }}>
        <div>
          <p style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 4px' }}>HR &amp; Administration</p>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: TEXT.heading, margin: '0 0 4px' }}>Safety</h1>
          <p style={{ fontSize: 13.5, color: TEXT.muted, margin: 0, maxWidth: 720 }}>
            {isEhs
              ? 'Accidents, near misses, dangerous occurrences and first-aid cases: investigation, CAPA, Form 18 to the Inspector (Factories Act s.88 / 88A) and closure approval.'
              : 'Report an accident, near miss or unsafe occurrence. Incidents you reported or are involved in, and safety actions assigned to you, are listed here.'}
          </p>
        </div>
        <button type="button" onClick={() => router.push('/dashboard/hr/safety/new')} style={{
          padding: '12px 22px', borderRadius: 12, border: 'none', cursor: 'pointer', background: GRADIENTS.primary,
          color: '#fff', fontSize: 14, fontWeight: 600, boxShadow: `0 8px 20px ${SHADOWS.glowOrange}`,
        }}>+ Report incident</button>
      </div>

      {error.length > 0 && <div style={errorBox}>{error.join(' ')}</div>}

      {actions.length > 0 && (
        <div style={{ ...cardStyle, marginBottom: 18 }}>
          <div style={{ fontSize: 13.5, fontWeight: 700, color: TEXT.heading, marginBottom: 8 }}>Safety actions assigned to you · {actions.length}</div>
          {actions.map((a) => (
            <div key={a.id} onClick={() => router.push(recordPath('/dashboard/hr/safety', a, 'incident_id'))} style={{ display: 'flex', gap: 10, fontSize: 13, padding: '6px 0', cursor: 'pointer', borderTop: `1px solid ${BORDER.light}`, flexWrap: 'wrap' }}>
              <b style={{ color: TEXT.heading }}>{a.incident_no}</b>
              <span style={{ flex: '1 1 260px' }}>{a.description}</span>
              <span style={{ color: a.is_overdue ? '#b91c1c' : TEXT.muted, fontWeight: a.is_overdue ? 700 : 400 }}>Due {fmtD(a.due_date)}{a.is_overdue ? ' · overdue' : ''}</span>
            </div>
          ))}
        </div>
      )}

      {isEhs && stats && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12, marginBottom: 18 }}>
          {kpis.map(([label, value, hint]) => (
            <div key={label} style={cardStyle}>
              <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.04em', textTransform: 'uppercase', color: TEXT.muted }}>{label}</div>
              <div style={{ fontSize: 22, fontWeight: 700, color: TEXT.heading, marginTop: 4 }}>{value}</div>
              <div style={{ fontSize: 11.5, color: TEXT.muted }}>{hint}</div>
            </div>
          ))}
        </div>
      )}

      {isEhs && (
        <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap', alignItems: 'center' }}>
          <div style={{ display: 'flex', gap: 4 }}>
            {(['incidents', 'register'] as const).map((v) => (
              <button key={v} type="button" onClick={() => setView(v)} style={{ ...secondaryBtnStyle, ...(view === v ? { borderColor: '#FF6A2A', color: '#FF6A2A' } : {}) }}>
                {v === 'incidents' ? 'Incidents' : 'Accident register'}
              </button>
            ))}
          </div>
          {view === 'incidents' ? (
            <>
              <input style={{ ...inputStyle, flex: '1 1 220px', maxWidth: 300 }} placeholder="Search number, title or place…" value={search} onChange={(e) => setSearch(e.target.value)} />
              <select style={{ ...inputStyle, flex: '0 1 190px' }} value={status} onChange={(e) => setStatus(e.target.value)}>
                <option value="open">Open (not closed)</option>
                <option value="">All statuses</option>
                {Object.entries(STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
              <select style={{ ...inputStyle, flex: '0 1 200px' }} value={type} onChange={(e) => setType(e.target.value)}>
                <option value="">All types</option>
                {Object.entries(TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </>
          ) : (
            <>
              <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 13, color: TEXT.body }}>
                <input type="checkbox" checked={reportableOnly} onChange={(e) => setReportableOnly(e.target.checked)} /> Reportable only (Form 18)
              </label>
              {can('hr', 'safety', 'export') && <button type="button" style={secondaryBtnStyle} onClick={exportRegister}>Export CSV</button>}
            </>
          )}
          <div style={{ flex: '0 1 150px' }}><DateField value={from} onChange={setFrom} placeholder="From" /></div>
          <div style={{ flex: '0 1 150px' }}><DateField value={to} onChange={setTo} placeholder="To" /></div>
        </div>
      )}

      {view === 'register' && isEhs ? (
        <div style={tableWrap}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 1100 }}>
            <thead><tr>{['No.', 'Date & time', 'Plant / place', 'Type', 'Persons injured', 'Injury', 'Days lost', 'Form 18', 'Status', ''].map((h) => <th key={h} style={th}>{h}</th>)}</tr></thead>
            <tbody>
              {loading ? <tr><td colSpan={10} style={{ ...td, textAlign: 'center', color: TEXT.muted }}>Loading…</td></tr>
                : registerRows.length === 0 ? <tr><td colSpan={10} style={{ ...td, textAlign: 'center', color: TEXT.muted }}>No incidents in this period.</td></tr>
                  : registerRows.map((r) => (
                    <tr key={String(r.id)} onClick={() => router.push(recordPath('/dashboard/hr/safety', r))} style={{ cursor: 'pointer' }}>
                      <td style={{ ...td, fontWeight: 600, color: TEXT.heading, whiteSpace: 'nowrap' }}>{String(r.incident_no)}</td>
                      <td style={{ ...td, whiteSpace: 'nowrap' }}>{fmtDT(String(r.occurred_at))}</td>
                      <td style={td}>{[r.branch_name, r.location_text].filter(Boolean).join(' · ') || '—'}</td>
                      <td style={td}>{TYPE_LABELS[String(r.incident_type)] || String(r.incident_type)}</td>
                      <td style={td}>{String(r.persons || '—')}</td>
                      <td style={td}>{String(r.injuries || '—')}</td>
                      <td style={td}>{String(r.lost_days)}</td>
                      <td style={td}>{r.reportable ? (r.form18_submitted_on ? `Sent ${fmtD(String(r.form18_submitted_on))}` : <span style={{ color: '#b91c1c', fontWeight: 700 }}>Due</span>) : 'Not reportable'}</td>
                      <td style={td}><span style={pill(STATUS_HEX[String(r.status)] || '#78716C')}>{STATUS_LABELS[String(r.status)] || String(r.status)}</span></td>
                      <td style={td} onClick={(e) => e.stopPropagation()}><span onClick={() => router.push(recordPath('/dashboard/hr/safety', r))} style={{ fontSize: 12, fontWeight: 600, color: '#FF6A2A', cursor: 'pointer' }}>View</span></td>
                    </tr>
                  ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div style={tableWrap}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 1000 }}>
            <thead><tr>{['No.', 'Incident', 'Type', 'Severity', 'Happened', 'Injured / lost days', 'CAPA', 'Status', ''].map((h) => <th key={h} style={th}>{h}</th>)}</tr></thead>
            <tbody>
              {loading ? <tr><td colSpan={9} style={{ ...td, textAlign: 'center', color: TEXT.muted }}>Loading…</td></tr>
                : rows.length === 0 ? <tr><td colSpan={9} style={{ ...td, textAlign: 'center', color: TEXT.muted }}>{isEhs ? 'No incidents match these filters.' : 'You have not reported or been involved in any incident.'}</td></tr>
                  : rows.map((r) => (
                    <tr key={r.id} onClick={() => router.push(recordPath('/dashboard/hr/safety', r))} style={{ cursor: 'pointer' }}>
                      <td style={{ ...td, fontWeight: 600, color: TEXT.heading, whiteSpace: 'nowrap' }}>{r.incident_no}</td>
                      <td style={td}>
                        <div style={{ fontWeight: 600, color: TEXT.heading }}>{r.title}</div>
                        <div style={{ fontSize: 11.5, color: TEXT.muted }}>{[r.branch_name, r.location_text].filter(Boolean).join(' · ')}</div>
                      </td>
                      <td style={td}>{TYPE_LABELS[r.incident_type] || r.incident_type}{r.reportable && <div style={{ fontSize: 11, color: r.form18_submitted_on ? TEXT.muted : '#b91c1c', fontWeight: 600 }}>{r.form18_submitted_on ? 'Form 18 sent' : 'Form 18 due'}</div>}</td>
                      <td style={td}><span style={pill(SEVERITY_HEX[r.severity])}>{SEVERITY_LABELS[r.severity] || r.severity}</span></td>
                      <td style={{ ...td, whiteSpace: 'nowrap' }}>{fmtDT(r.occurred_at)}</td>
                      <td style={td}>{r.injured_count} / {r.lost_days}{r.lti_count ? <span style={{ color: '#b91c1c', fontWeight: 700 }}> · LTI</span> : null}</td>
                      <td style={td}>{r.open_actions ? `${r.open_actions} open` : '—'}{r.overdue_actions ? <span style={{ color: '#b91c1c', fontWeight: 700 }}> · {r.overdue_actions} overdue</span> : null}</td>
                      <td style={td}><span style={pill(STATUS_HEX[r.status] || '#78716C')}>{STATUS_LABELS[r.status] || r.status}</span></td>
                      <td style={td} onClick={(e) => e.stopPropagation()}><span onClick={() => router.push(recordPath('/dashboard/hr/safety', r))} style={{ fontSize: 12, fontWeight: 600, color: '#FF6A2A', cursor: 'pointer' }}>View</span></td>
                    </tr>
                  ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
