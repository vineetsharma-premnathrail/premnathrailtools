'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRequireApp } from '@/hooks/useAuth'
import { designApi } from '@/lib/api'
import { DesignLookupOption, DesignReportSummary } from '@/types'
import { TEXT, GLASS, SHADOWS, GRADIENTS, BORDER } from '@/lib/theme'
import DesignNav from '@/components/design/DesignNav'
import { useDesignMe } from '@/components/design/useDesignMe'
import { openAttachmentBlob } from '@/hooks/useAttachmentBlobUrl'
import SearchableSelect from '@/components/erp/SearchableSelect'
import {
  DOC_TYPE_LABELS, DISCIPLINE_LABELS, ECR_STATUS_LABELS, ECN_STATUS_LABELS, ECR_SOURCE_LABELS, ECN_REASON_LABELS,
  SUBMISSION_STATUS_LABELS, TEAM_ROLE_LABELS, toOptions,
} from '@/components/design/designMeta'
import { extractErrorMessages } from '@/lib/validation'
import { formatDate } from '@/lib/format'

// Phase-4 report payloads (the API returns untyped JSON — shapes mirror
// backend app/modules/design/routes/insights.py).
interface CustomerApprovalsReport {
  avg_turnaround_days: number | null
  customers: { customer_name: string; submissions: number; drawings: number; approved: number; rejected: number; avg_turnaround_days: number | null }[]
  submissions: {
    id: number; submission_number: string; customer_name: string; status: string; sent_date: string | null; response_date: string | null
    turnaround_days: number | null; days_waiting: number | null; overdue: boolean; drawings: number; rejected: number
  }[]
}
interface ChangeRegisterReport {
  rows: {
    ecr_id: number | null; ecr_number: string | null; title: string; source: string | null; urgency: string | null; ecr_status: string | null
    raised_at: string | null; decided_at: string | null; ecn_id: number | null; ecn_number: string | null; ecn_status: string | null
    released_at: string | null; closed_at: string | null; days_to_decision: number | null; days_to_release: number | null
  }[]
  avg_days_to_release: number | null
  open_ecrs: number
}
interface MilestoneReport {
  rows: { milestone_id: number; title: string; status: string; target_date: string | null; actual_date: string | null; project: string | null; overdue: boolean; slip_days: number }[]
  note?: string
}
interface WorkloadReport {
  rows: { user_id: number; name: string | null; role: string; open: number; overdue: number; done: number; on_time: number; on_time_pct: number | null }[]
  note?: string
}
interface FirstTimeRightReport {
  customer_drawings_released: number; customer_first_time_right: number; customer_ftr_pct: number | null
  revisions_released: number; internal_first_time_right: number; internal_ftr_pct: number | null
}
interface RevisionHistoryReport {
  doc_number: string; title: string
  revisions: {
    revision_label: string; status: string; change_summary: string | null; author: string | null; checked_by: string | null; approved_by: string | null
    created_at: string | null; released_at: string | null; superseded_at: string | null; returns: number; cycle_days: number | null
  }[]
}

const STATUS_LABELS: Record<string, string> = {
  draft: 'Draft', in_review: 'In Review', in_approval: 'In Approval', released: 'Released', revising: 'Released · Revising', obsolete: 'Obsolete',
}

const cardStyle: React.CSSProperties = {
  borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur,
  border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), padding: 18,
}
const sectionTitle: React.CSSProperties = { fontSize: 12, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.secondary, margin: '0 0 12px' }
const inputStyle: React.CSSProperties = {
  padding: '9px 12px', borderRadius: 10, border: `1px solid ${BORDER.normal}`,
  background: 'rgba(255,255,255,.7)', fontSize: 13, outline: 'none', color: TEXT.body,
}
const tdStyle: React.CSSProperties = { padding: '7px 0', fontSize: 13, color: TEXT.body, borderTop: `1px solid ${BORDER.light}` }
const thStyle: React.CSSProperties = { textAlign: 'left', padding: '8px 10px', fontSize: 11, fontWeight: 600, letterSpacing: '.03em', textTransform: 'uppercase', color: TEXT.muted, background: '#fdf1e6', whiteSpace: 'nowrap', position: 'sticky', top: 0, zIndex: 1 }
const gtd: React.CSSProperties = { padding: '8px 10px', fontSize: 12.5, color: TEXT.body, borderTop: `1px solid ${BORDER.light}`, verticalAlign: 'top' }
const scrollBox: React.CSSProperties = { overflow: 'auto', maxHeight: 420, borderRadius: 12, border: `1px solid ${BORDER.light}` }
const mutedP: React.CSSProperties = { fontSize: 13, color: TEXT.muted, margin: 0 }

