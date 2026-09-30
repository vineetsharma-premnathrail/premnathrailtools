'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { productionApi } from '@/lib/api'
import { ProductionMaterialRequirement, ProductionPlanning } from '@/types'
import { TEXT, GLASS, SHADOWS, BORDER } from '@/lib/theme'
import { secondaryBtnStyle } from '@/components/shared/ui'
import ProductionNav from '@/components/production/ProductionNav'
import { extractErrorMessages } from '@/lib/validation'
import { formatDate } from '@/lib/format'

const STATUS_LABELS: Record<string, string> = { draft: 'Draft', released: 'Released', in_progress: 'In Progress' }
const STATUS_HEX: Record<string, string> = { draft: '#78716c', released: '#2563EB', in_progress: '#F59E0B' }

const sectionStyle: React.CSSProperties = {
  borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur,
  border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), padding: 20, marginBottom: 20,
}
const sectionTitle: React.CSSProperties = { fontSize: 12, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.secondary, margin: '0 0 6px' }
const thStyle: React.CSSProperties = { textAlign: 'left', padding: '8px 12px', fontSize: 11, fontWeight: 600, letterSpacing: '.03em', textTransform: 'uppercase', color: TEXT.muted, background: '#fdf1e6', position: 'sticky', top: 0, zIndex: 1 }
const tdStyle: React.CSSProperties = { padding: '9px 12px', fontSize: 13, color: TEXT.body, borderTop: `1px solid ${BORDER.light}`, verticalAlign: 'top' }
const pill = (hex: string): React.CSSProperties => ({ fontSize: 11, fontWeight: 700, padding: '3px 9px', borderRadius: 9999, background: `${hex}1a`, color: hex, whiteSpace: 'nowrap' })
const fmtQty = (n: number) => +n.toFixed(4)
const DAY_MS = 86400000
const actionBtn: React.CSSProperties = { ...secondaryBtnStyle, padding: '5px 12px', fontSize: 12 }

