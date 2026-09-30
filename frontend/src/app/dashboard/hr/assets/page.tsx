'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { hrApi, usersApi } from '@/lib/api'
import { extractErrorMessages } from '@/lib/validation'
import type { HrAsset, HrBranchLookup, DirectoryUser } from '@/types'
import HrNav from '@/components/hr/HrNav'
import SearchableSelect from '@/components/erp/SearchableSelect'
import { AssetFormDialog, ASSET_CATEGORY_LABELS, ASSET_CONDITION_LABELS } from '@/components/hr/admin/AssetDialogs'
import {
  PageHeader, ErrorBanner, SuccessBanner, Pill, EmptyRow, StatCard, primaryActionStyle, filterInputStyle,
  tableWrapStyle, thStyle, tdStyle, linkActionStyle, fmtDate,
} from '@/components/hr/admin/adminUi'
import { TEXT } from '@/lib/theme'

const STATUS_LABELS: Record<string, string> = { in_stock: 'In Stock', issued: 'Issued', under_repair: 'Under Repair', retired: 'Retired', lost: 'Lost' }
const STATUS_HEX: Record<string, string> = { in_stock: '#16A34A', issued: '#2563EB', under_repair: '#F59E0B', retired: '#64748B', lost: '#DC2626' }

export default function HrAssetsPage() {
  const { isAuthorized, isLoading } = useRequireApp('hr')
  const router = useRouter()

  const [assets, setAssets] = useState<HrAsset[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string[]>([])
  const [notice, setNotice] = useState('')
  const [branches, setBranches] = useState<HrBranchLookup[]>([])
  const [people, setPeople] = useState<DirectoryUser[]>([])

  const [search, setSearch] = useState('')
  const [debounced, setDebounced] = useState('')
  const [category, setCategory] = useState('')
  const [status, setStatus] = useState('')
  const [branchId, setBranchId] = useState('')
  const [holderId, setHolderId] = useState('')
  const [showCreate, setShowCreate] = useState(false)

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search), 300)
    return () => clearTimeout(t)
  }, [search])

  useEffect(() => {
    if (!isAuthorized) return
    hrApi.branchLookup().then(setBranches).catch(() => setBranches([]))
    usersApi.directory().then(setPeople).catch(() => setPeople([]))
  }, [isAuthorized])

  const load = useCallback(() => {
    setLoading(true)
    const params: Record<string, unknown> = {}
    if (debounced.trim()) params.search = debounced.trim()
    if (category) params.category = category
    if (status) params.status = status
    if (branchId) params.branch_id = Number(branchId)
    if (holderId) params.holder_id = Number(holderId)
    hrApi.listAssets(params)
      .then((data) => { setAssets(Array.isArray(data) ? data : []); setError([]) })
      .catch((err) => setError(extractErrorMessages(err, 'The asset register could not be loaded.')))
      .finally(() => setLoading(false))
  }, [debounced, category, status, branchId, holderId])

  useEffect(() => {
    if (isAuthorized) load()
  }, [isAuthorized, load])

  const counts = useMemo(() => {
    const c: Record<string, number> = {}
    assets.forEach((a) => { c[a.status] = (c[a.status] || 0) + 1 })
    return c
  }, [assets])

  const filtersActive = !!(debounced || category || status || branchId || holderId)

  if (isLoading || !isAuthorized) return null

  return (
    <div>
      <HrNav />

      <PageHeader
        title="Assets"
        subtitle="Company asset register — laptops, phones, SIMs, ID and access cards, vehicles. Issue to employees and record returns."
        actions={<button type="button" style={primaryActionStyle} onClick={() => setShowCreate(true)}>+ Add Asset</button>}
      />

      <ErrorBanner error={error} />
      <SuccessBanner message={notice} />

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 18 }}>
        <StatCard label={filtersActive ? 'Matching' : 'Total assets'} value={assets.length} hex={TEXT.heading} />
        <StatCard label="In stock" value={counts.in_stock || 0} hex={STATUS_HEX.in_stock} />
        <StatCard label="Issued" value={counts.issued || 0} hex={STATUS_HEX.issued} />
        <StatCard label="Under repair" value={counts.under_repair || 0} hex={STATUS_HEX.under_repair} />
        <StatCard label="Lost / retired" value={(counts.lost || 0) + (counts.retired || 0)} hex={STATUS_HEX.lost} />
      </div>

      <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap', alignItems: 'center' }}>
        <input
          style={{ ...filterInputStyle, flex: '1 1 240px', maxWidth: 340 }}
          placeholder="Search code, name, serial, invoice, holder…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select style={{ ...filterInputStyle, flex: '0 1 160px' }} value={category} onChange={(e) => setCategory(e.target.value)}>
          <option value="">All categories</option>
          {Object.entries(ASSET_CATEGORY_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <select style={{ ...filterInputStyle, flex: '0 1 150px' }} value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All statuses</option>
          {Object.entries(STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <select style={{ ...filterInputStyle, flex: '0 1 170px' }} value={branchId} onChange={(e) => setBranchId(e.target.value)}>
          <option value="">All plants</option>
          {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
        <div style={{ flex: '0 1 220px', minWidth: 180 }}>
          <SearchableSelect
            value={holderId}
            onChange={setHolderId}
            placeholder="Any holder"
            options={[{ value: '', label: 'Any holder' }, ...people.map((p) => ({ value: String(p.id), label: p.name }))]}
          />
        </div>
        {filtersActive && (
          <button type="button" style={linkActionStyle} onClick={() => { setSearch(''); setCategory(''); setStatus(''); setBranchId(''); setHolderId('') }}>
            Clear filters
          </button>
        )}
      </div>

      <div style={tableWrapStyle}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 1000 }}>
          <thead>
            <tr>
              {['Code', 'Asset', 'Category', 'Serial', 'Plant', 'Status', 'Held by', 'Condition', ''].map((h) => (
                <th key={h} style={thStyle}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <EmptyRow colSpan={9} text="Loading…" />
            ) : assets.length === 0 ? (
              <EmptyRow colSpan={9} text={filtersActive ? 'No assets match these filters.' : 'No assets registered yet. Use “+ Add Asset” to register the first one.'} />
            ) : (
              assets.map((a) => (
                <tr key={a.id} onClick={() => router.push(`/dashboard/hr/assets/${a.id}`)} style={{ cursor: 'pointer' }}>
                  <td style={{ ...tdStyle, fontWeight: 600, color: TEXT.heading, whiteSpace: 'nowrap' }}>{a.asset_code}</td>
                  <td style={tdStyle}>
                    <div style={{ fontWeight: 600 }}>{a.name}</div>
                    {(a.make || a.model) && <div style={{ fontSize: 12, color: TEXT.muted }}>{[a.make, a.model].filter(Boolean).join(' ')}</div>}
                  </td>
                  <td style={tdStyle}>{ASSET_CATEGORY_LABELS[a.category] || a.category}</td>
                  <td style={{ ...tdStyle, fontFamily: 'ui-monospace, monospace', fontSize: 12 }}>{a.serial_number || '—'}</td>
                  <td style={tdStyle}>{a.branch_name || '—'}</td>
                  <td style={tdStyle}><Pill hex={STATUS_HEX[a.status] || '#64748B'} label={STATUS_LABELS[a.status] || a.status} /></td>
                  <td style={tdStyle}>
                    {a.current_holder_name ? (
                      <>
                        <div>{a.current_holder_name}</div>
                        <div style={{ fontSize: 12, color: TEXT.muted }}>
                          since {fmtDate(a.issued_on)}
                          {a.expected_return_on && a.expected_return_on < new Date().toISOString().slice(0, 10) && (
                            <span style={{ color: '#DC2626', fontWeight: 600 }}> · return overdue</span>
                          )}
                        </div>
                      </>
                    ) : '—'}
                  </td>
                  <td style={tdStyle}>{a.condition ? ASSET_CONDITION_LABELS[a.condition] || a.condition : '—'}</td>
                  <td onClick={(e) => e.stopPropagation()} style={tdStyle}>
                    <span onClick={() => router.push(`/dashboard/hr/assets/${a.id}`)} style={linkActionStyle}>View</span>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <AssetFormDialog
        open={showCreate}
        branches={branches}
        onClose={() => setShowCreate(false)}
        onSaved={(a) => { setShowCreate(false); setNotice(`${a.asset_code} — ${a.name} added to the register.`); load() }}
      />
    </div>
  )
}
