'use client'

import { useEffect, useState } from 'react'
import { useRequireApp } from '@/hooks/useAuth'
import { qualityApi } from '@/lib/api'
import { QualityParetoRow } from '@/types'
import { TEXT } from '@/lib/theme'
import QualityNav from '@/components/quality/QualityNav'
import SearchableSelect from '@/components/erp/SearchableSelect'
import DateField from '@/components/erp/DateField'
import { Field, Section, inputStyle } from '@/components/shared/ui'
import { PageHeader, ErrorBanner, tableWrapStyle, thStyle, tdStyle, fmtMoney, INSPECTION_TYPE_LABELS } from '@/components/quality/QualityBits'
import { extractErrorMessages } from '@/lib/validation'

interface ItemOpt { id: number; item_code: string; item_name: string }

const NCR_SOURCES: Record<string, string> = {
  incoming: 'Incoming inspection', job_work: 'Job work', in_process: 'In-process', final: 'Final', customer_inspection: 'Customer / third-party',
  complaint: 'Customer complaint', audit: 'Audit', internal: 'Internal',
}

// Phase 3: defect Pareto. Phase 4 adds the KPI dashboard and the registers.
export default function QualityReportsPage() {
  const { isAuthorized, isLoading } = useRequireApp('quality')
  const yearStart = `${new Date().getFullYear()}-01-01`
  const [f, setF] = useState({ basis: 'ncr', date_from: yearStart, date_to: '', item_id: '', vendor: '', source: '' })
  const [items, setItems] = useState<ItemOpt[]>([])
  const [rows, setRows] = useState<QualityParetoRow[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | string[]>('')

  useEffect(() => {
    if (!isAuthorized) return
    qualityApi.lookupItems('').then(setItems).catch(() => setItems([]))
  }, [isAuthorized])

  useEffect(() => {
    if (!isAuthorized) return
    setLoading(true)
    setError('')
    const params: Record<string, unknown> = { basis: f.basis }
    if (f.date_from) params.date_from = f.date_from
    if (f.date_to) params.date_to = f.date_to
    if (f.item_id) params.item_id = Number(f.item_id)
    if (f.vendor.trim()) params.vendor = f.vendor.trim()
    if (f.source) params.source = f.source
    qualityApi.defectPareto(params)
      .then((d) => { setRows(d.rows || []); setTotal(d.total || 0) })
      .catch((err) => setError(extractErrorMessages(err, 'Failed to build the defect Pareto.')))
      .finally(() => setLoading(false))
  }, [isAuthorized, f])

  if (isLoading || !isAuthorized) return null
  const max = Math.max(1, ...rows.map((r) => r.count))
  const sources = f.basis === 'ncr' ? NCR_SOURCES : INSPECTION_TYPE_LABELS

  return (
    <div>
      <QualityNav />
      <PageHeader title="Quality Reports" />
      <ErrorBanner error={error} />
      <Section title="Defect Pareto" style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
          <div style={{ flex: '0 1 220px' }}>
            <Field label="Count">
              <select style={inputStyle} value={f.basis} onChange={(e) => setF({ ...f, basis: e.target.value, source: '' })}>
                <option value="ncr">NCRs</option><option value="lot_results">Failed characteristics on lots</option>
              </select>
            </Field>
          </div>
          <div style={{ flex: '0 1 160px' }}><Field label="From"><DateField value={f.date_from} onChange={(v) => setF({ ...f, date_from: v })} /></Field></div>
          <div style={{ flex: '0 1 160px' }}><Field label="To"><DateField value={f.date_to} onChange={(v) => setF({ ...f, date_to: v })} /></Field></div>
          <div style={{ flex: '1 1 240px', maxWidth: 340 }}>
            <Field label="Item">
              <SearchableSelect value={f.item_id} onChange={(v) => setF({ ...f, item_id: v })} placeholder="All items"
                options={[{ value: '', label: 'All items' }, ...items.map((i) => ({ value: String(i.id), label: `${i.item_code} — ${i.item_name}` }))]} />
            </Field>
          </div>
          <div style={{ flex: '1 1 180px', maxWidth: 260 }}><Field label="Vendor"><input style={inputStyle} value={f.vendor} onChange={(e) => setF({ ...f, vendor: e.target.value })} /></Field></div>
          <div style={{ flex: '0 1 220px' }}>
            <Field label={f.basis === 'ncr' ? 'NCR source' : 'Inspection type'}>
              <select style={inputStyle} value={f.source} onChange={(e) => setF({ ...f, source: e.target.value })}>
                <option value="">All</option>
                {Object.entries(sources).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </Field>
          </div>
        </div>
        <p style={{ fontSize: 12.5, color: TEXT.muted, margin: 0 }}>
          {total} occurrence(s). Highlighted rows are the &quot;vital few&quot; — the defect codes that make up the first 80% — where a CAPA pays off most.
        </p>
        <div style={tableWrapStyle}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 860 }}>
            <thead><tr>{['Defect code', 'Category', 'Count', '', '%', 'Cumulative %', 'Quantity', f.basis === 'ncr' ? 'Cost' : ''].map((h, i) => <th key={i} style={thStyle}>{h}</th>)}</tr></thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={8} style={{ ...tdStyle, textAlign: 'center', color: TEXT.muted }}>Loading…</td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={8} style={{ ...tdStyle, textAlign: 'center', color: TEXT.muted }}>No defects in this selection.</td></tr>
              ) : rows.map((r) => (
                <tr key={r.defect_code_id ?? 'none'} style={{ background: r.vital_few ? 'rgba(255,106,42,0.06)' : undefined }}>
                  <td style={{ ...tdStyle, fontWeight: 600, color: TEXT.heading }}>{r.code} — {r.name}</td>
                  <td style={tdStyle}>{r.category || '—'}</td>
                  <td style={tdStyle}>{r.count}</td>
                  <td style={{ ...tdStyle, width: 220 }}>
                    <div style={{ height: 10, borderRadius: 6, background: 'rgba(15,23,42,0.06)' }}>
                      <div style={{ height: '100%', width: `${(r.count / max) * 100}%`, borderRadius: 6, background: r.vital_few ? '#FF6A2A' : '#a8a29e' }} />
                    </div>
                  </td>
                  <td style={tdStyle}>{r.percent}%</td>
                  <td style={tdStyle}>{r.cumulative_percent}%</td>
                  <td style={tdStyle}>{r.quantity}</td>
                  <td style={tdStyle}>{f.basis === 'ncr' ? fmtMoney(r.cost) : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>
    </div>
  )
}
