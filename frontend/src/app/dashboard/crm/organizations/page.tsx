'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { crmApi } from '@/lib/api'
import { Organization } from '@/types'
import CrmNav from '@/components/crm/CrmNav'
import OrganizationDetailPanel from '@/components/crm/OrganizationDetailPanel'
import { secondaryBtnStyle, pageBtnStyle } from '@/components/crm/ui'
import { BRAND, TEXT } from '@/lib/theme'

const PAGE_SIZE = 16
const PINNED_ORGS_KEY = 'crm_pinned_org_ids'

const panelOuterStyle: React.CSSProperties = {
  borderRadius: 18,
  background: 'rgba(255,255,255,.16)',
  backdropFilter: 'blur(28px)',
  WebkitBackdropFilter: 'blur(28px)',
  border: '1px solid rgba(255,255,255,.24)',
  boxShadow: '0 12px 32px rgba(15,23,42,0.16), 0 2px 6px rgba(15,23,42,.08), inset 0 1px 0 rgba(255,255,255,.35)',
  overflow: 'hidden',
}

export default function OrganizationsPage() {
  const { isAuthorized, isLoading } = useRequireApp('crm')
  const router = useRouter()
  const searchParams = useSearchParams()
  const [orgs, setOrgs] = useState<Organization[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [page, setPage] = useState(1)

  const [search, setSearch] = useState('')
  const [pinnedIds, setPinnedIds] = useState<number[]>([])

  const selectedId = searchParams.get('id') ? Number(searchParams.get('id')) : null

  useEffect(() => {
    try {
      const stored = localStorage.getItem(PINNED_ORGS_KEY)
      if (stored) setPinnedIds(JSON.parse(stored))
    } catch {
      // ignore malformed storage
    }
  }, [])

  const togglePin = (id: number, e: React.MouseEvent) => {
    e.stopPropagation()
    setPinnedIds((prev) => {
      const next = prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id]
      localStorage.setItem(PINNED_ORGS_KEY, JSON.stringify(next))
      return next
    })
  }

  const load = async () => {
    setLoading(true)
    setError('')
    try {
      const data = await crmApi.listOrganizations({
        search: search || undefined,
      })
      setOrgs(data)
      setPage(1)
    } catch {
      setError('Failed to load organizations.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (isAuthorized) load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthorized])

  useEffect(() => {
    if (!isAuthorized) return
    const t = setTimeout(load, 300)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search])

  const clearFilters = () => {
    setSearch('')
    setFilters({ org_type: '', railway_zone: '', city: '', state: '', created_by_name: '' })
  }

  const openOrg = (id: number) => {
    router.push(`/dashboard/crm/organizations?id=${id}`)
  }

  type SortKey = 'name' | 'created_at'
  const [sortKey, setSortKey] = useState<SortKey>('created_at')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortKey(key)
      setSortDir(key === 'created_at' ? 'desc' : 'asc')
    }
  }

  type FilterKey = 'org_type' | 'railway_zone' | 'city' | 'state' | 'created_by_name'
  const FILTER_KEYS: FilterKey[] = ['org_type', 'railway_zone', 'city', 'state', 'created_by_name']
  const [filters, setFilters] = useState<Record<FilterKey, string>>({
    org_type: '', railway_zone: '', city: '', state: '', created_by_name: '',
  })
  const setFilter = (key: FilterKey, value: string) => setFilters((f) => ({ ...f, [key]: value }))

  const filterOptions = useMemo(() => {
    const options: Record<FilterKey, string[]> = { org_type: [], railway_zone: [], city: [], state: [], created_by_name: [] }
    for (const key of FILTER_KEYS) {
      const values = new Set<string>()
      for (const o of orgs) {
        const v = o[key as keyof Organization] as string | null | undefined
        if (v) values.add(v)
      }
      options[key] = Array.from(values).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
    }
    return options
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgs])

  const columns: { label: string; key: SortKey | FilterKey; type: 'sort' | 'filter' | 'none'; sortLabels?: [string, string] }[] = [
    { label: 'Name', key: 'name', type: 'sort', sortLabels: ['A–Z', 'Z–A'] },
    { label: 'Type', key: 'org_type', type: 'filter' },
    { label: 'Railway Zone', key: 'railway_zone', type: 'filter' },
    { label: 'City', key: 'city', type: 'filter' },
    { label: 'State', key: 'state', type: 'filter' },
    { label: 'Created Date', key: 'created_at', type: 'sort', sortLabels: ['Old', 'New'] },
    { label: 'Created By', key: 'created_by_name', type: 'filter' },
  ]

  const filteredOrgs = useMemo(() => {
    return orgs.filter((o) => FILTER_KEYS.every((key) => !filters[key] || o[key as keyof Organization] === filters[key]))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgs, filters])

  const sortedOrgs = useMemo(() => {
    const cmp = (a: Organization, b: Organization) => {
      const rawA = a[sortKey as keyof Organization]
      const rawB = b[sortKey as keyof Organization]
      let av: string | number
      let bv: string | number
      if (sortKey === 'created_at') {
        av = rawA ? new Date(rawA as string).getTime() : 0
        bv = rawB ? new Date(rawB as string).getTime() : 0
      } else {
        av = (rawA ?? '').toString().toLowerCase()
        bv = (rawB ?? '').toString().toLowerCase()
      }
      const result = av < bv ? -1 : av > bv ? 1 : 0
      return sortDir === 'asc' ? result : -result
    }
    const pinned = filteredOrgs.filter((o) => pinnedIds.includes(o.id)).sort(cmp)
    const rest = filteredOrgs.filter((o) => !pinnedIds.includes(o.id)).sort(cmp)
    return [...pinned, ...rest]
  }, [filteredOrgs, pinnedIds, sortKey, sortDir])

  const totalPages = Math.max(1, Math.ceil(sortedOrgs.length / PAGE_SIZE))
  const paged = sortedOrgs.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  if (isLoading || !isAuthorized) return null

  const header = (
    <>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 10 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: TEXT.heading, margin: 0 }}>Organizations</h1>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
          <Link
            href="/dashboard/crm/organizations/new"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 14.5, fontWeight: 700, padding: '12px 24px', borderRadius: 10, background: `linear-gradient(140deg,${BRAND.primary},${BRAND.primaryHover})`, color: TEXT.white, textDecoration: 'none', whiteSpace: 'nowrap', boxShadow: `0 4px 14px ${BRAND.primaryGlow}` }}
          >
            <span style={{ fontSize: 17, lineHeight: 1 }}>+</span> Add Organization
          </Link>
          <p style={{ fontSize: 13, color: '#78716c', margin: 0 }}>{sortedOrgs.length} Organizations Found</p>
        </div>
      </div>

      {error && (
        <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
          {error}
        </div>
      )}
    </>
  )

  const searchBar = (
    <div style={{ display: 'flex', justifyContent: 'center', gap: 10, alignItems: 'center', marginBottom: 10 }}>
      <input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search name, type, zone, city, state..."
        style={{ flex: 1, padding: '10px 14px', borderRadius: 10, border: '1px solid rgba(0,0,0,0.1)', background: '#fff', fontSize: 13.5, outline: 'none' }}
      />
      <button onClick={clearFilters} style={secondaryBtnStyle}>Clear</button>
    </div>
  )

  const fullTable = (
    <>
      <div style={panelOuterStyle}>
        <div style={{ overflow: 'auto', maxHeight: 'calc(100vh - 260px)' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 900 }}>
          <thead>
            <tr style={{ background: 'rgba(244,113,59,0.06)' }}>
              {columns.map((col) =>
                col.type === 'filter' ? (
                  <th
                    key={col.key}
                    style={{ textAlign: 'left', padding: '5px 10px', fontSize: 11, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: filters[col.key as FilterKey] ? '#FF7A45' : '#a8a29e', whiteSpace: 'nowrap', position: 'sticky', top: 0, background: '#fdf1e6', zIndex: 1 }}
                  >
                    <select
                      value={filters[col.key as FilterKey]}
                      onChange={(e) => setFilter(col.key as FilterKey, e.target.value)}
                      style={{ font: 'inherit', color: 'inherit', background: 'transparent', border: 'none', outline: 'none', cursor: 'pointer', maxWidth: 140 }}
                    >
                      <option value="">{col.label}</option>
                      {filterOptions[col.key as FilterKey].map((v) => (
                        <option key={v} value={v} style={{ textTransform: 'none', color: '#1f1108' }}>{v}</option>
                      ))}
                    </select>
                  </th>
                ) : col.type === 'none' ? (
                  <th
                    key={col.key}
                    style={{ textAlign: 'left', padding: '7px 16px', fontSize: 11, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: '#a8a29e', whiteSpace: 'nowrap', position: 'sticky', top: 0, background: '#fdf1e6', zIndex: 1 }}
                  >
                    {col.label}
                  </th>
                ) : (
                  <th
                    key={col.key}
                    onClick={() => toggleSort(col.key as SortKey)}
                    style={{ textAlign: 'left', padding: '7px 16px', fontSize: 11, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: sortKey === col.key ? '#FF7A45' : '#a8a29e', whiteSpace: 'nowrap', position: 'sticky', top: 0, background: '#fdf1e6', zIndex: 1, cursor: 'pointer', userSelect: 'none' }}
                  >
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                      {col.label}
                      {col.sortLabels && (
                        <span style={{ fontSize: 9.5, fontWeight: 700, opacity: sortKey === col.key ? 1 : 0.45, textTransform: 'none' }}>
                          ({sortKey === col.key ? col.sortLabels[sortDir === 'asc' ? 0 : 1] : `${col.sortLabels[0]}/${col.sortLabels[1]}`})
                        </span>
                      )}
                      <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"
                        style={{ opacity: sortKey === col.key ? 1 : 0.35, transform: sortKey === col.key && sortDir === 'desc' ? 'rotate(180deg)' : 'none', transition: 'transform .15s' }}>
                        <path d="M18 15l-6-6-6 6" />
                      </svg>
                    </span>
                  </th>
                )
              )}
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={7} style={{ padding: 24, textAlign: 'center', color: '#a8a29e', fontSize: 13 }}>Loading…</td></tr>}
            {!loading && paged.length === 0 && <tr><td colSpan={7} style={{ padding: 24, textAlign: 'center', color: '#a8a29e', fontSize: 13 }}>No organizations found.</td></tr>}
            {paged.map((o) => {
              const pinned = pinnedIds.includes(o.id)
              return (
              <tr key={o.id} onClick={() => openOrg(o.id)} style={{ borderTop: '1px solid rgba(0,0,0,0.05)', cursor: 'pointer' }}>
                <td style={{ padding: '7px 16px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <button
                      onClick={(e) => togglePin(o.id, e)}
                      title={pinned ? 'Unpin organization' : 'Pin organization to top'}
                      style={{ flexShrink: 0, background: 'none', border: 'none', cursor: 'pointer', padding: 2, display: 'flex', alignItems: 'center' }}
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill={pinned ? '#FF7A45' : 'none'} stroke={pinned ? '#FF7A45' : '#a8a29e'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M12 17v5M9 3h6l-1 6 3 3v2H7v-2l3-3-1-6z" />
                      </svg>
                    </button>
                    <div style={{ display: 'flex', flexDirection: 'column' }}>
                      <span style={{ fontSize: 13, fontWeight: 600, color: '#FF7A45' }}>{o.name}</span>
                      <span style={{ fontSize: 11, color: '#a8a29e' }}>{o.org_code || 'Not provided'}</span>
                    </div>
                  </div>
                </td>
                <td style={{ padding: '7px 16px', fontSize: 13, color: '#57534e', whiteSpace: 'nowrap' }}>{o.org_type || 'Not provided'}</td>
                <td style={{ padding: '7px 16px', fontSize: 13, color: '#57534e', whiteSpace: 'nowrap' }}>{o.railway_zone || 'Not provided'}</td>
                <td style={{ padding: '7px 16px', fontSize: 13, color: '#57534e', whiteSpace: 'nowrap' }}>{o.city || 'Not provided'}</td>
                <td style={{ padding: '7px 16px', fontSize: 13, color: '#57534e', whiteSpace: 'nowrap' }}>{o.state || 'Not provided'}</td>
                <td style={{ padding: '7px 16px', fontSize: 12.5, color: '#78716c', whiteSpace: 'nowrap' }}>{o.created_at ? new Date(o.created_at).toLocaleDateString('en-GB') : 'Not provided'}</td>
                <td style={{ padding: '7px 16px', fontSize: 12.5, color: '#78716c', whiteSpace: 'nowrap' }}>{o.created_by_name || 'Not provided'}</td>
              </tr>
              )
            })}
          </tbody>
        </table>
        </div>
      </div>

      {!loading && sortedOrgs.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 10, flexWrap: 'wrap', gap: 10 }}>
          <span style={{ fontSize: 12.5, color: '#78716c' }}>
            {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, sortedOrgs.length)} of {sortedOrgs.length}
          </span>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1} style={pageBtnStyle(page === 1)}>‹</button>
            {Array.from({ length: totalPages }, (_, i) => i + 1)
              .filter((p) => p === 1 || p === totalPages || Math.abs(p - page) <= 1)
              .reduce<number[]>((acc, p) => {
                if (acc.length && p - acc[acc.length - 1] > 1) acc.push(-1)
                acc.push(p)
                return acc
              }, [])
              .map((p, i) =>
                p === -1 ? (
                  <span key={`gap-${i}`} style={{ fontSize: 12.5, color: '#a8a29e', padding: '0 4px' }}>…</span>
                ) : (
                  <button key={p} onClick={() => setPage(p)} style={{ ...pageBtnStyle(false), background: p === page ? '#FF7A45' : '#fff', color: p === page ? '#fff' : '#57534e' }}>
                    {p}
                  </button>
                )
              )}
            <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page === totalPages} style={pageBtnStyle(page === totalPages)}>›</button>
          </div>
        </div>
      )}
    </>
  )

  if (!selectedId) {
    return (
      <div>
        <CrmNav />
        {header}
        {searchBar}
        {fullTable}
      </div>
    )
  }

  return (
    <div>
      <CrmNav />
      <OrganizationDetailPanel key={selectedId} orgId={selectedId} onDeleted={() => router.push('/dashboard/crm/organizations')} />
    </div>
  )
}
