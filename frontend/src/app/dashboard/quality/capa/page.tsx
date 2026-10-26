'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { recordPath } from '@/lib/recordRef'
import { useRequireApp } from '@/hooks/useAuth'
import { useCan } from '@/lib/permissions'
import { qualityApi } from '@/lib/api'
import { QualityCapa } from '@/types'
import { TEXT } from '@/lib/theme'
import QualityNav from '@/components/quality/QualityNav'
import { primaryBtnStyle, RowCount } from '@/components/shared/ui'
import {
  Pill, PageHeader, ErrorBanner, tableWrapStyle, thStyle, tdStyle, filterInputStyle, fmtDate,
  CAPA_STATUS_LABELS, CAPA_STATUS_HEX, CAPA_TRIGGER_LABELS, SEVERITY_HEX,
} from '@/components/quality/QualityBits'
import { extractErrorMessages } from '@/lib/validation'
import Select from '@/components/shared/Select'

export default function QualityCapaListPage() {
  const { isAuthorized, isLoading } = useRequireApp('quality')
  const router = useRouter()
  const { can } = useCan()
  const [capas, setCapas] = useState<QualityCapa[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | string[]>('')
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('live')
  const [trigger, setTrigger] = useState('')
  const [mine, setMine] = useState(false)
  const [overdue, setOverdue] = useState(false)

  useEffect(() => {
    if (!isAuthorized) return
    const params: Record<string, unknown> = {}
    if (statusFilter === 'live') params.open_only = true
    else if (statusFilter) params.status = statusFilter
    if (trigger) params.trigger = trigger
    if (search.trim()) params.search = search.trim()
    if (mine) params.mine = true
    if (overdue) params.overdue_only = true
    // Debounce typing and drop late responses so an older search can't overwrite a newer one.
    let ignore = false
    const t = setTimeout(() => {
      setLoading(true)
      qualityApi.listCapas(params)
        .then((data) => { if (ignore) return; setCapas(Array.isArray(data) ? data : []); setError('') })
        .catch((err) => { if (!ignore) setError(extractErrorMessages(err, 'Failed to load CAPAs.')) })
        .finally(() => { if (!ignore) setLoading(false) })
    }, 250)
    return () => { ignore = true; clearTimeout(t) }
  }, [isAuthorized, statusFilter, trigger, search, mine, overdue])

  if (isLoading || !isAuthorized) return null
  const cols = ['CAPA', 'Title', 'Raised for', 'Severity', 'Owner', 'Open actions', 'Status', 'Opened']

  return (
    <div>
      <QualityNav />
      <PageHeader title="CAPA (8D)" subtitle="Quality · Corrective & preventive actions">
        {can('quality', 'capa', 'create') && (<button type="button" onClick={() => router.push('/dashboard/quality/capa/new')} style={primaryBtnStyle}>+ New CAPA</button>)}
      </PageHeader>
      <ErrorBanner error={error} />

      <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap', alignItems: 'center' }}>
        <input style={{ ...filterInputStyle, flex: '1 1 240px', maxWidth: 380 }} placeholder="Search CAPA number, title, item…" value={search} onChange={(e) => setSearch(e.target.value)} />
        <Select style={{ ...filterInputStyle, flex: '0 1 200px' }} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="live">All not closed</option>
          <option value="">All statuses</option>
          {Object.entries(CAPA_STATUS_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </Select>
        <Select style={{ ...filterInputStyle, flex: '0 1 200px' }} value={trigger} onChange={(e) => setTrigger(e.target.value)}>
          <option value="">Any trigger</option>
          {Object.entries(CAPA_TRIGGER_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </Select>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: TEXT.body, cursor: 'pointer' }}>
          <input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} /> Mine (owner / team / action)
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: TEXT.body, cursor: 'pointer' }}>
          <input type="checkbox" checked={overdue} onChange={(e) => setOverdue(e.target.checked)} /> Overdue only
        </label>
      </div>

      <div style={tableWrapStyle}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 1000 }}>
          <thead><tr>{cols.map((h, i) => <th key={h} style={thStyle}>{h}{i === 0 && <RowCount count={capas.length} />}</th>)}</tr></thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={cols.length} style={{ ...tdStyle, textAlign: 'center', color: TEXT.muted }}>Loading…</td></tr>
            ) : capas.length === 0 ? (
              <tr><td colSpan={cols.length} style={{ ...tdStyle, textAlign: 'center', color: TEXT.muted }}>No CAPAs found — use + New CAPA to open one.</td></tr>
            ) : capas.map((c) => (
              <tr key={c.id} onClick={() => router.push(recordPath('/dashboard/quality/capa', c))} style={{ cursor: 'pointer' }}>
                <td style={{ ...tdStyle, fontWeight: 600, color: TEXT.heading, whiteSpace: 'nowrap' }}>{c.capa_number}</td>
                <td style={tdStyle}>{c.title}</td>
                <td style={tdStyle}>{CAPA_TRIGGER_LABELS[c.trigger] || c.trigger}{c.ncr_number ? ` · ${c.ncr_number}` : ''}{c.complaint_number ? ` · ${c.complaint_number}` : ''}</td>
                <td style={tdStyle}><Pill text={c.severity} hex={SEVERITY_HEX[c.severity]} /></td>
                <td style={tdStyle}>{c.responsible_user_name || <span style={{ color: '#b45309' }}>Not assigned</span>}</td>
                <td style={tdStyle}>{c.open_actions}{c.overdue ? <span style={{ color: '#DC2626', fontWeight: 600 }}> · overdue</span> : null}</td>
                <td style={tdStyle}><Pill text={CAPA_STATUS_LABELS[c.status] || c.status} hex={CAPA_STATUS_HEX[c.status]} /></td>
                <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>{fmtDate(c.created_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
