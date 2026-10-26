'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { recordPath } from '@/lib/recordRef'
import { useRequireApp } from '@/hooks/useAuth'
import { useCan } from '@/lib/permissions'
import { qualityApi } from '@/lib/api'
import { QualityFirstArticle } from '@/types'
import { TEXT } from '@/lib/theme'
import QualityNav from '@/components/quality/QualityNav'
import { primaryBtnStyle, RowCount } from '@/components/shared/ui'
import {
  Pill, PageHeader, ErrorBanner, tableWrapStyle, thStyle, tdStyle, filterInputStyle, fmtDate, LOT_STATUS_LABELS,
} from '@/components/quality/QualityBits'
import { extractErrorMessages } from '@/lib/validation'
import Select from '@/components/shared/Select'

const STATUS_LABELS: Record<string, string> = { open: 'Open', approved: 'Approved', rejected: 'Rejected', cancelled: 'Cancelled' }
const STATUS_HEX: Record<string, string> = { open: '#F59E0B', approved: '#16A34A', rejected: '#DC2626', cancelled: '#a8a29e' }
const TRIGGER_LABELS: Record<string, string> = { new_item: 'New item', new_revision: 'New drawing revision', new_vendor: 'New vendor', manual: 'Manual' }

export default function FirstArticlesPage() {
  const { isAuthorized, isLoading } = useRequireApp('quality')
  const router = useRouter()
  const { can } = useCan()
  const [rows, setRows] = useState<QualityFirstArticle[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | string[]>('')
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('')

  useEffect(() => {
    if (!isAuthorized) return
    const params: Record<string, unknown> = {}
    if (status) params.status = status
    if (search.trim()) params.search = search.trim()
    // Debounce typing and drop late responses so an older search can't overwrite a newer one.
    let ignore = false
    const t = setTimeout(() => {
      setLoading(true)
      qualityApi.listFirstArticles(params)
        .then((d) => { if (ignore) return; setRows(Array.isArray(d) ? d : []); setError('') })
        .catch((err) => { if (!ignore) setError(extractErrorMessages(err, 'Failed to load first article inspections.')) })
        .finally(() => { if (!ignore) setLoading(false) })
    }, 250)
    return () => { ignore = true; clearTimeout(t) }
  }, [isAuthorized, status, search])

  if (isLoading || !isAuthorized) return null
  const cols = ['FAI', 'Item', 'Source', 'Drawing', 'Why', 'Lot', 'Status', 'Decided']

  return (
    <div>
      <QualityNav />
      <PageHeader title="First Article Inspection">
        {can('quality', 'first_article', 'create') && (<button type="button" onClick={() => router.push('/dashboard/quality/first-articles/new')} style={primaryBtnStyle}>+ New FAI</button>)}
      </PageHeader>
      <p style={{ fontSize: 13, color: TEXT.muted, margin: '-8px 0 16px', maxWidth: 900 }}>
        Rule 9: a new item, a new drawing revision or a new vendor gets a full-drawing first article check. The first GRN / job work receipt / production output of it becomes the FAI lot automatically; regular lots of that item and source can&apos;t be accepted until a Quality engineer approves the FAI.
      </p>
      <ErrorBanner error={error} />
      <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
        <input style={{ ...filterInputStyle, flex: '1 1 240px', maxWidth: 420 }} placeholder="Search FAI, item, vendor, GRN / WO…" value={search} onChange={(e) => setSearch(e.target.value)} />
        <Select style={{ ...filterInputStyle, flex: '0 1 180px' }} value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All statuses</option>
          {Object.entries(STATUS_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </Select>
      </div>
      <div style={tableWrapStyle}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 1050 }}>
          <thead><tr>{cols.map((h, i) => <th key={h} style={thStyle}>{h}{i === 0 && <RowCount count={rows.length} />}</th>)}</tr></thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={cols.length} style={{ ...tdStyle, textAlign: 'center', color: TEXT.muted }}>Loading…</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={cols.length} style={{ ...tdStyle, textAlign: 'center', color: TEXT.muted }}>No first article inspections found — they are raised automatically for new items, revisions and vendors, or use + New FAI.</td></tr>
            ) : rows.map((f) => (
              <tr key={f.id} onClick={() => router.push(recordPath('/dashboard/quality/first-articles', f))} style={{ cursor: 'pointer' }}>
                <td style={{ ...tdStyle, fontWeight: 600, color: TEXT.heading, whiteSpace: 'nowrap' }}>{f.fai_number}</td>
                <td style={tdStyle}>{f.item_code ? `${f.item_code} — ` : ''}{f.item_name}</td>
                <td style={tdStyle}>{f.vendor_name || 'In-house'}<div style={{ fontSize: 11.5, color: TEXT.muted }}>{f.source_reference || ''}</div></td>
                <td style={tdStyle}>{f.drawing_ref || '—'}</td>
                <td style={tdStyle}>{TRIGGER_LABELS[f.trigger] || f.trigger}</td>
                <td style={tdStyle}>{f.lot_number || '—'}{f.lot_status ? <div style={{ fontSize: 11.5, color: TEXT.muted }}>{LOT_STATUS_LABELS[f.lot_status] || f.lot_status}</div> : null}</td>
                <td style={tdStyle}><Pill text={STATUS_LABELS[f.status] || f.status} hex={STATUS_HEX[f.status]} /></td>
                <td style={tdStyle}>{f.decided_by_name ? `${f.decided_by_name}, ${fmtDate(f.decided_at)}` : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
