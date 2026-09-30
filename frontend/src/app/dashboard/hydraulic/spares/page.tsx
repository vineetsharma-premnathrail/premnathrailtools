'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { hydraulicApi } from '@/lib/api'
import { HydSparePart } from '@/types'
import { TEXT, GLASS, SHADOWS, GRADIENTS, BORDER } from '@/lib/theme'
import HydraulicNav from '@/components/hydraulic/HydraulicNav'
import { SPARE_CATEGORY_LABELS, CRITICALITY_LABELS, CRITICALITY_HEX } from '@/components/hydraulic/labels'
import { extractErrorMessages } from '@/lib/validation'

const STOCK_LABELS: Record<string, string> = { ok: 'In Stock', low: 'Low', out: 'Out of Stock', not_linked: 'Not Linked' }
const STOCK_HEX: Record<string, string> = { ok: '#16A34A', low: '#F59E0B', out: '#DC2626', not_linked: '#78716c' }
const STOCK_FILTERS: [string, string][] = [
  ['', 'All stock'], ['reorder', 'Needs reorder'], ['out', 'Out of stock'], ['low', 'Low'], ['ok', 'OK'], ['not_linked', 'Not linked to Store'],
]

const inputStyle: React.CSSProperties = {
  padding: '9px 12px', borderRadius: 10, border: `1px solid ${BORDER.normal}`,
  background: 'rgba(255,255,255,.7)', fontSize: 13, outline: 'none', color: TEXT.body,
}
const cellStyle: React.CSSProperties = { padding: '10px 14px', fontSize: 13, color: TEXT.body, borderTop: `1px solid ${BORDER.light}` }
const qty = (n: number) => n.toLocaleString('en-IN', { maximumFractionDigits: 3 })

