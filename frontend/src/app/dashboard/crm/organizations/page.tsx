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
  }

  const openOrg = (id: number) => {
    router.push(`/dashboard/crm/organizations?id=${id}`)
  }

  const sortedOrgs = useMemo(() => {
    const alpha = (a: Organization, b: Organization) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
    const pinned = orgs.filter((o) => pinnedIds.includes(o.id)).sort(alpha)
    const rest = orgs.filter((o) => !pinnedIds.includes(o.id)).sort(alpha)
    return [...pinned, ...rest]
  }, [orgs, pinnedIds])

  const totalPages = Math.max(1, Math.ceil(sortedOrgs.length / PAGE_SIZE))
  const paged = sortedOrgs.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  if (isLoading || !isAuthorized) return null

  const header = (
    <>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, marginBottom: 10, flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: '#1f1108', margin: '0 0 4px' }}>Organizations</h1>
          <p style={{ fontSize: 13, color: '#78716c', margin: 0 }}>{sortedOrgs.length} Organizations Found</p>
        </div>
        <Link
          href="/dashboard/crm/organizations/new"
          style={{ fontSize: 13.5, fontWeight: 600, padding: '10px 20px', borderRadius: 10, background: 'linear-gradient(140deg,#fa9b9b,#ffe3d0)', color: '#fff', textDecoration: 'none', whiteSpace: 'nowrap' }}
        >
          + Add Organization
        </Link>
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
        placeholder="Name, GST, city..."
        style={{ flex: 1, padding: '10px 14px', borderRadius: 10, border: '1px solid rgba(0,0,0,0.1)', background: '#fff', fontSize: 13.5, outline: 'none' }}
      />
      <button onClick={clearFilters} style={secondaryBtnStyle}>Clear</button>
    </div>
  )

  const fullTable = (
    <>
      <div style={{ ...panelOuterStyle, overflow: 'auto', maxHeight: 'calc(100vh - 260px)' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 900 }}>
          <thead>
            <tr style={{ background: 'rgba(244,113,59,0.06)' }}>
              {['Name', 'Type', 'Railway Zone', 'City', 'State', 'GST Number', 'Phone', 'Created Date', 'Created By'].map((h) => (
                <th key={h} style={{ textAlign: 'left', padding: '7px 16px', fontSize: 11, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: '#a8a29e', whiteSpace: 'nowrap', position: 'sticky', top: 0, background: '#fdf1e6', zIndex: 1 }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={9} style={{ padding: 24, textAlign: 'center', color: '#a8a29e', fontSize: 13 }}>Loading…</td></tr>}
            {!loading && paged.length === 0 && <tr><td colSpan={9} style={{ padding: 24, textAlign: 'center', color: '#a8a29e', fontSize: 13 }}>No organizations found.</td></tr>}
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
                      <svg width="14" height="14" viewBox="0 0 24 24" fill={pinned ? '#fa9b9b' : 'none'} stroke={pinned ? '#fa9b9b' : '#a8a29e'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M12 17v5M9 3h6l-1 6 3 3v2H7v-2l3-3-1-6z" />
                      </svg>
                    </button>
                    <span style={{ fontSize: 13, fontWeight: 600, color: '#fa9b9b' }}>{o.name}</span>
                  </div>
                </td>
                <td style={{ padding: '7px 16px', fontSize: 13, color: '#57534e', whiteSpace: 'nowrap' }}>{o.org_type || 'Not provided'}</td>
                <td style={{ padding: '7px 16px', fontSize: 13, color: '#57534e', whiteSpace: 'nowrap' }}>{o.railway_zone || 'Not provided'}</td>
                <td style={{ padding: '7px 16px', fontSize: 13, color: '#57534e', whiteSpace: 'nowrap' }}>{o.city || 'Not provided'}</td>
                <td style={{ padding: '7px 16px', fontSize: 13, color: '#57534e', whiteSpace: 'nowrap' }}>{o.state || 'Not provided'}</td>
                <td style={{ padding: '7px 16px', fontSize: 12.5, color: '#78716c', whiteSpace: 'nowrap' }}>{o.gst_number || 'Not provided'}</td>
                <td style={{ padding: '7px 16px', fontSize: 12.5, color: '#78716c', whiteSpace: 'nowrap' }}>{o.official_phone || 'Not provided'}</td>
                <td style={{ padding: '7px 16px', fontSize: 12.5, color: '#78716c', whiteSpace: 'nowrap' }}>{o.created_at ? new Date(o.created_at).toLocaleDateString('en-GB') : 'Not provided'}</td>
                <td style={{ padding: '7px 16px', fontSize: 12.5, color: '#78716c', whiteSpace: 'nowrap' }}>{o.created_by_name || 'Not provided'}</td>
              </tr>
              )
            })}
          </tbody>
        </table>
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
                  <button key={p} onClick={() => setPage(p)} style={{ ...pageBtnStyle(false), background: p === page ? '#fa9b9b' : '#fff', color: p === page ? '#fff' : '#57534e' }}>
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
      <button
        onClick={() => router.push('/dashboard/crm/organizations')}
        style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'none', border: 'none', cursor: 'pointer', padding: '0 0 14px', fontSize: 13, fontWeight: 600, color: '#78716c' }}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M19 12H5M12 19l-7-7 7-7" />
        </svg>
        Back to list
      </button>
      <OrganizationDetailPanel key={selectedId} orgId={selectedId} onDeleted={() => router.push('/dashboard/crm/organizations')} />
    </div>
  )
}
