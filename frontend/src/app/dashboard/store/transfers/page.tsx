'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { storeApi } from '@/lib/api'
import { StoreStockTransfer } from '@/types'
import { TEXT, GLASS, SHADOWS } from '@/lib/theme'
import { primaryBtnStyle, chipBtnStyle, smallSecondaryBtnStyle, RowCount, Pill, thStyle, numThStyle } from '@/components/shared/ui'
import StoreNav from '@/components/store/StoreNav'
import { recordPath } from '@/lib/recordRef'
import MessageDialog from '@/components/erp/MessageDialog'
import { formatDate } from '@/lib/format'
import { extractErrorMessages } from '@/lib/validation'
import { useCan } from '@/lib/permissions'

const STATUS_HEX: Record<string, string> = {
  pending_approval: '#f59e0b', approved: '#2563EB', in_transit: '#7c3aed', received: '#16a34a', rejected: '#dc2626', cancelled: '#78716c',
}
const STATUS_FILTERS = [
  ['', 'All'], ['pending_approval', 'Pending approval'], ['approved', 'To dispatch'], ['in_transit', 'In transit'], ['received', 'Received'],
  ['rejected', 'Rejected'], ['cancelled', 'Cancelled'],
] as const

export default function StoreStockTransfersPage() {
  const { isAuthorized, isLoading } = useRequireApp('store')
  const { can } = useCan()
  const router = useRouter()
  const [transfers, setTransfers] = useState<StoreStockTransfer[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [statusFilter, setStatusFilter] = useState('')

  useEffect(() => {
    if (!isAuthorized) return
    setLoading(true)
    storeApi.listStockTransfers().then(setTransfers).catch((err) => setError(extractErrorMessages(err, 'Could not load stock transfers — check your connection and reload; if it persists your account may lack access to this module.').join(' '))).finally(() => setLoading(false))
  }, [isAuthorized])

  const shown = statusFilter ? transfers.filter((t) => t.status === statusFilter) : transfers
  const count = (s: string) => transfers.filter((t) => t.status === s).length

  if (isLoading || !isAuthorized) return null

  return (
    <div>
      <StoreNav />

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap', marginBottom: 8 }}>
        <div>
          <p style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 4px' }}>
            Store &amp; Inventory
          </p>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: TEXT.heading, margin: 0 }}>Stock Transfers</h1>
          <p style={{ fontSize: 13, color: TEXT.muted, margin: '4px 0 12px' }}>Move stock between stores: approve, dispatch, then the receiving store confirms receipt.</p>
        </div>
        {can('store', 'transfers', 'create') && (
          <button data-tour="transfers-add-btn" onClick={() => router.push('/dashboard/store/transfers/new')} style={primaryBtnStyle}>
            <span style={{ fontSize: 17, lineHeight: 1, marginRight: 6 }}>+</span> New Transfer
          </button>
        )}
      </div>

      <MessageDialog open={!!error} variant="error" title="Failed to Load Stock Transfers" message={error} onClose={() => setError('')} actionLabel="Reload" onAction={() => window.location.reload()} />

      <div data-tour="transfers-status-filter" style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 14 }}>
        {STATUS_FILTERS.map(([v, l]) => {
          const n = v ? count(v) : transfers.length
          const on = statusFilter === v
          return (
            <button key={v || 'all'} onClick={() => setStatusFilter(v)} style={chipBtnStyle(on)}>
              {l}{n ? ` (${n})` : ''}
            </button>
          )
        })}
      </div>

      <div data-tour="transfers-table" style={{ borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur, border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), overflow: 'auto', maxHeight: 'calc(100vh - 320px)' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 720 }}>
          <thead>
            <tr>
              {['Transfer #', 'From', 'To', 'Date', 'Items', 'Status', ''].map((h, hi) => (
                <th key={h} style={h === 'Items' ? numThStyle : thStyle}>{h}{hi === 0 && <RowCount count={shown.length} />}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={7} style={{ padding: 24, textAlign: 'center', color: TEXT.muted, fontSize: 13 }}>Loading…</td></tr>}
            {!loading && shown.length === 0 && (
              <tr><td colSpan={7} style={{ padding: 24, textAlign: 'center', color: TEXT.muted, fontSize: 13 }}>{statusFilter ? 'No transfers in this status — pick another status above.' : `No stock transfers yet${can('store', 'transfers', 'create') ? ' — use + New Transfer to move stock between stores.' : '.'}`}</td></tr>
            )}
            {!loading && shown.map((t) => (
              <tr key={t.id} onClick={() => router.push(recordPath('/dashboard/store/transfers', t))} style={{ borderTop: '1px solid rgba(0,0,0,0.05)', cursor: 'pointer' }}>
                <td style={{ padding: '12px 16px', fontSize: 13, fontWeight: 600, color: TEXT.body, whiteSpace: 'nowrap' }}>{t.transfer_number}</td>
                <td style={{ padding: '12px 16px', fontSize: 13, color: TEXT.secondary }}>{t.from_location_name || '—'}</td>
                <td style={{ padding: '12px 16px', fontSize: 13, color: TEXT.secondary }}>{t.to_location_name || '—'}</td>
                <td style={{ padding: '12px 16px', fontSize: 13, color: TEXT.secondary, whiteSpace: 'nowrap' }}>{formatDate(t.transfer_date)}</td>
                <td style={{ padding: '12px 16px', fontSize: 13, color: TEXT.secondary, textAlign: 'right' }}>{t.items.length}</td>
                <td style={{ padding: '12px 16px' }}>
                  <Pill label={t.status_label || t.status} hex={STATUS_HEX[t.status] || '#78716c'} />
                </td>
                <td onClick={(e) => e.stopPropagation()} style={{ padding: '8px 16px' }}>
                  <button type="button" onClick={() => router.push(recordPath('/dashboard/store/transfers', t))} style={smallSecondaryBtnStyle}>View</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
