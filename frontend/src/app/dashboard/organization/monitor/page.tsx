'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRequireOrgTab } from '@/app/dashboard/organization/_lib/useRequireOrgTab'
import { useCan } from '@/lib/permissions'
import OrganizationNav from '@/components/organization/OrganizationNav'
import ConfirmDialog from '@/components/erp/ConfirmDialog'
import { grcApi, monitorApi, DenialRow, DenialSummaryRow, JobRow, JobRunRow, SystemErrorRow } from '@/lib/basisApi'
import { extractErrorMessages } from '@/lib/validation'
import { BORDER, GLASS, SHADOWS, TEXT } from '@/lib/theme'
import { inputStyle, secondaryBtnStyle } from '@/components/shared/ui'
import { FormSheet, SheetIconName, sheetBtn } from '@/components/shared/FormSheet'
import { usePermissionWords } from '@/lib/permissionWords'

// Organization › System Monitor — SAP SM37 (background jobs), SM21/ST22
// (system errors, looked up by the error reference a user reports) and
// SU53 (denied access: why was X refused).

const cardStyle: React.CSSProperties = {
  borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur,
  border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), padding: 18, marginBottom: 16,
}
const th: React.CSSProperties = { textAlign: 'left', padding: '8px 10px', fontSize: 11.5, fontWeight: 700, color: TEXT.secondary, textTransform: 'uppercase', letterSpacing: '.04em', whiteSpace: 'nowrap', position: 'sticky', top: 0, background: '#fdf1e6', zIndex: 1 }
const td: React.CSSProperties = { padding: '9px 10px', fontSize: 12.5, color: TEXT.body, borderTop: `1px solid ${BORDER.light}`, verticalAlign: 'top' }
const STATUS_LABELS: Record<string, string> = { success: 'Success', failed: 'Failed', running: 'Running', skipped: 'Skipped' }
const STATUS_HEX: Record<string, string> = { success: '#16A34A', failed: '#DC2626', running: '#2563EB', skipped: '#78716c' }
const TABS = [{ key: 'jobs', label: 'Background jobs' }, { key: 'errors', label: 'System errors' }, { key: 'denials', label: 'Denied access' }] as const

function fmt(d?: string | null) {
  if (!d) return '—'
  const x = new Date(d)
  return `${x.toLocaleDateString('en-GB')} ${x.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`
}
function Pill({ s }: { s: string }) {
  return <span style={{ fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 9999, background: `${STATUS_HEX[s] || '#78716c'}1a`, color: STATUS_HEX[s] || '#78716c', whiteSpace: 'nowrap' }}>{STATUS_LABELS[s] || s}</span>
}

/** Read-only detail popup (run history, error trace) in the app-wide sheet style. */
function Modal({ icon, title, subtitle, onClose, children }: { icon: SheetIconName; title: string; subtitle: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <FormSheet width={980} icon={icon} title={title} subtitle={subtitle} onClose={onClose} busy={false}
      footer={<button type="button" onClick={onClose} style={sheetBtn('secondary')}>Close</button>}>
      <div style={{ padding: '20px 24px', maxHeight: '70vh', overflow: 'auto' }}>{children}</div>
    </FormSheet>
  )
}

