'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { recordPath } from '@/lib/recordRef'
import { useRequireApp } from '@/hooks/useAuth'
import { useCan } from '@/lib/permissions'
import { qualityApi } from '@/lib/api'
import { QualityCustomerComplaint } from '@/types'
import { TEXT, GLASS, SHADOWS } from '@/lib/theme'
import QualityNav from '@/components/quality/QualityNav'
import { primaryBtnStyle, RowCount } from '@/components/shared/ui'
import {
  Pill, PageHeader, ErrorBanner, tableWrapStyle, thStyle, tdStyle, filterInputStyle, fmtDate, fmtMoney,
  COMPLAINT_STATUS_LABELS, COMPLAINT_STATUS_HEX, SEVERITY_HEX,
} from '@/components/quality/QualityBits'
import { extractErrorMessages } from '@/lib/validation'
import Select from '@/components/shared/Select'

interface Stats { total: number; open: number; this_year: number; repeats: number; avg_response_days: number | null; total_cost: number }

const kpiStyle: React.CSSProperties = {
  flex: '1 1 150px', maxWidth: 220, padding: '12px 14px', borderRadius: 14, background: GLASS.card, border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(),
}

export default function QualityComplaintsPage() {
  const { isAuthorized, isLoading } = useRequireApp('quality')
  const router = useRouter()
  const { can, canFeature } = useCan()
  // Complaint costs: Quality › Complaints › costs switch (binds roles holding the tab).
  const seeCosts = !can('quality', 'complaints', 'view') || canFeature('quality', 'complaints', 'costs', 'view')
  const [rows, setRows] = useState<QualityCustomerComplaint[]>([])
  const [stats, setStats] = useState<Stats | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | string[]>('')
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('live')
  const [severity, setSeverity] = useState('')

  useEffect(() => {
    if (!isAuthorized) return
    qualityApi.getComplaintStats().then(setStats).catch(() => setStats(null))
  }, [isAuthorized])

  useEffect(() => {
    if (!isAuthorized) return
    const params: Record<string, unknown> = {}
    if (statusFilter === 'live') params.open_only = true
    else if (statusFilter) params.status = statusFilter
    if (severity) params.severity = severity
    if (search.trim()) params.search = search.trim()
    // Debounce typing and drop late responses so an older search can't overwrite a newer one.
    let ignore = false
    const t = setTimeout(() => {
      setLoading(true)
      qualityApi.listComplaints(params)
        .then((d) => { if (ignore) return; setRows(Array.isArray(d) ? d : []); setError('') })
        .catch((err) => { if (!ignore) setError(extractErrorMessages(err, 'Failed to load complaints.')) })
        .finally(() => { if (!ignore) setLoading(false) })
    }, 250)
    return () => { ignore = true; clearTimeout(t) }
  }, [isAuthorized, statusFilter, severity, search])

  if (isLoading || !isAuthorized) return null
  const cols = ['Complaint', 'Customer', 'Item / serial-batch', 'Severity', 'NCR / CAPA', 'Response', ...(seeCosts ? ['Cost'] : []), 'Status', 'Date', '']

  return (
    <div>
      <QualityNav />
      <PageHeader title="Customer Complaints">
        {can('quality', 'complaints', 'create') && (<button type="button" onClick={() => router.push('/dashboard/quality/complaints/new')} style={primaryBtnStyle}>+ Log complaint</button>)}
      </PageHeader>
      <ErrorBanner error={error} />

      {stats && (
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
          {[['Open', String(stats.open)], ['This year', String(stats.this_year)], ['Repeats', String(stats.repeats)],
            ['Avg. response', stats.avg_response_days == null ? '—' : `${stats.avg_response_days} days`], ...(seeCosts ? [['Total cost', fmtMoney(stats.total_cost)]] : [])].map(([l, v]) => (
            <div key={l} style={kpiStyle}>
              <p style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', color: TEXT.muted, margin: 0 }}>{l}</p>
              <p style={{ fontSize: 20, fontWeight: 700, color: TEXT.heading, margin: '4px 0 0' }}>{v}</p>
            </div>
          ))}
        </div>
      )}

      <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap', alignItems: 'center' }}>
        <input style={{ ...filterInputStyle, flex: '1 1 240px', maxWidth: 420 }} placeholder="Search number, customer, item, serial / batch…" value={search} onChange={(e) => setSearch(e.target.value)} />
        <Select style={{ ...filterInputStyle, flex: '0 1 200px' }} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="live">All open</option>
          <option value="">All statuses</option>
          {Object.entries(COMPLAINT_STATUS_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </Select>
        <Select style={{ ...filterInputStyle, flex: '0 1 150px' }} value={severity} onChange={(e) => setSeverity(e.target.value)}>
          <option value="">All severities</option><option value="critical">Critical</option><option value="major">Major</option><option value="minor">Minor</option>
        </Select>
      </div>

      <div style={tableWrapStyle}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 1100 }}>
          <thead><tr>{cols.map((h, i) => <th key={h} style={thStyle}>{h}{i === 0 && <RowCount count={rows.length} />}</th>)}</tr></thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={cols.length} style={{ ...tdStyle, textAlign: 'center', color: TEXT.muted }}>Loading…</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={cols.length} style={{ ...tdStyle, textAlign: 'center', color: TEXT.muted }}>No complaints found — use + Log complaint to record one.</td></tr>
            ) : rows.map((c) => (
              <tr key={c.id} onClick={() => router.push(recordPath('/dashboard/quality/complaints', c))} style={{ cursor: 'pointer' }}>
                <td style={{ ...tdStyle, fontWeight: 600, color: TEXT.heading, whiteSpace: 'nowrap' }}>
                  {c.complaint_number}{c.repeat_of_number ? <span style={{ color: '#DC2626', fontWeight: 600 }}> · repeat</span> : null}
                </td>
                <td style={tdStyle}>{c.customer_name}</td>
                <td style={tdStyle}>{c.item_name || '—'}{(c.serial_number || c.batch_number) ? ` · ${c.serial_number || c.batch_number}` : ''}</td>
                <td style={tdStyle}><Pill text={c.severity} hex={SEVERITY_HEX[c.severity]} /></td>
                <td style={tdStyle}>{[c.ncr_number, c.capa_number].filter(Boolean).join(' / ') || '—'}</td>
                <td style={tdStyle}>{c.response_days != null ? `${c.response_days} days` : `${c.age_days} days open`}</td>
                {seeCosts && <td style={tdStyle}>{c.total_cost ? fmtMoney(c.total_cost) : '—'}</td>}
                <td style={tdStyle}><Pill text={COMPLAINT_STATUS_LABELS[c.status] || c.status} hex={COMPLAINT_STATUS_HEX[c.status]} /></td>
                <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>{fmtDate(c.complaint_date)}</td>
                <td onClick={(e) => e.stopPropagation()} style={tdStyle}>
                  <span onClick={() => router.push(recordPath('/dashboard/quality/complaints', c))} style={{ fontSize: 12, fontWeight: 600, color: '#FF6A2A', cursor: 'pointer' }}>View</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
