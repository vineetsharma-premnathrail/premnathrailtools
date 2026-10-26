'use client'

import Select from '@/components/shared/Select'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { electricalApi } from '@/lib/api'
import { recordPath } from '@/lib/recordRef'
import { ElectricalIssue } from '@/types'
import { TEXT, GLASS, SHADOWS } from '@/lib/theme'
import { extractErrorMessages } from '@/lib/validation'
import { formatDate } from '@/lib/format'
import ElectricalNav from '@/components/electrical/ElectricalNav'
import {
  inputStyle, thStyle, tdStyle, Pill, ErrorBanner,
  SEVERITY_LABELS, SEVERITY_HEX, ISSUE_STATUS_LABELS, ISSUE_STATUS_HEX,
} from '@/components/electrical/shared'
import { RowCount, segmentBtnStyle, smallSecondaryBtnStyle } from '@/components/shared/ui'

// 'open' is the API's shorthand for open + investigating (every unresolved issue).
const STATUS_FILTERS: { value: string; label: string }[] = [
  { value: 'open', label: 'Open (unresolved)' },
  { value: 'investigating', label: 'Investigating' },
  { value: 'resolved', label: 'Resolved' },
  { value: 'closed', label: 'Closed' },
  { value: '', label: 'All statuses' },
]


const chipStyle = (hex: string): React.CSSProperties => ({
  display: 'inline-flex', alignItems: 'baseline', gap: 8, padding: '8px 14px', borderRadius: 12,
  background: `${hex}14`, border: `1px solid ${hex}33`, color: hex,
})

const COLS = ['Issue No.', 'Job', 'Title', 'Severity', 'Status', 'Linked', 'Assigned to', 'Reported', '']

