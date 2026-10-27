'use client'

import Select from '@/components/shared/Select'
import { useEffect, useMemo, useState } from 'react'
import { CaretUp, PushPin } from '@phosphor-icons/react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { useEscapeKey } from '@/hooks/useEscapeKey'
import { crmApi } from '@/lib/api'
import { Organization } from '@/types'
import CrmNav from '@/components/crm/CrmNav'
import OrganizationDetailPanel from '@/components/crm/OrganizationDetailPanel'
import ErrorRecoveryDialog from '@/components/erp/ErrorRecoveryDialog'
import ExportDialog from '@/components/erp/ExportDialog'
import CrmImportDialog from '@/components/crm/CrmImportDialog'
import { FormSheet, SheetSection, SHEET, sheetBtn } from '@/components/shared/FormSheet'
import { secondaryBtnStyle, primaryBtnStyle, inputStyle, smallDangerBtnStyle } from '@/components/crm/ui'
import { BRAND, TEXT } from '@/lib/theme'
import { formatDate } from '@/lib/format'
import { extractErrorMessages } from '@/lib/validation'
import { useCan } from '@/lib/permissions'
import { recordHref, useRecordId } from '@/lib/recordRef'
import InvalidRecordLink from '@/components/erp/InvalidRecordLink'
import { RowCount, StatChip } from '@/components/shared/ui'
import FilterMenu from '@/components/shared/FilterMenu'

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

type DuplicateOrgRow = {
  id: number
  org_code: string | null
  gst_number: string | null
  city: string | null
  state: string | null
  created_at: string | null
  inquiry_count: number
  tender_count: number
}
type DuplicateOrgGroup = { name: string; organizations: DuplicateOrgRow[] }

