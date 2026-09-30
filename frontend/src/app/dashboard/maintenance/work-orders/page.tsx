'use client'

import { useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { maintenanceApi } from '@/lib/api'
import { MaintenanceWorkOrder } from '@/types'
import { TEXT, GLASS, SHADOWS, GRADIENTS, BORDER } from '@/lib/theme'
import MaintenanceNav from '@/components/maintenance/MaintenanceNav'
import { extractErrorMessages } from '@/lib/validation'
import { formatDate } from '@/lib/format'
import { PRIORITY_LABELS, WO_STATUS_LABELS, WO_TYPE_LABELS, formatINR, formatMinutes } from '@/components/maintenance/labels'

const STATUS_HEX: Record<string, string> = { draft: '#78716c', assigned: '#2563EB', in_progress: '#F59E0B', on_hold: '#9333EA', completed: '#16A34A', closed: '#0f766e', cancelled: '#DC2626' }
const PRIORITY_HEX: Record<string, string> = { low: '#78716c', normal: '#2563EB', high: '#F59E0B', urgent: '#DC2626' }

const inputStyle: React.CSSProperties = {
  padding: '9px 12px', borderRadius: 10, border: `1px solid ${BORDER.normal}`,
  background: 'rgba(255,255,255,.7)', fontSize: 13, outline: 'none', color: TEXT.body,
}
const cellStyle: React.CSSProperties = { padding: '10px 14px', fontSize: 13, color: TEXT.body, borderTop: `1px solid ${BORDER.light}` }

export default function MaintenanceWorkOrdersPage() {
  const { isAuthorized, isLoading } = useRequireApp('maintenance')
  const router = useRouter()
  const searchParams = useSearchParams()

  const [orders, setOrders] = useState<MaintenanceWorkOrder[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | string[]>('')
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState(searchParams.get('status') || '')
  const [typeFilter, setTypeFilter] = useState('')
  const [mine, setMine] = useState(searchParams.get('mine') === '1')
  const [openOnly, setOpenOnly] = useState(!searchParams.get('status'))

  useEffect(() => {
    if (!isAuthorized) return
    const params: Record<string, unknown> = {}
    if (statusFilter) params.status = statusFilter
    else if (openOnly) params.open_only = true
    if (typeFilter) params.wo_type = typeFilter
    if (mine) params.mine = true
    if (search.trim()) params.search = search.trim()
    maintenanceApi.listWorkOrders(params)
      .then((data) => { setOrders(Array.isArray(data) ? data : []); setError('') })
      .catch((err) => setError(extractErrorMessages(err, 'Failed to load work orders.')))
      .finally(() => setLoading(false))
  }, [isAuthorized, statusFilter, typeFilter, mine, openOnly, search])

  if (isLoading || !isAuthorized) return null

  return (
    <div>
      <MaintenanceNav />

      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, marginBottom: 20, flexWrap: 'wrap' }}>
        <div>
          <p style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 4px' }}>
            Maintenance Module
          </p>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: TEXT.heading, margin: 0 }}>Work Orders</h1>
        </div>
        <button
          onClick={() => router.push('/dashboard/maintenance/work-orders/new')}
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

      <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap', alignItems: 'center' }}>
        <input style={{ ...inputStyle, flex: '1 1 240px', minWidth: 200 }} placeholder="Search by number, title or asset…" value={search} onChange={(e) => setSearch(e.target.value)} />
        <select style={{ ...inputStyle, flex: '0 1 170px' }} value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
          <option value="">All types</option>
          {Object.entries(WO_TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <select style={{ ...inputStyle, flex: '0 1 170px' }} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="">{openOnly ? 'Open + completed' : 'All statuses'}</option>
          {Object.entries(WO_STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        {!statusFilter && (
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: TEXT.body, cursor: 'pointer' }}>
            <input type="checkbox" checked={openOnly} onChange={(e) => setOpenOnly(e.target.checked)} /> Hide closed
          </label>
        )}
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: TEXT.body, cursor: 'pointer' }}>
          <input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} /> My jobs
        </label>
      </div>

      <div style={{
        borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur,
        border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), overflow: 'auto', maxHeight: 'calc(100vh - 320px)',
      }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 1150 }}>
          <thead>
            <tr>
              {['Number', 'Asset', 'Title', 'Type', 'Priority', 'Technician', 'Planned', 'Downtime', 'Cost', 'Status', ''].map((h) => (
                <th key={h} style={{ textAlign: 'left', padding: '10px 14px', fontSize: 11, fontWeight: 600, letterSpacing: '.03em', textTransform: 'uppercase', color: TEXT.muted, position: 'sticky', top: 0, background: '#fdf1e6', zIndex: 1 }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={11} style={{ padding: 20, textAlign: 'center', fontSize: 13, color: TEXT.muted }}>Loading…</td></tr>
            ) : orders.length === 0 ? (
              <tr><td colSpan={11} style={{ padding: 20, textAlign: 'center', fontSize: 13, color: TEXT.muted }}>
                {search || statusFilter || typeFilter || mine ? 'No work orders match these filters.' : 'No open work orders. Breakdown requests become work orders once maintenance picks them up.'}
              </td></tr>
            ) : (
              orders.map((w) => {
                const downtime = w.downtime_minutes ?? w.live_downtime_minutes
                return (
                  <tr key={w.id} onClick={() => router.push(`/dashboard/maintenance/work-orders/${w.id}`)} style={{ cursor: 'pointer' }}>
                    <td style={{ ...cellStyle, fontWeight: 600, color: TEXT.heading, whiteSpace: 'nowrap' }}>{w.wo_number}</td>
                    <td style={cellStyle}><span style={{ fontWeight: 600 }}>{w.asset_code}</span> <span style={{ color: TEXT.muted }}>{w.asset_name}</span></td>
                    <td style={{ ...cellStyle, maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={w.title}>{w.title}</td>
                    <td style={cellStyle}>{WO_TYPE_LABELS[w.wo_type] || w.wo_type}</td>
                    <td style={cellStyle}>
                      <span style={{ fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 9999, background: `${PRIORITY_HEX[w.priority]}1a`, color: PRIORITY_HEX[w.priority] }}>
                        {PRIORITY_LABELS[w.priority] || w.priority}
                      </span>
                    </td>
                    <td style={cellStyle}>{w.assigned_to_name || <span style={{ color: '#b45309' }}>Unassigned</span>}</td>
                    <td style={{ ...cellStyle, whiteSpace: 'nowrap' }}>{formatDate(w.planned_start)}</td>
                    <td style={{ ...cellStyle, whiteSpace: 'nowrap', color: w.machine_down && w.downtime_minutes == null ? '#DC2626' : TEXT.body }}>
                      {w.machine_down ? formatMinutes(downtime) : '—'}
                    </td>
                    <td style={{ ...cellStyle, whiteSpace: 'nowrap' }}>{w.total_cost ? formatINR(w.total_cost) : '—'}</td>
                    <td style={cellStyle}>
                      <span style={{ fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 9999, background: `${STATUS_HEX[w.status]}1a`, color: STATUS_HEX[w.status], whiteSpace: 'nowrap' }}>
                        {WO_STATUS_LABELS[w.status] || w.status}
                      </span>
                      {w.awaiting_confirmation && <span style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#F59E0B', marginTop: 4 }}>Awaiting requester</span>}
                    </td>
                    <td onClick={(e) => e.stopPropagation()} style={cellStyle}>
                      <span onClick={() => router.push(`/dashboard/maintenance/work-orders/${w.id}`)} style={{ fontSize: 12, fontWeight: 600, color: '#FF6A2A', cursor: 'pointer' }}>View</span>
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
