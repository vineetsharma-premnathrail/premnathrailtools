'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { purchaseApi } from '@/lib/api'
import { PurchaseRequisition } from '@/types'
import NotificationBell from '@/components/erp/NotificationBell'

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

const PRIORITY_LABELS: Record<string, string> = { low: 'Low', medium: 'Medium', high: 'High' }
const PRIORITY_HEX: Record<string, string> = { low: '#64748b', medium: '#f59e0b', high: '#dc2626' }

export default function PurchaseRequisitionsPage() {
  const { isAuthorized, isLoading } = useRequireApp('purchase')
  const router = useRouter()
  const [prs, setPrs] = useState<PurchaseRequisition[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')

  const load = async () => {
    setLoading(true)
    setError('')
    try {
      const data = await purchaseApi.list({
        search: search || undefined,
        status: statusFilter !== 'all' ? statusFilter : undefined,
        limit: 1000,
      })
      setPrs(data)
    } catch {
      setError('Failed to load purchase requisitions.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (isAuthorized) load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthorized, statusFilter])

  useEffect(() => {
    if (!isAuthorized) return
    const t = setTimeout(load, 300)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search])

  const counts = useMemo(() => {
    const c: Record<string, number> = {}
    for (const pr of prs) c[pr.status] = (c[pr.status] || 0) + 1
    return c
  }, [prs])

  if (isLoading || !isAuthorized) return null

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, marginBottom: 20, flexWrap: 'wrap' }}>
        <div>
          <p style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: '.05em', textTransform: 'uppercase', color: '#a8a29e', margin: '0 0 4px' }}>Purchase Module</p>
          <h1 style={{ fontSize: 24, fontWeight: 800, color: '#1f1108', margin: '0 0 4px' }}>Purchase Requisitions (from Service Requests)</h1>
          <p style={{ fontSize: 13, color: '#78716c', margin: 0 }}>{prs.length} PR(s) found</p>
        </div>
        <NotificationBell />
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
        <div style={{ padding: '9px 18px', borderRadius: 10, fontSize: 13, fontWeight: 700, background: 'linear-gradient(140deg,#FF7A45,#FF6A2A)', color: '#fff' }}>
          From Service Requests
        </div>
        <button
          onClick={() => router.push('/dashboard/purchase/p2p-requests')}
          style={{ padding: '9px 18px', borderRadius: 10, fontSize: 13, fontWeight: 700, border: '1px solid rgba(14,165,233,0.3)', background: 'rgba(14,165,233,0.08)', color: '#0369a1', cursor: 'pointer' }}
        >
          Standalone Requisitions →
        </button>
      </div>

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 16 }}>
        {Object.entries(STATUS_LABELS).map(([key, label]) => (
          <div key={key} style={{ padding: '8px 14px', borderRadius: 10, background: `${STATUS_HEX[key]}14`, border: `1px solid ${STATUS_HEX[key]}33`, minWidth: 90 }}>
            <p style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', color: STATUS_HEX[key], margin: '0 0 2px' }}>{label}</p>
            <p style={{ fontSize: 16, fontWeight: 800, color: '#1f1108', margin: 0 }}>{counts[key] || 0}</p>
          </div>
        ))}
      </div>

      {error && (
        <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
          {error}
        </div>
      )}

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: 16 }}>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="PR number..."
          style={{ flex: '1 1 220px', padding: '10px 14px', borderRadius: 10, border: '1px solid rgba(0,0,0,0.1)', background: '#fff', fontSize: 13.5, outline: 'none' }}
        />
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} style={{ padding: '10px 14px', borderRadius: 10, border: '1px solid rgba(0,0,0,0.1)', background: '#fff', fontSize: 13, fontWeight: 500, color: '#57534e' }}>
          <option value="all">All Statuses</option>
          {Object.entries(STATUS_LABELS).map(([v, l]) => (
            <option key={v} value={v}>{l}</option>
          ))}
        </select>
      </div>

      <div style={{ borderRadius: 18, background: 'rgba(255,255,255,.16)', backdropFilter: 'blur(28px)', WebkitBackdropFilter: 'blur(28px)', border: '1px solid rgba(255,255,255,.24)', boxShadow: '0 12px 32px rgba(15,23,42,0.16), 0 2px 6px rgba(15,23,42,.08), inset 0 1px 0 rgba(255,255,255,.35)', overflow: 'auto', maxHeight: 'calc(100vh - 400px)' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 1000 }}>
          <thead>
            <tr style={{ background: 'rgba(244,113,59,0.06)' }}>
              {['PR Number', 'Machine / Asset', 'Service Request', 'Client', 'Status', 'Priority', 'Vendor', 'Raised', ''].map((h) => (
                <th key={h} style={{ textAlign: 'left', padding: '12px 16px', fontSize: 11, fontWeight: 700, letterSpacing: '.05em', textTransform: 'uppercase', color: '#a8a29e', whiteSpace: 'nowrap', position: 'sticky', top: 0, background: '#fdf1e6', zIndex: 1 }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={9} style={{ padding: 24, textAlign: 'center', color: '#a8a29e', fontSize: 13 }}>Loading…</td></tr>}
            {!loading && prs.length === 0 && <tr><td colSpan={9} style={{ padding: 24, textAlign: 'center', color: '#a8a29e', fontSize: 13 }}>No purchase requisitions found.</td></tr>}
            {prs.map((pr) => (
              <tr key={pr.id} onClick={() => router.push(`/dashboard/purchase/${pr.id}`)} style={{ borderTop: '1px solid rgba(0,0,0,0.05)', cursor: 'pointer' }}>
                <td style={{ padding: '12px 16px', fontSize: 13, fontWeight: 700, color: '#fa9b9b' }}>{pr.pr_number}</td>
                <td style={{ padding: '12px 16px', fontSize: 13, color: '#57534e' }}>{pr.project_label || '—'}</td>
                <td style={{ padding: '12px 16px', fontSize: 13, color: '#57534e' }}>{pr.sr_request_number || '—'}</td>
                <td style={{ padding: '12px 16px', fontSize: 12.5, color: '#57534e' }}>{pr.client_company || '—'}</td>
                <td style={{ padding: '12px 16px' }}>
                  <span style={{ fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 9999, background: `${STATUS_HEX[pr.status]}1a`, color: STATUS_HEX[pr.status], whiteSpace: 'nowrap' }}>
                    {STATUS_LABELS[pr.status] || pr.status}
                  </span>
                </td>
                <td style={{ padding: '12px 16px' }}>
                  <span style={{ fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 9999, background: `${PRIORITY_HEX[pr.priority] || '#64748b'}1a`, color: PRIORITY_HEX[pr.priority] || '#64748b', whiteSpace: 'nowrap' }}>
                    {PRIORITY_LABELS[pr.priority] || pr.priority}
                  </span>
                </td>
                <td style={{ padding: '12px 16px', fontSize: 13, color: '#78716c' }}>{pr.vendor || '—'}</td>
                <td style={{ padding: '12px 16px', fontSize: 12.5, color: '#78716c', whiteSpace: 'nowrap' }}>{pr.created_at ? new Date(pr.created_at).toLocaleDateString() : '—'}</td>
                <td style={{ padding: '12px 16px' }} onClick={(e) => e.stopPropagation()}>
                  <span onClick={() => router.push(`/dashboard/purchase/${pr.id}`)} style={{ fontSize: 11.5, fontWeight: 700, color: '#2563eb', cursor: 'pointer' }}>View</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
