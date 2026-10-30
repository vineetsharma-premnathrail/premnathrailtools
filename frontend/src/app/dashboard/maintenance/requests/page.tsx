'use client'

import { normalizePriority, priorityLabel } from '@/lib/priority'
import { useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useRequireAnyApp } from '@/hooks/useAuth'
import { maintenanceApi } from '@/lib/api'
import { MaintenanceLookups, MaintenanceRequest } from '@/types'
import { TEXT, GLASS, SHADOWS, BORDER } from '@/lib/theme'
import { primaryBtnStyle, RowCount, Pill } from '@/components/shared/ui'
import MaintenanceNav from '@/components/maintenance/MaintenanceNav'
import { recordPath } from '@/lib/recordRef'
import { extractErrorMessages } from '@/lib/validation'
import { formatDateTime } from '@/lib/format'
import { PRIORITY_LABELS, REQUEST_STATUS_LABELS, REQUEST_TYPE_LABELS, WO_STATUS_LABELS } from '@/components/maintenance/labels'
import Select from '@/components/shared/Select'

const STATUS_HEX: Record<string, string> = { open: '#F59E0B', acknowledged: '#2563EB', converted: '#0f766e', rejected: '#DC2626', duplicate: '#78716c' }
const PRIORITY_HEX: Record<string, string> = { standard: '#475569', urgent: '#DC2626' }

const inputStyle: React.CSSProperties = {
  padding: '9px 12px', borderRadius: 10, border: `1px solid ${BORDER.normal}`,
  background: 'rgba(255,255,255,.7)', fontSize: 13, outline: 'none', color: TEXT.body,
}
const cellStyle: React.CSSProperties = { padding: '10px 14px', fontSize: 13, color: TEXT.body, borderTop: `1px solid ${BORDER.light}` }