export default function HydSparePartsPage() {
  const { isAuthorized, isLoading } = useRequireApp('hydraulic')
  const router = useRouter()

  const [spares, setSpares] = useState<HydSparePart[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | string[]>('')
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState('')
  const [systemType, setSystemType] = useState('')
  const [criticality, setCriticality] = useState('')
  const [stock, setStock] = useState('')

  useEffect(() => {
    if (!isAuthorized) return
    const params: Record<string, unknown> = {}
    if (category) params.category = category
    if (systemType) params.system_type = systemType
    if (criticality) params.criticality = criticality
    if (stock) params.stock = stock
    if (search.trim()) params.search = search.trim()
    hydraulicApi.listSpares(params)
      .then((data) => { setSpares(Array.isArray(data) ? data : []); setError('') })
      .catch((err) => setError(extractErrorMessages(err, 'Failed to load spare parts.')))
      .finally(() => setLoading(false))
  }, [isAuthorized, category, systemType, criticality, stock, search])

  if (isLoading || !isAuthorized) return null

  return (
    <div>
      <HydraulicNav />

      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, marginBottom: 20, flexWrap: 'wrap' }}>
        <div>
          <p style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 4px' }}>
            Hydraulic &amp; Pneumatic
          </p>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: TEXT.heading, margin: 0 }}>Spare Parts</h1>
          <p style={{ fontSize: 13, color: TEXT.secondary, margin: '6px 0 0' }}>Stock is read live from the linked Store item.</p>
        </div>
        <button
          onClick={() => router.push('/dashboard/hydraulic/spares/new')}
          style={{
            padding: '12px 22px', borderRadius: 12, border: 'none', cursor: 'pointer',
            background: GRADIENTS.primary, color: '#fff', fontSize: 14, fontWeight: 600,
            boxShadow: `0 8px 20px ${SHADOWS.glowOrange}`,
          }}
        >
          + New Spare
        </button>
      </div>

      {error && (
        <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
          {Array.isArray(error) ? error.join(' ') : error}
        </div>
      )}

      <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
        <input style={{ ...inputStyle, flex: '1 1 240px', minWidth: 200 }} placeholder="Search part code, name or part no…" value={search} onChange={(e) => setSearch(e.target.value)} />
        <select style={{ ...inputStyle, flex: '0 1 190px' }} value={category} onChange={(e) => setCategory(e.target.value)}>
          <option value="">All categories</option>
          {Object.entries(SPARE_CATEGORY_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <select style={{ ...inputStyle, flex: '0 1 170px' }} value={systemType} onChange={(e) => setSystemType(e.target.value)}>
          <option value="">Hydraulic + Pneumatic</option>
          <option value="hydraulic">Hydraulic</option>
          <option value="pneumatic">Pneumatic</option>
        </select>
        <select style={{ ...inputStyle, flex: '0 1 150px' }} value={criticality} onChange={(e) => setCriticality(e.target.value)}>
          <option value="">All criticality</option>
          {Object.entries(CRITICALITY_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <select style={{ ...inputStyle, flex: '0 1 180px' }} value={stock} onChange={(e) => setStock(e.target.value)}>
          {STOCK_FILTERS.map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </div>

      <div style={{
        borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur,
        border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), overflow: 'auto', maxHeight: 'calc(100vh - 320px)',
      }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 1150 }}>
          <thead>
            <tr>
              {['Part Code', 'Name', 'Category', 'For Component', 'Criticality', 'Available / Min', 'Used (12 m)', 'Lead Time', 'Stock', ''].map((h) => (
                <th key={h} style={{ textAlign: 'left', padding: '10px 14px', fontSize: 11, fontWeight: 600, letterSpacing: '.03em', textTransform: 'uppercase', color: TEXT.muted, position: 'sticky', top: 0, background: '#fdf1e6', zIndex: 1 }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={10} style={{ padding: 20, textAlign: 'center', fontSize: 13, color: TEXT.muted }}>Loading…</td></tr>
            ) : spares.length === 0 ? (
              <tr><td colSpan={10} style={{ padding: 20, textAlign: 'center', fontSize: 13, color: TEXT.muted }}>No spare parts match. Add the seal kits, filter elements and hoses your systems need, and link each to its Store item to track stock.</td></tr>
            ) : (
              spares.map((s) => {
                const stockColor = s.stock_status === 'out' ? '#DC2626' : s.stock_status === 'low' ? '#B45309' : TEXT.body
                return (
                  <tr key={s.id} onClick={() => router.push(`/dashboard/hydraulic/spares/${s.id}`)} style={{ cursor: 'pointer' }}>
                    <td style={{ ...cellStyle, fontWeight: 600, color: TEXT.heading, whiteSpace: 'nowrap' }}>{s.part_code}</td>
                    <td style={cellStyle}>
                      {s.name}
                      {s.status === 'obsolete' && <span style={{ fontSize: 11.5, color: TEXT.muted }}> (obsolete)</span>}
                      {s.part_number && <span style={{ display: 'block', fontSize: 12, color: TEXT.muted }}>{[s.manufacturer, s.part_number].filter(Boolean).join(' ')}</span>}
                    </td>
                    <td style={cellStyle}>{SPARE_CATEGORY_LABELS[s.category] || s.category}</td>
                    <td style={cellStyle}>{s.component_code ? <><span style={{ fontWeight: 600 }}>{s.component_code}</span><span style={{ display: 'block', fontSize: 12, color: TEXT.muted }}>{s.component_name}</span></> : '—'}</td>
                    <td style={cellStyle}>
                      <span style={{ fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 9999, background: `${CRITICALITY_HEX[s.criticality]}1a`, color: CRITICALITY_HEX[s.criticality], whiteSpace: 'nowrap' }}>
                        {CRITICALITY_LABELS[s.criticality] || s.criticality}
                      </span>
                    </td>
                    <td style={{ ...cellStyle, whiteSpace: 'nowrap', color: stockColor, fontWeight: stockColor === TEXT.body ? 400 : 600 }}>
                      {s.stock_status === 'not_linked' || s.available_qty == null ? '—' : `${qty(s.available_qty)} / ${qty(s.min_stock_qty)} ${s.uom}`}
                    </td>
                    <td style={{ ...cellStyle, whiteSpace: 'nowrap' }}>{s.used_last_12m ? `${qty(s.used_last_12m)} ${s.uom}` : '—'}</td>
                    <td style={{ ...cellStyle, whiteSpace: 'nowrap' }}>{s.lead_time_days != null ? `${s.lead_time_days} d` : '—'}</td>
                    <td style={cellStyle}>
                      <span style={{ fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 9999, background: `${STOCK_HEX[s.stock_status]}1a`, color: STOCK_HEX[s.stock_status], whiteSpace: 'nowrap' }}>
                        {STOCK_LABELS[s.stock_status] || s.stock_status}
                      </span>
                    </td>
                    <td onClick={(e) => e.stopPropagation()} style={cellStyle}>
                      <span onClick={() => router.push(`/dashboard/hydraulic/spares/${s.id}`)} style={{ fontSize: 12, fontWeight: 600, color: '#FF6A2A', cursor: 'pointer' }}>View</span>
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
