'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { storeApi } from '@/lib/api'
import { StoreMaterialReturn } from '@/types'
import { TEXT, BRAND, GLASS, SHADOWS } from '@/lib/theme'
import { Row, InfoRow, secondaryBtnStyle } from '@/components/shared/ui'
import StoreNav from '@/components/store/StoreNav'
import MessageDialog from '@/components/erp/MessageDialog'

const CONDITION_LABELS: Record<string, string> = { good: 'Good', damaged: 'Damaged', rejected: 'Rejected' }

export default function StoreMaterialReturnDetailPage() {
  const { isAuthorized, isLoading } = useRequireApp('store')
  const router = useRouter()
  const params = useParams()
  const returnId = Number(params.id)

  const [ret, setRet] = useState<StoreMaterialReturn | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')

  useEffect(() => {
    if (!isAuthorized || !returnId) return
    setLoading(true)
    storeApi.getMaterialReturn(returnId).then(setRet).catch(() => setLoadError('Failed to load this material return.')).finally(() => setLoading(false))
  }, [isAuthorized, returnId])

  if (isLoading || !isAuthorized) return null

  return (
    <div>
      <StoreNav />
      <MessageDialog open={!!loadError} variant="error" title="Failed to Load Material Return" message={loadError} onClose={() => setLoadError('')} actionLabel="Back to Returns" onAction={() => router.push('/dashboard/store/returns')} />

      {loading || !ret ? (
        <p style={{ fontSize: 13, color: TEXT.muted }}>Loading…</p>
      ) : (
        <>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
            <div>
              <p style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 4px' }}>
                Store &amp; Inventory · Material Return
              </p>
              <h1 style={{ fontSize: 22, fontWeight: 700, color: TEXT.heading, margin: 0 }}>{ret.return_number}</h1>
            </div>
            <button type="button" data-tour="return-detail-back-btn" onClick={() => router.push('/dashboard/store/returns')} style={secondaryBtnStyle}>← Back</button>
          </div>

          <div data-tour="return-detail-summary" style={{ borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur, border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), padding: 20, marginBottom: 20 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <Row>
                <InfoRow label="Warehouse" value={ret.location_name || '—'} />
                <InfoRow label="Source" value={ret.source_issue_number || ret.source_description || '—'} />
                <InfoRow label="Return Date" value={ret.return_date} />
              </Row>
              <Row>
                <InfoRow label="Reason" value={ret.reason || '—'} />
                <InfoRow label="Returned By" value={ret.returned_by_name || '—'} />
              </Row>
              <InfoRow label="Remarks" value={ret.remarks || '—'} />
            </div>
          </div>

          <p style={{ fontSize: 12, fontWeight: 700, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 10px' }}>Items</p>
          <div data-tour="return-detail-items" style={{ borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur, border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), overflow: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 560 }}>
              <thead>
                <tr>
                  {['Item', 'Quantity', 'Condition', 'Batch', 'Remarks'].map((h) => (
                    <th key={h} style={{ textAlign: 'left', padding: '12px 16px', fontSize: 11, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {ret.items.map((line) => (
                  <tr key={line.id} style={{ borderTop: '1px solid rgba(0,0,0,0.05)' }}>
                    <td style={{ padding: '12px 16px', fontSize: 13, fontWeight: 600, color: TEXT.body }}>{line.item_code} — {line.item_name}</td>
                    <td style={{ padding: '12px 16px', fontSize: 13, color: TEXT.secondary }}>{line.quantity} {line.uom}</td>
                    <td style={{ padding: '12px 16px' }}>
                      <span style={{ fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 9999, background: line.condition === 'good' ? `${BRAND.primary}1a` : 'rgba(220,38,38,0.1)', color: line.condition === 'good' ? BRAND.primaryActive : '#b91c1c' }}>
                        {CONDITION_LABELS[line.condition] || line.condition}
                      </span>
                    </td>
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