export default function MaintenanceRequestsPage() {
  const { isAuthorized, isLoading, user } = useRequireAnyApp('maintenance', 'production')
  const router = useRouter()
  const searchParams = useSearchParams()
  const isMaintenanceUser = !!user?.apps?.includes('maintenance')

  const [requests, setRequests] = useState<MaintenanceRequest[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | string[]>('')
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState(searchParams.get('status') || '')
  const [mine, setMine] = useState(false)
  // The dashboard's plant filter carries over (?branch_id=) so its counts match this list.
  const [branchFilter, setBranchFilter] = useState(searchParams.get('branch_id') || '')
  const [lookups, setLookups] = useState<MaintenanceLookups | null>(null)

  useEffect(() => {
    if (!isAuthorized || !isMaintenanceUser) return
    maintenanceApi.getLookups().then(setLookups).catch(() => { /* plant filter is optional */ })
  }, [isAuthorized, isMaintenanceUser])

  useEffect(() => {
    if (!isAuthorized) return
    const params: Record<string, unknown> = {}
    if (statusFilter) params.status = statusFilter
    if (mine) params.mine = true
    if (branchFilter) params.branch_id = Number(branchFilter)
    if (search.trim()) params.search = search.trim()
    // Debounce typing and drop late responses so an older search can't overwrite a newer one.
    let ignore = false
    const t = setTimeout(() => {
      maintenanceApi.listRequests(params)
        .then((data) => { if (ignore) return; setRequests(Array.isArray(data) ? data : []); setError('') })
        .catch((err) => { if (!ignore) setError(extractErrorMessages(err, 'Failed to load maintenance requests.')) })
        .finally(() => { if (!ignore) setLoading(false) })
    }, 250)
    return () => { ignore = true; clearTimeout(t) }
  }, [isAuthorized, statusFilter, mine, branchFilter, search])

  if (isLoading || !isAuthorized) return null

  return (
    <div>
      <MaintenanceNav />

      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, marginBottom: 20, flexWrap: 'wrap' }}>
        <div>
          <p style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 4px' }}>
            Maintenance Module
          </p>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: TEXT.heading, margin: 0 }}>{isMaintenanceUser ? 'Maintenance Requests' : 'My Maintenance Requests'}</h1>
        </div>
        <button
          data-tour="maint-req-new-btn"
          onClick={() => router.push('/dashboard/maintenance/requests/new')}
          style={primaryBtnStyle}
        >
          + Report Breakdown
        </button>
      </div>

      {error && (
        <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
          {Array.isArray(error) ? error.join(' ') : error}
        </div>
      )}

      <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap', alignItems: 'center' }}>
        <input data-tour="maint-req-search" style={{ ...inputStyle, flex: '1 1 240px', minWidth: 200 }} placeholder="Search by number, asset or problem…" value={search} onChange={(e) => setSearch(e.target.value)} />
        <Select data-tour="maint-req-status-filter" style={{ ...inputStyle, flex: '0 1 190px' }} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="">All statuses</option>
          {Object.entries(REQUEST_STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </Select>
        {lookups && (lookups.branches.length > 1 || branchFilter) && (
          <Select data-tour="maint-req-plant-filter" style={{ ...inputStyle, flex: '0 1 170px' }} value={branchFilter} onChange={(e) => setBranchFilter(e.target.value)}>
            <option value="">All plants</option>
            {lookups.branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </Select>
        )}
        {isMaintenanceUser && (
          <label data-tour="maint-req-mine" style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: TEXT.body, cursor: 'pointer' }}>
            <input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} /> Raised by me
          </label>
        )}
      </div>

      <div data-tour="maint-req-table" style={{
        borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur,
        border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), overflow: 'auto', maxHeight: 'calc(100vh - 320px)',
      }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 1100 }}>
          <thead>
            <tr>
              {['Number', 'Asset', 'Type', 'Problem', 'Priority', 'Reported', 'Raised By', 'Status', 'Work Order'].map((h, hi) => (
                <th key={h} style={{ textAlign: 'left', padding: '10px 14px', fontSize: 11, fontWeight: 600, letterSpacing: '.03em', whiteSpace: 'nowrap', textTransform: 'uppercase', color: TEXT.muted, position: 'sticky', top: 0, background: '#fdf1e6', zIndex: 1 }}>
                  {h}{hi === 0 && <RowCount count={requests.length} />}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={9} style={{ padding: 20, textAlign: 'center', fontSize: 13, color: TEXT.muted }}>Loading…</td></tr>
            ) : requests.length === 0 ? (
              <tr><td colSpan={9} style={{ padding: 20, textAlign: 'center', fontSize: 13, color: TEXT.muted }}>
                {search || statusFilter || mine || branchFilter ? 'No requests match these filters.' : 'No maintenance requests yet. Use “Report Breakdown” when a machine stops or misbehaves.'}
              </td></tr>
            ) : (
              requests.map((r) => (
                <tr key={r.id} onClick={() => router.push(recordPath('/dashboard/maintenance/requests', r))} style={{ cursor: 'pointer' }}>
                  <td style={{ ...cellStyle, fontWeight: 600, color: TEXT.heading, whiteSpace: 'nowrap' }}>{r.request_number}</td>
                  <td style={cellStyle}>
                    <span style={{ fontWeight: 600 }}>{r.asset_code}</span>
                    <span style={{ color: TEXT.muted }}> {r.asset_name}</span>
                  </td>
                  <td style={cellStyle}>
                    {REQUEST_TYPE_LABELS[r.request_type]?.split(' (')[0] || r.request_type}
                    {r.machine_down && <span style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#DC2626' }}>Machine down</span>}
                  </td>
                  <td style={{ ...cellStyle, maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.problem_description}>{r.problem_description}</td>
                  <td style={cellStyle}>
                    <Pill label={priorityLabel(r.priority)} hex={PRIORITY_HEX[normalizePriority(r.priority)]} />
                  </td>
                  <td style={{ ...cellStyle, whiteSpace: 'nowrap' }}>{formatDateTime(r.reported_at)}</td>
                  <td style={cellStyle}>{r.raised_by_name || '—'}</td>
                  <td style={cellStyle}>
                    <Pill label={REQUEST_STATUS_LABELS[r.status] || r.status} hex={STATUS_HEX[r.status]} />
                    {r.can_confirm && <span style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#F59E0B', marginTop: 4 }}>Confirm repair</span>}
                  </td>
                  <td style={{ ...cellStyle, whiteSpace: 'nowrap' }}>
                    {r.work_order ? `${r.work_order.wo_number} · ${WO_STATUS_LABELS[r.work_order.status] || r.work_order.status}` : '—'}
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
