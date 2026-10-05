'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { storeApi } from '@/lib/api'
import { StoreStockTransfer } from '@/types'
import { TEXT, GLASS, SHADOWS } from '@/lib/theme'
import { Row, InfoRow, secondaryBtnStyle } from '@/components/shared/ui'
import StoreNav from '@/components/store/StoreNav'
import MessageDialog from '@/components/erp/MessageDialog'

export default function StoreStockTransferDetailPage() {
  const { isAuthorized, isLoading } = useRequireApp('store')
  const router = useRouter()
  const params = useParams()
  const transferId = Number(params.id)

  const [transfer, setTransfer] = useState<StoreStockTransfer | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')

  useEffect(() => {
    if (!isAuthorized || !transferId) return
    setLoading(true)
    storeApi.getStockTransfer(transferId).then(setTransfer).catch(() => setLoadError('Failed to load this stock transfer.')).finally(() => setLoading(false))
  }, [isAuthorized, transferId])

  if (isLoading || !isAuthorized) return null

  return (
    <div>
      <StoreNav />
      <MessageDialog open={!!loadError} variant="error" title="Failed to Load Stock Transfer" message={loadError} onClose={() => setLoadError('')} actionLabel="Back to Transfers" onAction={() => router.push('/dashboard/store/transfers')} />

      {loading || !transfer ? (
        <p style={{ fontSize: 13, color: TEXT.muted }}>Loading…</p>
      ) : (
        <>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
            <div>
              <p style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 4px' }}>
                Store &amp; Inventory · Stock Transfer
              </p>
              <h1 style={{ fontSize: 22, fontWeight: 700, color: TEXT.heading, margin: 0 }}>{transfer.transfer_number}</h1>
            </div>
            <button type="button" data-tour="transfer-detail-back-btn" onClick={() => router.push('/dashboard/store/transfers')} style={secondaryBtnStyle}>← Back</button>
          </div>

          <div data-tour="transfer-detail-summary" style={{ borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur, border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), padding: 20, marginBottom: 20 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <Row>
                <InfoRow label="From Store" value={transfer.from_location_name || '—'} />
                <InfoRow label="To Store" value={transfer.to_location_name || '—'} />
                <InfoRow label="Transfer Date" value={transfer.transfer_date} />
              </Row>
              <Row>
                <InfoRow label="Reason" value={transfer.reason || '—'} />
                <InfoRow label="Transferred By" value={transfer.transferred_by_name || '—'} />
              </Row>
              <InfoRow label="Remarks" value={transfer.remarks || '—'} />
            </div>
          </div>

          <p style={{ fontSize: 12, fontWeight: 700, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 10px' }}>Items</p>
          <div data-tour="transfer-detail-items" style={{ borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur, border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), overflow: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 500 }}>
              <thead>
                <tr>
                  {['Item', 'Quantity', 'Batch', 'Remarks'].map((h) => (
                    <th key={h} style={{ textAlign: 'left', padding: '12px 16px', fontSize: 11, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {transfer.items.map((line) => (
                  <tr key={line.id} style={{ borderTop: '1px solid rgba(0,0,0,0.05)' }}>
                    <td style={{ padding: '12px 16px', fontSize: 13, fontWeight: 600, color: TEXT.body }}>{line.item_code} — {line.item_name}</td>
                    <td style={{ padding: '12px 16px', fontSize: 13, color: TEXT.secondary }}>{line.quantity} {line.uom}</td>
                    <td style={{ padding: '12px 16px', fontSize: 13, color: TEXT.secondary }}>{line.batch_number || '—'}</td>
                    <td style={{ padding: '12px 16px', fontSize: 13, color: TEXT.secondary }}>{line.remarks || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}
