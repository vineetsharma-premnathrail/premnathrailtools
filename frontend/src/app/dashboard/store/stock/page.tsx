'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRequireApp } from '@/hooks/useAuth'
import { storeApi } from '@/lib/api'
import { StoreDocType, StoreItem, StoreLocation, StoreStockBalance } from '@/types'
import { TEXT, BRAND, GLASS, SHADOWS } from '@/lib/theme'
import { inputStyle, primaryBtnStyle, secondaryBtnStyle } from '@/components/shared/ui'
import StoreNav from '@/components/store/StoreNav'
import MessageDialog from '@/components/erp/MessageDialog'
import SearchableSelect from '@/components/erp/SearchableSelect'
import StockImportDialog from '@/components/store/StockImportDialog'
import { extractErrorMessages } from '@/lib/validation'

// Entry types come from Store → Settings → Stock Entry Types. Adjustments
// are not posted here — they go through Store → Adjustments (approval +
// adjustment number) so every one shows in that list.

const QUARANTINE_DISPOSITIONS = [
  { value: 'scrap', label: 'Scrap — write it off' },
  { value: 'vendor_return', label: 'Returned to vendor' },
  { value: 'release', label: 'Release to usable stock (passed re-inspection)' },
]

export default function StoreStockPage() {
  const { isAuthorized, isLoading } = useRequireApp('store')
  const [balances, setBalances] = useState<StoreStockBalance[]>([])
  const [items, setItems] = useState<StoreItem[]>([])
  const [locations, setLocations] = useState<StoreLocation[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')

  const [showModal, setShowModal] = useState(false)
  const [entryTypes, setEntryTypes] = useState<StoreDocType[]>([])
  const [txnType, setTxnType] = useState('')
  const [clearing, setClearing] = useState<StoreStockBalance | null>(null)
  const [clearQty, setClearQty] = useState('')
  const [clearDisposition, setClearDisposition] = useState('scrap')
  const [clearRemarks, setClearRemarks] = useState('')
  const [clearErrors, setClearErrors] = useState<string[]>([])
  const [itemId, setItemId] = useState('')
  const [locationId, setLocationId] = useState('')
  const [quantity, setQuantity] = useState('')
  const [batchNumber, setBatchNumber] = useState('')
  const [referenceNumber, setReferenceNumber] = useState('')
  const [vendorName, setVendorName] = useState('')
  const [vendorOptions, setVendorOptions] = useState<string[]>([])
  const [remarks, setRemarks] = useState('')
  const [saving, setSaving] = useState(false)
  const [formErrors, setFormErrors] = useState<string[]>([])
  const [showImport, setShowImport] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState('')

  const [search, setSearch] = useState('')
  const [filterLocation, setFilterLocation] = useState('')
  const [filterCategory, setFilterCategory] = useState('')
  const [filterSubcategory, setFilterSubcategory] = useState('')

  const itemById = useMemo(() => new Map(items.map((i) => [i.id, i])), [items])
  const categories = useMemo(
    () => Array.from(new Set(items.map((i) => i.category).filter(Boolean) as string[])).sort(),
    [items],
  )
  const subcategories = useMemo(
    () => Array.from(new Set(
      items.filter((i) => !filterCategory || i.category === filterCategory)
        .map((i) => i.subcategory).filter(Boolean) as string[],
    )).sort(),
    [items, filterCategory],
  )

  const matches = (row: { item_id: number; location_id: number; item_code?: string | null; item_name?: string | null; location_name?: string | null; vendor_name?: string | null }) => {
    if (filterLocation && String(row.location_id) !== filterLocation) return false
    const item = itemById.get(row.item_id)
    if (filterCategory && item?.category !== filterCategory) return false
    if (filterSubcategory && item?.subcategory !== filterSubcategory) return false
    const q = search.trim().toLowerCase()
    if (q) {
      const hay = [row.item_code, row.item_name, row.location_name, row.vendor_name, item?.category, item?.subcategory].filter(Boolean).join(' ').toLowerCase()
      if (!hay.includes(q)) return false
    }
    return true
  }
  const filteredBalances = balances.filter(matches)
  const hasFilters = !!(search || filterLocation || filterCategory || filterSubcategory)
  const clearFilters = () => {
    setSearch(''); setFilterLocation(''); setFilterCategory(''); setFilterSubcategory('')
  }

  // Exports exactly what the page shows (same search + filters).
  const exportExcel = async () => {
    setExporting(true)
    try {
      const blob = await storeApi.exportStock({
        search: search.trim() || undefined,
        location_id: filterLocation ? Number(filterLocation) : undefined,
        category: filterCategory || undefined,
        subcategory: filterSubcategory || undefined,
      })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `stock_${new Date().toISOString().slice(0, 10)}.xlsx`
      a.click()
      URL.revokeObjectURL(url)
    } catch (err) {
      setExportError(extractErrorMessages(err, 'Export failed.').join(' '))
    } finally {
      setExporting(false)
    }
  }

  const load = async () => {
    setLoading(true)
    try {
      const [b, i, l, e] = await Promise.all([
        storeApi.listStockBalances(),
        storeApi.listItems(),
        storeApi.listLocations(),
        storeApi.listDocTypes('stock_entry'),
      ])
      setEntryTypes(e)
      setBalances(b)
      setItems(i)
      setLocations(l)
    } catch (err) {
      setLoadError(extractErrorMessages(err, 'Failed to load stock data.').join(' '))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (isAuthorized) load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthorized])

  const openModal = () => {
    setTxnType(entryTypes[0]?.value || '')
    setItemId('')
    setLocationId('')
    setQuantity('')
    setBatchNumber('')
    setReferenceNumber('')
    setVendorName('')
    setRemarks('')
    setFormErrors([])
    setShowModal(true)
    storeApi.listStockVendorOptions().then(setVendorOptions).catch(() => setVendorOptions([]))
  }

  // Vendor applies to stock coming in (receipts and other "in" entry types).
  const isStockIn = entryTypes.find((t) => t.value === txnType)?.stock_effect === 'in'

  const handleCreate = async () => {
    const problems: string[] = []
    if (!txnType) problems.push('Entry type is required — add one under Settings → Stock Entry Types.')
    if (!itemId) problems.push('Item is required.')
    if (!locationId) problems.push('Store is required.')
    if (!quantity || Number(quantity) <= 0) problems.push('Quantity must be greater than zero.')
    if (problems.length) {
      setFormErrors(problems)
      return
    }
    setSaving(true)
    setFormErrors([])
    try {
      await storeApi.createStockTransaction({
        item_id: Number(itemId),
        location_id: Number(locationId),
        entry_type: txnType,
        quantity: Number(quantity),
        batch_number: batchNumber.trim() || undefined,
        reference_number: referenceNumber.trim() || undefined,
        vendor_name: isStockIn ? vendorName.trim() || undefined : undefined,
        remarks: remarks.trim() || undefined,
      })
      setShowModal(false)
      load()
    } catch (err) {
      setFormErrors(extractErrorMessages(err, 'Failed to post stock entry.'))
    } finally {
      setSaving(false)
    }
  }

  const openClear = (b: StoreStockBalance) => {
    setClearing(b)
    setClearQty(String(b.quarantine_qty))
    setClearDisposition('scrap')
    setClearRemarks('')
    setClearErrors([])
  }

  const handleClear = async () => {
    if (!clearing) return
    const qty = Number(clearQty)
    if (!qty || qty <= 0) { setClearErrors(['Quantity must be greater than zero.']); return }
    if (qty > clearing.quarantine_qty) { setClearErrors([`Only ${clearing.quarantine_qty} ${clearing.uom || ''} is in quarantine.`]); return }
    setSaving(true)
    setClearErrors([])
    try {
      await storeApi.clearQuarantine({
        item_id: clearing.item_id, location_id: clearing.location_id, quantity: qty,
        disposition: clearDisposition, remarks: clearRemarks.trim() || undefined,
      })
      setClearing(null)
      load()
    } catch (err) {
      setClearErrors(extractErrorMessages(err, 'Failed to clear quarantine.'))
    } finally {
      setSaving(false)
    }
  }

  if (isLoading || !isAuthorized) return null

  return (
    <div>
      <StoreNav />

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
        <div>
          <p style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 4px' }}>
            Store &amp; Inventory
          </p>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: TEXT.heading, margin: '0 0 8px' }}>Stock</h1>
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          <button data-tour="stock-export-btn" onClick={exportExcel} disabled={exporting} style={{ ...secondaryBtnStyle, opacity: exporting ? 0.7 : 1 }}>{exporting ? 'Exporting…' : 'Export'}</button>
          <button data-tour="stock-import-btn" onClick={() => setShowImport(true)} style={secondaryBtnStyle}>Import</button>
          <button data-tour="stock-add-btn" onClick={openModal} style={primaryBtnStyle}>
            <span style={{ fontSize: 17, lineHeight: 1, marginRight: 6 }}>+</span> Record Stock Entry
          </button>
        </div>
      </div>

      <StockImportDialog open={showImport} onClose={() => setShowImport(false)} onImported={load} />
      <MessageDialog open={!!exportError} variant="error" title="Export Failed" message={exportError} onClose={() => setExportError('')} />

      <MessageDialog open={!!loadError} variant="error" title="Failed to Load Stock Data" message={loadError} onClose={() => setLoadError('')} actionLabel="Reload" onAction={() => window.location.reload()} />

      {showModal && (
        <div onClick={() => !saving && setShowModal(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: '#fff', borderRadius: 16, maxWidth: 460, width: '100%', padding: 24 }}>
            <h2 style={{ fontSize: 16, fontWeight: 700, margin: '0 0 16px 0', color: TEXT.heading }}>Record Stock Entry</h2>

            <div style={{ marginBottom: 14 }}>
              <label style={{ fontSize: 12, fontWeight: 700, color: TEXT.secondary, marginBottom: 6, display: 'block' }}>Entry Type *</label>
              <select data-tour="stock-txn-type" style={inputStyle} value={txnType} onChange={(e) => setTxnType(e.target.value)}>
                {entryTypes.map((t) => <option key={t.value} value={t.value}>{t.label} — {t.stock_effect === 'in' ? 'stock in' : 'stock out'}</option>)}
              </select>
            </div>
            <div style={{ marginBottom: 14 }}>
              <label style={{ fontSize: 12, fontWeight: 700, color: TEXT.secondary, marginBottom: 6, display: 'block' }}>Item *</label>
              <div data-tour="stock-item">
                <SearchableSelect
                  value={itemId}
                  onChange={setItemId}
                  options={items.map((i) => ({ value: String(i.id), label: `${i.item_code} — ${i.item_name}` }))}
                  placeholder="— Select —"
                />
              </div>
            </div>
            <div style={{ marginBottom: 14 }}>
              <label style={{ fontSize: 12, fontWeight: 700, color: TEXT.secondary, marginBottom: 6, display: 'block' }}>Store *</label>
              <select data-tour="stock-location" style={inputStyle} value={locationId} onChange={(e) => setLocationId(e.target.value)}>
                <option value="">— Select —</option>
                {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
              </select>
            </div>
            <div style={{ display: 'flex', gap: 10, marginBottom: 14 }}>
              <div style={{ flex: 1 }}>
                <label style={{ fontSize: 12, fontWeight: 700, color: TEXT.secondary, marginBottom: 6, display: 'block' }}>Quantity *</label>
                <input data-tour="stock-quantity" type="number" style={inputStyle} value={quantity} onChange={(e) => setQuantity(e.target.value)} />
              </div>
              <div style={{ flex: 1 }}>
                <label style={{ fontSize: 12, fontWeight: 700, color: TEXT.secondary, marginBottom: 6, display: 'block' }}>Batch Number</label>
                <input style={inputStyle} value={batchNumber} onChange={(e) => setBatchNumber(e.target.value)} />
              </div>
            </div>
            {isStockIn && (
              <div style={{ marginBottom: 14 }}>
                <label style={{ fontSize: 12, fontWeight: 700, color: TEXT.secondary, marginBottom: 6, display: 'block' }}>Vendor Name</label>
                <input data-tour="stock-vendor" list="stock-vendor-options" style={inputStyle} value={vendorName} onChange={(e) => setVendorName(e.target.value)} placeholder="Type or pick the supplier" />
                <datalist id="stock-vendor-options">
                  {vendorOptions.map((v) => <option key={v} value={v} />)}
                </datalist>
              </div>
            )}
            <div style={{ marginBottom: 14 }}>
              <label style={{ fontSize: 12, fontWeight: 700, color: TEXT.secondary, marginBottom: 6, display: 'block' }}>Invoice Number</label>
              <input data-tour="stock-reference" style={inputStyle} value={referenceNumber} onChange={(e) => setReferenceNumber(e.target.value)} placeholder="Supplier invoice / challan number" />
            </div>
            <div style={{ marginBottom: 14 }}>
              <label style={{ fontSize: 12, fontWeight: 700, color: TEXT.secondary, marginBottom: 6, display: 'block' }}>Remarks</label>
              <textarea style={{ ...inputStyle, minHeight: 60, resize: 'vertical' }} value={remarks} onChange={(e) => setRemarks(e.target.value)} />
            </div>

            {formErrors.length > 0 && (
              <div style={{ padding: '10px 14px', marginBottom: 14, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
                {formErrors.map((e, i) => <div key={i}>{e}</div>)}
              </div>
            )}

            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button onClick={() => setShowModal(false)} disabled={saving} style={secondaryBtnStyle}>Cancel</button>
              <button data-tour="stock-save-btn" onClick={handleCreate} disabled={saving} style={{ ...primaryBtnStyle, opacity: saving ? 0.7 : 1 }}>{saving ? 'Posting…' : 'Post Entry'}</button>
            </div>
          </div>
        </div>
      )}

      {clearing && (
        <div onClick={() => !saving && setClearing(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: '#fff', borderRadius: 16, maxWidth: 440, width: '100%', padding: 24 }}>
            <h2 style={{ fontSize: 16, fontWeight: 700, margin: '0 0 4px 0', color: TEXT.heading }}>Clear Quarantine</h2>
            <p style={{ fontSize: 12.5, color: TEXT.muted, margin: '0 0 16px' }}>{clearing.item_code} — {clearing.item_name} at {clearing.location_name} · {clearing.quarantine_qty} {clearing.uom} held</p>
            <div style={{ marginBottom: 14 }}>
              <label style={{ fontSize: 12, fontWeight: 700, color: TEXT.secondary, marginBottom: 6, display: 'block' }}>What happened to it? *</label>
              <select style={inputStyle} value={clearDisposition} onChange={(e) => setClearDisposition(e.target.value)}>
                {QUARANTINE_DISPOSITIONS.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}
              </select>
            </div>
            <div style={{ marginBottom: 14 }}>
              <label style={{ fontSize: 12, fontWeight: 700, color: TEXT.secondary, marginBottom: 6, display: 'block' }}>Quantity *</label>
              <input type="number" style={{ ...inputStyle, maxWidth: 160 }} value={clearQty} onChange={(e) => setClearQty(e.target.value)} />
            </div>
            <div style={{ marginBottom: 14 }}>
              <label style={{ fontSize: 12, fontWeight: 700, color: TEXT.secondary, marginBottom: 6, display: 'block' }}>Remarks</label>
              <input style={inputStyle} value={clearRemarks} onChange={(e) => setClearRemarks(e.target.value)} placeholder="Scrap note no. / vendor return challan / QC report" />
            </div>
            {clearErrors.length > 0 && (
              <div style={{ padding: '10px 14px', marginBottom: 14, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
                {clearErrors.map((e, i) => <div key={i}>{e}</div>)}
              </div>
            )}
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button onClick={() => setClearing(null)} disabled={saving} style={secondaryBtnStyle}>Cancel</button>
              <button onClick={handleClear} disabled={saving} style={{ ...primaryBtnStyle, opacity: saving ? 0.7 : 1 }}>{saving ? 'Saving…' : 'Clear'}</button>
            </div>
          </div>
        </div>
      )}

      <div data-tour="stock-filters" style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center', marginBottom: 18 }}>
        <input
          style={{ ...inputStyle, flex: '2 1 220px', width: 'auto' }}
          placeholder="Search item code, name, store…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select style={{ ...inputStyle, flex: '1 1 150px', width: 'auto' }} value={filterLocation} onChange={(e) => setFilterLocation(e.target.value)}>
          <option value="">All stores</option>
          {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
        </select>
        <select style={{ ...inputStyle, flex: '1 1 150px', width: 'auto' }} value={filterCategory} onChange={(e) => { setFilterCategory(e.target.value); setFilterSubcategory('') }}>
          <option value="">All categories</option>
          {categories.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <select style={{ ...inputStyle, flex: '1 1 150px', width: 'auto' }} value={filterSubcategory} onChange={(e) => setFilterSubcategory(e.target.value)}>
          <option value="">All subcategories</option>
          {subcategories.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        {hasFilters && <button onClick={clearFilters} style={secondaryBtnStyle}>Clear</button>}
      </div>

      <p style={{ fontSize: 12, fontWeight: 700, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 10px' }}>Current Balances</p>
      <div data-tour="stock-balances-table" style={{ borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur, border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), overflow: 'auto', maxHeight: 'calc(100vh - 300px)', minHeight: 200 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 760 }}>
          <thead>
            <tr>
              {['Item', 'Store', 'On Hand', 'Reserved', 'Available', 'Quarantine'].map((h) => (
                <th key={h} style={{ position: 'sticky', top: 0, background: '#fdf1e6', zIndex: 1, textAlign: 'left', padding: '12px 16px', fontSize: 11, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={6} style={{ padding: 24, textAlign: 'center', color: TEXT.muted, fontSize: 13 }}>Loading…</td></tr>}
            {!loading && filteredBalances.length === 0 && (
              <tr><td colSpan={6} style={{ padding: 24, textAlign: 'center', color: TEXT.muted, fontSize: 13 }}>{hasFilters ? 'No balances match the filters.' : 'No stock recorded yet.'}</td></tr>
            )}
            {!loading && filteredBalances.map((b) => (
              <tr key={b.id} style={{ borderTop: '1px solid rgba(0,0,0,0.05)' }}>
                <td style={{ padding: '12px 16px', fontSize: 13, fontWeight: 600, color: TEXT.body }}>{b.item_code} — {b.item_name}</td>
                <td style={{ padding: '12px 16px', fontSize: 13, color: TEXT.secondary }}>{b.location_name}</td>
                <td style={{ padding: '12px 16px', fontSize: 13, color: TEXT.secondary }}>{b.on_hand_qty} {b.uom}</td>
                <td style={{ padding: '12px 16px', fontSize: 13, color: TEXT.secondary }}>{b.reserved_qty} {b.uom}</td>
                <td style={{ padding: '12px 16px', fontSize: 13, fontWeight: 600, color: BRAND.primaryActive }}>{b.available_qty} {b.uom}</td>
                <td style={{ padding: '12px 16px', fontSize: 13, color: b.quarantine_qty > 0 ? '#d97706' : TEXT.muted, whiteSpace: 'nowrap' }}>
                  {b.quarantine_qty > 0 ? (
                    <>
                      {b.quarantine_qty} {b.uom}
                      <span onClick={() => openClear(b)} style={{ marginLeft: 10, color: '#FF6A2A', fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }}>Clear</span>
                    </>
                  ) : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

    </div>
  )
}
