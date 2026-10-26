'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { recordPath } from '@/lib/recordRef'
import { useRequireApp } from '@/hooks/useAuth'
import { useCan } from '@/lib/permissions'
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
  const { isAuthorized, isLoading } = useRequireApp('quality')
  const router = useRouter()
  const { can } = useCan()

  const [ncrs, setNcrs] = useState<QualityNcr[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | string[]>('')
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [severityFilter, setSeverityFilter] = useState('')
  const [mine, setMine] = useState(false)

  useEffect(() => {
    if (!isAuthorized) return
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
  }, [isAuthorized, statusFilter, severityFilter, search, mine])

  if (isLoading || !isAuthorized) return null
  const cols = ['NCR', 'Item', 'Qty', 'Severity', 'Source', 'Disposition', 'Status', 'NCR date', '']

  return (
    <div>
      <QualityNav />
      <PageHeader title="Non-Conformance Reports">
        {can('quality', 'ncr', 'create') && (<button type="button" onClick={() => router.push('/dashboard/quality/ncr/new')} style={primaryBtnStyle}>+ New NCR</button>)}
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
          <thead><tr>{cols.map((h, i) => <th key={h} style={thStyle}>{h}{i === 0 && <RowCount count={ncrs.length} />}</th>)}</tr></thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={cols.length} style={{ ...tdStyle, textAlign: 'center', color: TEXT.muted }}>Loading…</td></tr>
            ) : ncrs.length === 0 ? (
              <tr><td colSpan={cols.length} style={{ ...tdStyle, textAlign: 'center', color: TEXT.muted }}>No NCRs found — use + New NCR to raise one.</td></tr>
            ) : ncrs.map((n) => (
              <tr key={n.id} onClick={() => router.push(recordPath('/dashboard/quality/ncr', n))} style={{ cursor: 'pointer' }}>
                <td style={{ ...tdStyle, fontWeight: 600, color: TEXT.heading, whiteSpace: 'nowrap' }}>{n.ncr_number}{n.auto_raised ? <span style={{ color: TEXT.muted, fontWeight: 400 }}> · auto</span> : null}</td>
                <td style={tdStyle}>{n.item_code ? `${n.item_code} — ` : ''}{n.item_name}</td>
                <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>{fmtQty(n.quantity, n.uom)}</td>
                <td style={tdStyle}><Pill text={n.severity} hex={SEVERITY_HEX[n.severity]} /></td>
                <td style={tdStyle}>{n.source.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase())}</td>
                <td style={tdStyle}>
                  {n.disposition_type ? `${DISPOSITION_TYPE_LABELS[n.disposition_type] || n.disposition_type}${n.disposition_status === 'pending_approval' ? ' (awaiting approval)' : ''}` : '—'}
                </td>
                <td style={tdStyle}><Pill text={NCR_STATUS_LABELS[n.status] || n.status} hex={NCR_STATUS_HEX[n.status]} /></td>
                <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>{fmtDate(n.ncr_date)}</td>
                <td onClick={(e) => e.stopPropagation()} style={tdStyle}>
                  <span onClick={() => router.push(recordPath('/dashboard/quality/ncr', n))} style={{ fontSize: 12, fontWeight: 600, color: '#FF6A2A', cursor: 'pointer' }}>View</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
