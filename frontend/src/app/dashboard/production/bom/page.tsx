'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { productionApi } from '@/lib/api'
import { ProductionBom } from '@/types'
import { TEXT, GLASS, SHADOWS, GRADIENTS, BORDER } from '@/lib/theme'
import ProductionNav from '@/components/production/ProductionNav'
import { extractErrorMessages } from '@/lib/validation'

const STATUS_LABELS: Record<string, string> = { draft: 'Draft', active: 'Active', obsolete: 'Obsolete' }
const STATUS_HEX: Record<string, string> = { draft: '#F59E0B', active: '#16A34A', obsolete: '#78716c' }

const inputStyle: React.CSSProperties = {
  padding: '9px 12px', borderRadius: 10, border: `1px solid ${BORDER.normal}`,
  background: 'rgba(255,255,255,.7)', fontSize: 13, outline: 'none', color: TEXT.body,
}
const cellStyle: React.CSSProperties = { padding: '10px 14px', fontSize: 13, color: TEXT.body, borderTop: `1px solid ${BORDER.light}` }
const inr = (n: number) => `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`

export default function ProductionBomListPage() {
  const { isAuthorized, isLoading } = useRequireApp('production')
  const router = useRouter()

  const [boms, setBoms] = useState<ProductionBom[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | string[]>('')
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')

  useEffect(() => {
    if (!isAuthorized) return
    const params: Record<string, unknown> = {}
    if (statusFilter) params.status = statusFilter
    if (search.trim()) params.search = search.trim()
    productionApi.listBoms(params)
      .then((data) => setBoms(Array.isArray(data) ? data : []))
      .catch((err) => setError(extractErrorMessages(err, 'Failed to load BOMs.')))
      .finally(() => setLoading(false))
  }, [isAuthorized, statusFilter, search])

  if (isLoading || !isAuthorized) return null

  return (
    <div>
      <ProductionNav />

      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, marginBottom: 20, flexWrap: 'wrap' }}>
        <div>
          <p style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 4px' }}>
            Production Module
          </p>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: TEXT.heading, margin: 0 }}>BOM &amp; Routing</h1>
        </div>
        <button
          onClick={() => router.push('/dashboard/production/bom/new')}
          style={{
            padding: '12px 22px', borderRadius: 12, border: 'none', cursor: 'pointer',
            background: GRADIENTS.primary, color: '#fff', fontSize: 14, fontWeight: 600,
            boxShadow: `0 8px 20px ${SHADOWS.glowOrange}`,
          }}
        >
          + New BOM
        </button>
      </div>

      {error && (
        <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
          {Array.isArray(error) ? error.join(' ') : error}
        </div>
      )}

      <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
        <input style={{ ...inputStyle, flex: '1 1 240px', minWidth: 200 }} placeholder="Search by BOM number or product…" value={search} onChange={(e) => setSearch(e.target.value)} />
        <select style={{ ...inputStyle, flex: '0 1 170px' }} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="">All statuses</option>
          {Object.entries(STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </div>

      <div style={{
        borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur,
        border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), overflow: 'auto', maxHeight: 'calc(100vh - 320px)',
      }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 950 }}>
          <thead>
            <tr>
              {['BOM Number', 'Product', 'Version', 'Components', 'Operations', 'Std Cost / Unit', 'Work Orders', 'Status', ''].map((h) => (
                <th key={h} style={{ textAlign: 'left', padding: '10px 14px', fontSize: 11, fontWeight: 600, letterSpacing: '.03em', textTransform: 'uppercase', color: TEXT.muted, position: 'sticky', top: 0, background: '#fdf1e6', zIndex: 1 }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={9} style={{ padding: 20, textAlign: 'center', fontSize: 13, color: TEXT.muted }}>Loading…</td></tr>
            ) : boms.length === 0 ? (
              <tr><td colSpan={9} style={{ padding: 20, textAlign: 'center', fontSize: 13, color: TEXT.muted }}>No BOMs found.</td></tr>
            ) : (
              boms.map((b) => (
                <tr key={b.id} onClick={() => router.push(`/dashboard/production/bom/${b.id}`)} style={{ cursor: 'pointer' }}>
                  <td style={{ ...cellStyle, fontWeight: 600, color: TEXT.heading }}>{b.bom_number}</td>
                  <td style={cellStyle}>{b.product_code} — {b.product_name}</td>
                  <td style={cellStyle}>v{b.version}</td>
                  <td style={cellStyle}>{b.items.length}</td>
                  <td style={cellStyle}>{b.operations.length}</td>
                  <td style={cellStyle}>{inr((b.standard_material_cost + b.standard_labour_cost) / (b.base_quantity || 1))}</td>
                  <td style={cellStyle}>{b.work_order_count}</td>
                  <td style={cellStyle}>
                    <span style={{ fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 9999, background: `${STATUS_HEX[b.status]}1a`, color: STATUS_HEX[b.status], whiteSpace: 'nowrap' }}>
                      {STATUS_LABELS[b.status] || b.status}
                    </span>
                  </td>
                  <td onClick={(e) => e.stopPropagation()} style={cellStyle}>
                    <span onClick={() => router.push(`/dashboard/production/bom/${b.id}`)} style={{ fontSize: 12, fontWeight: 600, color: '#FF6A2A', cursor: 'pointer' }}>View</span>
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
