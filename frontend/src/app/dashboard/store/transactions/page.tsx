'use client'

import { useEffect, useState } from 'react'
import { useRequireApp } from '@/hooks/useAuth'
import { storeApi } from '@/lib/api'
import { StockTransaction } from '@/types'
import { TEXT, GLASS, SHADOWS, BORDER } from '@/lib/theme'
import StoreNav from '@/components/store/StoreNav'

export default function StoreTransactionsPage() {
  const { isAuthorized, isLoading } = useRequireApp('store')
  const [txns, setTxns] = useState<StockTransaction[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!isAuthorized) return
    setLoading(true)
    storeApi.listTransactions({ limit: 500 })
      .then(setTxns)
      .catch(() => setError('Failed to load transactions.'))
      .finally(() => setLoading(false))
  }, [isAuthorized])

  if (isLoading || !isAuthorized) return null

  return (
    <div>
      <StoreNav />

      <p style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 4px' }}>
        Store Module
      </p>
      <h1 style={{ fontSize: 24, fontWeight: 700, color: TEXT.heading, margin: '0 0 20px' }}>Transactions</h1>

      {error && (
        <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
          {error}
        </div>
      )}

      <div style={{ borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur, border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), overflow: 'auto', maxHeight: 'calc(100vh - 280px)' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 900 }}>
          <thead>
            <tr>
              {['Date', 'Item', 'Type', 'Location', 'Quantity', 'Reference', 'By', 'Remarks'].map((h) => (
                <th key={h} style={{ textAlign: 'left', padding: '12px 16px', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', color: TEXT.muted, position: 'sticky', top: 0, background: '#fdf1e6', zIndex: 1 }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={8} style={{ padding: 24, textAlign: 'center', color: TEXT.muted, fontSize: 13 }}>Loading…</td></tr>}
            {!loading && txns.length === 0 && (
              <tr><td colSpan={8} style={{ padding: 24, textAlign: 'center', color: TEXT.muted, fontSize: 13 }}>No transactions yet.</td></tr>
            )}
            {txns.map((t) => (
              <tr key={t.id} style={{ borderTop: `1px solid ${BORDER.light}` }}>
                <td style={{ padding: '10px 16px', fontSize: 12.5, color: TEXT.secondary, whiteSpace: 'nowrap' }}>{t.created_at ? new Date(t.created_at).toLocaleString() : '—'}</td>
                <td style={{ padding: '10px 16px', fontSize: 13 }}>{t.stock_item_description || '—'}</td>
                <td style={{ padding: '10px 16px', fontSize: 13, textTransform: 'capitalize' }}>{t.type.replace('_', ' ')}</td>
                <td style={{ padding: '10px 16px', fontSize: 13, color: TEXT.secondary }}>{t.location_name || '—'}</td>
                <td style={{ padding: '10px 16px', fontSize: 13, fontWeight: 600, color: t.quantity < 0 ? '#dc2626' : '#16a34a' }}>{t.quantity > 0 ? `+${t.quantity}` : t.quantity}</td>
                <td style={{ padding: '10px 16px', fontSize: 12.5, color: TEXT.secondary }}>{t.reference_type || '—'}</td>
                <td style={{ padding: '10px 16px', fontSize: 12.5, color: TEXT.secondary }}>{t.performed_by_name || '—'}</td>
                <td style={{ padding: '10px 16px', fontSize: 12.5, color: TEXT.secondary }}>{t.remarks || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
