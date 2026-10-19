'use client'

import { useCallback, useEffect, useState } from 'react'
import { storeApi } from '@/lib/api'
import { TEXT, GLASS, SHADOWS } from '@/lib/theme'
import { inputStyle, secondaryBtnStyle } from '@/components/shared/ui'
import DateField from '@/components/erp/DateField'
import { extractErrorMessages } from '@/lib/validation'

// Stock on a posting date (SAP MB5B): rebuilt from the stock ledger, never from
// today's balances — opening, receipts, issues and closing per item and store,
// closing valued at the item's average on that date.

interface AsOfRow {
  item_id: number
  item_code: string | null
  item_name: string
  uom: string | null
  location_id: number
  location_name: string
  opening_qty: number
  opening_value: number
  receipt_qty: number
  issue_qty: number
  closing_qty: number
  closing_free_qty: number
  closing_quality_qty: number
  closing_blocked_qty: number
  closing_vendor_qty?: number
  closing_rate: number
  closing_value: number
  rate_source: string
}

interface AsOfReport {
  from_date: string
  to_date: string
  rows: AsOfRow[]
  total_opening_value: number
  total_closing_value: number
}

const RATE_BASIS: Record<string, string> = {
  average_on_date: 'Average on date',
  current_average: "Today's average",
  standard: 'Standard cost',
  none: 'No cost',
}

const todayIso = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
const inr = (n: number) => `₹${(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`
const th: React.CSSProperties = { position: 'sticky', top: 0, background: '#fdf1e6', zIndex: 1, padding: '9px 10px', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.04em', color: TEXT.secondary, textAlign: 'left', whiteSpace: 'nowrap' }
const td: React.CSSProperties = { padding: '8px 10px', fontSize: 12.5, color: TEXT.body, borderTop: '1px solid rgba(0,0,0,0.05)', whiteSpace: 'nowrap' }
const num: React.CSSProperties = { ...td, textAlign: 'right' }

export default function StockAsOfPanel({ locationId, search, canExport }: { locationId: string; search: string; canExport: boolean }) {
  const [toDate, setToDate] = useState(todayIso())
  const [fromDate, setFromDate] = useState(todayIso().slice(0, 8) + '01')
  const [report, setReport] = useState<AsOfReport | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [exporting, setExporting] = useState(false)

  const params = useCallback(() => ({ date: toDate, from_date: fromDate, ...(locationId ? { location_id: Number(locationId) } : {}) }), [toDate, fromDate, locationId])

  useEffect(() => {
    if (!toDate || !fromDate) return
    let cancelled = false
    setLoading(true)
    setError('')
    storeApi.stockAsOf(params())
      .then((r: AsOfReport) => { if (!cancelled) setReport(r) })
      .catch((err: unknown) => { if (!cancelled) { setReport(null); setError(extractErrorMessages(err, 'Could not build the stock on that date.').join(' ')) } })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [params, toDate, fromDate])

  const doExport = async () => {
    setExporting(true)
    setError('')
    try {
      const blob = await storeApi.exportStockAsOf(params())
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `stock_on_${toDate}.xlsx`
      a.click()
      URL.revokeObjectURL(url)
    } catch (err: unknown) {
      setError(extractErrorMessages(err, 'Could not export the stock on that date.').join(' '))
    } finally { setExporting(false) }
  }

  const q = search.trim().toLowerCase()
  const rows = (report?.rows || []).filter((r) => !q || [r.item_code, r.item_name, r.location_name].filter(Boolean).join(' ').toLowerCase().includes(q))

  return (
    <div data-tour="stock-asof">
      <p style={{ fontSize: 12.5, color: TEXT.muted, margin: '0 0 12px' }}>
        Stock as it stood at the end of a date, rebuilt from every posted movement — what Finance values as closing stock for a period.
        Closing includes Free, Quality, Blocked and stock with a job-work vendor (all still ours).
      </p>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'flex-end', marginBottom: 14 }}>
        <div style={{ flex: '0 1 170px', minWidth: 150 }}>
          <label style={{ fontSize: 12, fontWeight: 700, color: TEXT.secondary, marginBottom: 6, display: 'block' }}>Movements from</label>
          <DateField value={fromDate} onChange={setFromDate} style={inputStyle} />
        </div>
        <div style={{ flex: '0 1 170px', minWidth: 150 }}>
          <label style={{ fontSize: 12, fontWeight: 700, color: TEXT.secondary, marginBottom: 6, display: 'block' }}>Stock as of</label>
          <DateField value={toDate} onChange={setToDate} style={inputStyle} />
        </div>
        {canExport && <button onClick={doExport} disabled={exporting || !report} style={{ ...secondaryBtnStyle, opacity: exporting ? 0.7 : 1 }}>{exporting ? 'Exporting…' : 'Export Excel'}</button>}
        {report && (
          <div style={{ fontSize: 12.5, color: TEXT.secondary, marginLeft: 'auto' }}>
            Opening value <b>{inr(report.total_opening_value)}</b> · Closing value <b>{inr(report.total_closing_value)}</b>
          </div>
        )}
      </div>
      {error && (
        <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
          {error}
        </div>
      )}
      <div style={{ borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur, border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), overflow: 'auto', maxHeight: 'calc(100vh - 320px)' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 1100 }}>
          <thead>
            <tr>
              {['Item', 'Store', 'Opening', 'Receipts', 'Issues', 'Closing', 'Free', 'Quality', 'Blocked', 'With vendor', 'Rate', 'Closing value', 'Rate basis'].map((h) => <th key={h} style={th}>{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={13} style={{ ...td, textAlign: 'center', color: TEXT.muted }}>Building stock on {toDate}…</td></tr>}
            {!loading && rows.length === 0 && <tr><td colSpan={13} style={{ ...td, textAlign: 'center', color: TEXT.muted }}>No stock or movements for this date range.</td></tr>}
            {!loading && rows.map((r) => (
              <tr key={`${r.item_id}-${r.location_id}`}>
                <td style={td}><b>{r.item_code}</b> {r.item_name}</td>
                <td style={td}>{r.location_name}</td>
                <td style={num}>{r.opening_qty} {r.uom}</td>
                <td style={num}>{r.receipt_qty}</td>
                <td style={num}>{r.issue_qty}</td>
                <td style={{ ...num, fontWeight: 700 }}>{r.closing_qty} {r.uom}</td>
                <td style={num}>{r.closing_free_qty}</td>
                <td style={num}>{r.closing_quality_qty}</td>
                <td style={num}>{r.closing_blocked_qty}</td>
                <td style={num}>{r.closing_vendor_qty || 0}</td>
                <td style={num}>{inr(r.closing_rate)}</td>
                <td style={{ ...num, fontWeight: 700 }}>{inr(r.closing_value)}</td>
                <td style={{ ...td, color: r.rate_source === 'average_on_date' ? TEXT.muted : '#d97706' }}>{RATE_BASIS[r.rate_source] || r.rate_source}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
