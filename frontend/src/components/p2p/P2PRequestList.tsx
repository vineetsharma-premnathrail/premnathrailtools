'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { p2pApi } from '@/lib/api'
import { P2PRequest } from '@/types'
import { TEXT, GLASS, SHADOWS, BRAND } from '@/lib/theme'

const STATUS_LABELS: Record<string, string> = {
  submitted: 'Submitted',
  approved: 'Approved',
  po_raised: 'PO Raised',
  partially_received: 'Partially Received',
  received: 'Received',
  closed: 'Closed',
  rejected: 'Rejected',
  cancelled: 'Cancelled',
}

const STATUS_HEX: Record<string, string> = {
  submitted: '#3b82f6',
  approved: '#8b5cf6',
  po_raised: '#f59e0b',
  partially_received: '#f97316',
  received: '#0ea5e9',
  closed: '#22c55e',
  rejected: '#dc2626',
  cancelled: '#94a3b8',
}

export default function P2PRequestList({ statuses, emptyLabel }: { statuses?: string[]; emptyLabel: string }) {
  const router = useRouter()
  const [prs, setPrs] = useState<P2PRequest[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    ;(async () => {
      setLoading(true)
      setError('')
      try {
        const data = await p2pApi.list({ limit: 500 })
        setPrs(statuses ? data.filter((pr) => statuses.includes(pr.status)) : data)
      } catch {
        setError('Failed to load your P2P requests.')
      } finally {
        setLoading(false)
      }
    })()
  }, [statuses])

  return (
    <div>
      {error && (
        <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
          {error}
        </div>
      )}
      <div style={{ borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur, border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), overflow: 'auto', maxHeight: 'calc(100vh - 320px)' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 900 }}>
          <thead>
            <tr style={{ background: `${BRAND.primary}0d` }}>
              {['PR Number', 'Category', 'Project', 'Required Date', 'Priority', 'Status', ''].map((h) => (
                <th key={h} style={{ textAlign: 'left', padding: '12px 16px', fontSize: 11, fontWeight: 700, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, whiteSpace: 'nowrap', position: 'sticky', top: 0, background: '#fdf1e6', zIndex: 1 }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={7} style={{ padding: 24, textAlign: 'center', color: TEXT.muted, fontSize: 13 }}>Loading…</td></tr>}
            {!loading && prs.length === 0 && (
              <tr><td colSpan={7} style={{ padding: 24, textAlign: 'center', color: TEXT.muted, fontSize: 13 }}>{emptyLabel}</td></tr>
            )}
            {prs.map((pr) => (
              <tr key={pr.id} onClick={() => router.push(`/dashboard/p2p/${pr.id}`)} style={{ borderTop: '1px solid rgba(0,0,0,0.05)', cursor: 'pointer' }}>
                <td style={{ padding: '12px 16px', fontSize: 13, fontWeight: 700, color: BRAND.primaryActive }}>{pr.pr_number}</td>
                <td style={{ padding: '12px 16px', fontSize: 13, color: TEXT.secondary }}>{pr.category_label || pr.category_code}</td>
                <td style={{ padding: '12px 16px', fontSize: 13, color: TEXT.secondary }}>{pr.project_label || '—'}</td>
                <td style={{ padding: '12px 16px', fontSize: 12.5, color: TEXT.secondary, whiteSpace: 'nowrap' }}>{pr.required_date ? new Date(pr.required_date).toLocaleDateString() : '—'}</td>
                <td style={{ padding: '12px 16px', fontSize: 13, color: TEXT.secondary, textTransform: 'capitalize' }}>{pr.priority}</td>
                <td style={{ padding: '12px 16px' }}>
                  <span style={{ fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 9999, background: `${STATUS_HEX[pr.status]}1a`, color: STATUS_HEX[pr.status], whiteSpace: 'nowrap' }}>
                    {STATUS_LABELS[pr.status] || pr.status}
                  </span>
                </td>
                <td style={{ padding: '12px 16px' }} onClick={(e) => e.stopPropagation()}>
                  <span onClick={() => router.push(`/dashboard/p2p/${pr.id}`)} style={{ fontSize: 11.5, fontWeight: 700, color: '#2563eb', cursor: 'pointer' }}>View</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
