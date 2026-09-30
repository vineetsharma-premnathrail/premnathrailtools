'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { rrvApi } from '@/lib/api'
import { ProductionReworkOrder } from '@/types'
import { TEXT, GLASS, SHADOWS, BORDER } from '@/lib/theme'
import ProductionNav from '@/components/production/ProductionNav'
import { secondaryBtnStyle } from '@/components/shared/ui'
import { extractErrorMessages } from '@/lib/validation'
import { formatDate } from '@/lib/format'

const STATUS_LABELS: Record<string, string> = { open: 'Open', in_progress: 'In Progress', done: 'Awaiting Verification', verified: 'Verified', cancelled: 'Cancelled' }
const STATUS_HEX: Record<string, string> = { open: '#DC2626', in_progress: '#F59E0B', done: '#7C3AED', verified: '#16A34A', cancelled: '#a8a29e' }
const STATUS_TABS = [
  { key: 'open,in_progress,done', label: 'Open' },
  { key: 'done', label: 'Awaiting Verification' },
  { key: 'verified', label: 'Verified' },
  { key: 'cancelled', label: 'Cancelled' },
  { key: '', label: 'All' },
]
const cellStyle: React.CSSProperties = { padding: '10px 14px', fontSize: 13, color: TEXT.body, borderTop: `1px solid ${BORDER.light}` }

export default function ReworkOrdersPage() {
  const { isAuthorized, isLoading } = useRequireApp('production')
  const router = useRouter()
  const [rows, setRows] = useState<ProductionReworkOrder[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | string[]>('')
  const [statusTab, setStatusTab] = useState(STATUS_TABS[0].key)
  const [mine, setMine] = useState(false)

  useEffect(() => {
    if (!isAuthorized) return
    const params: Record<string, unknown> = {}
    if (statusTab) params.status = statusTab
    if (mine) params.mine = true
    const handle = setTimeout(() => {
      setLoading(true)
      rrvApi.listRework(params)
        .then((data) => { setRows(Array.isArray(data) ? data : []); setError('') })
        .catch((err) => setError(extractErrorMessages(err, 'Failed to load rework orders.')))
        .finally(() => setLoading(false))
    }, 0)
    return () => clearTimeout(handle)
  }, [isAuthorized, statusTab, mine])

  if (isLoading || !isAuthorized) return null

  return (
    <div>
      <ProductionNav />

      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, marginBottom: 20, flexWrap: 'wrap' }}>
        <div>
          <p style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 4px' }}>RRV Builds</p>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: TEXT.heading, margin: 0 }}>Rework Orders</h1>
          <p style={{ fontSize: 13, color: TEXT.muted, margin: '4px 0 0' }}>Every rework across all vehicles — raised from failed tests, failed inspections, or manually.</p>
        </div>
        <button onClick={() => router.push('/dashboard/production/rrv-builds')} type="button" style={secondaryBtnStyle}>← Back</button>
      </div>

      {error && (
        <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
          {Array.isArray(error) ? error.join(' ') : error}
        </div>
      )}

      <div style={{ display: 'flex', gap: 6, marginBottom: 14, flexWrap: 'wrap', alignItems: 'center' }}>
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
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: TEXT.secondary, cursor: 'pointer', marginLeft: 8 }}>
          <input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} /> Assigned to me
        </label>
      </div>

      <div style={{
        borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur,
        border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), overflow: 'auto', maxHeight: 'calc(100vh - 340px)',
      }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 1000 }}>
          <thead>
            <tr>
              {['Rework', 'Build', 'What needs fixing', 'Source', 'Assigned to', 'Due', 'Status', ''].map((h) => (
                <th key={h} style={{ textAlign: 'left', padding: '10px 14px', fontSize: 11, fontWeight: 600, letterSpacing: '.03em', textTransform: 'uppercase', color: TEXT.muted, position: 'sticky', top: 0, background: '#fdf1e6', zIndex: 1 }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={8} style={{ padding: 20, textAlign: 'center', fontSize: 13, color: TEXT.muted }}>Loading…</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={8} style={{ padding: 20, textAlign: 'center', fontSize: 13, color: TEXT.muted }}>No rework orders here.</td></tr>
            ) : (
              rows.map((r) => (
                <tr key={r.id} onClick={() => router.push(`/dashboard/production/rrv-builds/${r.build_id}`)} style={{ cursor: 'pointer' }}>
                  <td style={{ ...cellStyle, fontWeight: 600, color: TEXT.heading, whiteSpace: 'nowrap' }}>{r.rework_number}</td>
                  <td style={cellStyle}>{r.build_number}<div style={{ fontSize: 12, color: TEXT.muted }}>{r.rrv_model}</div></td>
                  <td style={{ ...cellStyle, maxWidth: 320 }}>{r.title}</td>
                  <td style={cellStyle}>{r.source_label}{r.inspection_number ? <div style={{ fontSize: 12, color: TEXT.muted }}>{r.inspection_number}</div> : null}</td>
                  <td style={cellStyle}>{r.assigned_to_name || '—'}</td>
                  <td style={{ ...cellStyle, color: r.is_overdue ? '#DC2626' : TEXT.body, fontWeight: r.is_overdue ? 600 : 400 }}>{formatDate(r.due_date)}{r.is_overdue ? ' · overdue' : ''}</td>
                  <td style={cellStyle}>
                    <span style={{ fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 9999, background: `${STATUS_HEX[r.status]}1a`, color: STATUS_HEX[r.status], whiteSpace: 'nowrap' }}>
                      {STATUS_LABELS[r.status] || r.status}
                    </span>
                  </td>
                  <td onClick={(e) => e.stopPropagation()} style={cellStyle}>
                    <span onClick={() => router.push(`/dashboard/production/rrv-builds/${r.build_id}`)} style={{ fontSize: 12, fontWeight: 600, color: '#FF6A2A', cursor: 'pointer' }}>Open build</span>
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