const REV_STATUS_LABELS: Record<string, string> = {
  draft: 'Draft', in_review: 'In Review', in_approval: 'In Approval', approved: 'Approved · awaiting customer', customer_rejected: 'Customer rejected',
  released: 'Released', superseded: 'Superseded',
}
const REV_STATUS_HEX: Record<string, string> = {
  draft: '#78716c', in_review: '#2563EB', in_approval: '#7C3AED', approved: '#0f766e', customer_rejected: '#DC2626', released: '#16A34A', superseded: '#a8a29e',
}
const SUB_HEX: Record<string, string> = { draft: '#78716c', sent: '#2563EB', closed: '#16A34A', cancelled: '#a8a29e' }
const ECR_HEX: Record<string, string> = { open: '#D97706', impact_checked: '#7C3AED', approved: '#16A34A', rejected: '#DC2626', deferred: '#78716c', withdrawn: '#a8a29e' }
const ECN_HEX: Record<string, string> = { draft: '#78716c', submitted: '#7C3AED', approved: '#2563EB', implemented: '#16A34A', closed: '#0f766e', rejected: '#DC2626', cancelled: '#a8a29e' }
const MS_LABELS: Record<string, string> = { not_started: 'Not started', in_progress: 'In progress', submitted: 'Submitted', achieved: 'Achieved', cancelled: 'Cancelled' }
const MS_HEX: Record<string, string> = { not_started: '#78716c', in_progress: '#2563EB', submitted: '#7C3AED', achieved: '#16A34A', cancelled: '#a8a29e' }

function pill(label: string, hex: string) {
  return (
    <span style={{ fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 9999, background: `${hex}1a`, color: hex, whiteSpace: 'nowrap' }}>
      {label}
    </span>
  )
}
const days = (v: number | null | undefined) => (v == null ? '—' : `${v} d`)
const pct = (v: number | null | undefined) => (v == null ? '—' : `${v}%`)

