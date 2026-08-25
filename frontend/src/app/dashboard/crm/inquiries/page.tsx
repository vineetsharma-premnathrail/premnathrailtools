'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { crmApi } from '@/lib/api'
import { Inquiry, Tender, Organization } from '@/types'
import CrmNav from '@/components/crm/CrmNav'
import InquiryDetailPanel from '@/components/crm/InquiryDetailPanel'
import TenderDetailPanel from '@/components/crm/TenderDetailPanel'
import { secondaryBtnStyle, pageBtnStyle } from '@/components/crm/ui'
import { inquiryStatusColor } from '@/components/crm/constants'

const PAGE_SIZE = 16
const PINNED_KEY = 'crm_pinned_inquiry_tender_keys'

const panelOuterStyle: React.CSSProperties = {
  borderRadius: 18,
  background: 'rgba(255,255,255,.16)',
  backdropFilter: 'blur(28px)',
  WebkitBackdropFilter: 'blur(28px)',
  border: '1px solid rgba(255,255,255,.24)',
  boxShadow: '0 12px 32px rgba(15,23,42,0.16), 0 2px 6px rgba(15,23,42,.08), inset 0 1px 0 rgba(255,255,255,.35)',
  overflow: 'hidden',
}

type Kind = 'inquiry' | 'tender'

interface CombinedRow {
  key: string
  id: number
  kind: Kind
  universal_id: string
  org_id: number
  title: string
  stage: string
  status: string
  secondary: string
  date: string
  created_at: string
  created_by_name: string
}

