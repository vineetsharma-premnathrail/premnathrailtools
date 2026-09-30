'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { hrApi } from '@/lib/api'
import { HrEmployeeListItem, HrEmployeeListResponse, HrLookups } from '@/types'
import { TEXT, BORDER, GLASS, SHADOWS } from '@/lib/theme'
import { secondaryBtnStyle, pageBtnStyle } from '@/components/shared/ui'
import SearchableSelect from '@/components/erp/SearchableSelect'
import HrNav from '@/components/hr/HrNav'
import { extractErrorMessages } from '@/lib/validation'
import {
  tableWrapStyle, thStyle, tdStyle, searchInputStyle, linkActionStyle, ErrorBanner, Avatar, StatusPill, formatDate,
  EMPLOYMENT_STATUS_LABELS, EMPLOYMENT_STATUS_HEX, EMPLOYMENT_TYPE_LABELS,
} from '@/components/hr/masters/masterUi'

const PAGE_SIZE = 50

const selectStyle: React.CSSProperties = {
  padding: '9px 10px', borderRadius: 10, border: `1px solid ${BORDER.normal}`, background: 'rgba(255,255,255,.7)',
  fontSize: 13, outline: 'none', color: TEXT.body, boxSizing: 'border-box',
}

const statCardStyle: React.CSSProperties = {
  borderRadius: 14, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur,
  border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), padding: '12px 16px', minWidth: 150, cursor: 'pointer',
}

type SortKey = 'name' | 'employee_code' | 'department' | 'designation' | 'branch' | 'date_of_joining' | 'employment_status'

const COLUMNS: { key: SortKey | null; label: string }[] = [
  { key: 'name', label: 'Employee' },
  { key: 'employee_code', label: 'Code' },
  { key: 'department', label: 'Department' },
  { key: 'designation', label: 'Designation' },
  { key: 'branch', label: 'Plant' },
  { key: null, label: 'Manager' },
  { key: 'date_of_joining', label: 'Joined' },
  { key: 'employment_status', label: 'Status' },
  { key: null, label: '' },
]

