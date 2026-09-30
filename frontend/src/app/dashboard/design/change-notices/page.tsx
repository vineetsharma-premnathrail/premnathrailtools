'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { designApi } from '@/lib/api'
import { DesignChangeNotice } from '@/types'
import { TEXT, GLASS, SHADOWS, GRADIENTS, BORDER } from '@/lib/theme'
import DesignNav from '@/components/design/DesignNav'
import { ECN_REASON_LABELS } from '@/components/design/designMeta'
import { extractErrorMessages } from '@/lib/validation'
import { formatDate } from '@/lib/format'

const STATUS_LABELS: Record<string, string> = { draft: 'Draft', submitted: 'Awaiting Approval', approved: 'Approved', rejected: 'Rejected', implemented: 'Implemented', cancelled: 'Cancelled' }
const STATUS_HEX: Record<string, string> = { draft: '#78716c', submitted: '#F59E0B', approved: '#2563EB', rejected: '#DC2626', implemented: '#16A34A', cancelled: '#a8a29e' }
const PRIORITY_LABELS: Record<string, string> = { low: 'Low', medium: 'Medium', high: 'High', urgent: 'Urgent' }
const PRIORITY_HEX: Record<string, string> = { low: '#78716c', medium: '#2563EB', high: '#F59E0B', urgent: '#DC2626' }

const STATUS_TABS = [
  { key: 'draft,submitted,approved', label: 'Open' },
  { key: 'submitted', label: 'Awaiting Approval' },
  { key: 'approved', label: 'Approved' },
  { key: 'implemented', label: 'Implemented' },
  { key: 'rejected,cancelled', label: 'Rejected / Cancelled' },
  { key: '', label: 'All' },
]

const inputStyle: React.CSSProperties = {
  padding: '9px 12px', borderRadius: 10, border: `1px solid ${BORDER.normal}`,
  background: 'rgba(255,255,255,.7)', fontSize: 13, outline: 'none', color: TEXT.body,
}
const cellStyle: React.CSSProperties = { padding: '10px 14px', fontSize: 13, color: TEXT.body, borderTop: `1px solid ${BORDER.light}` }

export default function DesignChangeNoticesPage() {
  const { isAuthorized, isLoading } = useRequireApp('design')
  const router = useRouter()
  const [rows, setRows] = useState<DesignChangeNotice[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | string[]>('')
  const [statusTab, setStatusTab] = useState(STATUS_TABS[0].key)
  const [search, setSearch] = useState('')

  useEffect(() => {
    if (!isAuthorized) return
    const params: Record<string, unknown> = {}
    if (statusTab) params.status = statusTab
    if (search.trim()) params.search = search.trim()
    const handle = setTimeout(() => {
      setLoading(true)
      designApi.listChangeNotices(params)
        .then((data) => { setRows(Array.isArray(data) ? data : []); setError('') })
        .catch((err) => setError(extractErrorMessages(err, 'Failed to load change notices.')))
        .finally(() => setLoading(false))
    }, search ? 250 : 0)
    return () => clearTimeout(handle)
  }, [isAuthorized, statusTab, search])

  if (isLoading || !isAuthorized) return null

  return (
    <div>
      <DesignNav />

      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, marginBottom: 20, flexWrap: 'wrap' }}>
        <div>
          <p style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 4px' }}>Design Module</p>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: TEXT.heading, margin: 0 }}>Engineering Change Notices</h1>
        </div>
        <button
          onClick={() => router.push('/dashboard/design/change-notices/new')}
          style={{ padding: '12px 22px', borderRadius: 12, border: 'none', cursor: 'pointer', background: GRADIENTS.primary, color: '#fff', fontSize: 14, fontWeight: 600, boxShadow: `0 8px 20px ${SHADOWS.glowOrange}` }}
        >
          + Raise ECN
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
      <div style={{ marginBottom: 14 }}>
        <input style={{ ...inputStyle, width: '100%', maxWidth: 420 }} placeholder="Search by ECN number, title or description…" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>

      <div style={{
        borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur,
        border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), overflow: 'auto', maxHeight: 'calc(100vh - 360px)',
      }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 1040 }}>
          <thead>
            <tr>
              {['ECN', 'Title', 'Reason', 'Priority', 'Documents', 'Raised by', 'Approver', 'Target', 'Status', ''].map((h) => (
                <th key={h} style={{ textAlign: 'left', padding: '10px 14px', fontSize: 11, fontWeight: 600, letterSpacing: '.03em', textTransform: 'uppercase', color: TEXT.muted, position: 'sticky', top: 0, background: '#fdf1e6', zIndex: 1 }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={10} style={{ padding: 20, textAlign: 'center', fontSize: 13, color: TEXT.muted }}>Loading…</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={10} style={{ padding: 20, textAlign: 'center', fontSize: 13, color: TEXT.muted }}>No change notices here.</td></tr>
            ) : (
              rows.map((e) => (
                <tr key={e.id} onClick={() => router.push(`/dashboard/design/change-notices/${e.id}`)} style={{ cursor: 'pointer' }}>
                  <td style={{ ...cellStyle, fontWeight: 600, color: TEXT.heading, whiteSpace: 'nowrap' }}>{e.ecn_number}</td>
                  <td style={{ ...cellStyle, maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.title}</td>
                  <td style={cellStyle}>{ECN_REASON_LABELS[e.reason] || e.reason}</td>
                  <td style={cellStyle}>
                    <span style={{ fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 9999, background: `${PRIORITY_HEX[e.priority]}1a`, color: PRIORITY_HEX[e.priority], whiteSpace: 'nowrap' }}>
                      {PRIORITY_LABELS[e.priority] || e.priority}
                    </span>
                  </td>
                  <td style={cellStyle}>{e.status === 'approved' || e.status === 'implemented' ? `${e.released_count} / ${e.document_count} released` : e.document_count}</td>
                  <td style={cellStyle}>{e.created_by_name || '—'}</td>
                  <td style={cellStyle}>{e.approver_name || '—'}</td>
                  <td style={cellStyle}>{formatDate(e.target_date)}</td>
                  <td style={cellStyle}>
                    <span style={{ fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 9999, background: `${STATUS_HEX[e.status]}1a`, color: STATUS_HEX[e.status], whiteSpace: 'nowrap' }}>
                      {STATUS_LABELS[e.status] || e.status}
                    </span>
                  </td>
                  <td onClick={(ev) => ev.stopPropagation()} style={cellStyle}>
                    <span onClick={() => router.push(`/dashboard/design/change-notices/${e.id}`)} style={{ fontSize: 12, fontWeight: 600, color: '#FF6A2A', cursor: 'pointer' }}>View</span>
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
