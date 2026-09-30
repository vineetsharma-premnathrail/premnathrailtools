'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { productionApi } from '@/lib/api'
import { ProductionWorkOrder } from '@/types'
import { TEXT, GLASS, SHADOWS, GRADIENTS, BORDER } from '@/lib/theme'
import ProductionNav from '@/components/production/ProductionNav'
import { extractErrorMessages } from '@/lib/validation'
import { formatDate } from '@/lib/format'

const STATUS_LABELS: Record<string, string> = { draft: 'Draft', released: 'Released', in_progress: 'In Progress', completed: 'Completed', closed: 'Closed', cancelled: 'Cancelled' }
const STATUS_HEX: Record<string, string> = { draft: '#78716c', released: '#2563EB', in_progress: '#F59E0B', completed: '#16A34A', closed: '#0f766e', cancelled: '#DC2626' }
const PRIORITY_LABELS: Record<string, string> = { low: 'Low', normal: 'Normal', high: 'High', urgent: 'Urgent' }
const PRIORITY_HEX: Record<string, string> = { low: '#78716c', normal: '#2563EB', high: '#F59E0B', urgent: '#DC2626' }

const STATUS_TABS = [
  { key: 'draft,released,in_progress', label: 'Open' },
  { key: 'draft', label: 'Draft' },
  { key: 'released', label: 'Released' },
  { key: 'in_progress', label: 'In Progress' },
  { key: 'completed', label: 'Completed' },
  { key: 'closed', label: 'Closed' },
  { key: 'cancelled', label: 'Cancelled' },
  { key: '', label: 'All' },
]

const inputStyle: React.CSSProperties = {
  padding: '9px 12px', borderRadius: 10, border: `1px solid ${BORDER.normal}`,
  background: 'rgba(255,255,255,.7)', fontSize: 13, outline: 'none', color: TEXT.body,
}
const cellStyle: React.CSSProperties = { padding: '10px 14px', fontSize: 13, color: TEXT.body, borderTop: `1px solid ${BORDER.light}` }

