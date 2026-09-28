'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { qualityApi } from '@/lib/api'
import { QualityCapa } from '@/types'
import { TEXT, GLASS, SHADOWS, GRADIENTS, BORDER } from '@/lib/theme'
import QualityNav from '@/components/quality/QualityNav'
import { extractErrorMessages } from '@/lib/validation'

const STATUS_LABELS: Record<string, string> = { open: 'Open', in_progress: 'In Progress', pending_verification: 'Pending Verification', closed: 'Closed', overdue: 'Overdue' }
const STATUS_HEX: Record<string, string> = { open: '#F59E0B', in_progress: '#2563EB', pending_verification: '#7C3AED', closed: '#16A34A', overdue: '#DC2626' }
const ACTION_TYPE_LABELS: Record<string, string> = { corrective: 'Corrective', preventive: 'Preventive' }
const ACTION_TYPE_HEX: Record<string, string> = { corrective: '#DC2626', preventive: '#2563EB' }

const inputStyle: React.CSSProperties = {
  padding: '9px 12px', borderRadius: 10, border: `1px solid ${BORDER.normal}`,
  background: 'rgba(255,255,255,.7)', fontSize: 13, outline: 'none', color: TEXT.body,
}

export default function QualityCapaListPage() {
  const { isAuthorized, isLoading } = useRequireApp('quality')
  const router = useRouter()

  const [capas, setCapas] = useState<QualityCapa[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | string[]>('')
  const [actionTypeFilter, setActionTypeFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [ncrIdFilter, setNcrIdFilter] = useState('')

  useEffect(() => {
    if (!isAuthorized) return
    setLoading(true)
    const params: Record<string, unknown> = {}
    if (actionTypeFilter) params.action_type = actionTypeFilter
    if (statusFilter) params.status = statusFilter
    if (ncrIdFilter.trim()) params.ncr_id = Number(ncrIdFilter.trim())
    qualityApi.listCapas(params)
      .then((data) => setCapas(Array.isArray(data) ? data : []))
      .catch((err) => setError(extractErrorMessages(err, 'Failed to load CAPA records.')))
      .finally(() => setLoading(false))
  }, [isAuthorized, actionTypeFilter, statusFilter, ncrIdFilter])

  if (isLoading || !isAuthorized) return null

  return (
    <div>
      <QualityNav />

      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, marginBottom: 20, flexWrap: 'wrap' }}>
        <div>
          <p style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 4px' }}>
            Quality Module
          </p>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: TEXT.heading, margin: 0 }}>Corrective / Preventive Actions</h1>
        </div>
        <button
          onClick={() => router.push('/dashboard/quality/capa/new')}
          style={{
            padding: '12px 22px', borderRadius: 12, border: 'none', cursor: 'pointer',
            background: GRADIENTS.primary, color: '#fff', fontSize: 14, fontWeight: 600,
            boxShadow: `0 8px 20px ${SHADOWS.glowOrange}`,
          }}
        >
          + New CAPA
        </button>
      </div>

      {error && (
        <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
          {Array.isArray(error) ? error.join(' ') : error}
        </div>
      )}

      <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
        <input
          style={{ ...inputStyle, flex: '0 1 160px', minWidth: 140 }}
          placeholder="Filter by NCR ID…"
          value={ncrIdFilter}
          onChange={(e) => setNcrIdFilter(e.target.value)}
        />
        <select style={{ ...inputStyle, flex: '0 1 170px' }} value={actionTypeFilter} onChange={(e) => setActionTypeFilter(e.target.value)}>
          <option value="">All types</option>
          <option value="corrective">Corrective</option>
          <option value="preventive">Preventive</option>
        </select>
        <select style={{ ...inputStyle, flex: '0 1 190px' }} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="">All statuses</option>
          <option value="open">Open</option>
          <option value="in_progress">In Progress</option>
          <option value="pending_verification">Pending Verification</option>
          <option value="closed">Closed</option>
          <option value="overdue">Overdue</option>
        </select>
      </div>

      <div style={{
        borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur,
        border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), overflow: 'auto', maxHeight: 'calc(100vh - 320px)',
      }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 820 }}>
          <thead>
            <tr>
              {['CAPA Number', 'Type', 'Title', 'Status', 'Due Date', ''].map((h) => (
                <th key={h} style={{ textAlign: 'left', padding: '10px 14px', fontSize: 11, fontWeight: 600, letterSpacing: '.03em', textTransform: 'uppercase', color: TEXT.muted, position: 'sticky', top: 0, background: '#fdf1e6', zIndex: 1 }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6} style={{ padding: 20, textAlign: 'center', fontSize: 13, color: TEXT.muted }}>Loading…</td></tr>
            ) : capas.length === 0 ? (
              <tr><td colSpan={6} style={{ padding: 20, textAlign: 'center', fontSize: 13, color: TEXT.muted }}>No CAPA records found.</td></tr>
            ) : (
              capas.map((c) => (
                <tr key={c.id} onClick={() => router.push(`/dashboard/quality/capa/${c.id}`)} style={{ cursor: 'pointer' }}>
                  <td style={{ padding: '10px 14px', fontSize: 13, fontWeight: 600, color: TEXT.heading, borderTop: `1px solid ${BORDER.light}` }}>{c.capa_number}</td>
                  <td style={{ padding: '10px 14px', borderTop: `1px solid ${BORDER.light}` }}>
                    <span style={{ fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 9999, background: `${ACTION_TYPE_HEX[c.action_type]}1a`, color: ACTION_TYPE_HEX[c.action_type], whiteSpace: 'nowrap' }}>
                      {ACTION_TYPE_LABELS[c.action_type] || c.action_type}
                    </span>
                  </td>
                  <td style={{ padding: '10px 14px', fontSize: 13, color: TEXT.body, borderTop: `1px solid ${BORDER.light}` }}>{c.title}</td>
                  <td style={{ padding: '10px 14px', borderTop: `1px solid ${BORDER.light}` }}>
                    <span style={{ fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 9999, background: `${STATUS_HEX[c.status]}1a`, color: STATUS_HEX[c.status], whiteSpace: 'nowrap' }}>
                      {STATUS_LABELS[c.status] || c.status}
                    </span>
                  </td>
                  <td style={{ padding: '10px 14px', fontSize: 13, color: TEXT.body, borderTop: `1px solid ${BORDER.light}` }}>{c.due_date || '—'}</td>
                  <td onClick={(e) => e.stopPropagation()} style={{ padding: '10px 14px', borderTop: `1px solid ${BORDER.light}` }}>
                    <span onClick={() => router.push(`/dashboard/quality/capa/${c.id}`)} style={{ fontSize: 12, fontWeight: 600, color: '#FF6A2A', cursor: 'pointer' }}>View</span>
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
