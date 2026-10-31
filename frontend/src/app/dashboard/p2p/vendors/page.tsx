'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/hooks/useAuth'
import { useCan } from '@/lib/permissions'
import { vendorsApi } from '@/lib/api'
import { ProcurementVendor } from '@/types'
import { TEXT, GLASS, SHADOWS } from '@/lib/theme'
import { inputStyle, secondaryBtnStyle, smallSecondaryBtnStyle, RowCount, Pill, StatChip } from '@/components/shared/ui'
import { Funnel } from '@phosphor-icons/react'
import { FormSheet, SheetIcon, SHEET, sheetBtn, sheetInput, sheetLabel } from '@/components/shared/FormSheet'
import P2PNav from '@/components/p2p/P2PNav'
import ExportDialog from '@/components/erp/ExportDialog'
import ImportDialog from '@/components/shared/ImportDialog'
import VendorFormDialog from '@/components/p2p/VendorFormDialog'
import { extractErrorMessages } from '@/lib/validation'
import { recordPath } from '@/lib/recordRef'
import Select from '@/components/shared/Select'

const STATUS_HEX: Record<string, string> = { active: '#16a34a', inactive: '#78716c', blocked: '#dc2626' }
const STATUS_LABEL: Record<string, string> = { active: 'Active', inactive: 'Inactive', blocked: 'Blocked' }
const th: React.CSSProperties = { position: 'sticky', top: 0, background: '#fdf1e6', zIndex: 1, textAlign: 'left', padding: '10px 8px', fontSize: 11, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: '#a8a29e', whiteSpace: 'nowrap' }
// One-row text longer than 25 characters is cut with "…" (full text in the title).
const clip = (v?: string | null, max = 25) => (!v ? '—' : v.length > max ? `${v.slice(0, max).trimEnd()}…` : v)
const CUT_COLS = ['Company', 'Contact', 'Referred by / Added by']
const NEW_BTN: React.CSSProperties = { background: '#ea580c', border: '1px solid #c2410c', color: '#fff', fontSize: 13.5, fontWeight: 600, padding: '10px 14px', borderRadius: 10, cursor: 'pointer', whiteSpace: 'nowrap' }
const td: React.CSSProperties = { padding: '10px 8px', fontSize: 13, color: '#57534e', borderTop: '1px solid rgba(0,0,0,0.05)' }

