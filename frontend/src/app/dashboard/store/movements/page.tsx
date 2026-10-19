'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRequireApp } from '@/hooks/useAuth'
import { storeApi, storeMaterialDocsApi } from '@/lib/api'
import { StoreItem, StoreLocation, StoreStockTransaction } from '@/types'
import { TEXT, BRAND, GLASS, SHADOWS } from '@/lib/theme'
import { inputStyle, secondaryBtnStyle } from '@/components/shared/ui'
import StoreNav from '@/components/store/StoreNav'
import MessageDialog from '@/components/erp/MessageDialog'
import { extractErrorMessages } from '@/lib/validation'
import StockEntryDialog from '@/components/store/StockEntryDialog'
import { useCan } from '@/lib/permissions'

// The stock ledger — every posting from Record Stock Entry, issues, returns,
// transfers, adjustments, GRNs and quarantine clears. Read-only.

const TXN_TYPE_LABELS: Record<string, string> = {
  receipt: 'Receipt',
  issue: 'Issue',
  return_in: 'Return (in)',
  return_out: 'Return (out)',
  transfer_in: 'Transfer In',
  transfer_out: 'Transfer Out',
  adjustment_in: 'Adjustment (+)',
  adjustment_out: 'Adjustment (-)',
  damage: 'Damage',
  manual_in: 'Stock in',
  manual_out: 'Stock out',
  quarantine_in: 'Quarantine (in)',
  quarantine_out: 'Quarantine (out)',
  quality_in: 'GRN into Quality',
  quality_release: 'Quality → Free',
  quality_block: 'Quality → Blocked',
  blocked_release: 'Blocked → Free',
  blocked_to_quality: 'Blocked → Quality',
  free_block: 'Free → Blocked',
  quality_hold: 'Free → Quality',
  jobwork_out: 'Job work out',
  jobwork_in: 'Job work back',
  jobwork_to_quality: 'Job work → Quality',
  jobwork_to_blocked: 'Job work → Blocked',
  jobwork_consume: 'Job work consumed',
}
const PAGE_SIZE = 200

// Tells the reader what kind of document the reference number is.
const REF_TYPE_LABELS: Record<string, string> = {
  p2p_request: 'PR', grn: 'GRN', material_issue: 'Issue', material_return: 'Return', quarantine: 'Quarantine',
  stock_adjustment: 'Adjustment', stock_transfer: 'Transfer', stock_entry: 'Entry', maintenance_work_order: 'Work Order',
}

// Mirrors backend stock_ledger._INBOUND_TYPES / _OUTBOUND_TYPES (on-hand effect).
const INBOUND = new Set(['receipt', 'return_in', 'transfer_in', 'adjustment_in', 'manual_in'])
const OUTBOUND = new Set(['issue', 'return_out', 'transfer_out', 'adjustment_out', 'damage', 'manual_out'])

const TABS: { key: string; label: string; types: string[] | null }[] = [
  { key: 'all', label: 'All', types: null },
  { key: 'receipts', label: 'Receipts', types: ['receipt'] },
  { key: 'issues', label: 'Issues', types: ['issue'] },
]

