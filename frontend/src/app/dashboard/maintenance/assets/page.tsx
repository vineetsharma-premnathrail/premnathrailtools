'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { maintenanceApi } from '@/lib/api'
import { MaintenanceAsset, MaintenanceLookups } from '@/types'
import { TEXT, GLASS, SHADOWS, BORDER } from '@/lib/theme'
import MaintenanceNav from '@/components/maintenance/MaintenanceNav'
import { extractErrorMessages } from '@/lib/validation'
import { ASSET_CATEGORY_LABELS, ASSET_STATUS_LABELS } from '@/components/maintenance/labels'
import AssetImportDialog from '@/components/maintenance/AssetImportDialog'
import { secondaryBtnStyle, primaryBtnStyle, RowCount, Pill } from '@/components/shared/ui'
import { recordPath, refOf } from '@/lib/recordRef'
import { useCan } from '@/lib/permissions'
import Select from '@/components/shared/Select'

const STATUS_HEX: Record<string, string> = { operational: '#16A34A', breakdown: '#DC2626', under_maintenance: '#F59E0B', standby: '#2563EB', decommissioned: '#78716c' }
const CRIT_HEX: Record<string, string> = { A: '#DC2626', B: '#F59E0B', C: '#78716c' }

const inputStyle: React.CSSProperties = {
  padding: '9px 12px', borderRadius: 10, border: `1px solid ${BORDER.normal}`,
  background: 'rgba(255,255,255,.7)', fontSize: 13, outline: 'none', color: TEXT.body,
}
const cellStyle: React.CSSProperties = { padding: '10px 14px', fontSize: 13, color: TEXT.body, borderTop: `1px solid ${BORDER.light}` }

