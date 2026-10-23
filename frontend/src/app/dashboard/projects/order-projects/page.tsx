'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { orderProjectsApi } from '@/lib/api'
import { OrderProject } from '@/types'
import { TEXT, GLASS, SHADOWS } from '@/lib/theme'
import { extractErrorMessages } from '@/lib/validation'
import { formatDate } from '@/lib/format'
import ProjectsNav from '@/components/projects/ProjectsNav'
import { inputStyle, thStyle, tdStyle, Pill, ErrorBanner, PageHeader } from '@/components/sales/SalesUi'
import { recordPath } from '@/lib/recordRef'
import { useCan } from '@/lib/permissions'
import { OP_STATUS_LABELS, OP_STATUS_HEX } from '@/components/sales/OrderProjectTable'

export default function OrderProjectsPage() {
  const { isAuthorized, isLoading } = useRequireApp('projects')
  const { can } = useCan()
  const router = useRouter()
  const [projects, setProjects] = useState<OrderProject[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | string[]>('')
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('')
  const canView = can('projects', 'order_projects', 'view')

  useEffect(() => {
    if (!isAuthorized || !canView) return
    const params: Record<string, unknown> = {}
    if (status) params.status = status
    if (search.trim()) params.q = search.trim()
    let ignore = false
    const t = setTimeout(() => {
      orderProjectsApi.list(params)
        .then((d) => { if (!ignore) { setProjects(d); setError('') } })
        .catch((err) => { if (!ignore) setError(extractErrorMessages(err, 'Failed to load order projects.')) })
        .finally(() => { if (!ignore) setLoading(false) })
    }, 250)
    return () => { ignore = true; clearTimeout(t) }
  }, [isAuthorized, canView, status, search])

  if (isLoading || !isAuthorized) return null

  return (
    <div>
      <ProjectsNav />
      <PageHeader moduleLabel="Project Management" title="Order Projects" subtitle="One execution project per confirmed RRV order — every vehicle and spares lot the departments work against, up to delivery." />
      {!canView && <ErrorBanner error="You don't have 'view' permission on Project Management › Order Projects. Ask an admin to grant it in Organization › Role & Permissions." />}
      <ErrorBanner error={error} />

      <div data-tour="sales-op-filters" style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap', alignItems: 'center' }}>
        <input style={{ ...inputStyle, flex: '1 1 240px', minWidth: 200, maxWidth: 380 }} placeholder="Search OP no., SO no., customer, PO no.…" value={search} onChange={(e) => setSearch(e.target.value)} />
        <select style={{ ...inputStyle, width: 170 }} value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All statuses</option>
          {Object.entries(OP_STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </div>

      <div data-tour="sales-op-table" style={{ borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur, border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), overflow: 'auto', maxHeight: 'calc(100vh - 320px)' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 1050 }}>
          <thead>
            <tr>{['Project', 'Sales order', 'Customer', 'Customer PO', 'Vehicles', 'Project manager', 'Planned end', 'Status', ''].map((h) => <th key={h} style={thStyle}>{h}</th>)}</tr>
          </thead>
          <tbody>
            {loading && canView ? (
              <tr><td colSpan={9} style={{ padding: 20, textAlign: 'center', fontSize: 13, color: TEXT.muted }}>Loading…</td></tr>
            ) : projects.length === 0 ? (
              <tr><td colSpan={9} style={{ padding: 20, textAlign: 'center', fontSize: 13, color: TEXT.muted }}>
                {search || status ? 'No projects match these filters.' : 'No order projects yet. A project is created automatically when a sales order with an RRV line is confirmed.'}
              </td></tr>
            ) : projects.map((p) => (
              <tr key={p.id} onClick={() => router.push(recordPath('/dashboard/projects/order-projects', p))} style={{ cursor: 'pointer' }}>
                <td style={{ ...tdStyle, fontWeight: 600, color: TEXT.heading, whiteSpace: 'nowrap' }}>{p.op_number}</td>
                <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>{p.so_number || '—'}</td>
                <td style={tdStyle}>{p.customer_name || '—'}</td>
                <td style={tdStyle}>{p.customer_po_number || '—'}{p.customer_po_date ? <span style={{ color: TEXT.muted }}> · {formatDate(p.customer_po_date)}</span> : null}</td>
                <td style={tdStyle}>
                  {p.vehicles_delivered}/{p.vehicles_total} delivered
                  {p.lots_total ? <span style={{ color: TEXT.muted }}> · {p.lots_total} lot{p.lots_total === 1 ? '' : 's'}</span> : null}
                </td>
                <td style={tdStyle}>{p.project_manager_name || <span style={{ color: TEXT.muted }}>Not assigned</span>}</td>
                <td style={tdStyle}>{formatDate(p.planned_end)}</td>
                <td style={tdStyle}><Pill label={OP_STATUS_LABELS[p.status] || p.status} hex={OP_STATUS_HEX[p.status] || '#78716c'} /></td>
                <td style={tdStyle} onClick={(e) => e.stopPropagation()}>
                  <span onClick={() => router.push(recordPath('/dashboard/projects/order-projects', p))} style={{ color: '#FF6A2A', fontWeight: 600, cursor: 'pointer' }}>View</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