export default function ProductionPlanningPage() {
  const { isAuthorized, isLoading, user } = useRequireApp('production')
  const router = useRouter()
  const [data, setData] = useState<ProductionPlanning | null>(null)
  const [includeDraft, setIncludeDraft] = useState(true)
  const [shortOnly, setShortOnly] = useState(false)
  const [error, setError] = useState<string | string[]>('')

  useEffect(() => {
    if (!isAuthorized) return
    productionApi.getPlanning({ include_draft: includeDraft })
      .then(setData)
      .catch((err) => setError(extractErrorMessages(err, 'Failed to load production planning.')))
  }, [isAuthorized, includeDraft])

  const requirements = useMemo(() => (data?.requirements || []).filter((r) => !shortOnly || r.shortage_qty > 0), [data, shortOnly])

  // Timeline window covering every scheduled order, padded to whole days.
  const timeline = useMemo(() => {
    const dated = (data?.schedule || []).filter((s) => s.planned_start_date || s.planned_end_date)
    if (!dated.length) return null
    const times = dated.flatMap((s) => [s.planned_start_date, s.planned_end_date].filter(Boolean).map((d) => new Date(d as string).getTime()))
    const todayMs = new Date(new Date().toISOString().slice(0, 10)).getTime()
    const start = Math.min(...times, todayMs)
    const end = Math.max(...times, todayMs) + DAY_MS
    return { start, end, span: end - start, todayMs }
  }, [data])

  const canRaisePr = !!user?.apps?.includes('p2p')
  const prLink = (r: ProductionMaterialRequirement) => {
    const params = new URLSearchParams({
      item_name: r.item_name || r.item_code || '',
      part_code: r.item_code || '',
      unit: r.uom || '',
      quantity: String(Math.ceil(r.shortage_qty)),
      remarks: `Material shortage for Production work order(s) ${r.orders.map((o) => o.wo_number).join(', ')}.`,
    })
    return `/dashboard/p2p/new?${params.toString()}`
  }

  if (isLoading || !isAuthorized) return null

  return (
    <div>
      <ProductionNav />

      <div style={{ marginBottom: 20 }}>
        <p style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 4px' }}>
          Production Module
        </p>
        <h1 style={{ fontSize: 24, fontWeight: 700, color: TEXT.heading, margin: 0 }}>Production Planning</h1>
      </div>

      {error && (
        <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
          {Array.isArray(error) ? error.join(' ') : error}
        </div>
      )}

      {data && (
        <>
          <div style={sectionStyle}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
              <div>
                <p style={sectionTitle}>Material Requirements vs Stock</p>
                <p style={{ fontSize: 12, color: TEXT.muted, margin: 0 }}>
                  Outstanding component demand of open work orders against Store stock available (on hand − reserved) across all locations.
                </p>
              </div>
              <div style={{ display: 'flex', gap: 14, fontSize: 13, color: TEXT.secondary }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                  <input type="checkbox" checked={includeDraft} onChange={(e) => setIncludeDraft(e.target.checked)} /> Include draft orders
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                  <input type="checkbox" checked={shortOnly} onChange={(e) => setShortOnly(e.target.checked)} /> Shortages only
                </label>
              </div>
            </div>
            <div style={{ overflow: 'auto', maxHeight: 460 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 900 }}>
                <thead><tr>{['Item', 'Needed', 'Reserved', 'Free Stock', 'Shortage', 'Reorder Level', 'For Work Orders', ''].map((h) => <th key={h} style={thStyle}>{h}</th>)}</tr></thead>
                <tbody>
                  {requirements.length === 0 ? (
                    <tr><td colSpan={8} style={{ ...tdStyle, textAlign: 'center', color: TEXT.muted }}>{shortOnly ? 'No shortages — Store can cover every open work order.' : 'No outstanding material on open work orders.'}</td></tr>
                  ) : requirements.map((r) => (
                    <tr key={r.item_id}>
                      <td style={{ ...tdStyle, fontWeight: 600, color: TEXT.heading }}>{r.item_code} — {r.item_name}</td>
                      <td style={tdStyle}>{fmtQty(r.outstanding_qty)} {r.uom || ''}</td>
                      <td style={tdStyle}>{fmtQty(r.reserved_qty)}</td>
                      <td style={tdStyle}>{fmtQty(r.available_qty)}</td>
                      <td style={{ ...tdStyle, fontWeight: 700, color: r.shortage_qty > 0 ? '#DC2626' : '#16A34A' }}>{r.shortage_qty > 0 ? fmtQty(r.shortage_qty) : 'Covered'}</td>
                      <td style={tdStyle}>{r.reorder_level ?? '—'}</td>
                      <td style={tdStyle}>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                          {r.orders.map((o) => (
                            <span key={o.work_order_id} onClick={() => router.push(`/dashboard/production/work-orders/${o.work_order_id}`)}
                              style={{ ...pill(STATUS_HEX[o.status] || '#78716c'), cursor: 'pointer' }} title={STATUS_LABELS[o.status]}>
                              {o.wo_number}: {fmtQty(o.outstanding_qty)}
                            </span>
                          ))}
                        </div>
                      </td>
                      <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>
                        {r.shortage_qty > 0 && r.make_bom_id && (
                          <button type="button" style={actionBtn} title="This item has its own active BOM — build the shortfall"
                            onClick={() => router.push(`/dashboard/production/work-orders/new?bom_id=${r.make_bom_id}&quantity=${fmtQty(r.shortage_qty)}`)}>
                            Build
                          </button>
                        )}
                        {r.shortage_qty > 0 && !r.make_bom_id && canRaisePr && (
                          <button type="button" style={actionBtn} onClick={() => router.push(prLink(r))}>Raise PR</button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {data.requirements.some((r) => r.shortage_qty > 0) && (
              <p style={{ fontSize: 12, color: TEXT.muted, margin: '12px 0 0' }}>
                Use &quot;Raise PR&quot; to request bought-out items from Procurement (pre-filled, you review before submitting), or &quot;Build&quot; to raise a work order for a sub-assembly that has its own BOM. Once stock arrives, open the work order and click &quot;Top Up Reservation&quot;.
              </p>
            )}
          </div>

          <div style={sectionStyle}>
            <p style={sectionTitle}>Workstation Load</p>
            <p style={{ fontSize: 12, color: TEXT.muted, margin: '0 0 12px' }}>Remaining planned hours of open operations on released and in-progress orders, in working days at each workstation&apos;s daily capacity.</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {data.workstation_load.length === 0 && <p style={{ fontSize: 13, color: TEXT.muted, margin: 0 }}>No workstations set up yet.</p>}
              {data.workstation_load.map((w) => {
                const days = w.load_days ?? 0
                const hex = days > 10 ? '#DC2626' : days > 5 ? '#F59E0B' : '#16A34A'
                return (
                  <div key={w.workstation_id ?? 'none'} style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 13, fontWeight: 600, color: TEXT.heading, flex: '0 1 240px', minWidth: 180 }}>{w.workstation_name}</span>
                    <div style={{ flex: '1 1 200px', height: 8, borderRadius: 9999, background: 'rgba(0,0,0,0.08)', overflow: 'hidden' }}>
                      <div style={{ width: `${Math.min(days / 15, 1) * 100}%`, height: '100%', background: hex }} />
                    </div>
                    <span style={{ fontSize: 12, color: TEXT.secondary, flex: '0 1 260px', minWidth: 200 }}>
                      {w.remaining_hours} h · {w.open_operations} op(s){w.load_days != null ? ` · ${w.load_days} day(s)` : w.remaining_hours ? ' · no capacity set' : ''}
                      {w.status && w.status !== 'active' ? ` · ${w.status.replace('_', ' ')}` : ''}
                    </span>
                  </div>
                )
              })}
            </div>
          </div>

          <div style={sectionStyle}>
            <p style={sectionTitle}>Schedule</p>
            <p style={{ fontSize: 12, color: TEXT.muted, margin: '0 0 12px' }}>Open work orders on their planned dates. The orange line is today.</p>
            {data.schedule.length === 0 ? (
              <p style={{ fontSize: 13, color: TEXT.muted, margin: 0 }}>No open work orders.</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {timeline && (
                  <div style={{ display: 'flex', gap: 12, fontSize: 11, color: TEXT.muted }}>
                    <span style={{ flex: '0 0 200px' }} />
                    <div style={{ flex: 1, display: 'flex', justifyContent: 'space-between' }}>
                      <span>{formatDate(new Date(timeline.start))}</span>
                      <span>{formatDate(new Date(timeline.end - DAY_MS))}</span>
                    </div>
                  </div>
                )}
                {data.schedule.map((s) => {
                  const startMs = s.planned_start_date ? new Date(s.planned_start_date).getTime() : s.planned_end_date ? new Date(s.planned_end_date).getTime() : null
                  const endMs = (s.planned_end_date ? new Date(s.planned_end_date).getTime() : startMs ?? 0) + DAY_MS
                  const left = timeline && startMs != null ? ((startMs - timeline.start) / timeline.span) * 100 : 0
                  const width = timeline && startMs != null ? Math.max(((endMs - startMs) / timeline.span) * 100, 1.5) : 0
                  return (
                    <div key={s.work_order_id} style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                      <span onClick={() => router.push(`/dashboard/production/work-orders/${s.work_order_id}`)}
                        style={{ flex: '0 0 200px', fontSize: 12.5, cursor: 'pointer', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={s.product_name || ''}>
                        <b style={{ color: TEXT.heading }}>{s.wo_number}</b> <span style={{ color: TEXT.muted }}>{s.product_name}</span>
                      </span>
                      <div style={{ flex: 1, position: 'relative', height: 20, borderRadius: 6, background: 'rgba(0,0,0,0.04)' }}>
                        {timeline && startMs != null ? (
                          <>
                            <div style={{ position: 'absolute', left: `${left}%`, width: `${width}%`, top: 3, bottom: 3, borderRadius: 5, background: `${s.is_overdue ? '#DC2626' : STATUS_HEX[s.status]}40`, border: `1px solid ${s.is_overdue ? '#DC2626' : STATUS_HEX[s.status]}` }}>
                              <div style={{ width: `${s.progress_percent}%`, height: '100%', background: s.is_overdue ? '#DC2626' : STATUS_HEX[s.status], borderRadius: 4 }} />
                            </div>
                            <div style={{ position: 'absolute', left: `${((timeline.todayMs - timeline.start) / timeline.span) * 100}%`, top: 0, bottom: 0, width: 2, background: '#FF6A2A' }} />
                          </>
                        ) : (
                          <span style={{ fontSize: 11, color: TEXT.muted, position: 'absolute', left: 8, top: 3 }}>No planned dates</span>
                        )}
                      </div>
                      <span style={{ flex: '0 0 90px' }}><span style={pill(STATUS_HEX[s.status] || '#78716c')}>{STATUS_LABELS[s.status] || s.status}</span></span>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