export default function StoreMovementsPage() {
  const { isAuthorized, isLoading } = useRequireApp('store')
  const [transactions, setTransactions] = useState<StoreStockTransaction[]>([])
  const [items, setItems] = useState<StoreItem[]>([])
  const [locations, setLocations] = useState<StoreLocation[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')

  const [tab, setTab] = useState('all')
  const [openEntry, setOpenEntry] = useState<string | null>(null)
  const { can } = useCan()
  const [search, setSearch] = useState('')
  const [filterLocation, setFilterLocation] = useState('')
  const [filterCategory, setFilterCategory] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  // MB51 server-side filters + paging.
  const [filterType, setFilterType] = useState('')
  const [refNo, setRefNo] = useState('')
  const [userId, setUserId] = useState('')
  const [vendor, setVendor] = useState('')
  const [users, setUsers] = useState<{ id: number; label: string }[]>([])
  const [page, setPage] = useState(0)
  const [total, setTotal] = useState(0)
  const [exporting, setExporting] = useState(false)
  const serverParams = () => ({
    location_id: filterLocation || undefined, transaction_type: filterType || undefined, date_from: dateFrom || undefined,
    date_to: dateTo || undefined, reference_number: refNo.trim() || undefined, created_by_id: userId || undefined,
    vendor_name: vendor.trim() || undefined,
  })

  const itemById = useMemo(() => new Map(items.map((i) => [i.id, i])), [items])
  const categories = useMemo(
    () => Array.from(new Set(items.map((i) => i.category).filter(Boolean) as string[])).sort(),
    [items],
  )

  useEffect(() => {
    if (!isAuthorized) return
    Promise.all([storeApi.listItems(), storeApi.listLocations(), storeMaterialDocsApi.postedBy()])
      .then(([i, l, u]) => { setItems(i); setLocations(l); setUsers(u) })
      .catch((err) => setLoadError(extractErrorMessages(err, 'Failed to load stock movements.').join(' ')))
  }, [isAuthorized])

  useEffect(() => {
    if (!isAuthorized) return
    setLoading(true)
    const t = setTimeout(() => {
      storeMaterialDocsApi.list({ ...serverParams(), skip: page * PAGE_SIZE, limit: PAGE_SIZE })
        .then((r) => { setTransactions(r.rows); setTotal(r.total) })
        .catch((err) => setLoadError(extractErrorMessages(err, 'Failed to load stock movements.').join(' ')))
        .finally(() => setLoading(false))
    }, 300)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthorized, page, filterLocation, filterType, dateFrom, dateTo, refNo, userId, vendor])
  useEffect(() => { setPage(0) }, [filterLocation, filterType, dateFrom, dateTo, refNo, userId, vendor])

  const exportExcel = async () => {
    setExporting(true)
    try {
      const blob = await storeMaterialDocsApi.export(serverParams())
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = 'material_documents_MB51.xlsx'
      a.click()
      URL.revokeObjectURL(url)
    } catch (err) {
      setLoadError(extractErrorMessages(err, 'Could not export the movements.').join(' '))
    } finally {
      setExporting(false)
    }
  }

  // Filters other than the tab — tab counts are computed after these.
  const baseFiltered = transactions.filter((t) => {
    if (filterLocation && String(t.location_id) !== filterLocation) return false
    const item = itemById.get(t.item_id)
    if (filterCategory && item?.category !== filterCategory) return false
    if (dateFrom && t.transaction_date < dateFrom) return false
    if (dateTo && t.transaction_date > dateTo) return false
    const q = search.trim().toLowerCase()
    if (q) {
      const hay = [t.item_code, t.item_name, t.location_name, t.vendor_name, t.reference_number, t.batch_number, item?.category]
        .filter(Boolean).join(' ').toLowerCase()
      if (!hay.includes(q)) return false
    }
    return true
  })
  const inTab = (t: StoreStockTransaction, key: string) => {
    const types = TABS.find((x) => x.key === key)?.types
    return !types || types.includes(t.transaction_type)
  }
  const rows = baseFiltered.filter((t) => inTab(t, tab))
  const hasFilters = !!(search || filterLocation || filterCategory || dateFrom || dateTo || filterType || refNo || userId || vendor)
  const clearFilters = () => {
    setSearch(''); setFilterLocation(''); setFilterCategory(''); setDateFrom(''); setDateTo('')
    setFilterType(''); setRefNo(''); setUserId(''); setVendor('')
  }
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  if (isLoading || !isAuthorized) return null

  const th = { position: 'sticky' as const, top: 0, background: '#fdf1e6', zIndex: 1, textAlign: 'left' as const, padding: '12px 16px', fontSize: 11, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase' as const, color: TEXT.muted }
  const td = { padding: '12px 16px', fontSize: 13, color: TEXT.secondary }

  return (
    <div>
      <StoreNav />
      {openEntry && <StockEntryDialog entryNumber={openEntry} canAttach={can('store', 'adjustments', 'create')} onClose={() => setOpenEntry(null)} />}

      <div style={{ marginBottom: 8 }}>
        <p style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 4px' }}>
          Store &amp; Inventory
        </p>
        <h1 style={{ fontSize: 24, fontWeight: 700, color: TEXT.heading, margin: '0 0 8px' }}>Stock Movements</h1>
      </div>

      <MessageDialog open={!!loadError} variant="error" title="Failed to Load Stock Movements" message={loadError} onClose={() => setLoadError('')} actionLabel="Reload" onAction={() => window.location.reload()} />

      <div data-tour="movements-tabs" style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 14 }}>
        {TABS.map((x) => {
          const active = tab === x.key
          const count = baseFiltered.filter((t) => inTab(t, x.key)).length
          return (
            <button
              key={x.key}
              onClick={() => setTab(x.key)}
              style={{
                padding: '7px 14px', borderRadius: 9999, fontSize: 12.5, fontWeight: 600, cursor: 'pointer',
                border: `1px solid ${active ? BRAND.primary : 'rgba(0,0,0,0.1)'}`,
                background: active ? `${BRAND.primary}1a` : '#fff',
                color: active ? BRAND.primaryActive : TEXT.secondary,
              }}
            >
              {x.label} <span style={{ opacity: 0.7, marginLeft: 4 }}>{loading ? '' : count}</span>
            </button>
          )
        })}
      </div>

      <div data-tour="movements-filters" style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center', marginBottom: 18 }}>
        <input
          data-tour="movements-search"
          style={{ ...inputStyle, flex: '2 1 220px', width: 'auto' }}
          placeholder="Search item, store, vendor, invoice / doc no., batch…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select data-tour="movements-store-filter" style={{ ...inputStyle, flex: '1 1 150px', width: 'auto' }} value={filterLocation} onChange={(e) => setFilterLocation(e.target.value)}>
          <option value="">All stores</option>
          {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
        </select>
        <select data-tour="movements-category-filter" style={{ ...inputStyle, flex: '1 1 150px', width: 'auto' }} value={filterCategory} onChange={(e) => setFilterCategory(e.target.value)}>
          <option value="">All categories</option>
          {categories.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <input data-tour="movements-date-from" type="date" title="From date" style={{ ...inputStyle, flex: '0 1 150px', width: 'auto' }} value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
        <input data-tour="movements-date-to" type="date" title="To date" style={{ ...inputStyle, flex: '0 1 150px', width: 'auto' }} value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
        <select data-tour="movements-type-filter" style={{ ...inputStyle, flex: '1 1 160px', width: 'auto' }} value={filterType} onChange={(e) => setFilterType(e.target.value)}>
          <option value="">All movement types</option>
          {Object.entries(TXN_TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <input data-tour="movements-ref-filter" style={{ ...inputStyle, flex: '1 1 160px', width: 'auto' }} placeholder="Document / reference no." value={refNo} onChange={(e) => setRefNo(e.target.value)} />
        <input style={{ ...inputStyle, flex: '1 1 150px', width: 'auto' }} placeholder="Vendor" value={vendor} onChange={(e) => setVendor(e.target.value)} />
        <select style={{ ...inputStyle, flex: '1 1 150px', width: 'auto' }} value={userId} onChange={(e) => setUserId(e.target.value)}>
          <option value="">All users</option>
          {users.map((u) => <option key={u.id} value={u.id}>{u.label}</option>)}
        </select>
        {hasFilters && <button onClick={clearFilters} style={secondaryBtnStyle}>Clear</button>}
        {can('store', 'movements', 'export') && (
          <button data-tour="movements-export-btn" onClick={exportExcel} disabled={exporting} style={secondaryBtnStyle}>{exporting ? 'Exporting…' : 'Export Excel'}</button>
        )}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10, fontSize: 12.5, color: TEXT.muted }}>
        <span>{total} movement(s){total > PAGE_SIZE ? ` — page ${page + 1} of ${pages}` : ''}</span>
        {total > PAGE_SIZE && (
          <>
            <button disabled={page === 0} onClick={() => setPage((p) => p - 1)} style={{ ...secondaryBtnStyle, padding: '4px 12px', fontSize: 12 }}>‹ Prev</button>
            <button disabled={page + 1 >= pages} onClick={() => setPage((p) => p + 1)} style={{ ...secondaryBtnStyle, padding: '4px 12px', fontSize: 12 }}>Next ›</button>
          </>
        )}
      </div>

      <div data-tour="movements-table" style={{ borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur, border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), overflow: 'auto', maxHeight: 'calc(100vh - 320px)', minHeight: 200 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 900 }}>
          <thead>
            <tr>
              {['Date', 'Item', 'Store', 'Bin', 'Type', 'Quantity', 'Value', 'Batch', 'Vendor', 'Invoice / Document', 'By'].map((h) => <th key={h} style={th}>{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={11} style={{ padding: 24, textAlign: 'center', color: TEXT.muted, fontSize: 13 }}>Loading…</td></tr>}
            {!loading && rows.length === 0 && (
              <tr><td colSpan={11} style={{ padding: 24, textAlign: 'center', color: TEXT.muted, fontSize: 13 }}>{hasFilters || tab !== 'all' ? 'No movements match the filters.' : 'No stock movements yet.'}</td></tr>
            )}
            {!loading && rows.map((t) => {
              const sign = INBOUND.has(t.transaction_type) ? '+' : OUTBOUND.has(t.transaction_type) ? '−' : ''
              return (
                <tr key={t.id} style={{ borderTop: '1px solid rgba(0,0,0,0.05)' }}>
                  <td style={{ ...td, whiteSpace: 'nowrap' }}>{t.transaction_date}</td>
                  <td style={{ ...td, fontWeight: 600, color: TEXT.body }}>{t.item_code} — {t.item_name}</td>
                  <td style={td}>{t.location_name}</td>
                  <td style={td}>{t.bin_code || '—'}</td>
                  <td style={{ padding: '12px 16px' }}>
                    <span style={{ fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 9999, background: sign === '+' ? '#15803d1a' : sign === '−' ? '#b91c1c1a' : 'rgba(100,116,139,0.12)', color: sign === '+' ? '#15803d' : sign === '−' ? '#b91c1c' : TEXT.secondary, whiteSpace: 'nowrap' }}>
                      {t.entry_type_label || TXN_TYPE_LABELS[t.transaction_type] || t.transaction_type}
                    </span>
                  </td>
                  <td style={{ ...td, fontWeight: 600, whiteSpace: 'nowrap', color: sign === '+' ? '#15803d' : sign === '−' ? '#b91c1c' : TEXT.secondary }}>{sign}{t.quantity}</td>
                  <td style={{ ...td, whiteSpace: 'nowrap' }}>{t.value != null ? `₹${Number(t.value).toLocaleString('en-IN', { maximumFractionDigits: 2 })}` : '—'}</td>
                  <td style={td}>{t.batch_number || '—'}</td>
                  <td style={td}>{t.vendor_name || '—'}</td>
                  <td style={td}>
                    {t.reference_number ? (
                      <span style={{ whiteSpace: 'nowrap' }}>
                        {t.reference_type && REF_TYPE_LABELS[t.reference_type] && (
                          <span style={{ fontSize: 10.5, fontWeight: 700, padding: '2px 7px', borderRadius: 9999, background: 'rgba(59,130,246,0.1)', color: '#2563eb', marginRight: 6 }}>{REF_TYPE_LABELS[t.reference_type]}</span>
                        )}
                        {t.reference_type === 'stock_entry' ? (
                          <span title="Open the entry and its documents" onClick={() => setOpenEntry(t.reference_number || null)}
                            style={{ color: BRAND.primaryActive, fontWeight: 600, cursor: 'pointer', textDecoration: 'underline' }}>{t.reference_number} 📎</span>
                        ) : t.reference_number}
                      </span>
                    ) : '—'}
                  </td>
                  <td style={td}>{t.created_by_name || '—'}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
