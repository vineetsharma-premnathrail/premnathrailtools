'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRequireApp } from '@/hooks/useAuth'
import { storeApi } from '@/lib/api'
import { StoreItem, StoreLocation, StoreStockBalance } from '@/types'
import { TEXT, BRAND, GLASS, SHADOWS } from '@/lib/theme'
import { inputStyle, secondaryBtnStyle } from '@/components/shared/ui'
import { FormSheet, SheetSection, SheetIcon, Optional, Req, SHEET, sheetBtn, sheetInput, sheetLabel, sheetHint } from '@/components/shared/FormSheet'
import StoreNav from '@/components/store/StoreNav'
import MessageDialog from '@/components/erp/MessageDialog'
import StockImportDialog from '@/components/store/StockImportDialog'
import StockAsOfPanel from '@/components/store/StockAsOfPanel'
import { extractErrorMessages } from '@/lib/validation'
import { useCan } from '@/lib/permissions'
import Select from '@/components/shared/Select'

// No hand-made stock posting here (2026-10-12, SAP standard): every movement
// has its own document — GRN, Issues, Returns, Transfers, Adjustments,
// Physical Count. Opening stock at go-live is the admin-only Opening Stock
// Import. Blocked stock is still disposed of with Clear Quarantine.

const QUARANTINE_DISPOSITIONS = [
  { value: 'scrap', label: 'Scrap — write it off' },
  { value: 'vendor_return', label: 'Returned to vendor' },
  { value: 'release', label: 'Release to usable stock (passed re-inspection)' },
]


