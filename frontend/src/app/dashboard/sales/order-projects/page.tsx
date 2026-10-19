'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { orderProjectsApi } from '@/lib/api'
import { OrderProject } from '@/types'
import { TEXT, GLASS, SHADOWS } from '@/lib/theme'
import { extractErrorMessages } from '@/lib/validation'
import { formatDate } from '@/lib/format'
import SalesNav from '@/components/sales/SalesNav'
import { inputStyle, thStyle, tdStyle, Pill, ErrorBanner, PageHeader } from '@/components/sales/SalesUi'
import ConfirmDialog from '@/components/erp/ConfirmDialog'
import { secondaryBtnStyle } from '@/components/shared/ui'
import { recordPath } from '@/lib/recordRef'
import { useCan } from '@/lib/permissions'
import { OP_STATUS_LABELS, OP_STATUS_HEX } from '@/components/sales/OrderProjectTable'

export default function OrderProjectsPage() {
  const { isAuthorized, isLoading, user } = useRequireApp('sales')
  const { can } = useCan()
  const router = useRouter()
  const [projects, setProjects] = useState<OrderProject[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | string[]>('')
  const [notice, setNotice] = useState('')
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('')
  const [reload, setReload] = useState(0)
  const [confirmBackfill, setConfirmBackfill] = useState(false)
  const [busy, setBusy] = useState(false)
  const isAdmin = !!user && (user.role === 'admin' || !!(user as { is_azure_admin?: boolean }).is_azure_admin)
  const canView = can('sales', 'order_projects', 'view')

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
  }, [isAuthorized, canView, status, search, reload])

  const runBackfill = async () => {
    setConfirmBackfill(false)
    setBusy(true)
    setNotice('')
    try {
      const r = await orderProjectsApi.backfill()
      setNotice(r.created ? `Created ${r.created} project(s): ${r.op_numbers.join(', ')}.` : 'Every confirmed RRV order already has its project — nothing to create.')
      setReload((n) => n + 1)
    } catch (err) {
      setError(extractErrorMessages(err, 'Could not create the projects.'))
    } finally { setBusy(false) }
  }

  if (isLoading || !isAuthorized) return null

  return (
    <div>
      <SalesNav />
      <PageHeader title="Order Projects" subtitle="One execution project per confirmed RRV order — every vehicle and spares lot the departments work against, up to delivery.">
        {isAdmin && (
          <button data-tour="sales-op-backfill" style={secondaryBtnStyle} disabled={busy} onClick={() => setConfirmBackfill(true)}>
            {busy ? 'Creating…' : 'Create projects for confirmed orders'}
          </button>
        )}
      </PageHeader>
      {!canView && <ErrorBanner error="You don't have 'view' permission on Sales › Order Projects. Ask an admin to grant it in Organization › Role & Permissions." />}
      <ErrorBanner error={error} />
      {notice && <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(22,163,74,0.08)', border: '1px solid rgba(22,163,74,0.2)', color: '#15803d', fontSize: 13 }}>{notice}</div>}

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
              <tr key={p.id} onClick={() => router.push(recordPath('/dashboard/sales/order-projects', p))} style={{ cursor: 'pointer' }}>
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
                  <span onClick={() => router.push(recordPath('/dashboard/sales/order-projects', p))} style={{ color: '#FF6A2A', fontWeight: 600, cursor: 'pointer' }}>View</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ConfirmDialog
        open={confirmBackfill}
        title="Create projects for confirmed orders?"
        message="Every confirmed sales order (not cancelled or closed) that has an RRV line but no order project yet gets one now — with one element per vehicle and one lot per spares line. Orders that already have a project are left as they are."
        confirmLabel="Create projects"
        danger={false}
        onConfirm={runBackfill}
        onCancel={() => setConfirmBackfill(false)}
      />
    </div>
  )
}
