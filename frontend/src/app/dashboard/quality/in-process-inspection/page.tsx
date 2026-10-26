'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { recordPath } from '@/lib/recordRef'
import { useRequireApp } from '@/hooks/useAuth'
import { useCan } from '@/lib/permissions'
import { qualityApi } from '@/lib/api'
import { QualityInspection } from '@/types'
import { TEXT, GLASS, SHADOWS, BORDER } from '@/lib/theme'
import QualityNav from '@/components/quality/QualityNav'
import LotList from '@/components/quality/LotList'
import { extractErrorMessages } from '@/lib/validation'
import { formatDate } from '@/lib/format'
import Select from '@/components/shared/Select'
import { primaryBtnStyle, RowCount, Pill } from '@/components/shared/ui'

const STATUS_LABELS: Record<string, string> = { pending: 'Pending', in_progress: 'In Progress', passed: 'Passed', failed: 'Failed', conditionally_passed: 'Conditionally Passed' }
const STATUS_HEX: Record<string, string> = { pending: '#F59E0B', in_progress: '#2563EB', passed: '#16A34A', failed: '#DC2626', conditionally_passed: '#7C3AED' }

const inputStyle: React.CSSProperties = {
  padding: '9px 12px', borderRadius: 10, border: `1px solid ${BORDER.normal}`,
  background: 'rgba(255,255,255,.7)', fontSize: 13, outline: 'none', color: TEXT.body,
}

export default function InProcessInspectionListPage() {
  const { isAuthorized, isLoading } = useRequireApp('quality')
  const router = useRouter()
  const { can } = useCan()

  const [inspections, setInspections] = useState<QualityInspection[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | string[]>('')
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')

  useEffect(() => {
    if (!isAuthorized) return
    const params: Record<string, unknown> = { inspection_type: 'in_process' }
    if (statusFilter) params.status = statusFilter
    if (search.trim()) params.search = search.trim()
    // Debounce typing and drop late responses so an older search can't overwrite a newer one.
    let ignore = false
    const t = setTimeout(() => {
      setLoading(true)
      qualityApi.listInspections(params)
        .then((data) => { if (ignore) return; setInspections(Array.isArray(data) ? data : []); setError('') })
        .catch((err) => { if (!ignore) setError(extractErrorMessages(err, 'Failed to load In-Process Inspections.')) })
        .finally(() => { if (!ignore) setLoading(false) })
    }, 250)
    return () => { ignore = true; clearTimeout(t) }
  }, [isAuthorized, statusFilter, search])

  if (isLoading || !isAuthorized) return null

  return (
    <div>
      <QualityNav />

      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, marginBottom: 20, flexWrap: 'wrap' }}>
        <div>
          <p style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 4px' }}>
            Quality Module
          </p>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: TEXT.heading, margin: 0 }}>In-process Inspections</h1>
          <p style={{ fontSize: 13, color: TEXT.muted, margin: '4px 0 0' }}>
            Production routing steps marked &ldquo;inspection required&rdquo; raise an in-process lot when the shop floor clicks Request Inspection. The next operation stays on hold until the lot&rsquo;s usage decision.
          </p>
        </div>
        {can('quality', 'inspection_lots', 'create') && (<button
          onClick={() => router.push('/dashboard/quality/lots/new')}
          style={primaryBtnStyle}
        >
          + Manual Lot
        </button>)}
      </div>

      <LotList initialType="in_process" />

      <h2 style={{ fontSize: 15, fontWeight: 700, color: TEXT.heading, margin: '28px 0 4px' }}>Earlier gate inspections</h2>
      <p style={{ fontSize: 12.5, color: TEXT.muted, margin: '0 0 12px' }}>
        Free-text gate inspections raised before inspection lots existed. Kept for history; any still pending can be finished here and still release their production step.
      </p>

      {error && (
        <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
          {Array.isArray(error) ? error.join(' ') : error}
        </div>
      )}

      <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
        <input
          style={{ ...inputStyle, flex: '1 1 240px', minWidth: 200 }}
          placeholder="Search by inspection #, item, batch, or project…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <Select style={{ ...inputStyle, flex: '0 1 180px' }} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="">All statuses</option>
          <option value="pending">Pending</option>
          <option value="in_progress">In Progress</option>
          <option value="passed">Passed</option>
          <option value="failed">Failed</option>
          <option value="conditionally_passed">Conditionally Passed</option>
        </Select>
      </div>

      <div style={{
        borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur,
        border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), overflow: 'auto', maxHeight: 'calc(100vh - 320px)',
      }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 920 }}>
          <thead>
            <tr>
              {['Inspection #', 'Item', 'Batch', 'Project', 'Qty Inspected', 'Date', 'Status'].map((h, i) => (
                <th key={h} style={{ textAlign: 'left', padding: '10px 14px', fontSize: 11, fontWeight: 600, letterSpacing: '.03em', textTransform: 'uppercase', color: TEXT.muted, position: 'sticky', top: 0, background: '#fdf1e6', zIndex: 1 }}>
                  {h}{i === 0 && <RowCount count={inspections.length} />}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={7} style={{ padding: 20, textAlign: 'center', fontSize: 13, color: TEXT.muted }}>Loading…</td></tr>
            ) : inspections.length === 0 ? (
              <tr><td colSpan={7} style={{ padding: 20, textAlign: 'center', fontSize: 13, color: TEXT.muted }}>No in-process inspections found.</td></tr>
            ) : (
              inspections.map((insp) => (
                <tr key={insp.id} onClick={() => router.push(recordPath('/dashboard/quality/in-process-inspection', insp))} style={{ cursor: 'pointer' }}>
                  <td style={{ padding: '10px 14px', fontSize: 13, fontWeight: 600, color: TEXT.heading, borderTop: `1px solid ${BORDER.light}` }}>{insp.inspection_number}</td>
                  <td style={{ padding: '10px 14px', fontSize: 13, color: TEXT.body, borderTop: `1px solid ${BORDER.light}` }}>{insp.item_name}{insp.item_code ? ` (${insp.item_code})` : ''}</td>
                  <td style={{ padding: '10px 14px', fontSize: 13, color: TEXT.body, borderTop: `1px solid ${BORDER.light}` }}>{insp.batch_number || '—'}</td>
                  <td style={{ padding: '10px 14px', fontSize: 13, color: TEXT.body, borderTop: `1px solid ${BORDER.light}` }}>{insp.project_label || '—'}</td>
                  <td style={{ padding: '10px 14px', fontSize: 13, color: TEXT.body, borderTop: `1px solid ${BORDER.light}` }}>{insp.quantity_inspected ?? '—'}</td>
                  <td style={{ padding: '10px 14px', fontSize: 13, color: TEXT.body, borderTop: `1px solid ${BORDER.light}` }}>{formatDate(insp.inspection_date)}</td>
                  <td style={{ padding: '10px 14px', borderTop: `1px solid ${BORDER.light}` }}>
                    <Pill label={STATUS_LABELS[insp.status] || insp.status} hex={STATUS_HEX[insp.status]} />
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
