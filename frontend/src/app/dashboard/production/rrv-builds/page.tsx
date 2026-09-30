'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { rrvApi } from '@/lib/api'
import { ProductionRrvBuild } from '@/types'
import { TEXT, GLASS, SHADOWS, GRADIENTS, BORDER } from '@/lib/theme'
import ProductionNav from '@/components/production/ProductionNav'
import { secondaryBtnStyle } from '@/components/shared/ui'
import { extractErrorMessages } from '@/lib/validation'
import { formatDate } from '@/lib/format'

const STATUS_LABELS: Record<string, string> = { planned: 'Planned', in_progress: 'In Progress', on_hold: 'On Hold', completed: 'Completed', handed_over: 'Handed Over', cancelled: 'Cancelled' }
const STATUS_HEX: Record<string, string> = { planned: '#78716c', in_progress: '#2563EB', on_hold: '#F59E0B', completed: '#7C3AED', handed_over: '#16A34A', cancelled: '#DC2626' }
const PRIORITY_HEX: Record<string, string> = { low: '#78716c', normal: '#2563EB', high: '#F59E0B', urgent: '#DC2626' }

const STATUS_TABS = [
  { key: 'planned,in_progress,on_hold,completed', label: 'Open' },
  { key: 'in_progress', label: 'In Progress' },
  { key: 'on_hold', label: 'On Hold' },
  { key: 'completed', label: 'Ready for Handover' },
  { key: 'handed_over', label: 'Handed Over' },
  { key: 'cancelled', label: 'Cancelled' },
  { key: '', label: 'All' },
]

const inputStyle: React.CSSProperties = {
  padding: '9px 12px', borderRadius: 10, border: `1px solid ${BORDER.normal}`,
  background: 'rgba(255,255,255,.7)', fontSize: 13, outline: 'none', color: TEXT.body,
}
const cellStyle: React.CSSProperties = { padding: '10px 14px', fontSize: 13, color: TEXT.body, borderTop: `1px solid ${BORDER.light}` }

