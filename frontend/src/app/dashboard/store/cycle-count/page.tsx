'use client'

import { useEffect, useState } from 'react'
import { useRequireApp } from '@/hooks/useAuth'
import { storeApi } from '@/lib/api'
import { StoreLocation, StockBalanceRow } from '@/types'
import { TEXT, GLASS, SHADOWS, BRAND } from '@/lib/theme'
import StoreNav from '@/components/store/StoreNav'
import SearchableSelect from '@/components/erp/SearchableSelect'
import { inputStyle, primaryBtnStyle } from '@/components/shared/ui'

export default function CycleCountPage() {
  const { isAuthorized, isLoading } = useRequireApp('store')
  const [locations, setLocations] = useState<StoreLocation[]>([])
  const [locationId, setLocationId] = useState('')
  const [balances, setBalances] = useState<StockBalanceRow[]>([])
  const [counted, setCounted] = useState<Record<number, string>>({})
  const [loading, setLoading] = useState(false)
  const [posting, setPosting] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  useEffect(() => {
    if (!isAuthorized) return
    storeApi.listLocations().then(setLocations).catch(() => {})
  }, [isAuthorized])

  const loadSheet = async (locId: string) => {
    setLocationId(locId)
    setCounted({})
    setMessage('')
    setError('')
    if (!locId) { setBalances([]); return }
    setLoading(true)
    try {
      setBalances(await storeApi.listBalances(Number(locId)))
    } catch {
      setError('Failed to load count sheet.')
    } finally {
      setLoading(false)
    }
  }

  const variance = (row: StockBalanceRow) => {
    const c = counted[row.stock_item_id]
    if (c === undefined || c === '') return null
    return Number(c) - row.quantity_on_hand
  }

  const postAdjustments = async () => {
    const toPost = balances.filter((row) => {
      const v = variance(row)
      return v !== null && v !== 0
    })
    if (toPost.length === 0) { setError('No variances to post — enter at least one differing count.'); return }
    setPosting(true)
    setError('')
    setMessage('')
    try {
      for (const row of toPost) {
        await storeApi.adjust({
          stock_item_id: row.stock_item_id,
          location_id: Number(locationId),
          counted_quantity: Number(counted[row.stock_item_id]),
        })
      }
      setMessage(`Posted ${toPost.length} adjustment(s).`)
      await loadSheet(locationId)
    } catch (e: unknown) {
      const err = e as { response?: { data?: { detail?: string } } }
      setError(err.response?.data?.detail || 'Failed to post adjustments.')
    } finally {
      setPosting(false)
    }
  }

  if (isLoading || !isAuthorized) return null

  return (
    <div>
      <p style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 4px' }}>
        Store Module
      </p>
      <h1 style={{ fontSize: 24, fontWeight: 700, color: TEXT.heading, margin: '0 0 20px' }}>Cycle Count</h1>

      <StoreNav />

      <div style={{ maxWidth: 360, marginBottom: 16 }}>
        <SearchableSelect
          value={locationId}
          onChange={loadSheet}
          options={locations.map((l) => ({ value: String(l.id), label: l.name }))}
          placeholder="Select a location to count…"
        />
      </div>

      {error && (
        <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
          {error}
        </div>
      )}
      {message && (
        <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(34,197,94,0.08)', border: '1px solid rgba(34,197,94,0.2)', color: '#15803d', fontSize: 13 }}>
          {message}
        </div>
      )}

      {locationId && (
        <>
          <div style={{ borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur, border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), overflow: 'auto', maxHeight: 'calc(100vh - 420px)', marginBottom: 16 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 700 }}>
              <thead>
                <tr style={{ background: `${BRAND.primary}0d` }}>
                  {['Part Code', 'Description', 'UOM', 'System Qty', 'Counted Qty', 'Variance'].map((h) => (
                    <th key={h} style={{ textAlign: 'left', padding: '10px 14px', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', color: TEXT.muted, position: 'sticky', top: 0, background: '#fdf1e6', zIndex: 1 }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {loading && <tr><td colSpan={6} style={{ padding: 20, textAlign: 'center', color: TEXT.muted, fontSize: 13 }}>Loading…</td></tr>}
                {!loading && balances.length === 0 && (
                  <tr><td colSpan={6} style={{ padding: 20, textAlign: 'center', color: TEXT.muted, fontSize: 13 }}>No active stock items.</td></tr>
                )}
                {balances.map((row) => {
                  const v = variance(row)
                  return (
                    <tr key={row.stock_item_id} style={{ borderTop: '1px solid rgba(0,0,0,0.05)' }}>
                      <td style={{ padding: '8px 14px', fontSize: 13, fontWeight: 600, color: TEXT.heading }}>{row.part_code}</td>
                      <td style={{ padding: '8px 14px', fontSize: 13 }}>{row.description}</td>
                      <td style={{ padding: '8px 14px', fontSize: 13, color: TEXT.secondary }}>{row.unit || '—'}</td>
                      <td style={{ padding: '8px 14px', fontSize: 13, color: TEXT.secondary }}>{row.quantity_on_hand}</td>
                      <td style={{ padding: '8px 14px', minWidth: 100 }}>
                        <input
                          type="number"
                          style={inputStyle}
                          value={counted[row.stock_item_id] ?? ''}
                          onChange={(e) => setCounted((prev) => ({ ...prev, [row.stock_item_id]: e.target.value }))}
                          placeholder={String(row.quantity_on_hand)}
                        />
                      </td>
                      <td style={{ padding: '8px 14px', fontSize: 13, fontWeight: 600, color: v == null || v === 0 ? TEXT.muted : v > 0 ? '#16a34a' : '#dc2626' }}>
                        {v == null ? '—' : v > 0 ? `+${v}` : v}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          <button disabled={posting} onClick={postAdjustments} style={{ ...primaryBtnStyle, padding: '12px 26px', fontSize: 14, cursor: posting ? 'not-allowed' : 'pointer', opacity: posting ? 0.6 : 1 }}>
            {posting ? 'Posting…' : 'Post Adjustments'}
          </button>
        </>
      )}
    </div>
  )
}
