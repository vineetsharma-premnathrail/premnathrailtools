'use client'

import { useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { maintenanceApi } from '@/lib/api'
import { MaintenanceAsset, MaintenanceLookups } from '@/types'
import { TEXT, GLASS, SHADOWS, GRADIENTS, BORDER } from '@/lib/theme'
import MaintenanceNav from '@/components/maintenance/MaintenanceNav'
import { extractErrorMessages } from '@/lib/validation'
import { ASSET_CATEGORY_LABELS, ASSET_STATUS_LABELS } from '@/components/maintenance/labels'

const STATUS_HEX: Record<string, string> = { operational: '#16A34A', breakdown: '#DC2626', under_maintenance: '#F59E0B', standby: '#2563EB', decommissioned: '#78716c' }
const CRIT_HEX: Record<string, string> = { A: '#DC2626', B: '#F59E0B', C: '#78716c' }

const inputStyle: React.CSSProperties = {
  padding: '9px 12px', borderRadius: 10, border: `1px solid ${BORDER.normal}`,
  background: 'rgba(255,255,255,.7)', fontSize: 13, outline: 'none', color: TEXT.body,
}
const cellStyle: React.CSSProperties = { padding: '10px 14px', fontSize: 13, color: TEXT.body, borderTop: `1px solid ${BORDER.light}` }

export default function MaintenanceAssetsPage() {
  const { isAuthorized, isLoading } = useRequireApp('maintenance')
  const router = useRouter()
  const searchParams = useSearchParams()

  const [assets, setAssets] = useState<MaintenanceAsset[]>([])
  const [lookups, setLookups] = useState<MaintenanceLookups | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | string[]>('')
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState(searchParams.get('status') || '')
  const [categoryFilter, setCategoryFilter] = useState('')
  const [criticalityFilter, setCriticalityFilter] = useState('')
  const [branchFilter, setBranchFilter] = useState('')

  useEffect(() => {
    if (!isAuthorized) return
    maintenanceApi.getLookups().then(setLookups).catch(() => { /* plant filter is optional */ })
  }, [isAuthorized])

  useEffect(() => {
    if (!isAuthorized) return
    const params: Record<string, unknown> = {}
    if (statusFilter) params.status = statusFilter
    if (categoryFilter) params.category = categoryFilter
    if (criticalityFilter) params.criticality = criticalityFilter
    if (branchFilter) params.branch_id = Number(branchFilter)
    if (search.trim()) params.search = search.trim()
    maintenanceApi.listAssets(params)
      .then((data) => { setAssets(Array.isArray(data) ? data : []); setError('') })
      .catch((err) => setError(extractErrorMessages(err, 'Failed to load assets.')))
      .finally(() => setLoading(false))
  }, [isAuthorized, statusFilter, categoryFilter, criticalityFilter, branchFilter, search])

  if (isLoading || !isAuthorized) return null

  return (
    <div>
      <MaintenanceNav />

      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, marginBottom: 20, flexWrap: 'wrap' }}>
        <div>
          <p style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 4px' }}>
            Maintenance Module
          </p>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: TEXT.heading, margin: 0 }}>Asset Register</h1>
        </div>
        <button
          onClick={() => router.push('/dashboard/maintenance/assets/new')}
          style={{
            padding: '12px 22px', borderRadius: 12, border: 'none', cursor: 'pointer',
            background: GRADIENTS.primary, color: '#fff', fontSize: 14, fontWeight: 600,
            boxShadow: `0 8px 20px ${SHADOWS.glowOrange}`,
          }}
        >
          + New Asset
        </button>
      </div>

      {error && (
        <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
          {Array.isArray(error) ? error.join(' ') : error}
        </div>
      )}

      <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
        <input style={{ ...inputStyle, flex: '1 1 240px', minWidth: 200 }} placeholder="Search by code, name, serial or location…" value={search} onChange={(e) => setSearch(e.target.value)} />
        {lookups && lookups.branches.length > 1 && (
          <select style={{ ...inputStyle, flex: '0 1 170px' }} value={branchFilter} onChange={(e) => setBranchFilter(e.target.value)}>
            <option value="">All plants</option>
            {lookups.branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        )}
        <select style={{ ...inputStyle, flex: '0 1 190px' }} value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}>
          <option value="">All categories</option>
          {Object.entries(ASSET_CATEGORY_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <select style={{ ...inputStyle, flex: '0 1 140px' }} value={criticalityFilter} onChange={(e) => setCriticalityFilter(e.target.value)}>
          <option value="">Any criticality</option>
          <option value="A">A</option>
          <option value="B">B</option>
          <option value="C">C</option>
        </select>
        <select style={{ ...inputStyle, flex: '0 1 180px' }} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="">All statuses</option>
          {Object.entries(ASSET_STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </div>

      <div style={{
        borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur,
        border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), overflow: 'auto', maxHeight: 'calc(100vh - 320px)',
      }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 1000 }}>
          <thead>
            <tr>
              {['Code', 'Name', 'Category', 'Plant', 'Location', 'Crit.', 'Open WOs', 'Status', ''].map((h) => (
                <th key={h} style={{ textAlign: 'left', padding: '10px 14px', fontSize: 11, fontWeight: 600, letterSpacing: '.03em', textTransform: 'uppercase', color: TEXT.muted, position: 'sticky', top: 0, background: '#fdf1e6', zIndex: 1 }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={9} style={{ padding: 20, textAlign: 'center', fontSize: 13, color: TEXT.muted }}>Loading…</td></tr>
            ) : assets.length === 0 ? (
              <tr><td colSpan={9} style={{ padding: 20, textAlign: 'center', fontSize: 13, color: TEXT.muted }}>
                {search || statusFilter || categoryFilter || criticalityFilter || branchFilter
                  ? 'No assets match these filters.'
                  : 'No assets yet. Add the machines, cranes, compressors and other plant equipment you maintain.'}
              </td></tr>
            ) : (
              assets.map((a) => (
                <tr key={a.id} onClick={() => router.push(`/dashboard/maintenance/assets/${a.id}`)} style={{ cursor: 'pointer' }}>
                  <td style={{ ...cellStyle, fontWeight: 600, color: TEXT.heading }}>{a.asset_code}</td>
                  <td style={cellStyle}>
                    {a.name}
                    {a.parent_asset_code && <span style={{ fontSize: 11.5, color: TEXT.muted }}> · part of {a.parent_asset_code}</span>}
                  </td>
                  <td style={cellStyle}>{ASSET_CATEGORY_LABELS[a.category] || a.category}</td>
                  <td style={cellStyle}>{a.branch_name || '—'}</td>
                  <td style={cellStyle}>{a.location_text || '—'}</td>
                  <td style={cellStyle}>
                    <span style={{ fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 9999, background: `${CRIT_HEX[a.criticality]}1a`, color: CRIT_HEX[a.criticality] }}>{a.criticality}</span>
                  </td>
                  <td style={cellStyle}>{a.open_work_orders || '—'}</td>
                  <td style={cellStyle}>
                    <span style={{ fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 9999, background: `${STATUS_HEX[a.status]}1a`, color: STATUS_HEX[a.status], whiteSpace: 'nowrap' }}>
                      {ASSET_STATUS_LABELS[a.status] || a.status}
                    </span>
                  </td>
                  <td onClick={(e) => e.stopPropagation()} style={cellStyle}>
                    <span onClick={() => router.push(`/dashboard/maintenance/assets/${a.id}`)} style={{ fontSize: 12, fontWeight: 600, color: '#FF6A2A', cursor: 'pointer' }}>View</span>
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