export default function ElectricalTroubleshootingPage() {
  const { isAuthorized, isLoading } = useRequireApp('electrical')
  const router = useRouter()

  const [issues, setIssues] = useState<ElectricalIssue[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | string[]>('')
  const [status, setStatus] = useState('open')
  const [severity, setSeverity] = useState('')
  const [mine, setMine] = useState(false)

  useEffect(() => {
    if (!isAuthorized) return
    const params: Record<string, unknown> = {}
    if (status) params.status = status
    if (severity) params.severity = severity
    if (mine) params.mine = true
    electricalApi.listIssues(params)
      .then((d) => { setIssues(Array.isArray(d) ? d : []); setError('') })
      .catch((err) => setError(extractErrorMessages(err, "Couldn't load the troubleshooting log. Refresh the page to try again.")))
      .finally(() => setLoading(false))
  }, [isAuthorized, status, severity, mine])

  const openCount = issues.filter((i) => i.status === 'open' || i.status === 'investigating').length
  const criticalCount = issues.filter((i) => i.severity === 'critical' && (i.status === 'open' || i.status === 'investigating')).length
  const go = (i: ElectricalIssue) => router.push(`${recordPath('/dashboard/electrical/jobs', i, 'job_id')}?tab=issues`)

  if (isLoading || !isAuthorized) return null

  return (
    <div>
      <ElectricalNav />

      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, marginBottom: 20, flexWrap: 'wrap' }}>
        <div>
          <p style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 4px' }}>
            Electrical Module
          </p>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: TEXT.heading, margin: 0 }}>Troubleshooting</h1>
          <p style={{ fontSize: 13, color: TEXT.muted, margin: '6px 0 0' }}>
            Electrical faults logged across every RRV job. Log and resolve issues from the job&apos;s Issues tab.
          </p>
        </div>
      </div>

      <ErrorBanner error={error} />

      <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap', alignItems: 'center' }}>
        <Select data-tour="elec-ireg-status-filter" style={{ ...inputStyle, width: 'auto', flex: '0 1 190px' }} value={status} onChange={(e) => setStatus(e.target.value)}>
          {STATUS_FILTERS.map((s) => <option key={s.value || 'all'} value={s.value}>{s.label}</option>)}
        </Select>
        <Select data-tour="elec-ireg-severity-filter" style={{ ...inputStyle, width: 'auto', flex: '0 1 160px' }} value={severity} onChange={(e) => setSeverity(e.target.value)}>
          <option value="">All severities</option>
          {Object.entries(SEVERITY_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </Select>
        <button data-tour="elec-ireg-mine-toggle" type="button" onClick={() => setMine((v) => !v)} style={segmentBtnStyle(mine)} aria-pressed={mine}>
          {mine ? '✓ ' : ''}Assigned to me
        </button>
      </div>

      {!loading && (
        <div data-tour="elec-ireg-summary" style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
          <span style={chipStyle(openCount ? '#DC2626' : '#16A34A')}>
            <strong style={{ fontSize: 18 }}>{openCount}</strong>
            <span style={{ fontSize: 12, fontWeight: 600 }}>open / investigating</span>
          </span>
          <span style={chipStyle(criticalCount ? '#DC2626' : '#78716c')}>
            <strong style={{ fontSize: 18 }}>{criticalCount}</strong>
            <span style={{ fontSize: 12, fontWeight: 600 }}>critical still open</span>
          </span>
        </div>
      )}

      <div data-tour="elec-ireg-table" style={{
        borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur,
        border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), overflow: 'auto', maxHeight: 'calc(100vh - 320px)',
      }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 1100 }}>
          <thead>
            <tr>{COLS.map((h, i) => <th key={`${h}-${i}`} style={thStyle}>{h}{i === 0 && <RowCount count={issues.length} />}</th>)}</tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={COLS.length} style={{ padding: 20, textAlign: 'center', fontSize: 13, color: TEXT.muted }}>Loading…</td></tr>
            ) : issues.length === 0 ? (
              <tr>
                <td colSpan={COLS.length} style={{ padding: 20, textAlign: 'center', fontSize: 13, color: TEXT.muted }}>
                  {status === 'open' && !severity && !mine
                    ? 'No open electrical issues — every logged fault has been resolved.'
                    : 'No issues match these filters.'}
                </td>
              </tr>
            ) : issues.map((i) => {
              const links = [
                i.test_number && `Test ${i.test_number}`,
                i.panel_tag && `Panel ${i.panel_tag}`,
                i.cable_tag && `Cable ${i.cable_tag}`,
              ].filter(Boolean).join(' · ')
              return (
                <tr key={i.id} onClick={() => go(i)} style={{ cursor: 'pointer' }}>
                  <td style={{ ...tdStyle, fontWeight: 600, color: TEXT.heading, whiteSpace: 'nowrap' }}>{i.issue_number}</td>
                  <td style={tdStyle}>
                    <div style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>{i.job_number || '—'}</div>
                    {i.job_title && <div style={{ fontSize: 11.5, color: TEXT.muted }}>{i.job_title}</div>}
                  </td>
                  <td title={i.title} style={{ ...tdStyle, maxWidth: 320, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{i.title}</td>
                  <td style={tdStyle}><Pill value={i.severity} labels={SEVERITY_LABELS} hex={SEVERITY_HEX} /></td>
                  <td style={tdStyle}><Pill value={i.status} labels={ISSUE_STATUS_LABELS} hex={ISSUE_STATUS_HEX} /></td>
                  <td style={{ ...tdStyle, fontSize: 12.5 }}>{links || '—'}</td>
                  <td style={tdStyle}>{i.assigned_to_name || <span style={{ color: TEXT.muted }}>Unassigned</span>}</td>
                  <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>
                    {formatDate(i.created_at)}
                    {i.reported_by_name && <div style={{ fontSize: 11.5, color: TEXT.muted }}>{i.reported_by_name}</div>}
                  </td>
                  <td onClick={(e) => e.stopPropagation()} style={tdStyle}>
                    <button type="button" onClick={() => go(i)} style={smallSecondaryBtnStyle}>View</button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
