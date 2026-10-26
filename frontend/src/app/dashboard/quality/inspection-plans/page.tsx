'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { recordPath } from '@/lib/recordRef'
import { useRequireApp } from '@/hooks/useAuth'
import { useCan } from '@/lib/permissions'
import { qualityApi } from '@/lib/api'
import { QualityInspectionPlan } from '@/types'
import { TEXT } from '@/lib/theme'
import QualityNav from '@/components/quality/QualityNav'
import { primaryBtnStyle, RowCount } from '@/components/shared/ui'
import {
  Pill, PageHeader, ErrorBanner, tableWrapStyle, thStyle, tdStyle, filterInputStyle, fmtDate, INSPECTION_TYPE_LABELS, PLAN_STATUS_HEX, PLAN_STATUS_LABELS,
} from '@/components/quality/QualityBits'
import { extractErrorMessages } from '@/lib/validation'
import Select from '@/components/shared/Select'

const SAMPLING_LABEL: Record<string, string> = { aql: 'AQL', full: '100%', fixed: 'Fixed' }

export default function InspectionPlansPage() {
  const { isAuthorized, isLoading } = useRequireApp('quality')
  const router = useRouter()
  const { can } = useCan()
  const [plans, setPlans] = useState<QualityInspectionPlan[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | string[]>('')
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('')
  const [type, setType] = useState('')

  useEffect(() => {
    if (!isAuthorized) return
    const params: Record<string, unknown> = {}
    if (status) params.status = status
    if (type) params.inspection_type = type
    if (search.trim()) params.search = search.trim()
    // Debounce typing and drop late responses so an older search can't overwrite a newer one.
    let ignore = false
    const t = setTimeout(() => {
      setLoading(true)
      qualityApi.listInspectionPlans(params)
        .then((d) => { if (ignore) return; setPlans(Array.isArray(d) ? d : []); setError('') })
        .catch((err) => { if (!ignore) setError(extractErrorMessages(err, 'Failed to load inspection plans.')) })
        .finally(() => { if (!ignore) setLoading(false) })
    }, 250)
    return () => { ignore = true; clearTimeout(t) }
  }, [isAuthorized, status, type, search])

  if (isLoading || !isAuthorized) return null
  const cols = ['Plan', 'Item', 'Inspection type', 'Rev', 'Sampling', 'Lines', 'Status', 'Approved']

  return (
    <div>
      <QualityNav />
      <PageHeader title="Inspection Plans">
        {can('quality', 'inspection_plans', 'create') && (<button type="button" onClick={() => router.push('/dashboard/quality/inspection-plans/new')} style={primaryBtnStyle}>+ New Plan</button>)}
      </PageHeader>
      <p style={{ fontSize: 13, color: TEXT.muted, margin: '-10px 0 16px' }}>
        One approved (current) plan per item and inspection type. Approved plans are frozen — use &ldquo;New revision&rdquo; to change one; approving the revision makes the old one obsolete.
      </p>
      <ErrorBanner error={error} />
      <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
        <input style={{ ...filterInputStyle, flex: '1 1 240px', maxWidth: 420 }} placeholder="Search plan number or item…" value={search} onChange={(e) => setSearch(e.target.value)} />
        <Select style={{ ...filterInputStyle, flex: '0 1 200px' }} value={type} onChange={(e) => setType(e.target.value)}>
          <option value="">All inspection types</option>
          {Object.entries(INSPECTION_TYPE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </Select>
        <Select style={{ ...filterInputStyle, flex: '0 1 150px' }} value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All statuses</option><option value="draft">Draft</option><option value="pending_approval">Waiting for approval</option><option value="approved">Approved</option><option value="obsolete">Obsolete</option>
        </Select>
      </div>
      <div style={tableWrapStyle}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 920 }}>
          <thead><tr>{cols.map((h, i) => <th key={h} style={thStyle}>{h}{i === 0 && <RowCount count={plans.length} />}</th>)}</tr></thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={cols.length} style={{ ...tdStyle, textAlign: 'center', color: TEXT.muted }}>Loading…</td></tr>
            ) : plans.length === 0 ? (
              <tr><td colSpan={cols.length} style={{ ...tdStyle, textAlign: 'center', color: TEXT.muted }}>{search || status || type ? "No inspection plans match these filters." : "No inspection plans yet — use + New Plan."}</td></tr>
            ) : plans.map((p) => (
              <tr key={p.id} onClick={() => router.push(recordPath('/dashboard/quality/inspection-plans', p))} style={{ cursor: 'pointer' }}>
                <td style={{ ...tdStyle, fontWeight: 600, color: TEXT.heading }}>{p.plan_number}</td>
                <td style={tdStyle}>{p.item_code ? `${p.item_code} — ` : ''}{p.item_name}{!p.item_id && <span style={{ color: '#b45309' }}> (legacy — no item link)</span>}</td>
                <td style={tdStyle}>{INSPECTION_TYPE_LABELS[p.inspection_type] || p.inspection_type}</td>
                <td style={tdStyle}>{p.revision}</td>
                <td style={tdStyle}>{SAMPLING_LABEL[p.sampling_type] || p.sampling_type}{p.sampling_type === 'aql' && p.aql != null ? ` ${p.aql} / ${p.inspection_level}` : ''}</td>
                <td style={tdStyle}>{p.line_count}</td>
                <td style={tdStyle}><Pill text={PLAN_STATUS_LABELS[p.status] || p.status} hex={PLAN_STATUS_HEX[p.status]} /></td>
                <td style={tdStyle}>{p.approved_at ? `${fmtDate(p.approved_at)} · ${p.approved_by_name || ''}` : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