export default function ProductionWorkOrdersPage() {
  const { isAuthorized, isLoading } = useRequireApp('production')
  const router = useRouter()

  const [orders, setOrders] = useState<ProductionWorkOrder[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | string[]>('')
  const [search, setSearch] = useState('')
  const [statusTab, setStatusTab] = useState(STATUS_TABS[0].key)
  const [priority, setPriority] = useState('')
  const [overdueOnly, setOverdueOnly] = useState(false)

  useEffect(() => {
    if (!isAuthorized) return
    const params: Record<string, unknown> = {}
    if (statusTab) params.status = statusTab
    if (priority) params.priority = priority
    if (overdueOnly) params.overdue = true
    if (search.trim()) params.search = search.trim()
    productionApi.listWorkOrders(params)
      .then((data) => setOrders(Array.isArray(data) ? data : []))
      .catch((err) => setError(extractErrorMessages(err, 'Failed to load work orders.')))
      .finally(() => setLoading(false))
  }, [isAuthorized, statusTab, priority, overdueOnly, search])

  if (isLoading || !isAuthorized) return null

  return (
    <div>
      <ProductionNav />

      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, marginBottom: 20, flexWrap: 'wrap' }}>
        <div>
          <p style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 4px' }}>
            Production Module
          </p>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: TEXT.heading, margin: 0 }}>Work Orders</h1>
        </div>
        <button
          onClick={() => router.push('/dashboard/production/work-orders/new')}
          style={{
            padding: '12px 22px', borderRadius: 12, border: 'none', cursor: 'pointer',
            background: GRADIENTS.primary, color: '#fff', fontSize: 14, fontWeight: 600,
            boxShadow: `0 8px 20px ${SHADOWS.glowOrange}`,
          }}
        >
          + New Work Order
        </button>
      </div>

      {error && (
        <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
          {Array.isArray(error) ? error.join(' ') : error}
        </div>
      )}

      <div style={{ display: 'flex', gap: 6, marginBottom: 12, flexWrap: 'wrap' }}>
        {STATUS_TABS.map((t) => {
          const active = statusTab === t.key
          return (
            <button key={t.label} type="button" onClick={() => setStatusTab(t.key)} style={{
              padding: '6px 14px', borderRadius: 9999, fontSize: 12, fontWeight: 600, cursor: 'pointer',
              border: `1px solid ${active ? '#FF6A2A' : BORDER.normal}`, background: active ? 'rgba(255,106,42,0.1)' : 'rgba(255,255,255,.6)',
              color: active ? '#FF6A2A' : TEXT.secondary,
            }}>
              {t.label}
            </button>
          )
        })}
      </div>

      <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap', alignItems: 'center' }}>
        <input style={{ ...inputStyle, flex: '1 1 240px', minWidth: 200 }} placeholder="Search by WO number or product…" value={search} onChange={(e) => setSearch(e.target.value)} />
        <select style={{ ...inputStyle, flex: '0 1 160px' }} value={priority} onChange={(e) => setPriority(e.target.value)}>
          <option value="">All priorities</option>
          {Object.entries(PRIORITY_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: TEXT.secondary, cursor: 'pointer' }}>
          <input type="checkbox" checked={overdueOnly} onChange={(e) => setOverdueOnly(e.target.checked)} /> Overdue only
        </label>
      </div>

      <div style={{
        borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur,
        border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), overflow: 'auto', maxHeight: 'calc(100vh - 360px)',
      }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 1080 }}>
          <thead>
            <tr>
              {['WO Number', 'Product', 'Machine / Project', 'Qty', 'Progress', 'Priority', 'Planned End', 'Status', ''].map((h) => (
                <th key={h} style={{ textAlign: 'left', padding: '10px 14px', fontSize: 11, fontWeight: 600, letterSpacing: '.03em', textTransform: 'uppercase', color: TEXT.muted, position: 'sticky', top: 0, background: '#fdf1e6', zIndex: 1 }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={9} style={{ padding: 20, textAlign: 'center', fontSize: 13, color: TEXT.muted }}>Loading…</td></tr>
            ) : orders.length === 0 ? (
              <tr><td colSpan={9} style={{ padding: 20, textAlign: 'center', fontSize: 13, color: TEXT.muted }}>No work orders found.</td></tr>
            ) : (
              orders.map((o) => (
                <tr key={o.id} onClick={() => router.push(`/dashboard/production/work-orders/${o.id}`)} style={{ cursor: 'pointer' }}>
                  <td style={{ ...cellStyle, fontWeight: 600, color: TEXT.heading }}>{o.wo_number}</td>
                  <td style={cellStyle}>{o.product_code} — {o.product_name}</td>
                  <td style={cellStyle}>{o.project_label || '—'}</td>
                  <td style={cellStyle}>{o.quantity_completed} / {o.quantity_planned} {o.product_uom || ''}</td>
                  <td style={{ ...cellStyle, minWidth: 120 }}>
                    <div style={{ height: 6, borderRadius: 9999, background: 'rgba(0,0,0,0.08)', overflow: 'hidden' }}>
                      <div style={{ width: `${o.progress_percent}%`, height: '100%', background: '#16A34A' }} />
                    </div>
                    <span style={{ fontSize: 11, color: TEXT.muted }}>{o.progress_percent}%</span>
                  </td>
                  <td style={cellStyle}>
                    <span style={{ fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 9999, background: `${PRIORITY_HEX[o.priority]}1a`, color: PRIORITY_HEX[o.priority], whiteSpace: 'nowrap' }}>
                      {PRIORITY_LABELS[o.priority] || o.priority}
                    </span>
                  </td>
                  <td style={{ ...cellStyle, color: o.is_overdue ? '#DC2626' : TEXT.body, fontWeight: o.is_overdue ? 600 : 400 }}>
                    {o.planned_end_date ? formatDate(o.planned_end_date) : '—'}{o.is_overdue ? ' · overdue' : ''}
                  </td>
                  <td style={cellStyle}>
                    <span style={{ fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 9999, background: `${STATUS_HEX[o.status]}1a`, color: STATUS_HEX[o.status], whiteSpace: 'nowrap' }}>
                      {STATUS_LABELS[o.status] || o.status}
                    </span>
                  </td>
                  <td onClick={(e) => e.stopPropagation()} style={cellStyle}>
                    <span onClick={() => router.push(`/dashboard/production/work-orders/${o.id}`)} style={{ fontSize: 12, fontWeight: 600, color: '#FF6A2A', cursor: 'pointer' }}>View</span>
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