export default function HrEmployeesPage() {
  const { isAuthorized, isLoading } = useRequireApp('hr')
  const router = useRouter()

  const [lookups, setLookups] = useState<HrLookups | null>(null)
  const [data, setData] = useState<HrEmployeeListResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string[]>([])

  const [searchText, setSearchText] = useState('')
  const [search, setSearch] = useState('')
  const [departmentId, setDepartmentId] = useState('')
  const [branchId, setBranchId] = useState('')
  const [designationId, setDesignationId] = useState('')
  const [employmentStatus, setEmploymentStatus] = useState('')
  const [employmentType, setEmploymentType] = useState('')
  const [hasProfile, setHasProfile] = useState('')
  const [userStatus, setUserStatus] = useState('active')
  const [sort, setSort] = useState<SortKey>('name')
  const [order, setOrder] = useState<'asc' | 'desc'>('asc')
  const [page, setPage] = useState(1)

  // debounce the search box
  useEffect(() => {
    const t = setTimeout(() => { setSearch(searchText.trim()); setPage(1) }, 300)
    return () => clearTimeout(t)
  }, [searchText])

  useEffect(() => {
    if (!isAuthorized) return
    hrApi.getLookups({ include_inactive: true }).then(setLookups).catch((err) => setError(extractErrorMessages(err, "Couldn't load the filter lists.")))
  }, [isAuthorized])

  useEffect(() => {
    if (!isAuthorized) return
    let cancelled = false
    setLoading(true)
    const params: Record<string, unknown> = { page, page_size: PAGE_SIZE, sort, order, user_status: userStatus }
    if (search) params.search = search
    if (departmentId) params.department_id = departmentId
    if (branchId) params.branch_id = branchId
    if (designationId) params.designation_id = designationId
    if (employmentStatus) params.employment_status = employmentStatus
    if (employmentType) params.employment_type = employmentType
    if (hasProfile) params.has_profile = hasProfile === 'yes'
    hrApi.listEmployees(params)
      .then((res) => { if (!cancelled) { setData(res); setError([]) } })
      .catch((err) => { if (!cancelled) setError(extractErrorMessages(err, "Couldn't load employees.")) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [isAuthorized, page, sort, order, search, departmentId, branchId, designationId, employmentStatus, employmentType, hasProfile, userStatus])

  const resetPage = <T,>(setter: (v: T) => void) => (v: T) => { setter(v); setPage(1) }

  const toggleSort = (key: SortKey) => {
    if (sort === key) setOrder(order === 'asc' ? 'desc' : 'asc')
    else { setSort(key); setOrder('asc') }
    setPage(1)
  }

  const filtersActive = !!(search || departmentId || branchId || designationId || employmentStatus || employmentType || hasProfile || userStatus !== 'active')
  const clearFilters = () => {
    setSearchText(''); setSearch(''); setDepartmentId(''); setBranchId(''); setDesignationId('')
    setEmploymentStatus(''); setEmploymentType(''); setHasProfile(''); setUserStatus('active'); setPage(1)
  }

  const deptOptions = useMemo(() => [{ value: '', label: 'All departments' }, ...(lookups?.departments || []).map((d) => ({ value: String(d.id), label: d.name }))], [lookups])
  const desigOptions = useMemo(() => [{ value: '', label: 'All designations' }, ...(lookups?.designations || []).map((d) => ({ value: String(d.id), label: d.is_active ? d.name : `${d.name} (inactive)` }))], [lookups])

  const items: HrEmployeeListItem[] = data?.items || []
  const total = data?.total || 0
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const from = total ? (page - 1) * PAGE_SIZE + 1 : 0
  const to = Math.min(page * PAGE_SIZE, total)

  if (isLoading || !isAuthorized) return null

  return (
    <div>
      <HrNav />

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, marginBottom: 16, flexWrap: 'wrap' }}>
        <div>
          <p style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 4px' }}>
            HR &amp; Administration
          </p>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: TEXT.heading, margin: '0 0 4px' }}>Employees</h1>
          <p style={{ fontSize: 13.5, color: TEXT.muted, margin: 0 }}>Every portal user with their HR profile. Open someone to view or edit their record and documents.</p>
        </div>
        <button type="button" style={secondaryBtnStyle} onClick={() => router.push('/dashboard/hr/org-chart')}>View Org Chart</button>
      </div>

      {data && (
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
          <div style={statCardStyle} onClick={() => { clearFilters() }}>
            <p style={{ fontSize: 11, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 4px' }}>Active people</p>
            <p style={{ fontSize: 22, fontWeight: 700, color: TEXT.heading, margin: 0 }}>{data.total_users}</p>
          </div>
          <div style={statCardStyle} onClick={() => { resetPage(setHasProfile)('yes') }}>
            <p style={{ fontSize: 11, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 4px' }}>With HR profile</p>
            <p style={{ fontSize: 22, fontWeight: 700, color: '#16A34A', margin: 0 }}>{data.with_profile}</p>
          </div>
          <div style={statCardStyle} onClick={() => { resetPage(setHasProfile)('no') }} title="Click to list people who still need an HR profile">
            <p style={{ fontSize: 11, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 4px' }}>Profile missing</p>
            <p style={{ fontSize: 22, fontWeight: 700, color: data.without_profile ? '#EA580C' : TEXT.heading, margin: 0 }}>{data.without_profile}</p>
          </div>
        </div>
      )}

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginBottom: 14 }}>
        <input style={searchInputStyle} value={searchText} onChange={(e) => setSearchText(e.target.value)} placeholder="Search name, email or employee code…" />
        <div style={{ width: 200 }}><SearchableSelect value={departmentId} onChange={resetPage(setDepartmentId)} options={deptOptions} placeholder="All departments" /></div>
        <div style={{ width: 200 }}><SearchableSelect value={designationId} onChange={resetPage(setDesignationId)} options={desigOptions} placeholder="All designations" /></div>
        <select style={{ ...selectStyle, width: 160 }} value={branchId} onChange={(e) => resetPage(setBranchId)(e.target.value)}>
          <option value="">All plants</option>
          {(lookups?.branches || []).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
        <select style={{ ...selectStyle, width: 150 }} value={employmentStatus} onChange={(e) => resetPage(setEmploymentStatus)(e.target.value)}>
          <option value="">Any status</option>
          {Object.entries(EMPLOYMENT_STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <select style={{ ...selectStyle, width: 150 }} value={employmentType} onChange={(e) => resetPage(setEmploymentType)(e.target.value)}>
          <option value="">Any type</option>
          {Object.entries(EMPLOYMENT_TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <select style={{ ...selectStyle, width: 150 }} value={hasProfile} onChange={(e) => resetPage(setHasProfile)(e.target.value)}>
          <option value="">Profile: any</option>
          <option value="yes">Has HR profile</option>
          <option value="no">Profile missing</option>
        </select>
        <select style={{ ...selectStyle, width: 170 }} value={userStatus} onChange={(e) => resetPage(setUserStatus)(e.target.value)}>
          <option value="active">Active accounts</option>
          <option value="inactive">Deactivated accounts</option>
          <option value="all">All accounts</option>
        </select>
        {filtersActive && <button type="button" style={linkActionStyle} onClick={clearFilters}>Clear filters</button>}
      </div>

      <ErrorBanner errors={error} />

      <div style={tableWrapStyle}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 1100 }}>
          <thead>
            <tr>
              {COLUMNS.map((c) => (
                <th
                  key={c.label || 'view'}
                  style={{ ...thStyle, cursor: c.key ? 'pointer' : 'default', userSelect: 'none' }}
                  onClick={() => c.key && toggleSort(c.key)}
                  title={c.key ? 'Sort' : undefined}
                >
                  {c.label}{c.key && sort === c.key ? (order === 'asc' ? ' ▲' : ' ▼') : ''}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={COLUMNS.length} style={{ ...tdStyle, textAlign: 'center', color: TEXT.muted, padding: 24 }}>Loading…</td></tr>}
            {!loading && items.length === 0 && (
              <tr><td colSpan={COLUMNS.length} style={{ ...tdStyle, textAlign: 'center', color: TEXT.muted, padding: 24 }}>
                {filtersActive ? 'Nobody matches these filters.' : 'No employees found. People appear here once they sign in to the portal or an admin runs "Sync Azure Users".'}
              </td></tr>
            )}
            {!loading && items.map((e) => (
              <tr key={e.user_id} onClick={() => router.push(`/dashboard/hr/employees/${e.user_id}`)} style={{ cursor: 'pointer', opacity: e.is_active ? 1 : 0.6 }}>
                <td style={tdStyle}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <Avatar name={e.name} url={e.profile_photo_url} id={e.user_id} />
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 600, color: TEXT.heading }}>{e.name}</div>
                      <div style={{ fontSize: 11.5, color: TEXT.muted }}>{e.email}</div>
                    </div>
                  </div>
                </td>
                <td style={{ ...tdStyle, color: TEXT.secondary, whiteSpace: 'nowrap' }}>{e.employee_code || '—'}</td>
                <td style={{ ...tdStyle, color: TEXT.secondary }}>{e.department_name || '—'}</td>
                <td style={{ ...tdStyle, color: TEXT.secondary }}>{e.designation_name || '—'}{e.grade_name && <div style={{ fontSize: 11, color: TEXT.muted }}>{e.grade_name}</div>}</td>
                <td style={{ ...tdStyle, color: TEXT.secondary }}>{e.branch_name || '—'}</td>
                <td style={{ ...tdStyle, color: TEXT.secondary }}>{e.reporting_manager_name || '—'}</td>
                <td style={{ ...tdStyle, color: TEXT.secondary, whiteSpace: 'nowrap' }}>{formatDate(e.date_of_joining)}</td>
                <td style={tdStyle}>
                  {!e.has_profile
                    ? <StatusPill label="No HR profile" hex="#EA580C" />
                    : <StatusPill label={EMPLOYMENT_STATUS_LABELS[e.employment_status || ''] || e.employment_status || '—'} hex={EMPLOYMENT_STATUS_HEX[e.employment_status || ''] || '#64748B'} />}
                  {!e.is_active && <div style={{ fontSize: 10.5, color: TEXT.muted, marginTop: 3 }}>Account deactivated</div>}
                </td>
                <td style={{ ...tdStyle, textAlign: 'right', whiteSpace: 'nowrap' }} onClick={(ev) => ev.stopPropagation()}>
                  {e.has_profile
                    ? <span style={{ ...linkActionStyle, cursor: 'pointer' }} onClick={() => router.push(`/dashboard/hr/employees/${e.user_id}`)}>View</span>
                    : <span style={{ ...linkActionStyle, cursor: 'pointer' }} onClick={() => router.push(`/dashboard/hr/employees/${e.user_id}/edit`)}>Create profile</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginTop: 12, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 12.5, color: TEXT.muted }}>{total ? `Showing ${from}–${to} of ${total}` : ''}</span>
        {pages > 1 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button type="button" style={pageBtnStyle(page <= 1)} disabled={page <= 1} onClick={() => setPage(page - 1)}>‹ Prev</button>
            <span style={{ fontSize: 12.5, color: TEXT.secondary }}>Page {page} of {pages}</span>
            <button type="button" style={pageBtnStyle(page >= pages)} disabled={page >= pages} onClick={() => setPage(page + 1)}>Next ›</button>
          </div>
        )}
      </div>
    </div>
  )
}