export default function InquiriesPage() {
  const { isAuthorized, isLoading } = useRequireApp('crm')
  const router = useRouter()
  const searchParams = useSearchParams()
  const [inquiries, setInquiries] = useState<Inquiry[]>([])
  const [tenders, setTenders] = useState<Tender[]>([])
  const [organizations, setOrganizations] = useState<Organization[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [page, setPage] = useState(1)

  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState<'all' | Kind>('all')
  const [pinnedKeys, setPinnedKeys] = useState<string[]>([])

  const selectedId = searchParams.get('id') ? Number(searchParams.get('id')) : null
  const selectedType: Kind = searchParams.get('type') === 'tender' ? 'tender' : 'inquiry'

  useEffect(() => {
    try {
      const stored = localStorage.getItem(PINNED_KEY)
      if (stored) setPinnedKeys(JSON.parse(stored))
    } catch {
      // ignore malformed storage
    }
  }, [])

  const togglePin = (key: string, e: React.MouseEvent) => {
    e.stopPropagation()
    setPinnedKeys((prev) => {
      const next = prev.includes(key) ? prev.filter((p) => p !== key) : [...prev, key]
      localStorage.setItem(PINNED_KEY, JSON.stringify(next))
      return next
    })
  }

  const load = async () => {
    setLoading(true)
    setError('')
    try {
      const [inquiryData, tenderData, orgData] = await Promise.all([
        crmApi.listInquiries({ search: search || undefined }),
        crmApi.listTenders({ search: search || undefined }),
        crmApi.listOrganizations(),
      ])
      setInquiries(inquiryData)
      setTenders(tenderData)
      setOrganizations(orgData)
      setPage(1)
    } catch {
      setError('Failed to load inquiries & tenders.')
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

  const orgById = useMemo(() => new Map(organizations.map((o) => [o.id, o])), [organizations])
  const clearFilters = () => { setSearch(''); setTypeFilter('all') }

  const combined = useMemo<CombinedRow[]>(() => {
    const fromInquiries: CombinedRow[] = inquiries.map((i) => ({
      key: `inquiry-${i.id}`,
      id: i.id,
      kind: 'inquiry',
      universal_id: i.universal_id,
      org_id: i.org_id,
      title: i.product || 'Not provided',
      stage: i.current_stage || 'Not provided',
      status: i.status || 'Not provided',
      secondary: i.priority || 'Not provided',
      date: i.next_followup_date || 'Not provided',
      created_at: i.created_at || 'Not provided',
      created_by_name: i.created_by_name || 'Not provided',
    }))
    const fromTenders: CombinedRow[] = tenders.map((t) => ({
      key: `tender-${t.id}`,
      id: t.id,
      kind: 'tender',
      universal_id: t.universal_id,
      org_id: t.org_id,
      title: t.tender_name || t.tender_number || 'Not provided',
      stage: t.current_stage || 'Not provided',
      status: t.status || 'Not provided',
      secondary: t.tender_value != null ? `${t.currency || ''} ${t.tender_value.toLocaleString()}` : 'Not provided',
      date: t.submission_date || 'Not provided',
      created_at: t.created_at || 'Not provided',
      created_by_name: t.created_by_name || 'Not provided',
    }))
    const all = [...fromInquiries, ...fromTenders]
    return typeFilter === 'all' ? all : all.filter((r) => r.kind === typeFilter)
  }, [inquiries, tenders, typeFilter])

  const sortedRows = useMemo(() => {
    const alpha = (a: CombinedRow, b: CombinedRow) => (a.universal_id || '').localeCompare(b.universal_id || '', undefined, { sensitivity: 'base' })
    const pinned = combined.filter((r) => pinnedKeys.includes(r.key)).sort(alpha)
    const rest = combined.filter((r) => !pinnedKeys.includes(r.key)).sort(alpha)
    return [...pinned, ...rest]
  }, [combined, pinnedKeys])

  const openRow = (row: CombinedRow) => {
    router.push(`/dashboard/crm/inquiries?id=${row.id}&type=${row.kind}`)
  }

  const totalPages = Math.max(1, Math.ceil(sortedRows.length / PAGE_SIZE))
  const paged = sortedRows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  if (isLoading || !isAuthorized) return null

  const header = (
    <>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, marginBottom: 20, flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: '#1f1108', margin: '0 0 4px' }}>Inquiries &amp; Tenders</h1>
          <p style={{ fontSize: 13, color: '#78716c', margin: 0 }}>{sortedRows.length} Records Found</p>
        </div>
        <Link
          href="/dashboard/crm/inquiries/new"
          style={{ fontSize: 13.5, fontWeight: 600, padding: '10px 20px', borderRadius: 10, background: 'linear-gradient(140deg,#fa9b9b,#ffe3d0)', color: '#fff', textDecoration: 'none', whiteSpace: 'nowrap' }}
        >
          + New Record
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
    <div style={{ display: 'flex', flexWrap: 'nowrap', gap: 6, marginBottom: 10 }}>
      <input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Inquiry / Tender #, product..."
        style={{ flex: '1 1 auto', minWidth: 0, padding: '8px 10px', borderRadius: 10, border: '1px solid rgba(0,0,0,0.1)', background: '#fff', fontSize: 12.5, outline: 'none' }}
      />
      <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value as 'all' | Kind)} style={{ flex: '0 0 auto', width: 90, padding: '8px 4px', borderRadius: 10, border: '1px solid rgba(0,0,0,0.1)', background: '#fff', fontSize: 11.5 }}>
        <option value="all">All</option>
        <option value="inquiry">Inquiry</option>
        <option value="tender">Tender</option>
      </select>
      <button onClick={clearFilters} style={{ ...secondaryBtnStyle, flex: '0 0 auto', padding: '8px 10px', fontSize: 11.5 }}>Clear</button>
    </div>
  )

  const typeBadge = (kind: Kind) => (
    <span style={{
      fontSize: 10.5, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.03em', padding: '2px 8px', borderRadius: 999,
      background: kind === 'tender' ? 'rgba(59,130,246,0.1)' : 'rgba(250,155,155,0.15)',
      color: kind === 'tender' ? '#2563eb' : '#fa9b9b',
    }}>
      {kind}
    </span>
  )

  const fullTable = (
    <>
      <div style={{ ...panelOuterStyle, height: 'auto', overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 1000 }}>
          <thead>
            <tr style={{ background: 'rgba(244,113,59,0.06)' }}>
              {['Type', 'ID', 'Organization', 'Title', 'Stage', 'Status', 'Value / Priority', 'Date', 'Created Date', 'Created By'].map((h) => (
                <th key={h} style={{ textAlign: 'left', padding: '7px 16px', fontSize: 11, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: '#a8a29e', whiteSpace: 'nowrap', position: 'sticky', top: 0, background: '#fdf1e6', zIndex: 1 }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={10} style={{ padding: 24, textAlign: 'center', color: '#a8a29e', fontSize: 13 }}>Loading…</td></tr>}
            {!loading && paged.length === 0 && <tr><td colSpan={10} style={{ padding: 24, textAlign: 'center', color: '#a8a29e', fontSize: 13 }}>No records found.</td></tr>}
            {paged.map((r) => {
              const pinned = pinnedKeys.includes(r.key)
              return (
              <tr key={r.key} onClick={() => openRow(r)} style={{ borderTop: '1px solid rgba(0,0,0,0.05)', cursor: 'pointer' }}>
                <td style={{ padding: '7px 16px' }}>{typeBadge(r.kind)}</td>
                <td style={{ padding: '7px 16px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <button
                      onClick={(e) => togglePin(r.key, e)}
                      title={pinned ? 'Unpin' : 'Pin to top'}
                      style={{ flexShrink: 0, background: 'none', border: 'none', cursor: 'pointer', padding: 2, display: 'flex', alignItems: 'center' }}
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill={pinned ? '#fa9b9b' : 'none'} stroke={pinned ? '#fa9b9b' : '#a8a29e'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M12 17v5M9 3h6l-1 6 3 3v2H7v-2l3-3-1-6z" />
                      </svg>
                    </button>
                    <span style={{ fontSize: 13, fontWeight: 600, color: '#fa9b9b' }}>{r.universal_id}</span>
                  </div>
                </td>
                <td style={{ padding: '7px 16px', fontSize: 13, fontWeight: 600, color: '#1f1108', whiteSpace: 'nowrap' }}>{orgById.get(r.org_id)?.name || 'Not provided'}</td>
                <td style={{ padding: '7px 16px', fontSize: 13, color: '#1f1108', whiteSpace: 'nowrap' }}>{r.title}</td>
                <td style={{ padding: '7px 16px', fontSize: 12.5, color: '#1f1108', whiteSpace: 'nowrap' }}>{r.stage}</td>
                <td style={{ padding: '7px 16px', whiteSpace: 'nowrap' }}>
                  {r.kind === 'inquiry' ? (
                    <span style={{ fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 6, background: inquiryStatusColor(r.status).bg, color: inquiryStatusColor(r.status).text }}>{r.status}</span>
                  ) : (
                    <span style={{ fontSize: 12.5, color: '#57534e' }}>{r.status}</span>
                  )}
                </td>
                <td style={{ padding: '7px 16px', fontSize: 12.5, color: '#78716c', whiteSpace: 'nowrap' }}>{r.secondary}</td>
                <td style={{ padding: '7px 16px', fontSize: 12.5, color: '#78716c', whiteSpace: 'nowrap' }}>{r.date}</td>
                <td style={{ padding: '7px 16px', fontSize: 12.5, color: '#78716c', whiteSpace: 'nowrap' }}>{r.created_at === 'Not provided' ? r.created_at : new Date(r.created_at).toLocaleDateString()}</td>
                <td style={{ padding: '7px 16px', fontSize: 12.5, color: '#78716c', whiteSpace: 'nowrap' }}>{r.created_by_name}</td>
              </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {!loading && sortedRows.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 10, flexWrap: 'wrap', gap: 10 }}>
          <span style={{ fontSize: 12.5, color: '#78716c' }}>
            {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, sortedRows.length)} of {sortedRows.length}
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
        onClick={() => router.push('/dashboard/crm/inquiries')}
        style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'none', border: 'none', cursor: 'pointer', padding: '0 0 14px', fontSize: 13, fontWeight: 600, color: '#78716c' }}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M19 12H5M12 19l-7-7 7-7" />
        </svg>
        Back to list
      </button>
      {selectedType === 'tender' ? (
        <TenderDetailPanel key={`tender-${selectedId}`} tenderId={selectedId} onDeleted={() => router.push('/dashboard/crm/inquiries')} />
      ) : (
        <InquiryDetailPanel key={`inquiry-${selectedId}`} inquiryId={selectedId} onDeleted={() => router.push('/dashboard/crm/inquiries')} />
      )}
    </div>
  )
}
