'use client'

// MD04 stock / requirements list for one item — a portaled side drawer, opened
// from the MRP page and the Planning page (no item id in the URL).
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useEscapeKey } from '@/hooks/useEscapeKey'
import { mrpApi, StockRequirements } from '@/lib/mrpApi'
import { extractErrorMessages } from '@/lib/validation'
import { formatDate } from '@/lib/format'
import { TEXT, BORDER } from '@/lib/theme'
import { secondaryBtnStyle } from '@/components/shared/ui'

const EXC_HEX: Record<string, string> = {
  shortage: '#DC2626', reschedule_in: '#F59E0B', reschedule_out: '#2563EB', cancel: '#7C3AED',
  finish_in_past: '#DC2626', start_in_past: '#DC2626', below_safety_stock: '#F59E0B',
}
const EXC_SHORT: Record<string, string> = {
  shortage: 'Shortage', reschedule_in: 'Bring in', reschedule_out: 'Postpone', cancel: 'Cancel',
  finish_in_past: 'Overdue', start_in_past: 'Start in past', below_safety_stock: 'Below safety',
}
const pill = (hex: string): React.CSSProperties => ({ fontSize: 10.5, fontWeight: 700, padding: '2px 8px', borderRadius: 9999, background: `${hex}1a`, color: hex, whiteSpace: 'nowrap' })
const th: React.CSSProperties = { textAlign: 'left', padding: '7px 10px', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.03em', color: TEXT.muted, background: '#fdf1e6', position: 'sticky', top: 0, zIndex: 1 }
const td: React.CSSProperties = { padding: '7px 10px', fontSize: 12.5, color: TEXT.body, borderTop: `1px solid ${BORDER.light}`, verticalAlign: 'top' }
const fmt = (n: number) => +n.toFixed(4)

export default function StockRequirementsDrawer({ itemId, branchId, onClose }: { itemId: number | null; branchId?: number | null; onClose: () => void }) {
  const [data, setData] = useState<StockRequirements | null>(null)
  const [error, setError] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  useEscapeKey(itemId != null, onClose)

  useEffect(() => {
    if (itemId == null) return
    setLoading(true)
    setData(null)
    setError([])
    mrpApi.stockRequirements(itemId, branchId ? { branch_id: branchId } : {})
      .then(setData)
      .catch((err) => setError(extractErrorMessages(err, 'Failed to load the stock / requirements list.')))
      .finally(() => setLoading(false))
  }, [itemId, branchId])

  if (itemId == null || typeof document === 'undefined') return null

  return createPortal(
    <div onClick={onClose} className="dialog-backdrop" style={{ position: 'fixed', inset: 0, background: 'rgba(20,14,8,0.35)', zIndex: 200, display: 'flex', justifyContent: 'flex-end' }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: 'min(980px, 100vw)', height: '100%', background: '#fff', boxShadow: '-12px 0 40px rgba(0,0,0,0.2)', padding: 22, overflowY: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, marginBottom: 14 }}>
          <div>
            <p style={{ fontSize: 11, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 4px' }}>Stock / Requirements List (MD04)</p>
            <h2 style={{ fontSize: 19, fontWeight: 700, color: TEXT.heading, margin: 0 }}>{data ? `${data.item_code} — ${data.item_name}` : 'Loading…'}</h2>
          </div>
          <button type="button" style={secondaryBtnStyle} onClick={onClose}>Close</button>
        </div>

        {error.length > 0 && (
          <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
            {error.join(' ')}
          </div>
        )}
        {loading && <p style={{ fontSize: 13, color: TEXT.muted }}>Loading…</p>}

        {data && (
          <>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 18, fontSize: 12.5, color: TEXT.secondary, marginBottom: 14 }}>
              <span>Procurement: <b style={{ color: TEXT.heading }}>{data.procurement === 'make' ? `Make (${data.bom_number})` : 'Buy'}</b></span>
              <span>Stock: <b style={{ color: TEXT.heading }}>{fmt(data.stock)} {data.uom || ''}</b></span>
              <span>Safety stock: <b style={{ color: TEXT.heading }}>{fmt(data.safety_stock)}</b></span>
              <span>Lead time: <b style={{ color: TEXT.heading }}>{data.lead_time_days != null ? `${data.lead_time_days} day(s)` : 'not set'}</b></span>
              {data.min_order_qty ? <span>Min. order qty: <b style={{ color: TEXT.heading }}>{data.min_order_qty}</b></span> : null}
              <span>Ending available: <b style={{ color: data.ending_available < 0 ? '#DC2626' : '#16A34A' }}>{fmt(data.ending_available)}</b></span>
            </div>

            <div style={{ overflow: 'auto', maxHeight: 'calc(100vh - 340px)', border: `1px solid ${BORDER.light}`, borderRadius: 12 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 760 }}>
                <thead><tr>{['Date', 'MRP Element', 'Reference', 'Receipt / Reqmt', 'Available', 'Exception'].map((h) => <th key={h} style={th}>{h}</th>)}</tr></thead>
                <tbody>
                  {data.rows.map((r, i) => (
                    <tr key={i}>
                      <td style={{ ...td, whiteSpace: 'nowrap' }}>{formatDate(r.date)}</td>
                      <td style={td}>{r.element_label}{r.firmed ? <span style={{ ...pill('#16A34A'), marginLeft: 6 }}>Firmed</span> : null}</td>
                      <td style={td}>{r.reference}{r.pegged_to ? <div style={{ fontSize: 11, color: TEXT.muted }}>for {r.pegged_to}</div> : null}</td>
                      <td style={{ ...td, fontWeight: 600, color: r.element === 'stock' ? TEXT.heading : r.quantity < 0 ? '#DC2626' : '#16A34A' }}>{r.element === 'stock' ? '' : (r.quantity > 0 ? '+' : '')}{fmt(r.quantity)}</td>
                      <td style={{ ...td, fontWeight: 700, color: r.available < 0 ? '#DC2626' : TEXT.heading }}>{fmt(r.available)}</td>
                      <td style={td}>
                        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                          {r.exceptions.map((c) => <span key={c} style={pill(EXC_HEX[c] || '#78716c')}>{EXC_SHORT[c] || c}</span>)}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <p style={{ fontSize: 12, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.secondary, margin: '18px 0 8px' }}>Exception messages</p>
            {data.exceptions.length === 0 ? (
              <p style={{ fontSize: 13, color: TEXT.muted, margin: 0 }}>None — stock and receipts cover every requirement on time.</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {data.exceptions.map((e, i) => (
                  <div key={i} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', fontSize: 12.5, color: TEXT.body }}>
                    <span style={pill(EXC_HEX[e.code] || '#78716c')}>{e.label}</span>
                    <span>{e.message}</span>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>,
    document.body,
  )
}
