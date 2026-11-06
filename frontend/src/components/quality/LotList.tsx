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
import { useVisibility } from '@/lib/visibility'
import { VisTd, VisTh } from '@/lib/visibilityComponents'
import { sampleLots } from '@/lib/qualityPreviewSamples'

// Inspection types that can exist while Quality is live for incoming inspection only (qualityLive.ts).
const LIVE_LOT_TYPES = ['incoming', 'stock_reinspection', 'sales_return']

const VIEW_LABELS: Record<string, string> = {
  waiting: 'Lots waiting', in_inspection: 'In inspection', overdue: 'Lots waiting too long', decided_month: 'Decided this month', rejected_month: 'Rejected this month',
}

/** Inspection lot table — the Inspection Lots register (all lots, filters)
 *  and My Inspections (`mine`: open lots assigned to me or unassigned). */
export default function LotList({ mine = false, initialType = '', initialView = '' }: { mine?: boolean; initialType?: string; initialView?: string }) {
  const router = useRouter()
  // Columns the user's roles hide; in the Role editor's preview the list shows sample rows and loads nothing.
  const vis = useVisibility('quality:inspection_lots')
  const [lots, setLots] = useState<QualityInspectionLot[]>(vis.preview ? sampleLots : [])
  const [loading, setLoading] = useState(!vis.preview)
  const [error, setError] = useState<string | string[]>('')
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('')
  const [type, setType] = useState(initialType)
  const [waitingDays, setWaitingDays] = useState(2)
  // Dashboard count cards open this list already filtered (?view=); the chip below clears it.
  // The server applies the view (?view= on the list API).
  const [view, setView] = useState(initialView in VIEW_LABELS ? initialView : '')

  useEffect(() => {
    if (vis.preview) return
    qualityApi.getSettings().then((s) => setWaitingDays(Number(s.values?.lot_waiting_days) || 2)).catch(() => {})
  }, [vis.preview])

  useEffect(() => {
    if (vis.preview) return  // sample rows from the first render, nothing is loaded
    const params: Record<string, unknown> = {}
    if (mine) params.mine = true
    if (status) params.status = status
    if (view) params.view = view
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
  }, [mine, status, type, search, view, vis.preview])

  // [label, hideable column key]: number and status are never hideable.
  const cols: [string, string | null][] = [['Lot', null], ['Item', 'item'], ['Qty', 'qty'], ['Type', 'type'], ['Source', 'source'],
    ['Status', null], ['Assigned', 'assigned'], ['Age', 'age'], ['Decision', 'decision']]
  // The preview draws every column (hidden ones dimmed, with a toggle); normal use drops the hidden ones.
  const colCount = cols.filter(([, k]) => !k || vis.preview || vis.showColumn('lots', k)).length

  return (
    <div>
      <ErrorBanner error={error} />
      {view && (
        <div style={{ marginBottom: 12 }}>
          <button type="button" onClick={() => setView('')} title="Show all lots again" style={{ ...filterInputStyle, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 8, fontWeight: 600 }}>
            {VIEW_LABELS[view]} <span aria-hidden>✕</span>
          </button>
        </div>
      )}
      <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
        <input style={{ ...filterInputStyle, flex: '1 1 240px', maxWidth: 420 }} placeholder="Search lot, item, GRN / WO number, vendor…" value={search} onChange={(e) => setSearch(e.target.value)} />
        <Select style={{ ...filterInputStyle, flex: '0 1 200px' }} value={type} onChange={(e) => setType(e.target.value)}>
          <option value="">All inspection types</option>
          {LIVE_LOT_TYPES.map((v) => <option key={v} value={v}>{INSPECTION_TYPE_LABELS[v] || v}</option>)}
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
          <thead><tr>{cols.map(([h, k], i) => {
            const head = <>{h}{i === 0 && <RowCount count={lots.length} />}</>
            return k ? <VisTh key={h} vis={vis} table="lots" k={k} style={thStyle}>{head}</VisTh> : <th key={h} style={thStyle}>{head}</th>
          })}</tr></thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={colCount} style={{ ...tdStyle, textAlign: 'center', color: TEXT.muted }}>Loading…</td></tr>
            ) : lots.length === 0 ? (
              <tr><td colSpan={colCount} style={{ ...tdStyle, textAlign: 'center', color: TEXT.muted }}>
                {mine ? 'Nothing waiting for you — open lots assigned to you or unassigned show here.' : 'No inspection lots found.'}
              </td></tr>
            ) : lots.map((l) => {
              const open = ['created', 'in_inspection', 'results_recorded'].includes(l.status)
              const late = open && l.age_days > waitingDays
              return (
                <tr key={l.id} onClick={vis.preview ? undefined : () => router.push(recordPath('/dashboard/quality/lots', l))} style={{ cursor: vis.preview ? 'default' : 'pointer' }}>
                  <td style={{ ...tdStyle, fontWeight: 600, color: TEXT.heading, whiteSpace: 'nowrap' }}>{l.lot_number}</td>
                  <VisTd vis={vis} table="lots" k="item" style={tdStyle}>{l.item_code ? `${l.item_code} — ` : ''}{l.item_name}</VisTd>
                  <VisTd vis={vis} table="lots" k="qty" style={{ ...tdStyle, whiteSpace: 'nowrap' }}>{fmtQty(l.quantity, l.uom)}</VisTd>
                  <VisTd vis={vis} table="lots" k="type" style={tdStyle}>{INSPECTION_TYPE_LABELS[l.inspection_type] || l.inspection_type}</VisTd>
                  <VisTd vis={vis} table="lots" k="source" style={tdStyle}>{l.source_reference || l.source_type}</VisTd>
                  <td style={tdStyle}><Pill text={LOT_STATUS_LABELS[l.status] || l.status} hex={LOT_STATUS_HEX[l.status]} /></td>
                  <VisTd vis={vis} table="lots" k="assigned" style={tdStyle}>{l.assigned_to_name || <span style={{ color: TEXT.muted }}>Unassigned</span>}</VisTd>
                  <VisTd vis={vis} table="lots" k="age" style={{ ...tdStyle, color: late ? '#DC2626' : TEXT.body, fontWeight: late ? 700 : 400, whiteSpace: 'nowrap' }} title={`Lot date ${fmtDate(l.lot_date)}`}>
                    {l.age_days} d
                  </VisTd>
                  <VisTd vis={vis} table="lots" k="decision" style={tdStyle}>{l.decision ? DECISION_LABELS[l.decision] : '—'}</VisTd>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