export default function OrganizationsPage() {
  const { user, isAuthorized, isLoading } = useRequireApp('crm')
  const { can } = useCan()
  const router = useRouter()
  const searchParams = useSearchParams()
  const [orgs, setOrgs] = useState<Organization[]>([])
  const [loading, setLoading] = useState(true)
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false)
  const [error, setError] = useState('')

  const isAdmin = user?.role === 'admin'
  const [showExport, setShowExport] = useState(false)
  const [showImport, setShowImport] = useState(false)
  const [duplicateGroups, setDuplicateGroups] = useState<DuplicateOrgGroup[]>([])
  const [showDuplicates, setShowDuplicates] = useState(false)
  useEscapeKey(showDuplicates, () => setShowDuplicates(false))

  const [search, setSearch] = useState('')
  const [pinnedIds, setPinnedIds] = useState<number[]>([])

  const selectedRef = searchParams.get('id')
  const { id: selectedId, error: linkError } = useRecordId(selectedRef)

  useEffect(() => {
    try {
      const stored = localStorage.getItem(PINNED_ORGS_KEY)
      // Deferred so the effect itself sets no state.
      if (stored) { const ids = JSON.parse(stored); Promise.resolve().then(() => setPinnedIds(ids)) }
    } catch {
      // ignore malformed storage
    }
  }, [])

  const togglePin = (id: number, e: React.MouseEvent) => {
    e.stopPropagation()
    setPinnedIds((prev) => {
      const next = prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id]
      try {
        localStorage.setItem(PINNED_ORGS_KEY, JSON.stringify(next))
      } catch {
        // storage unavailable (private mode / blocked): the pin stays for this session only
      }
      return next
    })
  }

  const load = async () => {
    setLoading(true)
    setError('')
    try {
      const data = await crmApi.listOrganizations({
        search: search || undefined,
        limit: 10000,
      })
      setOrgs(data)
    } catch (err) {
      setError(extractErrorMessages(err, 'Failed to load customer organizations. The server did not respond, or your connection was interrupted.').join(' '))
    } finally {
      setLoading(false)
      setHasLoadedOnce(true)
    }
  }

  useEffect(() => {
    if (isAuthorized) Promise.resolve().then(load)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthorized])

  useEffect(() => {
    if (!isAuthorized || !isAdmin) return
    crmApi.getDuplicateOrganizations()
      .then((data) => setDuplicateGroups(data.groups || []))
      .catch(() => setDuplicateGroups([]))
  }, [isAuthorized, isAdmin])

  useEffect(() => {
    if (!isAuthorized) return
    const t = setTimeout(load, 300)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search])

  const clearFilters = () => {
    setSearch('')
    setFilters({ org_scope: '', org_type: '', railway_zone: '', city: '', state: '', created_by_name: '' })
  }

  const openOrg = (org: object) => {
    router.push(recordHref('/dashboard/crm/organizations', org))
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

  type FilterKey = 'org_scope' | 'org_type' | 'railway_zone' | 'city' | 'state' | 'created_by_name'
  const FILTER_KEYS: FilterKey[] = ['org_scope', 'org_type', 'railway_zone', 'city', 'state', 'created_by_name']
  const [filters, setFilters] = useState<Record<FilterKey, string>>({
    org_scope: '', org_type: '', railway_zone: '', city: '', state: '', created_by_name: '',
  })
  const setFilter = (key: FilterKey, value: string) => setFilters((f) => ({ ...f, [key]: value }))

  const filterOptions = useMemo(() => {
    const options: Record<FilterKey, string[]> = { org_scope: [], org_type: [], railway_zone: [], city: [], state: [], created_by_name: [] }
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

  const scopeLabel = (v?: string | null) => (v === 'international' ? 'International' : 'Domestic')

  const columns: { label: string; key: SortKey | FilterKey; type: 'sort' | 'filter' | 'none'; sortLabels?: [string, string] }[] = [
    { label: 'Name', key: 'name', type: 'sort', sortLabels: ['A–Z', 'Z–A'] },
    { label: 'Scope', key: 'org_scope', type: 'filter' },
    { label: 'Type', key: 'org_type', type: 'filter' },
    { label: 'Railway Zone', key: 'railway_zone', type: 'filter' },
    { label: 'City', key: 'city', type: 'filter' },
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

  const paged = sortedOrgs

  if (isLoading || !isAuthorized) return null

  // Counter chips follow the search and the column filters, like the table.
  const monthIST = (d: string | Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit' }).format(new Date(d))
  const thisMonth = monthIST(new Date())
  const orgStats = {
    total: filteredOrgs.length,
    domestic: filteredOrgs.filter((o) => o.org_scope !== 'international').length,
    international: filteredOrgs.filter((o) => o.org_scope === 'international').length,
    railway: filteredOrgs.filter((o) => (o.org_type || '').includes('Railway')).length,
    addedThisMonth: filteredOrgs.filter((o) => !!o.created_at && monthIST(o.created_at) === thisMonth).length,
  }

  const header = (
    <>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 10 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: TEXT.heading, margin: 0 }}>Customer Organizations</h1>
        <div data-tour="crm-org-stats" style={{ display: 'flex', flexWrap: 'wrap', gap: 8, margin: '10px 0 14px' }}>
          <StatChip label="Organizations" value={orgStats.total} color="#3b82f6" />
          <StatChip label="Domestic" value={orgStats.domestic} color="#16a34a" />
          <StatChip label="International" value={orgStats.international} color="#ea580c" />
          <StatChip label="Railway" value={orgStats.railway} color="#ca8a04" />
          <StatChip label="Added this month" value={orgStats.addedThisMonth} color="#78716c" />
        </div>
        {/* One toolbar row: add, search, clear, then export / import; wraps on narrow screens. */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          {can('crm', 'organizations', 'create') && <Link
            href="/dashboard/crm/organizations/new"
            data-tour="orgs-add-btn"
            style={{ ...primaryBtnStyle, textDecoration: 'none', boxShadow: `0 4px 14px ${BRAND.primaryGlow}` }}
          >
            <span style={{ fontSize: 16, lineHeight: 1 }}>+</span> Add Customer Organization
          </Link>}
          <input
            data-tour="orgs-search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name, type, zone, city, state..."
            style={{ ...inputStyle, flex: '1 1 260px', minWidth: 200, width: 'auto' }}
          />
          <FilterMenu
            tourId="orgs-filter-btn"
            fields={([
              ['org_scope', 'Scope'], ['org_type', 'Type'], ['railway_zone', 'Railway Zone'],
              ['city', 'City'], ['state', 'State'], ['created_by_name', 'Created By'],
            ] as [FilterKey, string][]).map(([key, label]) => ({
              key, label, value: filters[key],
              options: filterOptions[key].map((v) => ({ value: v, label: key === 'org_scope' ? scopeLabel(v) : v })),
            }))}
            onChange={(key, v) => setFilter(key as FilterKey, v)}
            onClear={() => setFilters({ org_scope: '', org_type: '', railway_zone: '', city: '', state: '', created_by_name: '' })}
          />
          <button type="button" onClick={clearFilters} data-tour="orgs-clear-btn" style={secondaryBtnStyle}>Clear</button>
          <div style={{ display: 'flex', gap: 8 }}>
            {can('crm', 'organizations', 'export') && <button type="button" data-tour="orgs-export-btn" onClick={() => setShowExport(true)} style={secondaryBtnStyle}>Export</button>}
            {isAdmin && can('crm', 'organizations', 'import') && <button type="button" data-tour="orgs-import-btn" onClick={() => setShowImport(true)} style={secondaryBtnStyle}>Import</button>}
          </div>
        </div>
        {showExport && (
          <ExportDialog onClose={() => setShowExport(false)} filename="organizations" noun="customer organizations" dateLabel="Created date"
            download={(params) => crmApi.exportExcel('organizations', params)}
            items={sortedOrgs.map((o) => ({ id: o.id, label: o.name, sub: [o.org_code, o.org_type, o.city].filter(Boolean).join(' · ') }))}
            filterParams={{ search: search || undefined }} />
        )}
        {showImport && <CrmImportDialog onClose={() => setShowImport(false)} onImported={() => load()} />}
        {isAdmin && duplicateGroups.length > 0 && (
          <button
            onClick={() => setShowDuplicates(true)}
            data-tour="orgs-duplicate-btn"
            style={{ ...smallDangerBtnStyle, alignSelf: 'flex-start' }}
          >
            ⚠ {duplicateGroups.length} duplicate customer organization {duplicateGroups.length === 1 ? 'name' : 'names'} found — review
          </button>
        )}
      </div>

      {showDuplicates && (
        <FormSheet width={720} icon="alert" iconColor="#dc2626" title="Duplicate Customer Organizations" onClose={() => setShowDuplicates(false)} busy={false}
          subtitle="These customer organizations share the same name. Nothing has been changed automatically — review each group and merge/delete manually via each customer organization's detail page once you've confirmed which one to keep."
          footer={<button type="button" onClick={() => setShowDuplicates(false)} style={sheetBtn('secondary', SHEET.INK)}>Close</button>}>
          <div style={{ padding: '20px 24px' }}>
            {duplicateGroups.map((group) => (
              <SheetSection key={group.name} icon="building" title={group.name}>
                <div style={{ border: `1px solid ${SHEET.LINE}`, borderRadius: 10, overflow: 'hidden' }}>
                  {group.organizations.map((o, i) => (
                    <div
                      key={o.id}
                      onClick={() => { setShowDuplicates(false); openOrg(o) }}
                      style={{ display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: 12.5, padding: '8px 12px', borderTop: i ? `1px solid ${SHEET.LINE}` : 'none', cursor: 'pointer' }}
                    >
                      <span style={{ color: SHEET.BODY }}>
                        #{o.id} · {o.org_code || 'no code'} · {o.city || '—'}, {o.state || '—'}
                        {o.gst_number ? ` · GST ${o.gst_number}` : ''}
                      </span>
                      <span style={{ color: SHEET.MUTED, whiteSpace: 'nowrap' }}>
                        {o.inquiry_count} inquiries · {o.tender_count} tenders
                      </span>
                    </div>
                  ))}
                </div>
              </SheetSection>
            ))}
          </div>
        </FormSheet>
      )}

      <ErrorRecoveryDialog
        open={!!error}
        title="Failed to Load Customer Organizations"
        message={`${error} Please refresh the page. If the issue persists, reload the application and try again.`}
        onClose={() => setError('')}
      />
    </>
  )


  const fullTable = (
    <>
      <div style={{ ...panelOuterStyle, flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        <div style={{ overflow: 'auto', flex: 1, minHeight: 0 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 900 }}>
          <thead>
            <tr style={{ background: 'rgba(244,113,59,0.06)' }}>
              {columns.map((col) =>
                col.type === 'filter' ? (
                  <th
                    key={col.key}
                    data-tour={`orgs-col-${col.key}`}
                    style={{ textAlign: 'left', padding: '5px 10px', fontSize: 11, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: filters[col.key as FilterKey] ? '#FF7A45' : '#a8a29e', whiteSpace: 'nowrap', position: 'sticky', top: 0, background: '#fdf1e6', zIndex: 1 }}
                  >
                    <Select
                      value={filters[col.key as FilterKey]}
                      onChange={(e) => setFilter(col.key as FilterKey, e.target.value)}
                      style={{ font: 'inherit', color: 'inherit', background: 'transparent', border: 'none', outline: 'none', cursor: 'pointer', maxWidth: 140 }}
                    >
                      <option value="">{col.label}</option>
                      {filterOptions[col.key as FilterKey].map((v) => (
                        <option key={v} value={v} style={{ textTransform: 'none', color: '#1f1108' }}>{col.key === 'org_scope' ? scopeLabel(v) : v}</option>
                      ))}
                    </Select>
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
                    data-tour={`orgs-col-${col.key}`}
                    style={{ textAlign: 'left', padding: '7px 16px', fontSize: 11, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: sortKey === col.key ? '#FF7A45' : '#a8a29e', whiteSpace: 'nowrap', position: 'sticky', top: 0, background: '#fdf1e6', zIndex: 1, cursor: 'pointer', userSelect: 'none' }}
                  >
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                      {col.label}{col.key === 'name' && <RowCount count={sortedOrgs.length} />}
                      {col.sortLabels && (
                        <span style={{ fontSize: 9.5, fontWeight: 700, opacity: sortKey === col.key ? 1 : 0.45, textTransform: 'none' }}>
                          ({sortKey === col.key ? col.sortLabels[sortDir === 'asc' ? 0 : 1] : `${col.sortLabels[0]}/${col.sortLabels[1]}`})
                        </span>
                      )}
                      <CaretUp size={9}
                        style={{ opacity: sortKey === col.key ? 1 : 0.35, transform: sortKey === col.key && sortDir === 'desc' ? 'rotate(180deg)' : 'none', transition: 'transform .15s' }} />
                    </span>
                  </th>
                )
              )}
            </tr>
          </thead>
          <tbody data-tour="orgs-table-rows" style={{ opacity: loading && hasLoadedOnce ? 0.5 : 1, transition: 'opacity .15s' }}>
            {loading && !hasLoadedOnce && <tr><td colSpan={7} style={{ padding: 24, textAlign: 'center', color: '#a8a29e', fontSize: 13 }}>Loading…</td></tr>}
            {!loading && paged.length === 0 && <tr><td colSpan={7} style={{ padding: 24, textAlign: 'center', color: '#a8a29e', fontSize: 13 }}>No customer organizations found.</td></tr>}
            {(!loading || hasLoadedOnce) && paged.map((o, idx) => {
              const pinned = pinnedIds.includes(o.id)
              return (
              <tr key={o.id} onClick={() => openOrg(o)} style={{ borderTop: '1px solid rgba(0,0,0,0.05)', cursor: 'pointer' }}>
                <td style={{ padding: '7px 16px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <button
                      onClick={(e) => togglePin(o.id, e)}
                      data-tour={idx === 0 ? 'orgs-pin-btn' : undefined}
                      title={pinned ? 'Unpin customer organization' : 'Pin customer organization to top'}
                      style={{ flexShrink: 0, background: 'none', border: 'none', cursor: 'pointer', padding: 8, margin: -8, display: 'flex', alignItems: 'center', borderRadius: 6 }}
                    >
                      <PushPin size={14} weight={pinned ? 'fill' : 'regular'} color={pinned ? '#FF7A45' : '#a8a29e'} />
                    </button>
                    <div style={{ display: 'flex', flexDirection: 'column' }}>
                      <span style={{ fontSize: 13, fontWeight: 600, color: '#FF7A45' }}>{o.name}</span>
                      <span style={{ fontSize: 11, color: '#a8a29e' }}>{o.org_code || '—'}</span>
                    </div>
                  </div>
                </td>
                <td style={{ padding: '7px 16px', fontSize: 13, color: '#57534e', whiteSpace: 'nowrap' }}>{scopeLabel(o.org_scope)}</td>
                <td style={{ padding: '7px 16px', fontSize: 13, color: '#57534e', maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={o.org_type || undefined}>{o.org_type || '—'}</td>
                <td style={{ padding: '7px 16px', fontSize: 13, color: '#57534e', maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={o.railway_zone || undefined}>{o.railway_zone || '—'}</td>
                <td style={{ padding: '7px 16px', fontSize: 13, color: '#57534e', maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={o.city || undefined}>{o.city || '—'}</td>
                <td style={{ padding: '7px 16px', fontSize: 12.5, color: '#78716c', whiteSpace: 'nowrap' }}>{formatDate(o.created_at)}</td>
                <td style={{ padding: '7px 16px', fontSize: 12.5, color: '#78716c', whiteSpace: 'nowrap' }}>{o.created_by_name || '—'}</td>
              </tr>
              )
            })}
          </tbody>
        </table>
        </div>
      </div>

    </>
  )

  if (!selectedRef) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
        <CrmNav />
        {header}
        {fullTable}
      </div>
    )
  }

  if (linkError) return (<div><CrmNav /><InvalidRecordLink message={linkError} listHref="/dashboard/crm/organizations" listLabel="Back to customer organizations" /></div>)
  if (!selectedId) return <div><CrmNav /></div>

  return (
    <div>
      <CrmNav />
      <OrganizationDetailPanel key={selectedId} orgId={selectedId} onDeleted={() => { load(); router.push('/dashboard/crm/organizations') }} />
    </div>
  )
}