function Kpi({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div style={cardStyle}>
      <p style={{ fontSize: 11, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 8px' }}>{label}</p>
      <p style={{ fontSize: 26, fontWeight: 700, color: TEXT.heading, margin: 0 }}>{value}</p>
      {sub && <p style={{ fontSize: 12, color: TEXT.muted, margin: '4px 0 0' }}>{sub}</p>}
    </div>
  )
}

function CountTable({ title, rows, labels }: { title: string; rows: { key: string; count: number }[]; labels: Record<string, string> }) {
  return (
    <div style={{ ...cardStyle, flex: '1 1 260px' }}>
      <p style={sectionTitle}>{title}</p>
      {rows.length === 0 ? <p style={{ fontSize: 13, color: TEXT.muted, margin: 0 }}>No documents yet.</p> : (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key}>
                <td style={tdStyle}>{labels[r.key] || r.key}</td>
                <td style={{ ...tdStyle, textAlign: 'right', fontWeight: 700 }}>{r.count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

function monthLabel(ym: string) {
  const [y, m] = ym.split('-').map(Number)
  return new Date(y, m - 1, 1).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })
}

export default function DesignReportsPage() {
  const { isAuthorized, isLoading } = useRequireApp('design')
  const me = useDesignMe(isAuthorized)
  // Customer submissions (and their turnaround) are Design-team only.
  const isTeam = !!me && me.is_team
  const [data, setData] = useState<DesignReportSummary | null>(null)
  const [error, setError] = useState<string | string[]>('')
  const [exporting, setExporting] = useState(false)
  const [status, setStatus] = useState('draft,in_review,in_approval,released,revising')
  const [docType, setDocType] = useState('')
  const [discipline, setDiscipline] = useState('')
  const [approvals, setApprovals] = useState<CustomerApprovalsReport | null>(null)
  const [register, setRegister] = useState<ChangeRegisterReport | null>(null)
  const [milestones, setMilestones] = useState<MilestoneReport | null>(null)
  const [workload, setWorkload] = useState<WorkloadReport | null>(null)
  const [ftr, setFtr] = useState<FirstTimeRightReport | null>(null)
  const [docs, setDocs] = useState<DesignLookupOption[]>([])
  const [historyDocId, setHistoryDocId] = useState('')
  const [history, setHistory] = useState<RevisionHistoryReport | null>(null)
  const [historyLoading, setHistoryLoading] = useState(false)

  useEffect(() => {
    if (!isAuthorized) return
    // Each report loads on its own so one failing doesn't blank the rest;
    // their real error messages are collected into the banner.
    const fail = (what: string) => (err: unknown) => setError((prev) => {
      const list = Array.isArray(prev) ? prev : prev ? [prev] : []
      return [...list, ...extractErrorMessages(err, `Failed to load ${what}.`)]
    })
    designApi.getReportSummary().then(setData).catch(fail('Design reports'))
    designApi.reportChangeRegister().then(setRegister).catch(fail('the change register'))
    designApi.reportMilestones().then(setMilestones).catch(fail('the WBS report'))
    designApi.reportWorkload().then(setWorkload).catch(fail('the workload report'))
    designApi.reportFirstTimeRight().then(setFtr).catch(fail('the first-time-right report'))
    designApi.lookupDocuments().then(setDocs).catch(fail('the drawing list'))
  }, [isAuthorized])

  useEffect(() => {
    if (!isAuthorized || !isTeam) return
    designApi.reportCustomerApprovals().then(setApprovals).catch((err: unknown) => setError((prev) => {
      const list = Array.isArray(prev) ? prev : prev ? [prev] : []
      return [...list, ...extractErrorMessages(err, 'Failed to load the customer approvals report.')]
    }))
  }, [isAuthorized, isTeam])

  const pickHistoryDoc = (id: string) => {
    setHistoryDocId(id)
    setHistory(null)
    if (!id) return
    setHistoryLoading(true)
    designApi.reportRevisionHistory(Number(id))
      .then((h: RevisionHistoryReport) => setHistory(h))
      .catch((err) => setError(extractErrorMessages(err, 'Failed to load the revision history.')))
      .finally(() => setHistoryLoading(false))
  }

  const docOptions = useMemo(() => toOptions(docs.map((d) => ({ id: d.id, label: d.code ? `${d.code} — ${d.label}` : d.label }))), [docs])

  if (isLoading || !isAuthorized) return null

  const exportMdl = async () => {
    setExporting(true)
    setError('')
    const params: Record<string, unknown> = {}
    if (status) params.status = status
    if (docType) params.document_type = docType
    if (discipline) params.discipline = discipline
    try {
      await openAttachmentBlob(() => designApi.exportMasterDocumentList(params), `master-document-list-${new Date().toISOString().slice(0, 10)}.csv`)
    } catch (err) {
      setError(extractErrorMessages(err, 'Exporting the Master Document List failed.'))
    } finally {
      setExporting(false)
    }
  }

  return (
    <div>
      <DesignNav />

      <div style={{ marginBottom: 20 }}>
        <p style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 4px' }}>Design Module</p>
        <h1 style={{ fontSize: 24, fontWeight: 700, color: TEXT.heading, margin: 0 }}>Design Reports</h1>
      </div>

      {error && (
        <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
          {Array.isArray(error) ? error.join(' ') : error}
        </div>
      )}

      <div data-tour="design-rep-mdl" style={{ ...cardStyle, marginBottom: 16 }}>
        <p style={sectionTitle}>Master Document List (ISO 9001 §7.5)</p>
        <p style={{ fontSize: 13, color: TEXT.muted, margin: '0 0 12px' }}>
          Every controlled document with its current revision, who checked and approved it, and any revision in progress — as a CSV for audits and customer submissions.
        </p>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          <select data-tour="design-rep-mdl-status" style={{ ...inputStyle, flex: '0 1 220px' }} value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="draft,in_review,in_approval,released,revising">All active documents</option>
            <option value="released,revising">Released only</option>
            <option value="obsolete">Obsolete only</option>
            <option value="">Everything, incl. obsolete</option>
          </select>
          <select data-tour="design-rep-mdl-type" style={{ ...inputStyle, flex: '0 1 180px' }} value={docType} onChange={(e) => setDocType(e.target.value)}>
            <option value="">All types</option>
            {Object.entries(DOC_TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <select data-tour="design-rep-mdl-discipline" style={{ ...inputStyle, flex: '0 1 170px' }} value={discipline} onChange={(e) => setDiscipline(e.target.value)}>
            <option value="">All disciplines</option>
            {Object.entries(DISCIPLINE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <button type="button" data-tour="design-rep-mdl-export-btn" onClick={exportMdl} disabled={exporting} style={{
            padding: '10px 18px', borderRadius: 12, border: 'none', cursor: exporting ? 'wait' : 'pointer',
            background: GRADIENTS.primary, color: '#fff', fontSize: 13, fontWeight: 600, boxShadow: `0 6px 16px ${SHADOWS.glowOrange}`,
          }}>
            {exporting ? 'Exporting…' : 'Download CSV'}
          </button>
        </div>
      </div>

      {data && (
        <>
          <div data-tour="design-rep-kpis" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 14, marginBottom: 16 }}>
            <Kpi label="Revisions released" value={data.total_revisions_released} sub="all time" />
            <Kpi label="Avg. cycle time" value={data.avg_cycle_days != null ? `${data.avg_cycle_days} days` : '—'} sub="revision opened → released" />
            <Kpi label="Avg. returns per release" value={data.avg_returns_per_release ?? '—'} sub="times sent back before release" />
          </div>
          <div data-tour="design-rep-counts" style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'flex-start' }}>
            <CountTable title="By status" rows={data.by_status} labels={STATUS_LABELS} />
            <CountTable title="By type" rows={data.by_type} labels={DOC_TYPE_LABELS} />
            <CountTable title="By discipline" rows={data.by_discipline} labels={DISCIPLINE_LABELS} />
            <div style={{ ...cardStyle, flex: '1 1 260px' }}>
              <p style={sectionTitle}>Releases — last 12 months</p>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <tbody>
                  {data.releases_by_month.slice().reverse().map((m) => (
                    <tr key={m.month}>
                      <td style={tdStyle}>{monthLabel(m.month)}</td>
                      <td style={{ ...tdStyle, textAlign: 'right', fontWeight: m.released ? 700 : 400, color: m.released ? TEXT.heading : TEXT.muted }}>{m.released}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {/* First-time-right */}
      {ftr && (
        <>
          <p style={{ ...sectionTitle, margin: '24px 0 12px' }}>First-time-right</p>
          <div data-tour="design-rep-ftr" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 14, marginBottom: 16 }}>
            <Kpi label="Customer FTR" value={pct(ftr.customer_ftr_pct)} sub={`${ftr.customer_first_time_right} of ${ftr.customer_drawings_released} customer drawings released with no customer rejection`} />
            <Kpi label="Internal FTR" value={pct(ftr.internal_ftr_pct)} sub={`${ftr.internal_first_time_right} of ${ftr.revisions_released} revisions released without being sent back`} />
          </div>
        </>
      )}

      {/* Customer approvals */}
      {approvals && (
        <div data-tour="design-rep-approvals" style={{ ...cardStyle, marginBottom: 16, marginTop: ftr ? 0 : 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
            <p style={sectionTitle}>Customer approvals</p>
            <span style={{ fontSize: 13, color: TEXT.secondary }}>
              Avg. turnaround: <strong style={{ color: TEXT.heading }}>{approvals.avg_turnaround_days != null ? `${approvals.avg_turnaround_days} days` : '—'}</strong> <span style={{ color: TEXT.muted }}>(sent → customer response)</span>
            </span>
          </div>
          {approvals.submissions.length === 0 ? <p style={mutedP}>No transmittals sent to customers yet.</p> : (
            <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'flex-start' }}>
              <div style={{ flex: '1 1 380px', ...scrollBox }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 460 }}>
                  <thead><tr>{['Customer', 'Transmittals', 'Drawings', 'Approved', 'Rejected', 'Avg. turnaround'].map((h) => <th key={h} style={thStyle}>{h}</th>)}</tr></thead>
                  <tbody>
                    {approvals.customers.map((c) => (
                      <tr key={c.customer_name}>
                        <td style={{ ...gtd, fontWeight: 600 }}>{c.customer_name}</td>
                        <td style={gtd}>{c.submissions}</td>
                        <td style={gtd}>{c.drawings}</td>
                        <td style={{ ...gtd, color: '#16A34A', fontWeight: 600 }}>{c.approved}</td>
                        <td style={{ ...gtd, color: c.rejected ? '#DC2626' : TEXT.body, fontWeight: c.rejected ? 600 : 400 }}>{c.rejected}</td>
                        <td style={gtd}>{days(c.avg_turnaround_days)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div style={{ flex: '2 1 560px', ...scrollBox }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 720 }}>
                  <thead><tr>{['Transmittal', 'Customer', 'Status', 'Sent', 'Response', 'Turnaround', 'Drawings', 'Rejected'].map((h) => <th key={h} style={thStyle}>{h}</th>)}</tr></thead>
                  <tbody>
                    {approvals.submissions.map((r) => (
                      <tr key={r.id}>
                        <td style={{ ...gtd, fontWeight: 600, color: TEXT.heading, whiteSpace: 'nowrap' }}>{r.submission_number}</td>
                        <td style={gtd}>{r.customer_name}</td>
                        <td style={gtd}>
                          {pill(SUBMISSION_STATUS_LABELS[r.status] || r.status, SUB_HEX[r.status] || '#78716c')}
                          {r.overdue && <div style={{ marginTop: 4 }}>{pill('Overdue', '#DC2626')}</div>}
                        </td>
                        <td style={{ ...gtd, whiteSpace: 'nowrap' }}>{formatDate(r.sent_date)}</td>
                        <td style={{ ...gtd, whiteSpace: 'nowrap' }}>
                          {r.response_date ? formatDate(r.response_date) : <span style={{ color: TEXT.muted }}>{r.days_waiting != null ? `waiting ${r.days_waiting} d` : '—'}</span>}
                        </td>
                        <td style={gtd}>{days(r.turnaround_days)}</td>
                        <td style={gtd}>{r.drawings}</td>
                        <td style={{ ...gtd, color: r.rejected ? '#DC2626' : TEXT.body }}>{r.rejected}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Change register */}
      {register && (
        <div data-tour="design-rep-changes" style={{ ...cardStyle, marginBottom: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
            <p style={sectionTitle}>Change register (ECR → ECN)</p>
            <span style={{ fontSize: 13, color: TEXT.secondary }}>
              Open ECRs: <strong style={{ color: TEXT.heading }}>{register.open_ecrs}</strong> · Avg. request → release:{' '}
              <strong style={{ color: TEXT.heading }}>{register.avg_days_to_release != null ? `${register.avg_days_to_release} days` : '—'}</strong>
            </span>
          </div>
          {register.rows.length === 0 ? <p style={mutedP}>No change requests or notices yet.</p> : (
            <div style={scrollBox}>
              <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 1080 }}>
                <thead><tr>{['ECR', 'Title', 'Source', 'ECR status', 'Raised', 'Days to decision', 'ECN', 'ECN status', 'Released', 'Days to release'].map((h) => <th key={h} style={thStyle}>{h}</th>)}</tr></thead>
                <tbody>
                  {register.rows.map((r, i) => (
                    <tr key={`${r.ecr_id ?? 'n'}-${r.ecn_id ?? 'x'}-${i}`}>
                      <td style={{ ...gtd, fontWeight: 600, color: TEXT.heading, whiteSpace: 'nowrap' }}>{r.ecr_number || <span style={{ color: TEXT.muted, fontWeight: 400 }}>Direct ECN</span>}</td>
                      <td style={{ ...gtd, maxWidth: 280 }}>{r.title}</td>
                      <td style={gtd}>{r.source ? ((r.ecr_id ? ECR_SOURCE_LABELS[r.source] : ECN_REASON_LABELS[r.source]) || r.source) : '—'}</td>
                      <td style={gtd}>{r.ecr_status ? pill(ECR_STATUS_LABELS[r.ecr_status] || r.ecr_status, ECR_HEX[r.ecr_status] || '#78716c') : '—'}</td>
                      <td style={{ ...gtd, whiteSpace: 'nowrap' }}>{formatDate(r.raised_at)}</td>
                      <td style={gtd}>{days(r.days_to_decision)}</td>
                      <td style={{ ...gtd, fontWeight: 600, whiteSpace: 'nowrap' }}>{r.ecn_number || <span style={{ color: TEXT.muted, fontWeight: 400 }}>—</span>}</td>
                      <td style={gtd}>{r.ecn_status ? pill(ECN_STATUS_LABELS[r.ecn_status] || r.ecn_status, ECN_HEX[r.ecn_status] || '#78716c') : '—'}</td>
                      <td style={{ ...gtd, whiteSpace: 'nowrap' }}>{r.released_at ? formatDate(r.released_at) : '—'}</td>
                      <td style={{ ...gtd, fontWeight: r.days_to_release != null ? 600 : 400 }}>{days(r.days_to_release)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'flex-start', marginBottom: 16 }}>
        {/* Design milestone status */}
        {milestones && (
          <div data-tour="design-rep-milestones" style={{ ...cardStyle, flex: '1 1 480px' }}>
            <p style={sectionTitle}>Design WBS status</p>
            {milestones.note ? <p style={mutedP}>{milestones.note}</p> : milestones.rows.length === 0 ? <p style={mutedP}>No project WBS elements are assigned to the Design department.</p> : (
              <div style={scrollBox}>
                <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 560 }}>
                  <thead><tr>{['WBS', 'Project', 'Target', 'Status', 'Slip'].map((h) => <th key={h} style={thStyle}>{h}</th>)}</tr></thead>
                  <tbody>
                    {milestones.rows.map((m) => (
                      <tr key={m.milestone_id}>
                        <td style={{ ...gtd, fontWeight: 600 }}>{m.title}</td>
                        <td style={{ ...gtd, color: TEXT.secondary }}>{m.project || '—'}</td>
                        <td style={{ ...gtd, whiteSpace: 'nowrap' }}>
                          {formatDate(m.target_date)}
                          {m.actual_date && <div style={{ fontSize: 11.5, color: TEXT.muted }}>done {formatDate(m.actual_date)}</div>}
                        </td>
                        <td style={gtd}>
                          {pill(MS_LABELS[m.status] || m.status, MS_HEX[m.status] || '#78716c')}
                          {m.overdue && <div style={{ marginTop: 4 }}>{pill('Overdue', '#DC2626')}</div>}
                        </td>
                        <td style={{ ...gtd, color: m.slip_days > 0 ? '#DC2626' : TEXT.muted }}>{m.slip_days ? `${m.slip_days > 0 ? '+' : ''}${m.slip_days} d` : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* Designer workload */}
        {workload && (
          <div data-tour="design-rep-workload" style={{ ...cardStyle, flex: '1 1 420px' }}>
            <p style={sectionTitle}>Designer workload &amp; on-time</p>
            {workload.note ? <p style={mutedP}>{workload.note}</p> : workload.rows.length === 0 ? <p style={mutedP}>No team members.</p> : (
              <div style={scrollBox}>
                <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 480 }}>
                  <thead><tr>{['Member', 'Open', 'Overdue', 'Done', 'On time'].map((h) => <th key={h} style={thStyle}>{h}</th>)}</tr></thead>
                  <tbody>
                    {workload.rows.map((w) => (
                      <tr key={w.user_id}>
                        <td style={gtd}>
                          <div style={{ fontWeight: 600 }}>{w.name || `User #${w.user_id}`}</div>
                          <div style={{ fontSize: 11.5, color: TEXT.muted }}>{TEAM_ROLE_LABELS[w.role] || w.role}</div>
                        </td>
                        <td style={{ ...gtd, fontWeight: 600 }}>{w.open}</td>
                        <td style={{ ...gtd, color: w.overdue ? '#DC2626' : TEXT.body, fontWeight: w.overdue ? 600 : 400 }}>{w.overdue}</td>
                        <td style={gtd}>{w.done}</td>
                        <td style={gtd}>{pct(w.on_time_pct)}{w.on_time_pct != null && <span style={{ fontSize: 11.5, color: TEXT.muted }}> ({w.on_time}/{w.done})</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p style={{ fontSize: 11.5, color: TEXT.muted, margin: '10px 0 0' }}>From Project Management tasks assigned to each team member. On time = completed on or before the due date.</p>
          </div>
        )}
      </div>

      {/* Revision history per drawing */}
      <div data-tour="design-rep-history" style={{ ...cardStyle, marginBottom: 16 }}>
        <p style={sectionTitle}>Revision history per drawing</p>
        <div data-tour="design-rep-history-pick" style={{ maxWidth: 460, marginBottom: 12 }}>
          <SearchableSelect value={historyDocId} onChange={pickHistoryDoc} options={docOptions} placeholder="Pick a drawing / document…" />
        </div>
        {!historyDocId ? (
          <p style={mutedP}>Pick a drawing to see every revision — who authored, checked and approved it, how often it was sent back, and how long each took.</p>
        ) : historyLoading ? (
          <p style={mutedP}>Loading…</p>
        ) : history && (history.revisions.length === 0 ? (
          <p style={mutedP}>{history.doc_number} has no revisions yet.</p>
        ) : (
          <>
            <p style={{ fontSize: 13, color: TEXT.body, margin: '0 0 10px' }}><strong>{history.doc_number}</strong> — {history.title}</p>
            <div style={scrollBox}>
              <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 1000 }}>
                <thead><tr>{['Rev', 'Status', 'Change summary', 'Author', 'Checked by', 'Approved by', 'Opened', 'Released', 'Returns', 'Cycle'].map((h) => <th key={h} style={thStyle}>{h}</th>)}</tr></thead>
                <tbody>
                  {history.revisions.map((r) => (
                    <tr key={r.revision_label}>
                      <td style={{ ...gtd, fontWeight: 700, color: TEXT.heading }}>{r.revision_label}</td>
                      <td style={gtd}>{pill(REV_STATUS_LABELS[r.status] || r.status, REV_STATUS_HEX[r.status] || '#78716c')}</td>
                      <td style={{ ...gtd, maxWidth: 280, color: TEXT.secondary }}>{r.change_summary || '—'}</td>
                      <td style={gtd}>{r.author || '—'}</td>
                      <td style={gtd}>{r.checked_by || '—'}</td>
                      <td style={gtd}>{r.approved_by || '—'}</td>
                      <td style={{ ...gtd, whiteSpace: 'nowrap' }}>{formatDate(r.created_at)}</td>
                      <td style={{ ...gtd, whiteSpace: 'nowrap' }}>
                        {r.released_at ? formatDate(r.released_at) : '—'}
                        {r.superseded_at && <div style={{ fontSize: 11.5, color: TEXT.muted }}>superseded {formatDate(r.superseded_at)}</div>}
                      </td>
                      <td style={{ ...gtd, color: r.returns ? '#DC2626' : TEXT.body }}>{r.returns}</td>
                      <td style={gtd}>{days(r.cycle_days)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ))}
      </div>
    </div>
  )
}
