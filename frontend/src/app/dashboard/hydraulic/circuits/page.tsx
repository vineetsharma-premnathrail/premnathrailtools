'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { hydraulicApi } from '@/lib/api'
import { HydCircuit } from '@/types'
import { TEXT, GLASS, SHADOWS, GRADIENTS, BORDER } from '@/lib/theme'
import HydraulicNav from '@/components/hydraulic/HydraulicNav'
import Checkbox from '@/components/Checkbox'
import { SYSTEM_TYPE_LABELS, SYSTEM_TYPE_HEX } from '@/components/hydraulic/labels'
import { extractErrorMessages } from '@/lib/validation'
import { formatDate } from '@/lib/format'

const STATUS_LABELS: Record<string, string> = { draft: 'Draft', under_review: 'Under Review', approved: 'Approved', superseded: 'Superseded' }
const STATUS_HEX: Record<string, string> = { draft: '#78716c', under_review: '#2563EB', approved: '#16A34A', superseded: '#a8a29e' }

const inputStyle: React.CSSProperties = {
  padding: '9px 12px', borderRadius: 10, border: `1px solid ${BORDER.normal}`,
  background: 'rgba(255,255,255,.7)', fontSize: 13, outline: 'none', color: TEXT.body,
}
const cellStyle: React.CSSProperties = { padding: '10px 14px', fontSize: 13, color: TEXT.body, borderTop: `1px solid ${BORDER.light}` }

export default function HydCircuitsPage() {
  const { isAuthorized, isLoading } = useRequireApp('hydraulic')
  const router = useRouter()

  const [circuits, setCircuits] = useState<HydCircuit[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | string[]>('')
  const [search, setSearch] = useState('')
  const [systemType, setSystemType] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [showSuperseded, setShowSuperseded] = useState(false)

  useEffect(() => {
    if (!isAuthorized) return
    const params: Record<string, unknown> = {}
    if (systemType) params.system_type = systemType
    if (statusFilter) params.status = statusFilter
    if (showSuperseded) params.include_superseded = true
    if (search.trim()) params.search = search.trim()
    hydraulicApi.listCircuits(params)
      .then((data) => { setCircuits(Array.isArray(data) ? data : []); setError('') })
      .catch((err) => setError(extractErrorMessages(err, 'Failed to load circuits.')))
      .finally(() => setLoading(false))
  }, [isAuthorized, systemType, statusFilter, showSuperseded, search])

  if (isLoading || !isAuthorized) return null

  return (
    <div>
      <HydraulicNav />

      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, marginBottom: 20, flexWrap: 'wrap' }}>
        <div>
          <p style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 4px' }}>
            Hydraulic &amp; Pneumatic
          </p>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: TEXT.heading, margin: 0 }}>Circuits</h1>
        </div>
        <button
          onClick={() => router.push('/dashboard/hydraulic/circuits/new')}
          style={{
            padding: '12px 22px', borderRadius: 12, border: 'none', cursor: 'pointer',
            background: GRADIENTS.primary, color: '#fff', fontSize: 14, fontWeight: 600,
            boxShadow: `0 8px 20px ${SHADOWS.glowOrange}`,
          }}
        >
          + New Circuit
        </button>
      </div>

      {error && (
        <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
          {Array.isArray(error) ? error.join(' ') : error}
        </div>
      )}

      <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap', alignItems: 'center' }}>
        <input style={{ ...inputStyle, flex: '1 1 240px', minWidth: 200 }} placeholder="Search circuit no., title or drawing no…" value={search} onChange={(e) => setSearch(e.target.value)} />
        <select style={{ ...inputStyle, flex: '0 1 170px' }} value={systemType} onChange={(e) => setSystemType(e.target.value)}>
          <option value="">Hydraulic + Pneumatic</option>
          {Object.entries(SYSTEM_TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <select style={{ ...inputStyle, flex: '0 1 150px' }} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="">All statuses</option>
          {Object.entries(STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: statusFilter ? TEXT.muted : TEXT.body }}
          title={statusFilter ? 'A status filter is set, so this has no effect — clear it to use this toggle.' : undefined}>
          <Checkbox id="hyd-circuits-superseded" checked={showSuperseded} onChange={(e) => setShowSuperseded(e.target.checked)} disabled={!!statusFilter} />
          <span onClick={() => { if (!statusFilter) setShowSuperseded(!showSuperseded) }} style={{ cursor: statusFilter ? 'default' : 'pointer' }}>Show superseded</span>
        </div>
      </div>

      <div style={{
        borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur,
        border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), overflow: 'auto', maxHeight: 'calc(100vh - 320px)',
      }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 1000 }}>
          <thead>
            <tr>
              {['Circuit No.', 'Rev', 'Title', 'System', 'Type', 'Files', 'Approved', 'Status', ''].map((h) => (
                <th key={h} style={{ textAlign: 'left', padding: '10px 14px', fontSize: 11, fontWeight: 600, letterSpacing: '.03em', textTransform: 'uppercase', color: TEXT.muted, position: 'sticky', top: 0, background: '#fdf1e6', zIndex: 1 }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={9} style={{ padding: 20, textAlign: 'center', fontSize: 13, color: TEXT.muted }}>Loading…</td></tr>
            ) : circuits.length === 0 ? (
              <tr><td colSpan={9} style={{ padding: 20, textAlign: 'center', fontSize: 13, color: TEXT.muted }}>No circuits match. Create one, upload its ISO 1219 schematic, and send it for review.</td></tr>
            ) : (
              circuits.map((c) => (
                <tr key={c.id} onClick={() => router.push(`/dashboard/hydraulic/circuits/${c.id}`)} style={{ cursor: 'pointer', opacity: c.status === 'superseded' ? 0.65 : 1 }}>
                  <td style={{ ...cellStyle, fontWeight: 600, color: TEXT.heading, whiteSpace: 'nowrap' }}>{c.circuit_number}</td>
                  <td style={{ ...cellStyle, fontWeight: 600 }}>{c.revision}</td>
                  <td style={cellStyle}>{c.title}</td>
                  <td style={cellStyle}>{c.system_number ? `${c.system_number} — ${c.system_name || ''}` : '—'}</td>
                  <td style={cellStyle}>
                    <span style={{ fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 9999, background: `${SYSTEM_TYPE_HEX[c.system_type]}1a`, color: SYSTEM_TYPE_HEX[c.system_type], whiteSpace: 'nowrap' }}>
                      {SYSTEM_TYPE_LABELS[c.system_type] || c.system_type}
                    </span>
                  </td>
                  <td style={cellStyle}>{c.document_count || '—'}</td>
                  <td style={{ ...cellStyle, whiteSpace: 'nowrap' }}>
                    {c.approved_at ? (
                      <>
                        {formatDate(c.approved_at)}
                        {c.approved_by_name && <span style={{ display: 'block', fontSize: 11.5, color: TEXT.muted }}>{c.approved_by_name}</span>}
                      </>
                    ) : '—'}
                  </td>
                  <td style={cellStyle}>
                    <span style={{ fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 9999, background: `${STATUS_HEX[c.status]}1a`, color: STATUS_HEX[c.status], whiteSpace: 'nowrap' }}>
                      {STATUS_LABELS[c.status] || c.status}
                    </span>
                  </td>
                  <td onClick={(e) => e.stopPropagation()} style={cellStyle}>
                    <span onClick={() => router.push(`/dashboard/hydraulic/circuits/${c.id}`)} style={{ fontSize: 12, fontWeight: 600, color: '#FF6A2A', cursor: 'pointer' }}>View</span>
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
