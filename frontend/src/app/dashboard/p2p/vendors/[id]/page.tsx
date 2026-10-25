'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useAuth } from '@/hooks/useAuth'
import { useCan } from '@/lib/permissions'
import { vendorsApi } from '@/lib/api'
import { ProcurementVendor, VendorCatalogRow, VendorDocumentRow } from '@/types'
import { TEXT, GLASS, SHADOWS } from '@/lib/theme'
import { inputStyle, primaryBtnStyle, secondaryBtnStyle, smallSecondaryBtnStyle, smallDangerBtnStyle, RowCount, Pill, DetailCard, DetailSummary, DetailGroup, DetailRow } from '@/components/shared/ui'
import P2PNav from '@/components/p2p/P2PNav'
import VendorFormDialog from '@/components/p2p/VendorFormDialog'
import ImportDialog, { saveBlob } from '@/components/shared/ImportDialog'
import ConfirmDialog from '@/components/erp/ConfirmDialog'
import { formatDate, formatDateTime } from '@/lib/format'
import { extractErrorMessages } from '@/lib/validation'
import { useRecordId } from '@/lib/recordRef'
import InvalidRecordLink from '@/components/erp/InvalidRecordLink'
import Select from '@/components/shared/Select'
import { FormSheet, SheetSection, SheetIcon, Req, SHEET, sheetBtn, sheetInput, sheetLabel } from '@/components/shared/FormSheet'

const card: React.CSSProperties = {
  borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur,
  border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), padding: 20, marginBottom: 16,
}
const h2: React.CSSProperties = { fontSize: 15, fontWeight: 700, color: TEXT.heading, margin: 0 }
const th: React.CSSProperties = { position: 'sticky', top: 0, background: '#fdf1e6', textAlign: 'left', padding: '8px 10px', fontSize: 11, fontWeight: 700, color: TEXT.secondary, whiteSpace: 'nowrap' }
const td: React.CSSProperties = { padding: '8px 10px', fontSize: 12.5, color: TEXT.body, borderTop: '1px solid rgba(0,0,0,0.05)', verticalAlign: 'top' }

const EMPTY_ITEM = { item_name: '', part_code: '', make: '', unit: '', unit_price: '', currency: 'INR', dimensions: '', technical_spec: '', lead_time_days: '' }
type ItemForm = typeof EMPTY_ITEM

const STATUS_LABEL: Record<string, string> = { active: 'Active', inactive: 'Inactive', blocked: 'Blocked' }
const STATUS_HEX: Record<string, string> = { active: '#16a34a', inactive: '#78716c', blocked: '#dc2626' }
const MSME_ACTIVITY: Record<string, string> = { manufacturing: 'Manufacturing', services: 'Services', trader: 'Trader' }
const cap = (v: string) => `${v[0].toUpperCase()}${v.slice(1)}`

