'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { hydraulicApi } from '@/lib/api'
import { HydComponent } from '@/types'
import { TEXT, GLASS, SHADOWS, GRADIENTS, BORDER } from '@/lib/theme'
import HydraulicNav from '@/components/hydraulic/HydraulicNav'
import { COMPONENT_CATEGORY_LABELS, MEDIA_TYPE_LABELS, SYSTEM_TYPE_HEX } from '@/components/hydraulic/labels'
import { extractErrorMessages } from '@/lib/validation'

const STATUS_LABELS: Record<string, string> = { active: 'Active', obsolete: 'Obsolete' }
const STATUS_HEX: Record<string, string> = { active: '#16A34A', obsolete: '#78716c' }

const inputStyle: React.CSSProperties = {
  padding: '9px 12px', borderRadius: 10, border: `1px solid ${BORDER.normal}`,
  background: 'rgba(255,255,255,.7)', fontSize: 13, outline: 'none', color: TEXT.body,
}
const cellStyle: React.CSSProperties = { padding: '10px 14px', fontSize: 13, color: TEXT.body, borderTop: `1px solid ${BORDER.light}` }

/** The one-line rating summary a list row shows, picked per category. */
function ratingSummary(c: HydComponent): string {
  const parts: string[] = []
  if (c.bore_mm) parts.push(`Ø${c.bore_mm}${c.rod_mm ? `/${c.rod_mm}` : ''}${c.stroke_mm ? ` × ${c.stroke_mm}` : ''} mm`)
  if (c.displacement_cc) parts.push(`${c.displacement_cc} cc/rev`)
  if (c.flow_rate_lpm) parts.push(`${c.flow_rate_lpm} L/min`)
  if (c.rated_pressure_bar) parts.push(`${c.rated_pressure_bar} bar`)
  if (!parts.length && c.port_size) parts.push(c.port_size)
  return parts.join(' · ') || '—'
}

export default function HydComponentsPage() {
  const { isAuthorized, isLoading } = useRequireApp('hydraulic')
  const router = useRouter()

  const [components, setComponents] = useState<HydComponent[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | string[]>('')
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState('')
  const [systemType, setSystemType] = useState('')
  const [statusFilter, setStatusFilter] = useState('active')

  useEffect(() => {
    if (!isAuthorized) return
    const params: Record<string, unknown> = {}
    if (category) params.category = category
    if (systemType) params.system_type = systemType
    if (statusFilter) params.status = statusFilter
    if (search.trim()) params.search = search.trim()
    hydraulicApi.listComponents(params)
      .then((data) => setComponents(Array.isArray(data) ? data : []))
      .catch((err) => setError(extractErrorMessages(err, 'Failed to load components.')))
      .finally(() => setLoading(false))
  }, [isAuthorized, category, systemType, statusFilter, search])

  if (isLoading || !isAuthorized) return null

  return (
    <div>
      <HydraulicNav />

      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, marginBottom: 20, flexWrap: 'wrap' }}>
        <div>
          <p style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 4px' }}>
            Hydraulic &amp; Pneumatic
          </p>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: TEXT.heading, margin: 0 }}>Component Master</h1>
        </div>
        <button
          onClick={() => router.push('/dashboard/hydraulic/components/new')}
          style={{
            padding: '12px 22px', borderRadius: 12, border: 'none', cursor: 'pointer',
            background: GRADIENTS.primary, color: '#fff', fontSize: 14, fontWeight: 600,
            boxShadow: `0 8px 20px ${SHADOWS.glowOrange}`,
          }}
        >
          + New Component
        </button>
      </div>

      {error && (
        <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
          {Array.isArray(error) ? error.join(' ') : error}
        </div>
      )}

      <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
        <input style={{ ...inputStyle, flex: '1 1 240px', minWidth: 200 }} placeholder="Search code, name, make, model or part no…" value={search} onChange={(e) => setSearch(e.target.value)} />
        <select style={{ ...inputStyle, flex: '0 1 210px' }} value={category} onChange={(e) => setCategory(e.target.value)}>
          <option value="">All categories</option>
          {Object.entries(COMPONENT_CATEGORY_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <select style={{ ...inputStyle, flex: '0 1 150px' }} value={systemType} onChange={(e) => setSystemType(e.target.value)}>
          <option value="">Hydraulic + Pneumatic</option>
          <option value="hydraulic">Hydraulic</option>
          <option value="pneumatic">Pneumatic</option>
        </select>
        <select style={{ ...inputStyle, flex: '0 1 140px' }} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="">All statuses</option>
          {Object.entries(STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </div>

      <div style={{
        borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur,
        border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), overflow: 'auto', maxHeight: 'calc(100vh - 320px)',
      }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 1000 }}>
          <thead>
            <tr>
              {['Code', 'Name', 'Category', 'Medium', 'Make / Model', 'Rating', 'Unit Cost', 'Used In', 'Status', ''].map((h) => (
                <th key={h} style={{ textAlign: 'left', padding: '10px 14px', fontSize: 11, fontWeight: 600, letterSpacing: '.03em', textTransform: 'uppercase', color: TEXT.muted, position: 'sticky', top: 0, background: '#fdf1e6', zIndex: 1 }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={10} style={{ padding: 20, textAlign: 'center', fontSize: 13, color: TEXT.muted }}>Loading…</td></tr>
            ) : components.length === 0 ? (
              <tr><td colSpan={10} style={{ padding: 20, textAlign: 'center', fontSize: 13, color: TEXT.muted }}>No components match. Add the pumps, valves, cylinders and fittings your circuits and BOMs use.</td></tr>
            ) : (
              components.map((c) => (
                <tr key={c.id} onClick={() => router.push(`/dashboard/hydraulic/components/${c.id}`)} style={{ cursor: 'pointer' }}>
                  <td style={{ ...cellStyle, fontWeight: 600, color: TEXT.heading, whiteSpace: 'nowrap' }}>{c.code}</td>
                  <td style={cellStyle}>{c.name}</td>
                  <td style={cellStyle}>{COMPONENT_CATEGORY_LABELS[c.category] || c.category}</td>
                  <td style={cellStyle}>
                    <span style={{ fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 9999, background: `${SYSTEM_TYPE_HEX[c.system_type]}1a`, color: SYSTEM_TYPE_HEX[c.system_type], whiteSpace: 'nowrap' }}>
                      {MEDIA_TYPE_LABELS[c.system_type] || c.system_type}
                    </span>
                  </td>
                  <td style={cellStyle}>{[c.manufacturer, c.model_number].filter(Boolean).join(' ') || '—'}</td>
                  <td style={{ ...cellStyle, whiteSpace: 'nowrap' }}>{ratingSummary(c)}</td>
                  <td style={{ ...cellStyle, whiteSpace: 'nowrap' }}>₹{c.unit_cost.toLocaleString('en-IN')}</td>
                  <td style={cellStyle}>{c.bom_usage_count ? `${c.bom_usage_count} BOM${c.bom_usage_count > 1 ? 's' : ''}` : '—'}</td>
                  <td style={cellStyle}>
                    <span style={{ fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 9999, background: `${STATUS_HEX[c.status]}1a`, color: STATUS_HEX[c.status], whiteSpace: 'nowrap' }}>
                      {STATUS_LABELS[c.status] || c.status}
                    </span>
                  </td>
                  <td onClick={(e) => e.stopPropagation()} style={cellStyle}>
                    <span onClick={() => router.push(`/dashboard/hydraulic/components/${c.id}`)} style={{ fontSize: 12, fontWeight: 600, color: '#FF6A2A', cursor: 'pointer' }}>View</span>
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