export default function StoreStockPage() {
  const { isAuthorized, isLoading, user } = useRequireApp('store')
  // Opening Stock Import (stock already on the shelves at go-live) is admin only.
  const isAdmin = user?.role === 'admin'
  const { can, canFeature } = useCan()
  // Stock is view / export only in the Permission Matrix — clearing blocked
  // stock is Adjustments › Clear blocked stock › Create.
  const canPost = canFeature('store', 'adjustments', 'quarantine_clear', 'create')
  // Store › Items › Stock value & rates (sensitive): the ₹ tiles / columns.
  const seeValues = canFeature('store', 'items', 'stock_values', 'view')
  const seeAsOf = canFeature('store', 'stock', 'as_of', 'view')
  const summaryCols = seeValues ? 7 : 5
  const [balances, setBalances] = useState<StoreStockBalance[]>([])
  const [items, setItems] = useState<StoreItem[]>([])
  const [locations, setLocations] = useState<StoreLocation[]>([])
  const [inTransit, setInTransit] = useState<number | null>(null)
  const [myPlants, setMyPlants] = useState<{ restricted: boolean; plant_names: string[] } | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')

  const [clearing, setClearing] = useState<StoreStockBalance | null>(null)
  const [clearQty, setClearQty] = useState('')
  const [clearDisposition, setClearDisposition] = useState('scrap')
  const [clearRemarks, setClearRemarks] = useState('')
  const [clearErrors, setClearErrors] = useState<string[]>([])
  const [saving, setSaving] = useState(false)
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

  // Overview — different UoMs can't be summed, so store totals are value (₹)
  // and item counts. Rate = moving average, else standard cost, else last receipt.
  const [view, setView] = useState<'overview' | 'matrix' | 'balances' | 'asof'>('overview')
  const rateOf = (itemId: number) => {
    const it = itemById.get(itemId)
    return Number(it?.moving_average_cost || it?.standard_cost || it?.last_receipt_rate || 0)
  }
  // Reserved stock is part of on_hand_qty (available = on_hand − reserved) — not added again.
  const totalQty = (b: StoreStockBalance) => Number(b.on_hand_qty || 0) + Number(b.quality_qty || 0) + Number(b.quarantine_qty || 0)
  const isLow = (b: StoreStockBalance) => {
    const lvl = itemById.get(b.item_id)?.reorder_level
    return lvl != null && lvl > 0 && Number(b.available_qty || 0) <= lvl
  }
  const storeSummary = useMemo(() => {
    const byStore = new Map<number, { id: number; name: string; items: number; value: number; available: number; quality: number; blocked: number; low: number; unpriced: number }>()
    for (const b of filteredBalances) {
      if (totalQty(b) <= 0) continue
      const s = byStore.get(b.location_id) || { id: b.location_id, name: b.location_name || `Store ${b.location_id}`, items: 0, value: 0, available: 0, quality: 0, blocked: 0, low: 0, unpriced: 0 }
      const rate = rateOf(b.item_id)
      s.items += 1
      s.value += totalQty(b) * rate
      s.available += Number(b.available_qty || 0) * rate
      if ((b.quality_qty || 0) > 0) s.quality += 1
      if (b.quarantine_qty > 0) s.blocked += 1
      if (isLow(b)) s.low += 1
      if (!rate) s.unpriced += 1
      byStore.set(b.location_id, s)
    }
    return Array.from(byStore.values()).sort((a, b) => b.value - a.value)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filteredBalances, itemById])
  const totals = storeSummary.reduce(
    (t, s) => ({ value: t.value + s.value, quality: t.quality + s.quality, blocked: t.blocked + s.blocked, low: t.low + s.low, unpriced: t.unpriced + s.unpriced }),
    { value: 0, quality: 0, blocked: 0, low: 0, unpriced: 0 },
  )
  const distinctItems = new Set(filteredBalances.filter((b) => totalQty(b) > 0).map((b) => b.item_id)).size
  const matrixStores = useMemo(() => {
    const ids = new Map<number, string>()
    for (const b of filteredBalances) ids.set(b.location_id, b.location_name || `Store ${b.location_id}`)
    return Array.from(ids, ([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name))
  }, [filteredBalances])
  const matrixRows = useMemo(() => {
    const rows = new Map<number, { item_id: number; label: string; uom: string; byStore: Map<number, number>; total: number }>()
    for (const b of filteredBalances) {
      const r = rows.get(b.item_id) || { item_id: b.item_id, label: `${b.item_code} — ${b.item_name}`, uom: b.uom || '', byStore: new Map(), total: 0 }
      const q = Number(b.available_qty || 0)
      r.byStore.set(b.location_id, (r.byStore.get(b.location_id) || 0) + q)
      r.total += q
      rows.set(b.item_id, r)
    }
    return Array.from(rows.values()).sort((a, b) => a.label.localeCompare(b.label))
  }, [filteredBalances])
  const inr = (n: number) => `₹ ${n.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`
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
      const [b, i, l, mp] = await Promise.all([
        storeApi.listStockBalances(),
        storeApi.listItems(),
        storeApi.listLocations(),
        storeApi.getMyPlantAccess().catch(() => null),
      ])
      setMyPlants(mp)
      storeApi.listStockTransfers({ status: 'in_transit' }).then((t: unknown[]) => setInTransit(t.length)).catch(() => setInTransit(null))
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

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap', marginBottom: 8 }}>
        <div>
          <p style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 4px' }}>
            Store &amp; Inventory
          </p>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: TEXT.heading, margin: '0 0 8px' }}>Stock</h1>
          {myPlants?.restricted && (
            <p data-tour="stock-plant-scope" style={{ fontSize: 12.5, color: TEXT.muted, margin: '0 0 8px' }}>
              {myPlants.plant_names.length
                ? <>Showing stock of your plant: <b>{myPlants.plant_names.join(', ')}</b></>
                : <>No plant is set for you, so no stock is shown — ask an admin to set your plant in Organization › Users, or widen your Store data access in Organization › Role &amp; Permissions.</>}
            </p>
          )}
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          {can('store', 'stock', 'export') && <button data-tour="stock-export-btn" onClick={exportExcel} disabled={exporting} style={{ ...secondaryBtnStyle, opacity: exporting ? 0.7 : 1 }}>{exporting ? 'Exporting…' : 'Export'}</button>}
          {isAdmin && <button data-tour="stock-import-btn" onClick={() => setShowImport(true)} style={secondaryBtnStyle}>Opening Stock Import</button>}
        </div>
      </div>

      <StockImportDialog open={showImport} onClose={() => setShowImport(false)} onImported={load} />
      <MessageDialog open={!!exportError} variant="error" title="Export Failed" message={exportError} onClose={() => setExportError('')} />

      <MessageDialog open={!!loadError} variant="error" title="Failed to Load Stock Data" message={loadError} onClose={() => setLoadError('')} actionLabel="Reload" onAction={() => window.location.reload()} />

      {clearing && (
        <FormSheet width={580} icon="shield" iconColor="#d97706" title="Clear Quarantine"
          subtitle={`${clearing.item_code} — ${clearing.item_name} at ${clearing.location_name} · ${clearing.quarantine_qty} ${clearing.uom || ''} held`}
          onClose={() => setClearing(null)} busy={saving}
          footer={<>
            <button type="button" onClick={() => setClearing(null)} disabled={saving} style={sheetBtn('secondary', SHEET.INK, saving)}>Cancel</button>
            <button data-tour="stock-clear-save-btn" type="button" onClick={handleClear} disabled={saving} style={sheetBtn('primary', '#d97706', saving)}><SheetIcon name="check" size={16} />{saving ? 'Saving…' : 'Clear'}</button>
          </>}>
          <div style={{ padding: '20px 24px' }}>
            {clearErrors.length > 0 && (
              <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
                {clearErrors.map((e, i) => <div key={i}>{e}</div>)}
              </div>
            )}
            <SheetSection icon="alert" title="Disposition">
              <label style={sheetLabel}>What happened to it? <Req /></label>
              <Select data-tour="stock-clear-disposition" style={sheetInput} value={clearDisposition} onChange={(e) => setClearDisposition(e.target.value)} autoFocus>
                {QUARANTINE_DISPOSITIONS.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}
              </Select>
              <div style={{ maxWidth: 180, marginTop: 14 }}>
                <label style={sheetLabel}>Quantity <Req /></label>
                <input data-tour="stock-clear-qty" type="number" style={sheetInput} value={clearQty} onChange={(e) => setClearQty(e.target.value)} />
              </div>
              <p style={sheetHint}>Up to {clearing.quarantine_qty} {clearing.uom || ''} — what is in quarantine at this store.</p>
            </SheetSection>
            <SheetSection icon="chat" title="Remarks" extra={<Optional />}>
              <input data-tour="stock-clear-remarks" style={sheetInput} value={clearRemarks} onChange={(e) => setClearRemarks(e.target.value)} placeholder="Scrap note no. / vendor return challan / QC report" />
            </SheetSection>
          </div>
        </FormSheet>
      )}

      <div data-tour="stock-filters" style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center', marginBottom: 18 }}>
        <input
          data-tour="stock-search"
          style={{ ...inputStyle, flex: '2 1 220px', width: 'auto' }}
          placeholder="Search item code, name, store…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <Select data-tour="stock-store-filter" style={{ ...inputStyle, flex: '1 1 150px', width: 'auto' }} value={filterLocation} onChange={(e) => setFilterLocation(e.target.value)}>
          <option value="">All stores</option>
          {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
        </Select>
        <Select data-tour="stock-category-filter" style={{ ...inputStyle, flex: '1 1 150px', width: 'auto' }} value={filterCategory} onChange={(e) => { setFilterCategory(e.target.value); setFilterSubcategory('') }}>
          <option value="">All categories</option>
          {categories.map((c) => <option key={c} value={c}>{c}</option>)}
        </Select>
        <Select data-tour="stock-subcategory-filter" style={{ ...inputStyle, flex: '1 1 150px', width: 'auto' }} value={filterSubcategory} onChange={(e) => setFilterSubcategory(e.target.value)}>
          <option value="">All subcategories</option>
          {subcategories.map((s) => <option key={s} value={s}>{s}</option>)}
        </Select>
        {hasFilters && <button onClick={clearFilters} style={secondaryBtnStyle}>Clear</button>}
      </div>

      <div data-tour="stock-view-tabs" style={{ display: 'flex', gap: 6, marginBottom: 14, flexWrap: 'wrap' }}>
        {([['overview', 'Store Overview'], ['matrix', 'Item × Store'], ['balances', 'All Balances'], ['asof', 'Stock on Date']] as const).filter(([v]) => v !== 'asof' || seeAsOf).map(([v, label]) => (
          <button key={v} onClick={() => setView(v)} style={{
            padding: '7px 14px', borderRadius: 999, fontSize: 12.5, fontWeight: 600, cursor: 'pointer',
            border: `1px solid ${view === v ? BRAND.primary : GLASS.border}`,
            background: view === v ? BRAND.primary : '#fff', color: view === v ? '#fff' : TEXT.secondary,
          }}>{label}</button>
        ))}
      </div>

      {view === 'asof' && seeAsOf && <StockAsOfPanel locationId={filterLocation} search={search} canExport={canFeature('store', 'stock', 'as_of', 'export')} />}

      {view === 'overview' && (
        <div data-tour="stock-overview">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 12, marginBottom: 18 }}>
            {[
              ...(seeValues ? [{ label: 'Stock Value', value: loading ? '…' : inr(totals.value), hint: totals.unpriced ? `${totals.unpriced} line(s) have no rate — set standard cost on the item` : 'At moving average / standard cost', color: TEXT.heading }] : []),
              { label: 'Stores Holding Stock', value: loading ? '…' : String(storeSummary.length), hint: `${distinctItems} distinct item(s)`, color: TEXT.heading },
              { label: 'At / Below Reorder', value: loading ? '…' : String(totals.low), hint: 'Available ≤ item reorder level', color: totals.low ? '#dc2626' : TEXT.heading },
              { label: 'In Quality', value: loading ? '…' : String(totals.quality), hint: 'Waiting for inspection decision', color: totals.quality ? '#2563EB' : TEXT.heading },
              { label: 'Blocked', value: loading ? '…' : String(totals.blocked), hint: 'Quarantined — cannot be issued', color: totals.blocked ? '#d97706' : TEXT.heading },
              ...(inTransit != null ? [{ label: 'Transfers In Transit', value: String(inTransit), hint: "Dispatched, not yet received — on neither store's balance", color: inTransit ? '#7c3aed' : TEXT.heading }] : []),
            ].map((k) => (
              <div key={k.label} style={{ padding: 16, borderRadius: 16, background: GLASS.card, border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass() }}>
                <p style={{ fontSize: 11, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 6px' }}>{k.label}</p>
                <p style={{ fontSize: 22, fontWeight: 700, color: k.color, margin: '0 0 4px' }}>{k.value}</p>
                <p style={{ fontSize: 11.5, color: TEXT.muted, margin: 0 }}>{k.hint}</p>
              </div>
            ))}
          </div>
          <p style={{ fontSize: 12, fontWeight: 700, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 10px' }}>Stock by Store</p>
          <div style={{ borderRadius: 18, background: GLASS.card, border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), overflow: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 760 }}>
              <thead>
                <tr>
                  {['Store', 'Items', ...(seeValues ? ['Stock Value', 'Available Value'] : []), 'At / Below Reorder', 'In Quality', 'Blocked'].map((h) => (
                    <th key={h} style={{ background: '#fdf1e6', textAlign: 'left', padding: '12px 16px', fontSize: 11, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {loading && <tr><td colSpan={summaryCols} style={{ padding: 24, textAlign: 'center', color: TEXT.muted, fontSize: 13 }}>Loading…</td></tr>}
                {!loading && storeSummary.length === 0 && (
                  <tr><td colSpan={summaryCols} style={{ padding: 24, textAlign: 'center', color: TEXT.muted, fontSize: 13 }}>{hasFilters ? 'No stock matches the filters.' : 'No stock recorded yet.'}</td></tr>
                )}
                {!loading && storeSummary.map((s) => (
                  <tr key={s.id} title="Show this store's balances" onClick={() => { setFilterLocation(String(s.id)); setView('balances') }} style={{ borderTop: '1px solid rgba(0,0,0,0.05)', cursor: 'pointer' }}>
                    <td style={{ padding: '12px 16px', fontSize: 13, fontWeight: 600, color: TEXT.body }}>{s.name}</td>
                    <td style={{ padding: '12px 16px', fontSize: 13, color: TEXT.secondary }}>{s.items}</td>
                    {seeValues && <td style={{ padding: '12px 16px', fontSize: 13, fontWeight: 600, color: TEXT.body }}>{inr(s.value)}</td>}
                    {seeValues && <td style={{ padding: '12px 16px', fontSize: 13, fontWeight: 600, color: BRAND.primaryActive }}>{inr(s.available)}</td>}
                    <td style={{ padding: '12px 16px', fontSize: 13, color: s.low ? '#dc2626' : TEXT.muted }}>{s.low || '—'}</td>
                    <td style={{ padding: '12px 16px', fontSize: 13, color: s.quality ? '#2563EB' : TEXT.muted }}>{s.quality || '—'}</td>
                    <td style={{ padding: '12px 16px', fontSize: 13, color: s.blocked ? '#d97706' : TEXT.muted }}>{s.blocked || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {view === 'matrix' && (
        <div data-tour="stock-matrix" style={{ borderRadius: 18, background: GLASS.card, border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), overflow: 'auto', maxHeight: 'calc(100vh - 300px)', minHeight: 200 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 560 }}>
            <thead>
              <tr>
                {['Item (available qty)', ...matrixStores.map((s) => s.name), 'Total'].map((h, i) => (
                  <th key={`${h}-${i}`} style={{ position: 'sticky', top: 0, background: '#fdf1e6', zIndex: 1, textAlign: i === 0 ? 'left' : 'right', padding: '12px 16px', fontSize: 11, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading && <tr><td colSpan={matrixStores.length + 2} style={{ padding: 24, textAlign: 'center', color: TEXT.muted, fontSize: 13 }}>Loading…</td></tr>}
              {!loading && matrixRows.length === 0 && (
                <tr><td colSpan={matrixStores.length + 2} style={{ padding: 24, textAlign: 'center', color: TEXT.muted, fontSize: 13 }}>{hasFilters ? 'No stock matches the filters.' : 'No stock recorded yet.'}</td></tr>
              )}
              {!loading && matrixRows.map((r) => (
                <tr key={r.item_id} style={{ borderTop: '1px solid rgba(0,0,0,0.05)' }}>
                  <td style={{ padding: '12px 16px', fontSize: 13, fontWeight: 600, color: TEXT.body }}>{r.label}</td>
                  {matrixStores.map((s) => {
                    const q = r.byStore.get(s.id)
                    return <td key={s.id} style={{ padding: '12px 16px', fontSize: 13, textAlign: 'right', color: q ? TEXT.secondary : TEXT.muted, whiteSpace: 'nowrap' }}>{q != null ? `${q} ${r.uom}` : '—'}</td>
                  })}
                  <td style={{ padding: '12px 16px', fontSize: 13, fontWeight: 700, textAlign: 'right', color: BRAND.primaryActive, whiteSpace: 'nowrap' }}>{r.total} {r.uom}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {view === 'balances' && <>
      <p style={{ fontSize: 12, fontWeight: 700, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 10px' }}>Current Balances</p>
      <div data-tour="stock-balances-table" style={{ borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur, border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), overflow: 'auto', maxHeight: 'calc(100vh - 300px)', minHeight: 200 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 760 }}>
          <thead>
            <tr>
              {['Item', 'Store', 'On Hand (Free)', 'Reserved', 'Available', 'Quality', 'Blocked', 'With Vendor'].map((h) => (
                <th key={h} style={{ position: 'sticky', top: 0, background: '#fdf1e6', zIndex: 1, textAlign: 'left', padding: '12px 16px', fontSize: 11, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={8} style={{ padding: 24, textAlign: 'center', color: TEXT.muted, fontSize: 13 }}>Loading…</td></tr>}
            {!loading && filteredBalances.length === 0 && (
              <tr><td colSpan={8} style={{ padding: 24, textAlign: 'center', color: TEXT.muted, fontSize: 13 }}>{hasFilters ? 'No balances match the filters.' : 'No stock recorded yet.'}</td></tr>
            )}
            {!loading && filteredBalances.map((b) => (
              <tr key={b.id} style={{ borderTop: '1px solid rgba(0,0,0,0.05)' }}>
                <td style={{ padding: '12px 16px', fontSize: 13, fontWeight: 600, color: TEXT.body }}>{b.item_code} — {b.item_name}</td>
                <td style={{ padding: '12px 16px', fontSize: 13, color: TEXT.secondary }}>{b.location_name}</td>
                <td style={{ padding: '12px 16px', fontSize: 13, color: TEXT.secondary }}>{b.on_hand_qty} {b.uom}</td>
                <td style={{ padding: '12px 16px', fontSize: 13, color: TEXT.secondary }}>{b.reserved_qty} {b.uom}</td>
                <td style={{ padding: '12px 16px', fontSize: 13, fontWeight: 600, color: BRAND.primaryActive }}>{b.available_qty} {b.uom}</td>
                <td title="Received, waiting for a Quality inspection lot decision — can't be issued" style={{ padding: '12px 16px', fontSize: 13, color: (b.quality_qty || 0) > 0 ? '#2563EB' : TEXT.muted, whiteSpace: 'nowrap' }}>
                  {(b.quality_qty || 0) > 0 ? `${b.quality_qty} ${b.uom || ''}` : '—'}
                </td>
                <td style={{ padding: '12px 16px', fontSize: 13, color: b.quarantine_qty > 0 ? '#d97706' : TEXT.muted, whiteSpace: 'nowrap' }}>
                  {b.quarantine_qty > 0 ? (
                    <>
                      {b.quarantine_qty} {b.uom}
                      {canPost && <span onClick={() => openClear(b)} style={{ marginLeft: 10, color: '#FF6A2A', fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }}>Clear</span>}
                    </>
                  ) : '—'}
                </td>
                <td title="Sent to a job-work vendor on a challan — still ours and valued, not issuable (Store › Job Work)" style={{ padding: '12px 16px', fontSize: 13, color: (b.vendor_qty || 0) > 0 ? '#7c3aed' : TEXT.muted, whiteSpace: 'nowrap' }}>
                  {(b.vendor_qty || 0) > 0 ? `${b.vendor_qty} ${b.uom || ''}` : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      </>}

    </div>
  )
}