export default function RrvBuildsPage() {
  const { isAuthorized, isLoading } = useRequireApp('production')
  const router = useRouter()
  const [builds, setBuilds] = useState<ProductionRrvBuild[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | string[]>('')
  const [statusTab, setStatusTab] = useState(STATUS_TABS[0].key)
  const [search, setSearch] = useState('')
  const [overdueOnly, setOverdueOnly] = useState(false)

  useEffect(() => {
    if (!isAuthorized) return
    const params: Record<string, unknown> = {}
    if (statusTab) params.status = statusTab
    if (search.trim()) params.search = search.trim()
    if (overdueOnly) params.overdue = true
    const handle = setTimeout(() => {
      setLoading(true)
      rrvApi.list(params)
        .then((data) => { setBuilds(Array.isArray(data) ? data : []); setError('') })
        .catch((err) => setError(extractErrorMessages(err, 'Failed to load RRV builds.')))
        .finally(() => setLoading(false))
    }, search ? 250 : 0)
    return () => clearTimeout(handle)
  }, [isAuthorized, statusTab, search, overdueOnly])

  if (isLoading || !isAuthorized) return null

  return (
    <div>
      <ProductionNav />

      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, marginBottom: 20, flexWrap: 'wrap' }}>
        <div>
          <p style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 4px' }}>Production Module</p>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: TEXT.heading, margin: 0 }}>RRV Builds</h1>
          <p style={{ fontSize: 13, color: TEXT.muted, margin: '4px 0 0' }}>One record per Rail-cum-Road Vehicle — from planning through assembly, testing and rework to customer handover.</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={() => router.push('/dashboard/production/rrv-builds/rework')} type="button" style={secondaryBtnStyle}>Rework Orders</button>
          <button
            onClick={() => router.push('/dashboard/production/rrv-builds/new')}
            style={{ padding: '12px 22px', borderRadius: 12, border: 'none', cursor: 'pointer', background: GRADIENTS.primary, color: '#fff', fontSize: 14, fontWeight: 600, boxShadow: `0 8px 20px ${SHADOWS.glowOrange}` }}
          >
            + New RRV Build
          </button>
        </div>
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
        <input style={{ ...inputStyle, flex: '1 1 260px', minWidth: 200, maxWidth: 440 }} placeholder="Search build no., model, customer, serial, chassis or PO…" value={search} onChange={(e) => setSearch(e.target.value)} />
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: TEXT.secondary, cursor: 'pointer' }}>
          <input type="checkbox" checked={overdueOnly} onChange={(e) => setOverdueOnly(e.target.checked)} /> Past target handover only
        </label>
      </div>

      <div style={{
        borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur,
        border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), overflow: 'auto', maxHeight: 'calc(100vh - 380px)',
      }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 1120 }}>
          <thead>
            <tr>
              {['Build', 'Model / Customer', 'Serial · Chassis', 'Progress', 'Current Stage', 'Rework', 'Target Handover', 'Status', ''].map((h) => (
                <th key={h} style={{ textAlign: 'left', padding: '10px 14px', fontSize: 11, fontWeight: 600, letterSpacing: '.03em', textTransform: 'uppercase', color: TEXT.muted, position: 'sticky', top: 0, background: '#fdf1e6', zIndex: 1 }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={9} style={{ padding: 20, textAlign: 'center', fontSize: 13, color: TEXT.muted }}>Loading…</td></tr>
            ) : builds.length === 0 ? (
              <tr><td colSpan={9} style={{ padding: 20, textAlign: 'center', fontSize: 13, color: TEXT.muted }}>No RRV builds here. Start one with “+ New RRV Build”.</td></tr>
            ) : (
              builds.map((b) => {
                const pct = b.stages_total ? Math.round((b.stages_done / b.stages_total) * 100) : 0
                return (
                  <tr key={b.id} onClick={() => router.push(`/dashboard/production/rrv-builds/${b.id}`)} style={{ cursor: 'pointer' }}>
                    <td style={{ ...cellStyle, fontWeight: 600, color: TEXT.heading, whiteSpace: 'nowrap' }}>
                      {b.build_number}
                      {b.priority !== 'normal' && <div><span style={{ fontSize: 10.5, fontWeight: 700, color: PRIORITY_HEX[b.priority] }}>{b.priority.toUpperCase()}</span></div>}
                    </td>
                    <td style={{ ...cellStyle, maxWidth: 260 }}>
                      <div style={{ fontWeight: 600 }}>{b.rrv_model}</div>
                      <div style={{ fontSize: 12, color: TEXT.muted }}>{b.customer_name || '—'}{b.customer_po_number ? ` · PO ${b.customer_po_number}` : ''}</div>
                    </td>
                    <td style={cellStyle}>
                      <div>{b.vehicle_serial_number || b.machine_label || '—'}</div>
                      <div style={{ fontSize: 12, color: TEXT.muted }}>{b.chassis_number || 'no chassis no. yet'}</div>
                    </td>
                    <td style={{ ...cellStyle, minWidth: 130 }}>
                      <div style={{ height: 6, borderRadius: 9999, background: 'rgba(0,0,0,0.08)', overflow: 'hidden' }}>
                        <div style={{ width: `${pct}%`, height: '100%', background: '#16A34A' }} />
                      </div>
                      <span style={{ fontSize: 11, color: TEXT.muted }}>{b.stages_done} / {b.stages_total} stages</span>
                    </td>
                    <td style={cellStyle}>{b.status === 'handed_over' ? '—' : b.current_stage_label || '—'}</td>
                    <td style={{ ...cellStyle, color: b.open_rework_count ? '#DC2626' : TEXT.muted, fontWeight: b.open_rework_count ? 700 : 400 }}>
                      {b.open_rework_count ? `${b.open_rework_count} open` : '—'}
                    </td>
                    <td style={{ ...cellStyle, color: b.is_overdue ? '#DC2626' : TEXT.body, fontWeight: b.is_overdue ? 600 : 400, whiteSpace: 'nowrap' }}>
                      {formatDate(b.target_handover_date)}{b.is_overdue ? ' · overdue' : ''}
                    </td>
                    <td style={cellStyle}>
                      <span style={{ fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 9999, background: `${STATUS_HEX[b.status]}1a`, color: STATUS_HEX[b.status], whiteSpace: 'nowrap' }}>
                        {STATUS_LABELS[b.status] || b.status}
                      </span>
                    </td>
                    <td onClick={(e) => e.stopPropagation()} style={cellStyle}>
                      <span onClick={() => router.push(`/dashboard/production/rrv-builds/${b.id}`)} style={{ fontSize: 12, fontWeight: 600, color: '#FF6A2A', cursor: 'pointer' }}>View</span>
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