export default function MaintenanceAssetsPage() {
  const { isAuthorized, isLoading } = useRequireApp('maintenance')
  const { can } = useCan()
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
  const [branchFilter, setBranchFilter] = useState(searchParams.get('branch_id') || '')
  const [importOpen, setImportOpen] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)
  const [selected, setSelected] = useState<number[]>([])
  // Signed refs of every asset seen, so a selection spanning filter changes can still be printed.
  const refById = useRef(new Map<number, string>())

  // Keep the URL params authoritative so a dashboard drill-down
  // (?status=down&branch_id=N) lands on exactly the records the KPI tile counted.
  useEffect(() => {
    setStatusFilter(searchParams.get('status') || '')
    setBranchFilter(searchParams.get('branch_id') || '')
  }, [searchParams])

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
      .then((data) => {
        const rows = Array.isArray(data) ? data : []
        rows.forEach((a) => refById.current.set(a.id, refOf(a)))
        setAssets(rows); setError('')
      })
      .catch((err) => setError(extractErrorMessages(err, 'Failed to load assets.')))
      .finally(() => setLoading(false))
  }, [isAuthorized, statusFilter, categoryFilter, criticalityFilter, branchFilter, search, reloadKey])

  const MAX_LABELS = 200
  const pageIds = assets.map((a) => a.id)
  const allOnPageSelected = pageIds.length > 0 && pageIds.every((id) => selected.includes(id))
  const toggleOne = (id: number) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]))
  const toggleAllOnPage = () => setSelected((s) => (allOnPageSelected
    ? s.filter((id) => !pageIds.includes(id))
    : Array.from(new Set([...s, ...pageIds]))))
  const printAllHref = branchFilter
    ? `/dashboard/maintenance/assets/labels?branch_id=${branchFilter}`
    : '/dashboard/maintenance/assets/labels'

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
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <button data-tour="maint-asset-labels-btn" onClick={() => router.push(printAllHref)} style={secondaryBtnStyle}>Print QR Labels</button>
        {can('maintenance', 'assets', 'import') && <button data-tour="maint-asset-import-btn" onClick={() => setImportOpen(true)} style={secondaryBtnStyle}>Import from Excel</button>}
        {can('maintenance', 'assets', 'create') && <button
          data-tour="maint-asset-new-btn"
          onClick={() => router.push('/dashboard/maintenance/assets/new')}
          style={primaryBtnStyle}
        >
          + New Asset
        </button>}
        </div>
      </div>

      <AssetImportDialog open={importOpen} onClose={() => setImportOpen(false)} onImported={() => setReloadKey((n) => n + 1)} />

      {error && (
        <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
          {Array.isArray(error) ? error.join(' ') : error}
        </div>
      )}

      <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
        <input data-tour="maint-asset-search" style={{ ...inputStyle, flex: '1 1 240px', minWidth: 200 }} placeholder="Search by code, name, serial or location…" value={search} onChange={(e) => setSearch(e.target.value)} />
        {lookups && lookups.branches.length > 1 && (
          <Select data-tour="maint-asset-plant-filter" style={{ ...inputStyle, flex: '0 1 170px' }} value={branchFilter} onChange={(e) => setBranchFilter(e.target.value)}>
            <option value="">All plants</option>
            {lookups.branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </Select>
        )}
        <Select data-tour="maint-asset-category-filter" style={{ ...inputStyle, flex: '0 1 190px' }} value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}>
          <option value="">All categories</option>
          {Object.entries(ASSET_CATEGORY_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </Select>
        <Select data-tour="maint-asset-crit-filter" style={{ ...inputStyle, flex: '0 1 140px' }} value={criticalityFilter} onChange={(e) => setCriticalityFilter(e.target.value)}>
          <option value="">Any criticality</option>
          <option value="A">A</option>
          <option value="B">B</option>
          <option value="C">C</option>
        </Select>
        <Select data-tour="maint-asset-status-filter" style={{ ...inputStyle, flex: '0 1 180px' }} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="">All statuses</option>
          <option value="down">Down (breakdown + under maintenance)</option>
          {Object.entries(ASSET_STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </Select>
      </div>

      {selected.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', padding: '10px 14px', marginBottom: 12, borderRadius: 12, background: 'rgba(255,106,42,0.08)', border: '1px solid rgba(255,106,42,0.25)', fontSize: 13, color: TEXT.body }}>
          <span style={{ fontWeight: 600 }}>{selected.length} selected</span>
          {selected.length > MAX_LABELS ? (
            <span style={{ color: '#b91c1c' }}>Max {MAX_LABELS} labels per sheet — print in batches (deselect {selected.length - MAX_LABELS}).</span>
          ) : (
            <button
              onClick={() => router.push(`/dashboard/maintenance/assets/labels?ids=${selected.map((id) => refById.current.get(id)).filter(Boolean).join(',')}`)}
              style={secondaryBtnStyle}
            >
              Print labels for {selected.length} selected
            </button>
          )}
          <button onClick={() => setSelected([])} style={{ ...secondaryBtnStyle, marginLeft: 'auto' }}>Clear selection</button>
        </div>
      )}

      <div data-tour="maint-asset-table" style={{
        borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur,
        border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), overflow: 'auto', maxHeight: 'calc(100vh - 320px)',
      }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 1000 }}>
          <thead>
            <tr>
              <th style={{ width: 36, padding: '10px 0 10px 14px', position: 'sticky', top: 0, background: '#fdf1e6', zIndex: 1 }}>
                <input type="checkbox" aria-label="Select all assets on this page" checked={allOnPageSelected} onChange={toggleAllOnPage} disabled={pageIds.length === 0} />
              </th>
              {['Code', 'Name', 'Category', 'Plant', 'Location', 'Crit.', 'Open WOs', 'Status'].map((h, hi) => (
                <th key={h} style={{ textAlign: 'left', padding: '10px 14px', fontSize: 11, fontWeight: 600, letterSpacing: '.03em', whiteSpace: 'nowrap', textTransform: 'uppercase', color: TEXT.muted, position: 'sticky', top: 0, background: '#fdf1e6', zIndex: 1 }}>
                  {h}{hi === 0 && <RowCount count={assets.length} />}
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
                <tr key={a.id} onClick={() => router.push(recordPath('/dashboard/maintenance/assets', a))} style={{ cursor: 'pointer' }}>
                  <td onClick={(e) => e.stopPropagation()} style={{ ...cellStyle, width: 36, padding: '10px 0 10px 14px' }}>
                    <input type="checkbox" aria-label={`Select ${a.asset_code}`} checked={selected.includes(a.id)} onChange={() => toggleOne(a.id)} />
                  </td>
                  <td style={{ ...cellStyle, fontWeight: 600, color: TEXT.heading }}>{a.asset_code}</td>
                  <td style={cellStyle}>
                    {a.name}
                    {a.parent_asset_code && <span style={{ fontSize: 11.5, color: TEXT.muted }}> · part of {a.parent_asset_code}</span>}
                  </td>
                  <td style={cellStyle}>{ASSET_CATEGORY_LABELS[a.category] || a.category}</td>
                  <td style={cellStyle}>{a.branch_name || '—'}</td>
                  <td style={cellStyle}>{a.location_text || '—'}</td>
                  <td style={cellStyle}>
                    <Pill label={a.criticality} hex={CRIT_HEX[a.criticality]} />
                  </td>
                  <td style={cellStyle}>{a.open_work_orders || '—'}</td>
                  <td style={cellStyle}>
                    <Pill label={ASSET_STATUS_LABELS[a.status] || a.status} hex={STATUS_HEX[a.status]} />
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
