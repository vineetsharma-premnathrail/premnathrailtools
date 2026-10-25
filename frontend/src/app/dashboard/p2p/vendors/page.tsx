'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/hooks/useAuth'
import { useCan } from '@/lib/permissions'
import { vendorsApi } from '@/lib/api'
import { ProcurementVendor } from '@/types'
import { TEXT, GLASS, SHADOWS } from '@/lib/theme'
import { inputStyle, secondaryBtnStyle, primaryBtnStyle, smallSecondaryBtnStyle, RowCount, Pill } from '@/components/shared/ui'
import P2PNav from '@/components/p2p/P2PNav'
import ExportDialog from '@/components/erp/ExportDialog'
import ImportDialog from '@/components/shared/ImportDialog'
import VendorFormDialog from '@/components/p2p/VendorFormDialog'
import { extractErrorMessages } from '@/lib/validation'
import { recordPath } from '@/lib/recordRef'
import Select from '@/components/shared/Select'

const STATUS_HEX: Record<string, string> = { active: '#16a34a', inactive: '#78716c', blocked: '#dc2626' }
const STATUS_LABEL: Record<string, string> = { active: 'Active', inactive: 'Inactive', blocked: 'Blocked' }
const th: React.CSSProperties = { position: 'sticky', top: 0, background: '#fdf1e6', zIndex: 1, textAlign: 'left', padding: '10px 14px', fontSize: 11, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: '#a8a29e', whiteSpace: 'nowrap' }
const td: React.CSSProperties = { padding: '10px 14px', fontSize: 13, color: '#57534e', borderTop: '1px solid rgba(0,0,0,0.05)' }

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
  const [moreRight, setMoreRight] = useState(false)

  useEffect(() => {
    if (!allowed) return
    let cancelled = false
    setLoading(true); setError('')
    vendorsApi.list({ status: status || undefined })
      .then((v) => { if (!cancelled) { setVendors(v); setError('') } })
      .catch((err) => { if (!cancelled) setError(extractErrorMessages(err, 'Could not load vendors — reload the page.').join(' ')) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [allowed, status, reload])

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase()
    const sorted = [...vendors].sort((a, b) => (a.code || '').localeCompare(b.code || '', undefined, { numeric: true }))
    if (!q) return sorted
    return sorted.filter((v) => [v.name, v.code, v.gstin, v.city, v.contact_name, v.contact_phone].some((x) => (x || '').toLowerCase().includes(q)))
  }, [vendors, search])

  if (isLoading) return <div><P2PNav /><p role="status" style={{ fontSize: 13, color: TEXT.muted }}>Loading…</p></div>
  if (!allowed) return <div><P2PNav /><p role="alert" style={{ fontSize: 13, color: TEXT.muted }}>You don&apos;t have access to Vendors. Ask an admin to give you Procurement › Vendors › View.</p></div>

  return (
    <div>
      <P2PNav />
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, marginBottom: 16, flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: TEXT.heading, margin: '0 0 4px' }}>Vendors</h1>
          <p style={{ fontSize: 13, color: '#5b6472', margin: 0, maxWidth: 640 }}>
            Suppliers you buy from. Finance keeps bank and credit details.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {can('p2p', 'vendors', 'export') && <button type="button" data-tour="vendors-export-btn" onClick={() => setShowExport(true)} style={secondaryBtnStyle}>Export</button>}
          {can('p2p', 'vendors', 'import') && <button type="button" data-tour="vendors-import-btn" onClick={() => setShowImport(true)} style={secondaryBtnStyle}>Import</button>}
          {can('p2p', 'vendors', 'create') && <button type="button" data-tour="vendors-add-btn" onClick={() => setShowAdd(true)}
            style={primaryBtnStyle}>
            + Add Vendor
          </button>}
        </div>
      </div>

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 14 }}>
        <input aria-label="Search vendors" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name, code, GSTIN, city, contact…" style={{ ...inputStyle, flex: '1 1 280px', maxWidth: 300 }} />
        <Select aria-label="Status" title="Status" value={status} onChange={(e) => setStatus(e.target.value)} style={{ ...inputStyle, flex: '1 1 160px', maxWidth: 300 }}>
          <option value="active">Status: Active</option>
          <option value="inactive">Status: Inactive</option>
          <option value="blocked">Status: Blocked</option>
          <option value="">Status: All</option>
        </Select>
      </div>

      {error && (
        <div role="alert" style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <span>{error}</span>
          <button type="button" onClick={() => setReload((x) => x + 1)} style={smallSecondaryBtnStyle}>Try again</button>
        </div>
      )}

      <div style={{ position: 'relative' }}>
      <div onScroll={(e) => { const el = e.currentTarget; setMoreRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 4) }}
        ref={(el) => { if (el) { const more = el.scrollLeft + el.clientWidth < el.scrollWidth - 4; if (more !== moreRight) setMoreRight(more) } }}
        style={{ borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur, border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), overflow: 'auto', maxHeight: 'calc(100vh - 320px)' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 900 }}>
          <thead><tr>{['Code', 'Company', 'Contact', 'City', 'GSTIN', 'Referred by / Added by', 'Catalog', 'Status', ''].map((h, i) => <th key={h || 'actions'} style={h === 'Catalog' ? { ...th, textAlign: 'right' } : th}>{h || <span style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>Actions</span>}{i === 0 && <RowCount count={shown.length} />}</th>)}</tr></thead>
          <tbody>
            {loading && <tr><td colSpan={9} style={{ ...td, textAlign: 'center', color: '#a8a29e' }}>Loading…</td></tr>}
            {!loading && !error && shown.length === 0 && <tr><td colSpan={9} style={{ ...td, textAlign: 'center', color: '#a8a29e' }}>{vendors.length ? 'No vendor matches the search — clear it or try a code, GSTIN or city.' : status ? `No ${STATUS_LABEL[status]?.toLowerCase() || ''} vendors — pick another status above, or use + Add Vendor / Import.` : 'No vendors yet — use + Add Vendor or Import a list.'}</td></tr>}
            {shown.map((v) => (
              <tr key={v.id} onClick={() => router.push(recordPath('/dashboard/p2p/vendors', v))} style={{ cursor: 'pointer' }}>
                <td style={{ ...td, fontWeight: 600, color: '#FF7A45', whiteSpace: 'nowrap' }}>{v.code}</td>
                <td style={{ ...td, fontWeight: 600, color: TEXT.heading, maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={v.name}>{v.name}</td>
                <td style={{ ...td, whiteSpace: 'nowrap', maxWidth: 200 }}>
                  {v.contact_name || v.contact_phone ? (
                    <>
                      <div style={{ overflow: 'hidden', textOverflow: 'ellipsis' }} title={v.contact_name || undefined}>{v.contact_name || '—'}</div>
                      <div style={{ fontSize: 12, color: '#5b6472' }}>{v.contact_phone || '—'}</div>
                    </>
                  ) : '—'}
                </td>
                <td style={{ ...td, maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={v.city || undefined}>{v.city || '—'}</td>
                <td style={{ ...td, whiteSpace: 'nowrap' }}>{v.gstin || '—'}</td>
                <td style={{ ...td, whiteSpace: 'nowrap', maxWidth: 200 }}>
                  <div style={{ overflow: 'hidden', textOverflow: 'ellipsis' }} title={v.referred_by_label || undefined}>Referred: {v.referred_by_label || '—'}</div>
                  <div style={{ fontSize: 12, color: '#5b6472', overflow: 'hidden', textOverflow: 'ellipsis' }} title={v.created_by_name || undefined}>Added by {v.created_by_name || '—'}</div>
                </td>
                <td style={{ ...td, textAlign: 'right' }}>{(v.catalog_count ?? 0).toLocaleString('en-IN')}</td>
                <td style={td}><Pill label={STATUS_LABEL[v.status] || v.status} hex={STATUS_HEX[v.status] || '#78716c'} /></td>
                <td style={{ ...td, textAlign: 'right', whiteSpace: 'nowrap' }} onClick={(e) => e.stopPropagation()}><button type="button" onClick={() => router.push(recordPath('/dashboard/p2p/vendors', v))} style={smallSecondaryBtnStyle}>View</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {moreRight && <div aria-hidden="true" style={{ position: 'absolute', top: 1, right: 1, bottom: 1, width: 36, borderRadius: '0 18px 18px 0', pointerEvents: 'none', background: 'linear-gradient(to right, rgba(255,255,255,0), rgba(120,113,108,0.22))' }} />}
      </div>
      {moreRight && <p style={{ fontSize: 12, color: '#5b6472', margin: '6px 0 0', textAlign: 'right' }}>More columns to the right — scroll sideways.</p>}

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