export default function VendorDetailPage() {
  const { user, isLoading } = useAuth()
  const { can, canDelete, canFeature } = useCan()
  const canEditVendor = can('p2p', 'vendors', 'edit')
  // Vendors features (role editor). The catalog is also read by the Purchase
  // desk / Accounts as a lookup — those users (no Vendors › View) aren't governed by them.
  const viaVendorsTab = can('p2p', 'vendors', 'view')
  const vendorFeature = (feature: string, action: 'view' | 'create' | 'edit' | 'delete' | 'import' | 'export') =>
    !viaVendorsTab || canFeature('p2p', 'vendors', feature, action)
  const seeDocs = canFeature('p2p', 'vendors', 'documents', 'view')
  const seeCatalog = vendorFeature('catalog', 'view')
  // Editors always see the rates they maintain (as the backend does).
  const seePrices = !viaVendorsTab || canEditVendor || canFeature('p2p', 'vendors', 'prices', 'view')
  const allowed = !!user && (user.role === 'admin' || !!user.apps?.some((a) => a === 'purchase' || a === 'accounts'))
  const router = useRouter()
  const { id: linkedId, error: linkError } = useRecordId(useParams<{ id: string }>().id)
  const id = linkedId ?? 0
  const [vendor, setVendor] = useState<ProcurementVendor | null>(null)
  const [docs, setDocs] = useState<VendorDocumentRow[]>([])
  const [items, setItems] = useState<VendorCatalogRow[]>([])
  const [docTypes, setDocTypes] = useState<{ value: string; label: string }[]>([])
  const [docType, setDocType] = useState('catalog')
  const [error, setError] = useState('')
  const [editing, setEditing] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [itemForm, setItemForm] = useState<ItemForm | null>(null)
  const [editItemId, setEditItemId] = useState<number | null>(null)
  const [itemError, setItemError] = useState('')
  const [itemSaving, setItemSaving] = useState(false)
  const [showImport, setShowImport] = useState(false)
  const [confirm, setConfirm] = useState<{ kind: 'doc' | 'item'; id: number; name: string } | null>(null)
  const [reload, setReload] = useState(0)

  useEffect(() => {
    if (!allowed || !id) return
    let cancelled = false
    setError('')
    Promise.all([vendorsApi.get(id), seeDocs ? vendorsApi.documents(id) : Promise.resolve([]), seeCatalog ? vendorsApi.catalog(id) : Promise.resolve([]), vendorsApi.meta()])
      .then(([v, d, c, m]) => { if (!cancelled) { setVendor(v); setDocs(d); setItems(c); setDocTypes(m.doc_types) } })
      .catch((err) => { if (!cancelled) setError(extractErrorMessages(err, 'Could not load this vendor — reload the page.').join(' ')) })
    return () => { cancelled = true }
  }, [allowed, id, reload, seeDocs, seeCatalog])

  if (isLoading) return <div><P2PNav /><p role="status" style={{ fontSize: 13, color: TEXT.muted }}>Loading…</p></div>
  if (!allowed) return <div><P2PNav /><p role="alert" style={{ fontSize: 13, color: TEXT.muted }}>You don&apos;t have access to Vendors. Ask an admin to give you Procurement › Vendors › View.</p></div>
  if (linkError) return (<div><P2PNav /><InvalidRecordLink message={linkError} listHref="/dashboard/p2p/vendors" listLabel="Back to vendors" /></div>)
  const fail = (err: unknown, msg: string) => setError(extractErrorMessages(err, msg).join(' '))

  const upload = async (files: File[]) => {
    if (!files.length) return
    setUploading(true)
    setError('')
    try {
      await vendorsApi.uploadDocuments(id, docType, files)
      setReload((x) => x + 1)
    } catch (err) { fail(err, 'Could not upload the files — try again.') } finally { setUploading(false) }
  }

  const saveItem = async () => {
    if (!itemForm) return
    if (!itemForm.item_name.trim()) { setItemError('Item name is required.'); return }
    const payload = {
      ...itemForm,
      unit_price: itemForm.unit_price === '' ? null : Number(itemForm.unit_price),
      lead_time_days: itemForm.lead_time_days === '' ? null : Number(itemForm.lead_time_days),
    }
    setItemSaving(true)
    setItemError('')
    try {
      if (editItemId) await vendorsApi.updateCatalogItem(id, editItemId, payload)
      else await vendorsApi.addCatalogItem(id, payload)
      setItemForm(null)
      setEditItemId(null)
      setReload((x) => x + 1)
    } catch (err) { setItemError(extractErrorMessages(err, 'Could not save the item — check the values and try again.').join(' ')) } finally { setItemSaving(false) }
  }
  const closeItem = () => { if (!itemSaving) { setItemForm(null); setEditItemId(null); setItemError('') } }

  const doDelete = async () => {
    const c = confirm
    setConfirm(null)
    if (!c) return
    try {
      if (c.kind === 'doc') await vendorsApi.deleteDocument(id, c.id)
      else await vendorsApi.deleteCatalogItem(id, c.id)
      setReload((x) => x + 1)
    } catch (err) { fail(err, 'Could not delete — try again.') }
  }

  return (
    <div>
      <P2PNav />
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, marginBottom: 16, flexWrap: 'wrap' }}>
        <div style={{ minWidth: 0 }}>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: TEXT.heading, margin: '0 0 4px' }}>{vendor?.code || 'Vendor'}</h1>
          <p style={{ fontSize: 13, color: TEXT.secondary, margin: 0 }}>Vendor master — contact, tax details, documents and the items this vendor sells.</p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {vendor && canEditVendor && <button type="button" style={primaryBtnStyle} onClick={() => setEditing(true)}>Edit</button>}
          <button type="button" style={secondaryBtnStyle} onClick={() => router.push('/dashboard/p2p/vendors')}>← Back</button>
        </div>
      </div>

      {error && (
        <div role="alert" style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <span>{error}</span>
          {!vendor && <button type="button" onClick={() => setReload((x) => x + 1)} style={smallSecondaryBtnStyle}>Try again</button>}
        </div>
      )}
      {!vendor && !error && <p role="status" style={{ fontSize: 13, color: TEXT.muted }}>Loading vendor…</p>}

      {vendor && (() => {
        const m = vendor as unknown as { msme_category?: string | null; udyam_number?: string | null; msme_activity?: string | null; payment_days?: number | null }
        const place = [vendor.city, vendor.state].filter(Boolean).join(', ')
        return (
          <DetailCard>
            <DetailSummary
              title={vendor.name}
              text={`Supplier${place ? ` in ${place}` : ''}${seeCatalog ? ` with ${vendor.catalog_count} catalog item${vendor.catalog_count === 1 ? '' : 's'}` : ''}${seeDocs ? `${seeCatalog ? ' and' : ' with'} ${vendor.document_count} document${vendor.document_count === 1 ? '' : 's'} on file` : ''}.`}
              meta={<>
                <Pill label={STATUS_LABEL[vendor.status] || vendor.status} hex={STATUS_HEX[vendor.status] || '#78716c'} />
                {m.msme_category && <Pill label={`MSME · ${cap(m.msme_category)}`} hex="#0891b2" />}
                {vendor.created_by_name && <span>Added by {vendor.created_by_name}{vendor.created_at ? ` on ${formatDate(vendor.created_at)}` : ''}</span>}
              </>}
            />
            <DetailGroup title="Contact">
              <DetailRow label="Contact person">{vendor.contact_name}</DetailRow>
              <DetailRow label="Contact number">{vendor.contact_phone}</DetailRow>
              <DetailRow label="Email">{vendor.contact_email}</DetailRow>
            </DetailGroup>
            <DetailGroup title="Address">
              <DetailRow label="Address">{[vendor.address, vendor.city, vendor.state, vendor.pin_code].filter(Boolean).join(', ')}</DetailRow>
            </DetailGroup>
            <DetailGroup title="GST & website">
              <DetailRow label="GSTIN">{vendor.gstin}</DetailRow>
              <DetailRow label="Website">{vendor.website}</DetailRow>
            </DetailGroup>
            <DetailGroup title="MSME & payment">
              <DetailRow label="MSME category">{m.msme_category ? cap(m.msme_category) : 'Not an MSME'}</DetailRow>
              {m.msme_category && <DetailRow label="MSME activity">{m.msme_activity ? MSME_ACTIVITY[m.msme_activity] || m.msme_activity : null}</DetailRow>}
              {m.msme_category && <DetailRow label="Udyam registration no.">{m.udyam_number}</DetailRow>}
              <DetailRow label="Payment terms">{m.msme_category ? `Pay within ${Math.min(m.payment_days ?? 15, 45)} days` : m.payment_days != null ? `${m.payment_days} days` : null}</DetailRow>
            </DetailGroup>
            <DetailGroup title="Referral & record" last={!vendor.terms_conditions}>
              <DetailRow label="Referred by">{vendor.referred_by_label}</DetailRow>
              <DetailRow label="Added by">{vendor.created_by_name ? `${vendor.created_by_name}${vendor.created_at ? ` · ${formatDateTime(vendor.created_at)}` : ''}` : null}</DetailRow>
            </DetailGroup>
            {vendor.terms_conditions && (
              <DetailGroup last>
                <DetailRow label="Vendor's terms & conditions">{vendor.terms_conditions}</DetailRow>
              </DetailGroup>
            )}
          </DetailCard>
        )
      })()}

      {seeDocs && (
      <div style={card}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
          <h2 style={h2}>Documents</h2>
          <span style={{ fontSize: 12, color: TEXT.muted }}>Catalog PDF, GST certificate, PAN, MSME, cancelled cheque…</span>
          {canEditVendor && canFeature('p2p', 'vendors', 'documents', 'create') && <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
            <Select value={docType} onChange={(e) => setDocType(e.target.value)} style={{ ...inputStyle, width: 200 }}>
              {docTypes.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}
            </Select>
            <label style={{ ...secondaryBtnStyle, cursor: uploading ? 'default' : 'pointer', opacity: uploading ? 0.6 : 1 }}>
              {uploading ? 'Uploading…' : '📎 Upload'}
              <input type="file" multiple hidden disabled={uploading} onChange={(e) => { upload(Array.from(e.target.files || [])); e.target.value = '' }} />
            </label>
          </div>}
        </div>
        {docs.length === 0 ? <p style={{ fontSize: 13, color: TEXT.muted, margin: 0 }}>No documents yet{canEditVendor && canFeature('p2p', 'vendors', 'documents', 'create') ? ' — pick the document type and use Upload.' : '.'}</p> : (
          <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', minWidth: 560, borderCollapse: 'collapse' }}>
            <thead><tr>{['File', 'Type', 'Uploaded by', 'On', ''].map((h, i) => <th key={h} style={th}>{h}{i === 0 && <RowCount count={docs.length} />}</th>)}</tr></thead>
            <tbody>
              {docs.map((d) => (
                <tr key={d.id}>
                  <td style={td}><button type="button" onClick={() => vendorsApi.openDocument(id, d.id).catch((err) => fail(err, 'Could not open the file.'))} style={{ background: 'none', border: 'none', padding: 0, color: '#2563eb', cursor: 'pointer', fontSize: 12.5, textAlign: 'left' }}>📎 {d.file_name}</button></td>
                  <td style={td}>{d.doc_type_label}</td>
                  <td style={td}>{d.uploaded_by_name || '—'}</td>
                  <td style={{ ...td, whiteSpace: 'nowrap' }}>{formatDateTime(d.created_at)}</td>
                  {/* Company rule: 'Delete' on Vendors AND only a document you uploaded. */}
                  <td style={td}>{canDelete('p2p', 'vendors', d.uploaded_by_id ?? null) && canFeature('p2p', 'vendors', 'documents', 'delete') && <button type="button" onClick={() => setConfirm({ kind: 'doc', id: d.id, name: d.file_name })} style={smallDangerBtnStyle}>Delete</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        )}
      </div>
      )}

      {seeCatalog && (
      <div style={card}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
          <h2 style={h2}>Catalog — items this vendor sells</h2>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
            {can('p2p', 'vendors', 'export') && vendorFeature('catalog', 'export') && seePrices && <button type="button" style={secondaryBtnStyle} onClick={() => vendorsApi.exportCatalog(id).then((b) => saveBlob(b, `${vendor?.code || 'vendor'}_catalog.xlsx`)).catch((err) => fail(err, 'Export failed.'))}>Export</button>}
            {can('p2p', 'vendors', 'import') && vendorFeature('catalog', 'import') && <button type="button" style={secondaryBtnStyle} onClick={() => setShowImport(true)}>Import</button>}
            {canEditVendor && vendorFeature('catalog', 'create') && <button type="button" style={primaryBtnStyle} onClick={() => { setItemForm({ ...EMPTY_ITEM }); setEditItemId(null); setItemError('') }}>+ Add item</button>}
          </div>
        </div>

        {items.length === 0 ? <p style={{ fontSize: 13, color: TEXT.muted, margin: 0 }}>No items yet — add them one by one or import the vendor&apos;s list.</p> : (
          <div style={{ overflow: 'auto', maxHeight: 460 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 880 }}>
              <thead><tr>{['Item', 'Part code', 'Make', 'Unit', ...(seePrices ? ['Price'] : []), 'Dimensions', 'Technical spec', 'Lead time', ''].map((h, i) => <th key={h} style={h === 'Price' ? { ...th, textAlign: 'right' } : th}>{h}{i === 0 && <RowCount count={items.length} />}</th>)}</tr></thead>
              <tbody>
                {items.map((c) => (
                  <tr key={c.id}>
                    <td style={{ ...td, fontWeight: 600 }}>{c.item_name}</td>
                    <td style={td}>{c.part_code || '—'}</td>
                    <td style={td}>{c.make || '—'}</td>
                    <td style={td}>{c.unit || '—'}</td>
                    {seePrices && <td style={{ ...td, whiteSpace: 'nowrap', textAlign: 'right' }}>{c.unit_price != null ? `${c.currency} ${c.unit_price.toLocaleString('en-IN')}` : '—'}</td>}
                    <td style={td}>{c.dimensions || '—'}</td>
                    <td style={{ ...td, maxWidth: 260 }} title={c.technical_spec || undefined}><span style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{c.technical_spec || '—'}</span></td>
                    <td style={td}>{c.lead_time_days != null ? `${c.lead_time_days} days` : '—'}</td>
                    <td style={{ ...td, whiteSpace: 'nowrap' }}>
                      <div style={{ display: 'flex', gap: 6 }}>
                      {/* A catalog line is part of the vendor: add / edit / remove all need 'Edit'. */}
                      {canEditVendor && vendorFeature('catalog', 'edit') && <button type="button" style={smallSecondaryBtnStyle} onClick={() => {
                        setEditItemId(c.id)
                        setItemError('')
                        setItemForm({
                          item_name: c.item_name, part_code: c.part_code || '', make: c.make || '', unit: c.unit || '',
                          unit_price: c.unit_price != null ? String(c.unit_price) : '', currency: c.currency || 'INR',
                          dimensions: c.dimensions || '', technical_spec: c.technical_spec || '',
                          lead_time_days: c.lead_time_days != null ? String(c.lead_time_days) : '',
                        })
                      }}>Edit</button>}
                      {canEditVendor && vendorFeature('catalog', 'delete') && <button type="button" style={smallDangerBtnStyle} onClick={() => setConfirm({ kind: 'item', id: c.id, name: c.item_name })}>Delete</button>}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      )}

      {itemForm && (
        <FormSheet width={640} icon={editItemId ? 'edit' : 'box'} title={editItemId ? 'Edit catalog item' : 'Add catalog item'}
          subtitle={`An item ${vendor?.name || 'this vendor'} sells — RFQs and POs can pick it from the catalog.`}
          onClose={closeItem} busy={itemSaving}
          footer={<>
            <button type="button" onClick={closeItem} disabled={itemSaving} style={sheetBtn('secondary', SHEET.INK, itemSaving)}>Cancel</button>
            <button type="button" onClick={saveItem} disabled={itemSaving} style={sheetBtn('primary', SHEET.BLUE, itemSaving)}><SheetIcon name={editItemId ? 'check' : 'plus'} size={16} />{itemSaving ? 'Saving…' : editItemId ? 'Save item' : 'Add item'}</button>
          </>}>
          <div style={{ padding: '20px 24px' }}>
            {itemError && <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>{itemError}</div>}
            {([
              ['box', 'Item', [['item_name', 'Item name', '1 1 100%'], ['part_code', 'Part code', '1 1 160px'], ['make', 'Make', '1 1 160px'], ['dimensions', 'Dimensions', '1 1 180px']]],
              ['rupee', 'Price & Lead Time', [['unit', 'Unit', '0 1 100px'], ['unit_price', 'Price', '0 1 130px'], ['currency', 'Currency', '0 1 100px'], ['lead_time_days', 'Lead time (days)', '0 1 140px']]],
              ['doc', 'Technical specification', [['technical_spec', '', '1 1 100%']]],
            ] as const).map(([icon, title, fields]) => (
              <SheetSection key={title} icon={icon} title={title}>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
                  {fields.map(([k, l, flex]) => (
                    <div key={k} style={{ flex, minWidth: 0 }}>
                      {l && <label style={sheetLabel}>{l}{k === 'item_name' && <> <Req /></>}</label>}
                      {k === 'technical_spec'
                        ? <textarea value={itemForm[k]} rows={3} onChange={(e) => setItemForm((f) => (f ? { ...f, [k]: e.target.value } : f))} style={{ ...sheetInput, resize: 'vertical' }} />
                        : <input value={itemForm[k]} type={k === 'unit_price' || k === 'lead_time_days' ? 'number' : 'text'} autoFocus={k === 'item_name'}
                          onChange={(e) => setItemForm((f) => (f ? { ...f, [k]: e.target.value } : f))} style={sheetInput} />}
                    </div>
                  ))}
                </div>
              </SheetSection>
            ))}
          </div>
        </FormSheet>
      )}
      {editing && vendor && <VendorFormDialog vendor={vendor} onClose={() => setEditing(false)} onSaved={(v) => { setVendor(v); setEditing(false) }} />}
      {showImport && (
        <ImportDialog title={`Import catalog — ${vendor?.name || ''}`} templateName="vendor_catalog_template.csv" getTemplate={() => vendorsApi.catalogTemplate(id)}
          intro={<>One item per row: item name, part code, make, unit, price, dimensions, technical specification, lead time. An item already in the catalog (same name + part code) is updated with the new values.</>}
          upload={async (f) => {
            const r = await vendorsApi.importCatalog(id, f)
            return { summary: [`Added: ${r.added}`, `Updated: ${r.updated}`], errors: r.errors.map((e) => ({ where: `Row ${e.row}`, reason: e.reason })) }
          }}
          onClose={() => setShowImport(false)} onImported={() => setReload((x) => x + 1)} />
      )}
      <ConfirmDialog open={!!confirm} title={confirm?.kind === 'doc' ? 'Delete document?' : 'Delete catalog item?'}
        message={`Remove "${confirm?.name || ''}" from ${vendor?.name || 'this vendor'}?`} onConfirm={doDelete} onCancel={() => setConfirm(null)} />
    </div>
  )
}
