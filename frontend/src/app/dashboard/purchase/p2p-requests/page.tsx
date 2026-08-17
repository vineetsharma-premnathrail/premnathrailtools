'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { p2pApi } from '@/lib/api'
import { P2PRequest, PRCategoryMeta } from '@/types'
import { TEXT, GLASS, SHADOWS } from '@/lib/theme'

const STATUS_LABELS: Record<string, string> = {
  submitted: 'Submitted', approved: 'Approved', po_raised: 'PO Raised', partially_received: 'Partially Received',
  received: 'Received', closed: 'Closed', rejected: 'Rejected', cancelled: 'Cancelled',
}
const STATUS_HEX: Record<string, string> = {
  submitted: '#3b82f6', approved: '#8b5cf6', po_raised: '#f59e0b', partially_received: '#f97316',
  received: '#0ea5e9', closed: '#22c55e', rejected: '#dc2626', cancelled: '#94a3b8',
}
const PRIORITY_HEX: Record<string, string> = { low: '#64748b', medium: '#f59e0b', high: '#dc2626' }

export default function PurchaseTeamRequisitionsPage() {
  const { isAuthorized, isLoading } = useRequireApp('purchase')
  const router = useRouter()
  const [prs, setPrs] = useState<P2PRequest[]>([])
  const [categories, setCategories] = useState<PRCategoryMeta[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [categoryFilter, setCategoryFilter] = useState('all')
  const [departmentFilter, setDepartmentFilter] = useState('')
  const [projectFilter, setProjectFilter] = useState('')
  const [priorityFilter, setPriorityFilter] = useState('all')
  const [requiredDateFilter, setRequiredDateFilter] = useState('')

  const load = async () => {
    setLoading(true)
    setError('')
    try {
      const data = await p2pApi.list({
        search: search || undefined,
        status: statusFilter !== 'all' ? statusFilter : undefined,
        category_code: categoryFilter !== 'all' ? categoryFilter : undefined,
        department: departmentFilter || undefined,
        project_label: projectFilter || undefined,
        priority: priorityFilter !== 'all' ? priorityFilter : undefined,
        required_date: requiredDateFilter || undefined,
        limit: 1000,
      })
      setPrs(data)
    } catch {
      setError('Failed to load P2P requests.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (!isAuthorized) return
    p2pApi.getMeta().then((m) => setCategories(m.categories)).catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthorized])

  useEffect(() => {
    if (isAuthorized) load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthorized, statusFilter, categoryFilter, priorityFilter, requiredDateFilter])

  useEffect(() => {
    if (!isAuthorized) return
    const t = setTimeout(load, 300)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, departmentFilter, projectFilter])

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
          <p style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 4px' }}>Purchase Module</p>
          <h1 style={{ fontSize: 24, fontWeight: 800, color: TEXT.heading, margin: '0 0 4px' }}>Standalone P2P Requests</h1>
          <p style={{ fontSize: 13, color: TEXT.muted, margin: 0 }}>{prs.length} PR(s) found — raised directly by departments</p>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
        <button
          onClick={() => router.push('/dashboard/purchase')}
          style={{ padding: '9px 18px', borderRadius: 10, fontSize: 13, fontWeight: 700, border: '1px solid rgba(0,0,0,0.1)', background: 'rgba(255,255,255,.5)', color: TEXT.secondary, cursor: 'pointer' }}
        >
          ← From Service Requests
        </button>
        <div style={{ padding: '9px 18px', borderRadius: 10, fontSize: 13, fontWeight: 700, background: 'linear-gradient(140deg,#0ea5e9,#38bdf8)', color: '#fff' }}>
          Standalone Requisitions
        </div>
      </div>

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 16 }}>
        {Object.entries(STATUS_LABELS).map(([key, label]) => (
          <div key={key} style={{ padding: '8px 14px', borderRadius: 10, background: `${STATUS_HEX[key]}14`, border: `1px solid ${STATUS_HEX[key]}33`, minWidth: 90 }}>
            <p style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', color: STATUS_HEX[key], margin: '0 0 2px' }}>{label}</p>
            <p style={{ fontSize: 16, fontWeight: 800, color: TEXT.heading, margin: 0 }}>{counts[key] || 0}</p>
          </div>
        ))}
      </div>

      {error && (
        <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
          {error}
        </div>
      )}

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: 16 }}>
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="PR number..." style={{ flex: '1 1 160px', padding: '10px 14px', borderRadius: 10, border: '1px solid rgba(0,0,0,0.1)', background: '#fff', fontSize: 13.5, outline: 'none' }} />
        <input value={projectFilter} onChange={(e) => setProjectFilter(e.target.value)} placeholder="Project..." style={{ flex: '1 1 140px', padding: '10px 14px', borderRadius: 10, border: '1px solid rgba(0,0,0,0.1)', background: '#fff', fontSize: 13.5, outline: 'none' }} />
        <input value={departmentFilter} onChange={(e) => setDepartmentFilter(e.target.value)} placeholder="Department..." style={{ flex: '1 1 140px', padding: '10px 14px', borderRadius: 10, border: '1px solid rgba(0,0,0,0.1)', background: '#fff', fontSize: 13.5, outline: 'none' }} />
        <input type="date" value={requiredDateFilter} onChange={(e) => setRequiredDateFilter(e.target.value)} style={{ padding: '10px 14px', borderRadius: 10, border: '1px solid rgba(0,0,0,0.1)', background: '#fff', fontSize: 13 }} />
        <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)} style={{ padding: '10px 14px', borderRadius: 10, border: '1px solid rgba(0,0,0,0.1)', background: '#fff', fontSize: 13, fontWeight: 500 }}>
          <option value="all">All Categories</option>
          {categories.map((c) => <option key={c.code} value={c.code}>{c.label}</option>)}
        </select>
        <select value={priorityFilter} onChange={(e) => setPriorityFilter(e.target.value)} style={{ padding: '10px 14px', borderRadius: 10, border: '1px solid rgba(0,0,0,0.1)', background: '#fff', fontSize: 13, fontWeight: 500 }}>
          <option value="all">All Priorities</option>
          <option value="low">Low</option>
          <option value="medium">Medium</option>
          <option value="high">High</option>
        </select>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} style={{ padding: '10px 14px', borderRadius: 10, border: '1px solid rgba(0,0,0,0.1)', background: '#fff', fontSize: 13, fontWeight: 500 }}>
          <option value="all">All Statuses</option>
          {Object.entries(STATUS_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </div>

      <div style={{ borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur, border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), overflow: 'auto', maxHeight: 'calc(100vh - 400px)' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 1100 }}>
          <thead>
            <tr style={{ background: 'rgba(14,165,233,0.06)' }}>
              {['PR Number', 'Category', 'Project', 'Department', 'Requested By', 'Required Date', 'Priority', 'Status', 'Vendor', ''].map((h) => (
                <th key={h} style={{ textAlign: 'left', padding: '12px 16px', fontSize: 11, fontWeight: 700, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, whiteSpace: 'nowrap', position: 'sticky', top: 0, background: '#eaf6fc', zIndex: 1 }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={10} style={{ padding: 24, textAlign: 'center', color: TEXT.muted, fontSize: 13 }}>Loading…</td></tr>}
            {!loading && prs.length === 0 && <tr><td colSpan={10} style={{ padding: 24, textAlign: 'center', color: TEXT.muted, fontSize: 13 }}>No P2P requests found.</td></tr>}
            {prs.map((pr) => (
              <tr key={pr.id} onClick={() => router.push(`/dashboard/purchase/p2p-requests/${pr.id}`)} style={{ borderTop: '1px solid rgba(0,0,0,0.05)', cursor: 'pointer' }}>
                <td style={{ padding: '12px 16px', fontSize: 13, fontWeight: 700, color: '#0369a1' }}>{pr.pr_number}</td>
                <td style={{ padding: '12px 16px', fontSize: 13, color: TEXT.secondary }}>{pr.category_label || pr.category_code}</td>
                <td style={{ padding: '12px 16px', fontSize: 13, color: TEXT.secondary }}>{pr.project_label || '—'}</td>
                <td style={{ padding: '12px 16px', fontSize: 13, color: TEXT.secondary }}>{pr.department || '—'}</td>
                <td style={{ padding: '12px 16px', fontSize: 13, color: TEXT.secondary }}>{pr.requested_by_name || '—'}</td>
                <td style={{ padding: '12px 16px', fontSize: 12.5, color: TEXT.secondary, whiteSpace: 'nowrap' }}>{pr.required_date ? new Date(pr.required_date).toLocaleDateString() : '—'}</td>
                <td style={{ padding: '12px 16px' }}>
                  <span style={{ fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 9999, background: `${PRIORITY_HEX[pr.priority] || '#64748b'}1a`, color: PRIORITY_HEX[pr.priority] || '#64748b', textTransform: 'capitalize' }}>{pr.priority}</span>
                </td>
                <td style={{ padding: '12px 16px' }}>
                  <span style={{ fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 9999, background: `${STATUS_HEX[pr.status]}1a`, color: STATUS_HEX[pr.status], whiteSpace: 'nowrap' }}>{STATUS_LABELS[pr.status] || pr.status}</span>
                </td>
                <td style={{ padding: '12px 16px', fontSize: 13, color: TEXT.secondary }}>{pr.vendor || pr.selected_vendor || '—'}</td>
                <td style={{ padding: '12px 16px' }} onClick={(e) => e.stopPropagation()}>
                  <span onClick={() => router.push(`/dashboard/purchase/p2p-requests/${pr.id}`)} style={{ fontSize: 11.5, fontWeight: 700, color: '#2563eb', cursor: 'pointer' }}>View</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