export default function SystemMonitorPage() {
  const { isAuthorized, isLoading } = useRequireOrgTab('monitor')
  const { can } = useCan()
  const canEdit = can('organization', 'monitor', 'edit')
  const [tab, setTab] = useState<(typeof TABS)[number]['key']>('jobs')
  const [jobs, setJobs] = useState<JobRow[]>([])
  const [runsFor, setRunsFor] = useState<JobRow | null>(null)
  const [runs, setRuns] = useState<JobRunRow[]>([])
  const [rerun, setRerun] = useState<JobRow | null>(null)
  const [errors, setErrors] = useState<SystemErrorRow[]>([])
  const [errSummary, setErrSummary] = useState<{ method: string; path: string; exception_type: string; count: number }[]>([])
  const [errQuery, setErrQuery] = useState('')
  const [errDetail, setErrDetail] = useState<SystemErrorRow | null>(null)
  const [denials, setDenials] = useState<DenialRow[]>([])
  const [denialSummary, setDenialSummary] = useState<DenialSummaryRow[]>([])
  const [denialKey, setDenialKey] = useState<string | null>(null)
  const [days, setDays] = useState(7)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const { permLabel } = usePermissionWords()
  const fail = (fallback: string) => (e: unknown) => setError(extractErrorMessages(e, fallback).join(' '))

  const loadJobs = useCallback(() => { monitorApi.jobs().then(setJobs).catch(fail('Could not load background jobs.')) }, [])
  const loadErrors = useCallback(() => {
    monitorApi.errors({ days, q: errQuery.trim() || undefined }).then(setErrors).catch(fail('Could not load system errors.'))
    monitorApi.errorSummary(days).then(setErrSummary).catch(() => {})
  }, [days, errQuery])
  const loadDenials = useCallback(() => {
    grcApi.denials({ days, permission: denialKey || undefined }).then(setDenials).catch(fail('Could not load denied requests.'))
    grcApi.denialSummary(days).then(setDenialSummary).catch(() => {})
  }, [days, denialKey])

  useEffect(() => {
    if (!isAuthorized) return
    if (tab === 'jobs') loadJobs()
    if (tab === 'errors') loadErrors()
    if (tab === 'denials') loadDenials()
  }, [isAuthorized, tab, loadJobs, loadErrors, loadDenials])
  useEffect(() => { if (runsFor) monitorApi.runs(runsFor.job_id).then(setRuns).catch(fail('Could not load the run history.')) }, [runsFor])

  if (isLoading || !isAuthorized) return null

  const doRerun = async () => {
    const j = rerun; setRerun(null)
    if (!j) return
    try {
      await monitorApi.runNow(j.job_id)
      setNotice(`'${j.label}' started. Its run appears in the history when it finishes.`)
      setTimeout(loadJobs, 2500)
    } catch (e) { fail('Could not start the job.')(e) }
  }
  const openError = async (ref: string) => {
    try { setErrDetail(await monitorApi.error(ref)) } catch (e) { fail('Could not open that error.')(e) }
  }

  return (
    <div>
      <OrganizationNav />
      <h1 style={{ fontSize: 22, fontWeight: 700, color: TEXT.heading, margin: '0 0 4px' }}>System Monitor</h1>
      <p style={{ fontSize: 13, color: TEXT.muted, margin: '0 0 16px' }}>Background job runs, server errors (search the reference a user reports) and every refused request with the permission that was missing.</p>
      {error && <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>{error}</div>}
      {notice && <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(22,163,74,0.08)', border: '1px solid rgba(22,163,74,0.2)', color: '#15803d', fontSize: 13 }}>{notice}</div>}
      <ConfirmDialog open={!!rerun} title="Run this job now?" confirmLabel="Run now"
        message={rerun ? `'${rerun.label}' runs once more now. It is safe to repeat — reminders already sent today are not sent again.` : ''}
        onConfirm={doRerun} onCancel={() => setRerun(null)} />

      <div style={{ display: 'flex', gap: 6, marginBottom: 12, flexWrap: 'wrap', alignItems: 'center' }}>
        {TABS.map((t) => (
          <button key={t.key} type="button" onClick={() => { setTab(t.key); setError(''); setNotice('') }} style={{ padding: '7px 14px', borderRadius: 9999, fontSize: 12.5, fontWeight: 700, cursor: 'pointer', border: `1px solid ${tab === t.key ? '#FF7A45' : BORDER.normal}`, background: tab === t.key ? 'rgba(255,122,69,0.1)' : '#fff', color: tab === t.key ? '#c2410c' : TEXT.secondary }}>{t.label}</button>
        ))}
        {tab !== 'jobs' && (
          <select value={days} onChange={(e) => setDays(Number(e.target.value))} style={{ ...inputStyle, width: 130, marginLeft: 'auto' }}>
            <option value={1}>Last 24 hours</option><option value={7}>Last 7 days</option><option value={30}>Last 30 days</option><option value={90}>Last 90 days</option>
          </select>
        )}
      </div>

      {tab === 'jobs' && (
        <div style={{ ...cardStyle, overflow: 'auto', maxHeight: 'calc(100vh - 320px)' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 980 }}>
            <thead><tr><th style={th}>Job</th><th style={th}>Schedule</th><th style={th}>Next run</th><th style={th}>Last run</th><th style={th}>Result</th><th style={th}>Fails (7d)</th><th style={th}></th></tr></thead>
            <tbody>
              {jobs.length === 0 && <tr><td style={td} colSpan={7}>No jobs are registered on this server (the scheduler may not have started).</td></tr>}
              {jobs.map((j) => (
                <tr key={j.job_id} style={{ cursor: 'pointer' }} onClick={() => setRunsFor(j)}>
                  <td style={{ ...td, fontWeight: 600 }}>{j.label}<div style={{ fontSize: 11, color: TEXT.muted, fontWeight: 400, fontFamily: 'monospace' }}>{j.job_id}</div></td>
                  <td style={{ ...td, fontSize: 11.5 }}>{j.schedule || '—'}</td>
                  <td style={{ ...td, whiteSpace: 'nowrap' }}>{fmt(j.next_run_at)}</td>
                  <td style={{ ...td, whiteSpace: 'nowrap' }}>{j.last_run ? <>{fmt(j.last_run.started_at)} <Pill s={j.last_run.status} /></> : 'Never'}</td>
                  <td style={{ ...td, fontSize: 11.5, maxWidth: 260 }}>{j.last_run ? (j.last_run.error ? <span style={{ color: '#b91c1c' }}>{j.last_run.error.split('\n').slice(-2).join(' ').slice(0, 160)}</span> : (j.last_run.result_summary || (j.last_run.rows != null ? `${j.last_run.rows} row(s)` : 'OK'))) : '—'}</td>
                  <td style={{ ...td, color: j.failures_7d ? '#b91c1c' : TEXT.body, fontWeight: j.failures_7d ? 700 : 400 }}>{j.failures_7d}</td>
                  <td style={td} onClick={(e) => e.stopPropagation()}>
                    {canEdit && (j.idempotent
                      ? <button type="button" disabled={j.running} style={{ ...secondaryBtnStyle, padding: '6px 12px', opacity: j.running ? 0.5 : 1 }} onClick={() => setRerun(j)}>{j.running ? 'Running…' : 'Run now'}</button>
                      : <span title="Not safe to repeat by hand — it runs at its next scheduled time" style={{ fontSize: 11, color: TEXT.muted }}>Scheduled only</span>)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'errors' && (
        <>
          {errSummary.length > 0 && (
            <div style={cardStyle}>
              <h2 style={{ fontSize: 14, fontWeight: 700, color: TEXT.heading, margin: '0 0 8px' }}>Most frequent</h2>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {errSummary.slice(0, 8).map((s) => (
                  <span key={`${s.method}${s.path}${s.exception_type}`} style={{ fontSize: 11.5, padding: '6px 10px', borderRadius: 10, border: `1px solid ${BORDER.normal}`, background: '#fff' }}>
                    <b>{s.count}×</b> {s.method} {s.path} <span style={{ color: TEXT.muted }}>{(s.exception_type || '').split('.').pop()}</span>
                  </span>
                ))}
              </div>
            </div>
          )}
          <div style={{ ...cardStyle, overflow: 'auto', maxHeight: 'calc(100vh - 320px)' }}>
            <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
              <input style={{ ...inputStyle, maxWidth: 380 }} placeholder="Error reference, message or exception…" value={errQuery} onChange={(e) => setErrQuery(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') loadErrors() }} />
              <button type="button" style={secondaryBtnStyle} onClick={loadErrors}>Search</button>
            </div>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 940 }}>
              <thead><tr><th style={th}>When</th><th style={th}>Reference</th><th style={th}>Request</th><th style={th}>Error</th><th style={th}>User</th></tr></thead>
              <tbody>
                {errors.length === 0 && <tr><td style={td} colSpan={5}>No server errors in this period.</td></tr>}
                {errors.map((e) => (
                  <tr key={e.id} style={{ cursor: 'pointer' }} onClick={() => openError(e.error_ref)}>
                    <td style={{ ...td, whiteSpace: 'nowrap' }}>{fmt(e.occurred_at)}</td>
                    <td style={{ ...td, fontFamily: 'monospace', fontSize: 11 }}>{e.error_ref}</td>
                    <td style={{ ...td, fontFamily: 'monospace', fontSize: 11.5 }}>{e.method} {e.path}</td>
                    <td style={td}><b>{(e.exception_type || '').split('.').pop()}</b><div style={{ fontSize: 11.5, color: TEXT.muted }}>{(e.message || '').slice(0, 160)}</div></td>
                    <td style={td}>{e.user_name || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {tab === 'denials' && (
        <>
          <div style={cardStyle}>
            <h2 style={{ fontSize: 14, fontWeight: 700, color: TEXT.heading, margin: '0 0 8px' }}>Most refused permissions</h2>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {denialSummary.length === 0 && <span style={{ fontSize: 12.5, color: TEXT.muted }}>Nothing was refused in this period.</span>}
              {denialSummary.slice(0, 12).map((s) => {
                const active = denialKey === s.permission_key
                return (
                  <button key={s.permission_key || 'none'} type="button" onClick={() => setDenialKey(active ? null : s.permission_key)} style={{ fontSize: 11.5, padding: '6px 10px', borderRadius: 10, cursor: 'pointer', border: `1px solid ${active ? '#FF7A45' : BORDER.normal}`, background: active ? 'rgba(255,122,69,0.1)' : '#fff', textAlign: 'left' }}>
                    <b>{s.count}×</b> {s.permission_key ? permLabel(s.permission_key) : (s.permission_label || 'Record-level rule')} <span style={{ color: TEXT.muted }}>· {s.users} user(s)</span>
                  </button>
                )
              })}
            </div>
          </div>
          <div style={{ ...cardStyle, overflow: 'auto', maxHeight: 'calc(100vh - 320px)' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 980 }}>
              <thead><tr><th style={th}>When</th><th style={th}>User</th><th style={th}>Missing permission (why)</th><th style={th}>Request</th><th style={th}>Times</th><th style={th}>Fix: a role that grants it</th></tr></thead>
              <tbody>
                {denials.length === 0 && <tr><td style={td} colSpan={6}>No denied requests.</td></tr>}
                {denials.map((d) => (
                  <tr key={d.id}>
                    <td style={{ ...td, whiteSpace: 'nowrap' }}>{fmt(d.occurred_at)}</td>
                    <td style={{ ...td, fontWeight: 600 }}>{d.user_name || 'Not signed in'}</td>
                    <td style={td}><b>{d.permission_key ? permLabel(d.permission_key) : (d.permission_label || 'Record-level rule')}</b>{!d.permission_key && d.detail && <div style={{ fontSize: 11, color: TEXT.muted }}>{d.detail.slice(0, 180)}</div>}</td>
                    <td style={{ ...td, fontFamily: 'monospace', fontSize: 11.5 }}>{d.method} {d.path}</td>
                    <td style={td}>{d.repeat_count}</td>
                    <td style={td}>{d.granted_by_roles.length ? d.granted_by_roles.map((r) => r.name).join(', ') : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {runsFor && (
        <Modal icon="history" title={`${runsFor.label} — run history`} subtitle={`Background job ${runsFor.job_id}${runsFor.schedule ? ` · ${runsFor.schedule}` : ''}`} onClose={() => setRunsFor(null)}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 760 }}>
            <thead><tr><th style={th}>Started</th><th style={th}>Status</th><th style={th}>Duration</th><th style={th}>Rows</th><th style={th}>By</th><th style={th}>Result / error</th></tr></thead>
            <tbody>
              {runs.length === 0 && <tr><td style={td} colSpan={6}>No runs recorded yet.</td></tr>}
              {runs.map((r) => (
                <tr key={r.id}>
                  <td style={{ ...td, whiteSpace: 'nowrap' }}>{fmt(r.started_at)}</td><td style={td}><Pill s={r.status} /></td>
                  <td style={td}>{r.duration_ms != null ? `${(r.duration_ms / 1000).toFixed(1)} s` : '—'}</td><td style={td}>{r.rows ?? '—'}</td>
                  <td style={td}>{r.triggered_by}</td>
                  <td style={{ ...td, fontSize: 11.5 }}>{r.error ? <pre style={{ whiteSpace: 'pre-wrap', margin: 0, color: '#b91c1c', maxHeight: 180, overflow: 'auto' }}>{r.error}</pre> : (r.result_summary || '—')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Modal>
      )}
      {errDetail && (
        <Modal icon="alert" title={`Error ${errDetail.error_ref}`} subtitle="Server error — full request and stack trace" onClose={() => setErrDetail(null)}>
          <p style={{ fontSize: 13, margin: '0 0 6px' }}><b>{errDetail.method} {errDetail.path}</b>{errDetail.query_string ? `?${errDetail.query_string}` : ''}</p>
          <p style={{ fontSize: 12.5, color: TEXT.secondary, margin: '0 0 10px' }}>{fmt(errDetail.occurred_at)} · {errDetail.user_name || 'Unknown user'} · {errDetail.ip_address || '—'}</p>
          <p style={{ fontSize: 13, fontWeight: 700, margin: '0 0 6px' }}>{errDetail.exception_type}: {errDetail.message}</p>
          <pre style={{ fontSize: 11.5, background: '#1f1108', color: '#fde7d4', padding: 14, borderRadius: 10, overflow: 'auto', maxHeight: '50vh', whiteSpace: 'pre' }}>{errDetail.traceback}</pre>
        </Modal>
      )}
    </div>
  )
}