export default function VendorsPage() {
  const { user, isLoading } = useAuth()
  const router = useRouter()
  const { can } = useCan()
  // Same as the backend lookup: Vendors view, the Purchase desk or Accounts.
  const allowed = !!user && (user.role === 'admin' || can('p2p', 'vendors', 'view') || !!user.apps?.some((a) => a === 'purchase' || a === 'accounts'))
  const [vendors, setVendors] = useState<ProcurementVendor[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('active')
  const [showAdd, setShowAdd] = useState(false)
  const [showExport, setShowExport] = useState(false)
  const [showImport, setShowImport] = useState(false)
  const [reload, setReload] = useState(0)
  const [showFilters, setShowFilters] = useState(false)
  const [draftStatus, setDraftStatus] = useState('active')

  useEffect(() => {
    if (!allowed) return
    let cancelled = false
    setLoading(true); setError('')
    // Always the full list: the status is applied here, so the count chips stay real totals.
    vendorsApi.list({})
      .then((v) => { if (!cancelled) { setVendors(v); setError('') } })
      .catch((err) => { if (!cancelled) setError(extractErrorMessages(err, 'Could not load vendors — reload the page.').join(' ')) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [allowed, reload])

  // Search only (every status): what the count chips count. `shown` then applies the status filter.
  const searched = useMemo(() => {
    const q = search.trim().toLowerCase()
    const sorted = [...vendors].sort((a, b) => (a.code || '').localeCompare(b.code || '', undefined, { numeric: true }))
    if (!q) return sorted
    return sorted.filter((v) => [v.name, v.code, v.gstin, v.city, v.contact_name, v.contact_phone].some((x) => (x || '').toLowerCase().includes(q)))
  }, [vendors, search])
  const shown = useMemo(() => (status ? searched.filter((v) => v.status === status) : searched), [searched, status])
  // A count chip sets the same Status filter as the popup; clicking the active one goes back to the default (Active).
  const toggleStatus = (s: string) => setStatus((cur) => (cur === s ? 'active' : s))

  // The list opens on Active vendors; any other status choice counts as an active filter.
  const activeFilterCount = status !== 'active' ? 1 : 0
  const clearFilters = () => { setStatus('active'); setShowFilters(false) }
  const openFilters = () => { setDraftStatus(status); setShowFilters(true) }
  const applyFilters = () => { setStatus(draftStatus); setShowFilters(false) }

  if (isLoading) return <div><P2PNav /><p role="status" style={{ fontSize: 13, color: TEXT.muted }}>Loading…</p></div>
  if (!allowed) return <div><P2PNav /><p role="alert" style={{ fontSize: 13, color: TEXT.muted }}>You don&apos;t have access to Vendors. Ask an admin to give you Procurement › Vendors › View.</p></div>

  return (
    <div>
      <P2PNav />
      <div style={{ marginBottom: 14 }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, color: TEXT.heading, margin: 0 }}>Vendors</h1>
        <div data-tour="vendors-stats" style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 10 }}>
          <StatChip label="Vendors" value={searched.length} color="#3b82f6" onClick={() => setStatus('')} active={status === ''} />
          <StatChip label="Active" value={searched.filter((v) => v.status === 'active').length} color="#16a34a" onClick={() => toggleStatus('active')} active={status === 'active'} />
          <StatChip label="Inactive" value={searched.filter((v) => v.status === 'inactive').length} color="#78716c" onClick={() => toggleStatus('inactive')} active={status === 'inactive'} />
          <StatChip label="Blocked" value={searched.filter((v) => v.status === 'blocked').length} color="#dc2626" onClick={() => toggleStatus('blocked')} active={status === 'blocked'} />
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
        {can('p2p', 'vendors', 'create') && <button type="button" data-tour="vendors-add-btn" onClick={() => setShowAdd(true)} style={NEW_BTN}>+ Add Vendor</button>}
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          <input aria-label="Search vendors" data-tour="vendors-search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name, code, GSTIN, city, contact…" style={{ ...inputStyle, width: 280, maxWidth: '100%' }} />
          <button type="button" onClick={openFilters} data-tour="vendors-filter-btn" aria-label="Filters" title="Filters"
            style={{ ...secondaryBtnStyle, display: 'inline-flex', alignItems: 'center', gap: 6, ...(activeFilterCount ? { borderColor: '#ea580c', color: '#c2410c' } : {}) }}>
            <Funnel size={16} weight={activeFilterCount ? 'fill' : 'regular'} />
            Filters
            {activeFilterCount > 0 && <span style={{ minWidth: 18, height: 18, padding: '0 5px', borderRadius: 9, background: '#ea580c', color: '#fff', fontSize: 11, fontWeight: 700, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>{activeFilterCount}</span>}
          </button>
          {activeFilterCount > 0 && <button type="button" onClick={clearFilters} style={secondaryBtnStyle} data-tour="vendors-clear-btn">Clear</button>}
          {can('p2p', 'vendors', 'export') && <button type="button" data-tour="vendors-export-btn" onClick={() => setShowExport(true)} style={secondaryBtnStyle}>Export</button>}
          {can('p2p', 'vendors', 'import') && <button type="button" data-tour="vendors-import-btn" onClick={() => setShowImport(true)} style={secondaryBtnStyle}>Import</button>}
        </div>
      </div>

      {showFilters && (
        <FormSheet icon="search" title="Filters" subtitle="Narrow the vendors, then press Apply." width={560} busy={false} onClose={() => setShowFilters(false)} tour="vendors-filter-sheet"
          footer={<>
            <button type="button" onClick={clearFilters} style={sheetBtn('secondary', SHEET.INK)}>Clear Filters</button>
            <button type="button" onClick={applyFilters} style={sheetBtn('primary', SHEET.BLUE)} data-tour="vendors-apply-btn"><SheetIcon name="check" size={16} />Apply Filters</button>
          </>}>
          <div style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div>
              <label style={sheetLabel}>Status</label>
              <Select aria-label="Status" title="Status" value={draftStatus} onChange={(e) => setDraftStatus(e.target.value)} style={sheetInput} data-tour="vendors-status-filter">
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
                <option value="blocked">Blocked</option>
                <option value="">All statuses</option>
              </Select>
            </div>
          </div>
        </FormSheet>
      )}

      {error && (
        <div role="alert" style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <span>{error}</span>
          <button type="button" onClick={() => setReload((x) => x + 1)} style={smallSecondaryBtnStyle}>Try again</button>
        </div>
      )}

      <div style={{ borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur, border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), overflow: 'auto', maxHeight: 'calc(100vh - 320px)' }}>
        <table data-tour="vendors-table" style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr>{['Code', 'Company', 'Contact', 'City', 'GSTIN', 'Referred by / Added by', 'Catalog', 'Status'].map((h, i) => <th key={h} data-fit-min={60} data-fit-cut={CUT_COLS.includes(h) ? '' : undefined} style={h === 'Catalog' ? { ...th, textAlign: 'right' } : th}>{h}{i === 0 && <RowCount count={shown.length} />}</th>)}</tr></thead>
          <tbody>
            {loading && <tr><td colSpan={8} style={{ ...td, textAlign: 'center', color: '#a8a29e' }}>Loading…</td></tr>}
            {!loading && !error && shown.length === 0 && <tr><td colSpan={8} style={{ ...td, textAlign: 'center', color: '#a8a29e' }}>{vendors.length ? (search.trim() && searched.length === 0 ? 'No vendor matches the search — clear it or try a code, GSTIN or city.' : `No ${STATUS_LABEL[status]?.toLowerCase() || ''} vendors${search.trim() ? ' for this search' : ''} — click the Vendors count or change the status in Filters.`) : 'No vendors yet — use + Add Vendor or Import a list.'}</td></tr>}
            {shown.map((v) => (
              <tr key={v.id} onClick={() => router.push(recordPath('/dashboard/p2p/vendors', v))} style={{ cursor: 'pointer' }}>
                <td style={{ ...td, fontWeight: 600, color: '#FF7A45', whiteSpace: 'nowrap' }}>{v.code}</td>
                <td data-fit-clamp style={{ ...td, fontWeight: 600, color: TEXT.heading }}><div title={v.name}>{clip(v.name, 50)}</div></td>
                <td data-fit-clamp style={td}>
                  {v.contact_name || v.contact_phone ? (
                    <>
                      <div title={v.contact_name || undefined}>{clip(v.contact_name)}</div>
                      <div style={{ fontSize: 12, color: '#5b6472' }}>{v.contact_phone || '—'}</div>
                    </>
                  ) : '—'}
                </td>
                <td title={v.city || undefined} style={{ ...td, whiteSpace: 'nowrap' }}>{clip(v.city)}</td>
                <td style={{ ...td, whiteSpace: 'nowrap' }}>{v.gstin || '—'}</td>
                <td data-fit-clamp style={td}>
                  <div title={v.referred_by_label || undefined}>Referred: {clip(v.referred_by_label)}</div>
                  <div style={{ fontSize: 12, color: '#5b6472' }} title={v.created_by_name || undefined}>Added by {clip(v.created_by_name)}</div>
                </td>
                <td style={{ ...td, textAlign: 'right', whiteSpace: 'nowrap' }}>{(v.catalog_count ?? 0).toLocaleString('en-IN')}</td>
                <td style={{ ...td, whiteSpace: 'nowrap' }}><Pill label={STATUS_LABEL[v.status] || v.status} hex={STATUS_HEX[v.status] || '#78716c'} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showAdd && <VendorFormDialog onClose={() => setShowAdd(false)} onSaved={(v) => { setShowAdd(false); router.push(recordPath('/dashboard/p2p/vendors', v)) }} />}
      {showExport && (
        <ExportDialog onClose={() => setShowExport(false)} filename="vendors" noun="vendors" dateLabel="Added date"
          download={(params) => vendorsApi.exportExcel(params)} filterParams={{ search: search || undefined }}
          items={shown.map((v) => ({ id: v.id, label: `${v.name} (${v.code})`, sub: [v.city, v.gstin].filter(Boolean).join(' · ') }))} />
      )}
      {showImport && (
        <ImportDialog title="Import vendors" templateName="vendor_import_template.csv" getTemplate={vendorsApi.importTemplate}
          intro={<>One vendor per row. Only <b>Company Name</b> is required. A vendor already in the master (same name or GSTIN) is left unchanged.</>}
          upload={async (f) => {
            const r = await vendorsApi.importFile(f)
            return {
              summary: [`Added: ${r.created.length}`, ...(r.existing.length ? [`Already in master: ${r.existing.length}`] : [])],
              errors: r.errors.map((e) => ({ where: `Row ${e.row}`, reason: e.reason })),
            }
          }}
          onClose={() => setShowImport(false)} onImported={() => setReload((x) => x + 1)} />
      )}
    </div>
  )
}
