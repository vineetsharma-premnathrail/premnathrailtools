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
import { BRAND, TEXT } from '@/lib/theme'
import { formatDate } from '@/lib/format'
import MessageDialog from '@/components/erp/MessageDialog'

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
  product: string
  stage: string
  status: string
  secondary: string
  date: string
  created_at: string
  created_by_name: string
  org_name: string
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

  type ColFilterKey = 'stage' | 'created_by_name'
  const COL_FILTER_KEYS: ColFilterKey[] = ['stage', 'created_by_name']
  const [colFilters, setColFilters] = useState<Record<ColFilterKey, string>>({ stage: '', created_by_name: '' })
  const setColFilter = (key: ColFilterKey, value: string) => setColFilters((f) => ({ ...f, [key]: value }))

  const clearFilters = () => {
    setSearch('')
    setTypeFilter('all')
    setColFilters({ stage: '', created_by_name: '' })
  }

  const combined = useMemo<CombinedRow[]>(() => {
    const fromInquiries: CombinedRow[] = inquiries.map((i) => ({
      key: `inquiry-${i.id}`,
      id: i.id,
      kind: 'inquiry',
      universal_id: i.universal_id,
      org_id: i.org_id,
      title: i.product || 'Not provided',
      product: i.product || 'Not provided',
      stage: i.current_stage || 'Not provided',
      status: i.status || 'Not provided',
      secondary: i.priority || 'Not provided',
      date: i.next_followup_date || 'Not provided',
      created_at: i.created_at || 'Not provided',
      created_by_name: i.created_by_name || 'Not provided',
      org_name: orgById.get(i.org_id)?.name || 'Not provided',
    }))
    const fromTenders: CombinedRow[] = tenders.map((t) => ({
      key: `tender-${t.id}`,
      id: t.id,
      kind: 'tender',
      universal_id: t.universal_id,
      org_id: t.org_id,
      title: t.tender_name || t.tender_number || 'Not provided',
      product: t.tender_category || 'Not provided',
      stage: t.current_stage || 'Not provided',
      status: t.status || 'Not provided',
      secondary: t.tender_value != null ? `${t.currency || ''} ${t.tender_value.toLocaleString()}` : 'Not provided',
      date: t.submission_date || 'Not provided',
      created_at: t.created_at || 'Not provided',
      created_by_name: t.created_by_name || 'Not provided',
      org_name: orgById.get(t.org_id)?.name || 'Not provided',
    }))
    const all = [...fromInquiries, ...fromTenders]
    return typeFilter === 'all' ? all : all.filter((r) => r.kind === typeFilter)
  }, [inquiries, tenders, typeFilter, orgById])

  const colFilterOptions = useMemo(() => {
    const options: Record<ColFilterKey, string[]> = { stage: [], created_by_name: [] }
    for (const key of COL_FILTER_KEYS) {
      const values = new Set<string>()
      for (const r of combined) {
        if (r[key] && r[key] !== 'Not provided') values.add(r[key])
      }
      options[key] = Array.from(values).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
    }
    return options
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [combined])

  const filteredRows = useMemo(() => {
    return combined.filter((r) => COL_FILTER_KEYS.every((key) => !colFilters[key] || r[key] === colFilters[key]))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [combined, colFilters])

  type SortKey = 'universal_id' | 'created_at'
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

  const columns: { label: string; key: SortKey | ColFilterKey | 'kind' | 'org_name' | 'secondary' | 'product'; type: 'sort' | 'filter' | 'none'; sortLabels?: [string, string] }[] = [
    { label: 'ID', key: 'universal_id', type: 'none' },
    { label: 'Organization', key: 'org_name', type: 'none' },
    { label: 'Product', key: 'product', type: 'none' },
    { label: 'Stage', key: 'stage', type: 'filter' },
    { label: 'Created Date', key: 'created_at', type: 'sort', sortLabels: ['Old', 'Latest'] },
    { label: 'Created By', key: 'created_by_name', type: 'filter' },
  ]

  const sortedRows = useMemo(() => {
    const cmp = (a: CombinedRow, b: CombinedRow) => {
      const rawA = a[sortKey]
      const rawB = b[sortKey]
      let av: string | number
      let bv: string | number
      if (sortKey === 'created_at') {
        av = rawA && rawA !== 'Not provided' ? new Date(rawA).getTime() : 0
        bv = rawB && rawB !== 'Not provided' ? new Date(rawB).getTime() : 0
      } else {
        av = (rawA ?? '').toString().toLowerCase()
        bv = (rawB ?? '').toString().toLowerCase()
      }
      const result = av < bv ? -1 : av > bv ? 1 : 0
      return sortDir === 'asc' ? result : -result
    }
    const pinned = filteredRows.filter((r) => pinnedKeys.includes(r.key)).sort(cmp)
    const rest = filteredRows.filter((r) => !pinnedKeys.includes(r.key)).sort(cmp)
    return [...pinned, ...rest]
  }, [filteredRows, pinnedKeys, sortKey, sortDir])

  const openRow = (row: CombinedRow) => {
    router.push(`/dashboard/crm/inquiries?id=${row.id}&type=${row.kind}`)
  }

  const totalPages = Math.max(1, Math.ceil(sortedRows.length / PAGE_SIZE))
  const paged = sortedRows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  if (isLoading || !isAuthorized) return null

  const header = (
    <>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 20 }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, color: TEXT.heading, margin: 0 }}>Inquiries &amp; Tenders</h1>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
          <Link
            href="/dashboard/crm/inquiries/new"
            data-tour="iq-add-btn"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 14.5, fontWeight: 700, padding: '12px 24px', borderRadius: 10, background: `linear-gradient(140deg,${BRAND.primary},${BRAND.primaryHover})`, color: TEXT.white, textDecoration: 'none', whiteSpace: 'nowrap', boxShadow: `0 4px 14px ${BRAND.primaryGlow}` }}
          >
            <span style={{ fontSize: 17, lineHeight: 1 }}>+</span> New Record
          </Link>
        </div>
      </div>

      <MessageDialog
        open={!!error}
        variant="error"
        title="Failed to Load Inquiries & Tenders"
        message={error}
        onClose={() => setError('')}
        actionLabel="Reload"
        onAction={() => window.location.reload()}
      />
    </>
  )

  const searchBar = (
    <div style={{ display: 'flex', flexWrap: 'nowrap', gap: 6, marginBottom: 10 }}>
      <input
        data-tour="iq-search"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search ID, organization, product, owner, zone, stage..."
        style={{ flex: '1 1 auto', minWidth: 0, padding: '8px 10px', borderRadius: 10, border: '1px solid rgba(0,0,0,0.1)', background: '#fff', fontSize: 12.5, outline: 'none' }}
      />
      <div data-tour="iq-col-type" role="radiogroup" aria-label="Show" style={{ display: 'flex', alignItems: 'center', gap: 12, flex: '0 0 auto', padding: '0 10px', borderRadius: 10, border: '1px solid rgba(0,0,0,0.1)', background: '#fff' }}>
        {([['inquiry', 'Inquiry'], ['tender', 'Tender']] as const).map(([value, label]) => (
          <label key={value} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12.5, fontWeight: 600, color: typeFilter === value ? '#FF7A45' : '#57534e', cursor: 'pointer', whiteSpace: 'nowrap' }}>
            <input
              type="radio"
              name="iq-type-filter"
              value={value}
              checked={typeFilter === value}
              onChange={() => setTypeFilter(value)}
              style={{ accentColor: '#FF7A45', margin: 0, cursor: 'pointer' }}
            />
            {label}
          </label>
        ))}
      </div>
      <button onClick={clearFilters} data-tour="iq-clear-btn" style={{ ...secondaryBtnStyle, flex: '0 0 auto', padding: '8px 10px', fontSize: 11.5 }}>Clear</button>
    </div>
  )

  const fullTable = (
    <>
      <div style={{ ...panelOuterStyle, height: 'auto', overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 1000, tableLayout: 'fixed' }}>
          {/* Fixed widths so headers don't shift when the Inquiry/Tender filter changes the rows. */}
          <colgroup>
            <col style={{ width: '14%' }} />
            <col style={{ width: '25%' }} />
            <col style={{ width: '17%' }} />
            <col style={{ width: '16%' }} />
            <col style={{ width: '14%' }} />
            <col style={{ width: '14%' }} />
          </colgroup>
          <thead>
            <tr style={{ background: 'rgba(244,113,59,0.06)' }}>
              {columns.map((col) => {
                if (col.type === 'filter') {
                  const key = col.key as ColFilterKey
                  return (
                    <th key={col.key} data-tour={`iq-col-${key}`} style={{ textAlign: 'left', padding: '5px 10px', fontSize: 11, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: colFilters[key] ? '#FF7A45' : '#a8a29e', whiteSpace: 'nowrap', position: 'sticky', top: 0, background: '#fdf1e6', zIndex: 1 }}>
                      <select
                        value={colFilters[key]}
                        onChange={(e) => setColFilter(key, e.target.value)}
                        style={{ font: 'inherit', color: 'inherit', background: 'transparent', border: 'none', outline: 'none', cursor: 'pointer', maxWidth: 140 }}
                      >
                        <option value="">{col.label}</option>
                        {colFilterOptions[key].map((v) => (
                          <option key={v} value={v} style={{ textTransform: 'none', color: '#1f1108' }}>{v}</option>
                        ))}
                      </select>
                    </th>
                  )
                }
                if (col.type === 'none') {
                  return (
                    <th key={col.key} style={{ textAlign: 'left', padding: '7px 16px', fontSize: 11, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: '#a8a29e', whiteSpace: 'nowrap', position: 'sticky', top: 0, background: '#fdf1e6', zIndex: 1 }}>
                      {col.label}
                    </th>
                  )
                }
                return (
                  <th
                    key={col.key}
                    onClick={() => toggleSort(col.key as SortKey)}
                    data-tour={`iq-col-${col.key}`}
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
              })}
            </tr>
          </thead>
          <tbody data-tour="iq-table-rows">
            {loading && <tr><td colSpan={6} style={{ padding: 24, textAlign: 'center', color: '#a8a29e', fontSize: 13 }}>Loading…</td></tr>}
            {!loading && paged.length === 0 && <tr><td colSpan={6} style={{ padding: 24, textAlign: 'center', color: '#a8a29e', fontSize: 13 }}>No records found.</td></tr>}
            {paged.map((r, idx) => {
              const pinned = pinnedKeys.includes(r.key)
              return (
              <tr key={r.key} onClick={() => openRow(r)} style={{ borderTop: '1px solid rgba(0,0,0,0.05)', cursor: 'pointer' }}>
                <td style={{ padding: '7px 16px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <button
                      onClick={(e) => togglePin(r.key, e)}
                      data-tour={idx === 0 ? 'iq-pin-btn' : undefined}
                      title={pinned ? 'Unpin' : 'Pin to top'}
                      style={{ flexShrink: 0, background: 'none', border: 'none', cursor: 'pointer', padding: 2, display: 'flex', alignItems: 'center' }}
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill={pinned ? '#FF7A45' : 'none'} stroke={pinned ? '#FF7A45' : '#a8a29e'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M12 17v5M9 3h6l-1 6 3 3v2H7v-2l3-3-1-6z" />
                      </svg>
                    </button>
                    <span style={{ fontSize: 13, fontWeight: 600, color: '#FF7A45', whiteSpace: 'nowrap', lineHeight: 1.35 }}>
                      {/* INQ-20260917- on line 1, the serial on line 2 */}
                      {r.universal_id.includes('-') ? (
                        <>
                          {r.universal_id.slice(0, r.universal_id.lastIndexOf('-') + 1)}
                          <br />
                          {r.universal_id.slice(r.universal_id.lastIndexOf('-') + 1)}
                        </>
                      ) : r.universal_id}
                    </span>
                  </div>
                </td>
                <td style={{ padding: '7px 16px', fontSize: 13, fontWeight: 600, color: '#1f1108', whiteSpace: 'normal', wordBreak: 'break-word', lineHeight: 1.35 }}>{orgById.get(r.org_id)?.name || 'Not provided'}</td>
                <td title={r.product} style={{ padding: '7px 16px', fontSize: 12.5, color: '#1f1108', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.product}</td>
                <td title={r.stage} style={{ padding: '7px 16px', fontSize: 12.5, color: '#1f1108', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.stage}</td>
                <td style={{ padding: '7px 16px', fontSize: 12.5, color: '#78716c', whiteSpace: 'nowrap' }}>{r.created_at === 'Not provided' ? r.created_at : formatDate(r.created_at)}</td>
                <td title={r.created_by_name} style={{ padding: '7px 16px', fontSize: 12.5, color: '#78716c', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.created_by_name}</td>
              </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {!loading && sortedRows.length > 0 && (
        <div data-tour="iq-pagination" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 10, flexWrap: 'wrap', gap: 10 }}>
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
      {selectedType === 'tender' ? (
        <TenderDetailPanel key={`tender-${selectedId}`} tenderId={selectedId} onDeleted={() => { load(); router.push('/dashboard/crm/inquiries') }} />
      ) : (
        <InquiryDetailPanel key={`inquiry-${selectedId}`} inquiryId={selectedId} onDeleted={() => { load(); router.push('/dashboard/crm/inquiries') }} />
      )}
    </div>
  )
}
