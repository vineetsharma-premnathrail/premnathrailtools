'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { recordPath } from '@/lib/recordRef'
import { qualityApi } from '@/lib/api'
import { QualityInspectionLot } from '@/types'
import { TEXT } from '@/lib/theme'
import { extractErrorMessages } from '@/lib/validation'
import Select from '@/components/shared/Select'
import {
  Pill, ErrorBanner, tableWrapStyle, thStyle, tdStyle, filterInputStyle, fmtQty, fmtDate,
  INSPECTION_TYPE_LABELS, LOT_STATUS_LABELS, LOT_STATUS_HEX, DECISION_LABELS,
} from '@/components/quality/QualityBits'
import { RowCount } from '@/components/shared/ui'

/** Inspection lot table — the Inspection Lots register (all lots, filters)
 *  and My Inspections (`mine`: open lots assigned to me or unassigned). */
export default function LotList({ mine = false, initialType = '' }: { mine?: boolean; initialType?: string }) {
  const router = useRouter()
  const [lots, setLots] = useState<QualityInspectionLot[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | string[]>('')
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('')
  const [type, setType] = useState(initialType)
  const [waitingDays, setWaitingDays] = useState(2)

  useEffect(() => {
    qualityApi.getSettings().then((s) => setWaitingDays(Number(s.values?.lot_waiting_days) || 2)).catch(() => {})
  }, [])

  useEffect(() => {
    const params: Record<string, unknown> = {}
    if (mine) params.mine = true
    if (status) params.status = status
    if (type) params.inspection_type = type
    if (search.trim()) params.search = search.trim()
    // Debounce typing and drop late responses so an older search can't overwrite a newer one.
    let ignore = false
    const t = setTimeout(() => {
      setLoading(true)
      qualityApi.listLots(params)
        .then((d) => { if (ignore) return; setLots(Array.isArray(d) ? d : []); setError('') })
        .catch((err) => { if (!ignore) setError(extractErrorMessages(err, 'Failed to load inspection lots.')) })
        .finally(() => { if (!ignore) setLoading(false) })
    }, 250)
    return () => { ignore = true; clearTimeout(t) }
  }, [mine, status, type, search])

  const cols = ['Lot', 'Item', 'Qty', 'Type', 'Source', 'Status', 'Assigned', 'Age', 'Decision']

  return (
    <div>
      <ErrorBanner error={error} />
      <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
        <input style={{ ...filterInputStyle, flex: '1 1 240px', maxWidth: 420 }} placeholder="Search lot, item, GRN / WO number, vendor…" value={search} onChange={(e) => setSearch(e.target.value)} />
        <Select style={{ ...filterInputStyle, flex: '0 1 200px' }} value={type} onChange={(e) => setType(e.target.value)}>
          <option value="">All inspection types</option>
          {Object.entries(INSPECTION_TYPE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </Select>
        {!mine && (
          <Select style={{ ...filterInputStyle, flex: '0 1 180px' }} value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All statuses</option>
            {Object.entries(LOT_STATUS_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </Select>
        )}
      </div>
      <div style={tableWrapStyle}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 1000 }}>
          <thead><tr>{cols.map((h, i) => <th key={h} style={thStyle}>{h}{i === 0 && <RowCount count={lots.length} />}</th>)}</tr></thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={cols.length} style={{ ...tdStyle, textAlign: 'center', color: TEXT.muted }}>Loading…</td></tr>
            ) : lots.length === 0 ? (
              <tr><td colSpan={cols.length} style={{ ...tdStyle, textAlign: 'center', color: TEXT.muted }}>
                {mine ? 'Nothing waiting for you — open lots assigned to you or unassigned show here.' : 'No inspection lots found.'}
              </td></tr>
            ) : lots.map((l) => {
              const open = ['created', 'in_inspection', 'results_recorded'].includes(l.status)
              const late = open && l.age_days > waitingDays
              return (
                <tr key={l.id} onClick={() => router.push(recordPath('/dashboard/quality/lots', l))} style={{ cursor: 'pointer' }}>
                  <td style={{ ...tdStyle, fontWeight: 600, color: TEXT.heading, whiteSpace: 'nowrap' }}>{l.lot_number}</td>
                  <td style={tdStyle}>{l.item_code ? `${l.item_code} — ` : ''}{l.item_name}</td>
                  <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>{fmtQty(l.quantity, l.uom)}</td>
                  <td style={tdStyle}>{INSPECTION_TYPE_LABELS[l.inspection_type] || l.inspection_type}</td>
                  <td style={tdStyle}>{l.source_reference || l.source_type}</td>
                  <td style={tdStyle}><Pill text={LOT_STATUS_LABELS[l.status] || l.status} hex={LOT_STATUS_HEX[l.status]} /></td>
                  <td style={tdStyle}>{l.assigned_to_name || <span style={{ color: TEXT.muted }}>Unassigned</span>}</td>
                  <td style={{ ...tdStyle, color: late ? '#DC2626' : TEXT.body, fontWeight: late ? 700 : 400, whiteSpace: 'nowrap' }} title={`Lot date ${fmtDate(l.lot_date)}`}>
                    {l.age_days} d
                  </td>
                  <td style={tdStyle}>{l.decision ? DECISION_LABELS[l.decision] : '—'}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
