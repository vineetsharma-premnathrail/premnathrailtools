'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRequireApp } from '@/hooks/useAuth'
import { storeApi } from '@/lib/api'
import { StoreItem, StoreLocation, StoreStockTransaction } from '@/types'
import { TEXT, BRAND, GLASS, SHADOWS } from '@/lib/theme'
import { inputStyle, secondaryBtnStyle } from '@/components/shared/ui'
import StoreNav from '@/components/store/StoreNav'
import MessageDialog from '@/components/erp/MessageDialog'
import { extractErrorMessages } from '@/lib/validation'

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
}

// Tells the reader what kind of document the reference number is.
const REF_TYPE_LABELS: Record<string, string> = {
  p2p_request: 'PR', grn: 'GRN', material_issue: 'Issue', material_return: 'Return', quarantine: 'Quarantine',
  stock_adjustment: 'Adjustment', stock_transfer: 'Transfer', maintenance_work_order: 'Work Order',
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
  const [search, setSearch] = useState('')
  const [filterLocation, setFilterLocation] = useState('')
  const [filterCategory, setFilterCategory] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')

  const itemById = useMemo(() => new Map(items.map((i) => [i.id, i])), [items])
  const categories = useMemo(
    () => Array.from(new Set(items.map((i) => i.category).filter(Boolean) as string[])).sort(),
    [items],
  )

  useEffect(() => {
    if (!isAuthorized) return
    Promise.all([storeApi.listStockTransactions(), storeApi.listItems(), storeApi.listLocations()])
      .then(([t, i, l]) => { setTransactions(t); setItems(i); setLocations(l) })
      .catch((err) => setLoadError(extractErrorMessages(err, 'Failed to load stock movements.').join(' ')))
      .finally(() => setLoading(false))
  }, [isAuthorized])

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
  const hasFilters = !!(search || filterLocation || filterCategory || dateFrom || dateTo)
  const clearFilters = () => {
    setSearch(''); setFilterLocation(''); setFilterCategory(''); setDateFrom(''); setDateTo('')
  }

  if (isLoading || !isAuthorized) return null

  const th = { position: 'sticky' as const, top: 0, background: '#fdf1e6', zIndex: 1, textAlign: 'left' as const, padding: '12px 16px', fontSize: 11, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase' as const, color: TEXT.muted }
  const td = { padding: '12px 16px', fontSize: 13, color: TEXT.secondary }

  return (
    <div>
      <StoreNav />

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
          style={{ ...inputStyle, flex: '2 1 220px', width: 'auto' }}
          placeholder="Search item, store, vendor, invoice / doc no., batch…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select style={{ ...inputStyle, flex: '1 1 150px', width: 'auto' }} value={filterLocation} onChange={(e) => setFilterLocation(e.target.value)}>
          <option value="">All stores</option>
          {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
        </select>
        <select style={{ ...inputStyle, flex: '1 1 150px', width: 'auto' }} value={filterCategory} onChange={(e) => setFilterCategory(e.target.value)}>
          <option value="">All categories</option>
          {categories.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <input type="date" title="From date" style={{ ...inputStyle, flex: '0 1 150px', width: 'auto' }} value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
        <input type="date" title="To date" style={{ ...inputStyle, flex: '0 1 150px', width: 'auto' }} value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
        {hasFilters && <button onClick={clearFilters} style={secondaryBtnStyle}>Clear</button>}
      </div>

      <div data-tour="movements-table" style={{ borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur, border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), overflow: 'auto', maxHeight: 'calc(100vh - 320px)', minHeight: 200 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 900 }}>
          <thead>
            <tr>
              {['Date', 'Item', 'Store', 'Type', 'Quantity', 'Batch', 'Vendor', 'Invoice / Document', 'By'].map((h) => <th key={h} style={th}>{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={9} style={{ padding: 24, textAlign: 'center', color: TEXT.muted, fontSize: 13 }}>Loading…</td></tr>}
            {!loading && rows.length === 0 && (
              <tr><td colSpan={9} style={{ padding: 24, textAlign: 'center', color: TEXT.muted, fontSize: 13 }}>{hasFilters || tab !== 'all' ? 'No movements match the filters.' : 'No stock movements yet.'}</td></tr>
            )}
            {!loading && rows.map((t) => {
              const sign = INBOUND.has(t.transaction_type) ? '+' : OUTBOUND.has(t.transaction_type) ? '−' : ''
              return (
                <tr key={t.id} style={{ borderTop: '1px solid rgba(0,0,0,0.05)' }}>
                  <td style={{ ...td, whiteSpace: 'nowrap' }}>{t.transaction_date}</td>
                  <td style={{ ...td, fontWeight: 600, color: TEXT.body }}>{t.item_code} — {t.item_name}</td>
                  <td style={td}>{t.location_name}</td>
                  <td style={{ padding: '12px 16px' }}>
                    <span style={{ fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 9999, background: `${BRAND.primary}1a`, color: BRAND.primaryActive, whiteSpace: 'nowrap' }}>
                      {t.entry_type_label || TXN_TYPE_LABELS[t.transaction_type] || t.transaction_type}
                    </span>
                  </td>
                  <td style={{ ...td, fontWeight: 600, whiteSpace: 'nowrap', color: sign === '+' ? '#15803d' : sign === '−' ? '#b91c1c' : TEXT.secondary }}>{sign}{t.quantity}</td>
                  <td style={td}>{t.batch_number || '—'}</td>
                  <td style={td}>{t.vendor_name || '—'}</td>
                  <td style={td}>
                    {t.reference_number ? (
                      <span style={{ whiteSpace: 'nowrap' }}>
                        {t.reference_type && REF_TYPE_LABELS[t.reference_type] && (
                          <span style={{ fontSize: 10.5, fontWeight: 700, padding: '2px 7px', borderRadius: 9999, background: 'rgba(59,130,246,0.1)', color: '#2563eb', marginRight: 6 }}>{REF_TYPE_LABELS[t.reference_type]}</span>
                        )}
                        {t.reference_number}
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
