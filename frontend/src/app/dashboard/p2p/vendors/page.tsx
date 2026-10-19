'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/hooks/useAuth'
import { useCan } from '@/lib/permissions'
import { vendorsApi } from '@/lib/api'
import { ProcurementVendor } from '@/types'
import { TEXT, GLASS, SHADOWS, GRADIENTS } from '@/lib/theme'
import { inputStyle, secondaryBtnStyle } from '@/components/shared/ui'
import P2PNav from '@/components/p2p/P2PNav'
import ExportDialog from '@/components/erp/ExportDialog'
import ImportDialog from '@/components/shared/ImportDialog'
import VendorFormDialog from '@/components/p2p/VendorFormDialog'
import { extractErrorMessages } from '@/lib/validation'
import { recordPath } from '@/lib/recordRef'

const STATUS_HEX: Record<string, string> = { active: '#16a34a', inactive: '#78716c', blocked: '#dc2626' }
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

  useEffect(() => {
    if (!allowed) return
    let cancelled = false
    vendorsApi.list({ status: status || undefined })
      .then((v) => { if (!cancelled) { setVendors(v); setError('') } })
      .catch((err) => { if (!cancelled) setError(extractErrorMessages(err, 'Could not load vendors — reload the page.').join(' ')) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [allowed, status, reload])

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return vendors
    return vendors.filter((v) => [v.name, v.code, v.gstin, v.city, v.contact_name, v.contact_phone].some((x) => (x || '').toLowerCase().includes(q)))
  }, [vendors, search])

  if (isLoading || !allowed) return null

  return (
    <div>
      <P2PNav />
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, marginBottom: 16, flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: TEXT.heading, margin: '0 0 4px' }}>Vendors</h1>
          <p style={{ fontSize: 13, color: TEXT.muted, margin: 0, maxWidth: 640 }}>
            The vendor master shared with Finance — RFQs pick vendors from here, and POs link to them so the vendor&apos;s invoice matches the PO.
            Bank and credit details are kept by Finance (Accounts → Vendors).
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {can('p2p', 'vendors', 'export') && <button type="button" data-tour="vendors-export-btn" onClick={() => setShowExport(true)} style={secondaryBtnStyle}>Export</button>}
          {can('p2p', 'vendors', 'import') && <button type="button" data-tour="vendors-import-btn" onClick={() => setShowImport(true)} style={secondaryBtnStyle}>Import</button>}
          {can('p2p', 'vendors', 'create') && <button type="button" data-tour="vendors-add-btn" onClick={() => setShowAdd(true)}
            style={{ padding: '11px 20px', borderRadius: 12, border: 'none', cursor: 'pointer', background: GRADIENTS.primary, color: '#fff', fontSize: 14, fontWeight: 600 }}>
            + Add Vendor
          </button>}
        </div>
      </div>

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 14 }}>
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name, code, GSTIN, city, contact…" style={{ ...inputStyle, flex: '1 1 280px', maxWidth: 420 }} />
        <select value={status} onChange={(e) => setStatus(e.target.value)} style={{ ...inputStyle, width: 'auto' }}>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
          <option value="blocked">Blocked</option>
          <option value="">All statuses</option>
        </select>
      </div>

      {error && <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>{error}</div>}

      <div style={{ borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur, border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), overflow: 'auto', maxHeight: 'calc(100vh - 320px)' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 900 }}>
          <thead><tr>{['Code', 'Company', 'Contact', 'City', 'GSTIN', 'Catalog', 'Docs', 'Status', ''].map((h) => <th key={h} style={th}>{h}</th>)}</tr></thead>
          <tbody>
            {loading && <tr><td colSpan={9} style={{ ...td, textAlign: 'center', color: '#a8a29e' }}>Loading…</td></tr>}
            {!loading && shown.length === 0 && <tr><td colSpan={9} style={{ ...td, textAlign: 'center', color: '#a8a29e' }}>{vendors.length ? 'No vendor matches the search.' : 'No vendors yet — add one or import a list.'}</td></tr>}
            {shown.map((v) => (
              <tr key={v.id} onClick={() => router.push(recordPath('/dashboard/p2p/vendors', v))} style={{ cursor: 'pointer' }}>
                <td style={{ ...td, fontWeight: 600, color: '#FF7A45', whiteSpace: 'nowrap' }}>{v.code}</td>
                <td style={{ ...td, fontWeight: 600, color: TEXT.heading }}>{v.name}</td>
                <td style={td}>{[v.contact_name, v.contact_phone].filter(Boolean).join(' · ') || '—'}</td>
                <td style={td}>{v.city || '—'}</td>
                <td style={{ ...td, whiteSpace: 'nowrap' }}>{v.gstin || '—'}</td>
                <td style={td}>{v.catalog_count}</td>
                <td style={td}>{v.document_count}</td>
                <td style={td}><span style={{ fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 9999, background: `${STATUS_HEX[v.status] || '#78716c'}1a`, color: STATUS_HEX[v.status] || '#78716c', textTransform: 'capitalize' }}>{v.status}</span></td>
                <td style={td} onClick={(e) => e.stopPropagation()}><span onClick={() => router.push(recordPath('/dashboard/p2p/vendors', v))} style={{ fontSize: 12, fontWeight: 600, color: '#2563eb', cursor: 'pointer' }}>View</span></td>
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
