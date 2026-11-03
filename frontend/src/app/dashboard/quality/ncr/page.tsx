'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { recordPath } from '@/lib/recordRef'
import { useCan } from '@/lib/permissions'
import { VisTd, VisTh } from '@/lib/visibilityComponents'
import { useQualityScreen } from '@/components/quality/useQualityScreen'
import { sampleNcrs } from '@/lib/qualityPreviewSamples'
import { qualityApi } from '@/lib/api'
import { QualityNcr } from '@/types'
import { TEXT } from '@/lib/theme'
import QualityNav from '@/components/quality/QualityNav'
import { primaryBtnStyle, RowCount } from '@/components/shared/ui'
import {
  Pill, PageHeader, ErrorBanner, tableWrapStyle, thStyle, tdStyle, filterInputStyle, fmtQty, fmtDate,
  NCR_STATUS_LABELS, NCR_STATUS_HEX, SEVERITY_HEX, DISPOSITION_TYPE_LABELS,
} from '@/components/quality/QualityBits'
import { extractErrorMessages } from '@/lib/validation'
import Select from '@/components/shared/Select'

export default function QualityNcrListPage() {
  // Columns the user's roles hide; in the Role editor's preview the list shows sample rows and loads nothing.
  const { vis, isAuthorized, isLoading } = useQualityScreen('quality:ncr')
  const router = useRouter()
  const { can } = useCan()

  const [ncrs, setNcrs] = useState<QualityNcr[]>(vis.preview ? sampleNcrs : [])
  const [loading, setLoading] = useState(!vis.preview)
  const [error, setError] = useState<string | string[]>('')
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [severityFilter, setSeverityFilter] = useState('')
  const [mine, setMine] = useState(false)

  useEffect(() => {
    if (!isAuthorized) return
    if (vis.preview) return  // sample rows from the first render, nothing is loaded
    const params: Record<string, unknown> = {}
    if (statusFilter === 'live') params.open_only = true
    else if (statusFilter) params.status = statusFilter
    if (severityFilter) params.severity = severityFilter
    if (search.trim()) params.search = search.trim()
    if (mine) params.awaiting_my_approval = true
    // Debounce typing and drop late responses so an older search can't overwrite a newer one.
    let ignore = false
    const t = setTimeout(() => {
      setLoading(true)
      qualityApi.listNcrs(params)
        .then((data) => { if (ignore) return; setNcrs(Array.isArray(data) ? data : []); setError('') })
        .catch((err) => { if (!ignore) setError(extractErrorMessages(err, 'Failed to load NCRs.')) })
        .finally(() => { if (!ignore) setLoading(false) })
    }, 250)
    return () => { ignore = true; clearTimeout(t) }
  }, [isAuthorized, statusFilter, severityFilter, search, mine, vis.preview])

  if (isLoading || !isAuthorized) return null
  // [label, hideable column key]: number and status are never hideable.
  const cols: [string, string | null][] = [['NCR', null], ['Item', 'item'], ['Qty', 'qty'], ['Severity', 'severity'], ['Source', 'source'],
    ['Disposition', 'disposition'], ['Status', null], ['NCR date', 'ncr_date']]
  // The preview draws every column (hidden ones dimmed, with a toggle); normal use drops the hidden ones.
  const colCount = cols.filter(([, k]) => !k || vis.preview || vis.showColumn('ncrs', k)).length

  return (
    <div>
      {!vis.preview && <QualityNav />}
      <PageHeader title="Non-Conformance Reports">
        {!vis.preview && can('quality', 'ncr', 'create') && (<button type="button" onClick={() => router.push('/dashboard/quality/ncr/new')} style={primaryBtnStyle}>+ New NCR</button>)}
      </PageHeader>
      <ErrorBanner error={error} />

      <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap', alignItems: 'center' }}>
        <input style={{ ...filterInputStyle, flex: '1 1 240px', maxWidth: 420 }} placeholder="Search NCR number, item, vendor, description…" value={search} onChange={(e) => setSearch(e.target.value)} />
        <Select style={{ ...filterInputStyle, flex: '0 1 160px' }} value={severityFilter} onChange={(e) => setSeverityFilter(e.target.value)}>
          <option value="">All severities</option>
          <option value="critical">Critical</option><option value="major">Major</option><option value="minor">Minor</option>
        </Select>
        <Select style={{ ...filterInputStyle, flex: '0 1 200px' }} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="">All statuses</option>
          <option value="live">All not closed</option>
          {Object.entries(NCR_STATUS_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </Select>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: TEXT.body, cursor: 'pointer' }}>
          <input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} /> Waiting for my approval
        </label>
      </div>

      <div style={tableWrapStyle}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 980 }}>
          <thead><tr>{cols.map(([h, k], i) => {
            const head = <>{h}{i === 0 && <RowCount count={ncrs.length} />}</>
            return k ? <VisTh key={h} vis={vis} table="ncrs" k={k} style={thStyle}>{head}</VisTh> : <th key={h} style={thStyle}>{head}</th>
          })}</tr></thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={colCount} style={{ ...tdStyle, textAlign: 'center', color: TEXT.muted }}>Loading…</td></tr>
            ) : ncrs.length === 0 ? (
              <tr><td colSpan={colCount} style={{ ...tdStyle, textAlign: 'center', color: TEXT.muted }}>No NCRs found — use + New NCR to raise one.</td></tr>
            ) : ncrs.map((n) => (
              <tr key={n.id} onClick={vis.preview ? undefined : () => router.push(recordPath('/dashboard/quality/ncr', n))} style={{ cursor: vis.preview ? 'default' : 'pointer' }}>
                <td style={{ ...tdStyle, fontWeight: 600, color: TEXT.heading, whiteSpace: 'nowrap' }}>{n.ncr_number}{n.auto_raised ? <span style={{ color: TEXT.muted, fontWeight: 400 }}> · auto</span> : null}</td>
                <VisTd vis={vis} table="ncrs" k="item" style={tdStyle}>{n.item_code ? `${n.item_code} — ` : ''}{n.item_name}</VisTd>
                <VisTd vis={vis} table="ncrs" k="qty" style={{ ...tdStyle, whiteSpace: 'nowrap' }}>{fmtQty(n.quantity, n.uom)}</VisTd>
                <VisTd vis={vis} table="ncrs" k="severity" style={tdStyle}><Pill text={n.severity} hex={SEVERITY_HEX[n.severity]} /></VisTd>
                <VisTd vis={vis} table="ncrs" k="source" style={tdStyle}>{n.source.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase())}</VisTd>
                <VisTd vis={vis} table="ncrs" k="disposition" style={tdStyle}>
                  {n.disposition_type ? `${DISPOSITION_TYPE_LABELS[n.disposition_type] || n.disposition_type}${n.disposition_status === 'pending_approval' ? ' (awaiting approval)' : ''}` : '—'}
                </VisTd>
                <td style={tdStyle}><Pill text={NCR_STATUS_LABELS[n.status] || n.status} hex={NCR_STATUS_HEX[n.status]} /></td>
                <VisTd vis={vis} table="ncrs" k="ncr_date" style={{ ...tdStyle, whiteSpace: 'nowrap' }}>{fmtDate(n.ncr_date)}</VisTd>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
