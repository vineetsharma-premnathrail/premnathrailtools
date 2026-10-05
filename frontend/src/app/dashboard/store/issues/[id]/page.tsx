'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { storeApi } from '@/lib/api'
import { StoreMaterialIssue } from '@/types'
import { TEXT, GLASS, SHADOWS } from '@/lib/theme'
import { Row, InfoRow, secondaryBtnStyle } from '@/components/shared/ui'
import StoreNav from '@/components/store/StoreNav'
import MessageDialog from '@/components/erp/MessageDialog'

export default function StoreMaterialIssueDetailPage() {
  const { isAuthorized, isLoading } = useRequireApp('store')
  const router = useRouter()
  const params = useParams()
  const issueId = Number(params.id)

  const [issue, setIssue] = useState<StoreMaterialIssue | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')

  useEffect(() => {
    if (!isAuthorized || !issueId) return
    setLoading(true)
    storeApi.getMaterialIssue(issueId).then(setIssue).catch(() => setLoadError('Failed to load this material issue.')).finally(() => setLoading(false))
  }, [isAuthorized, issueId])

  if (isLoading || !isAuthorized) return null

  return (
    <div>
      <StoreNav />
      <MessageDialog open={!!loadError} variant="error" title="Failed to Load Material Issue" message={loadError} onClose={() => setLoadError('')} actionLabel="Back to Issues" onAction={() => router.push('/dashboard/store/issues')} />

      {loading || !issue ? (
        <p style={{ fontSize: 13, color: TEXT.muted }}>Loading…</p>
      ) : (
        <>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
            <div>
              <p style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 4px' }}>
                Store &amp; Inventory · Material Issue
              </p>
              <h1 style={{ fontSize: 22, fontWeight: 700, color: TEXT.heading, margin: 0 }}>{issue.issue_number}</h1>
            </div>
            <button type="button" data-tour="issue-detail-back-btn" onClick={() => router.push('/dashboard/store/issues')} style={secondaryBtnStyle}>← Back</button>
          </div>

          <div data-tour="issue-detail-summary" style={{ borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur, border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), padding: 20, marginBottom: 20 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <Row>
                <InfoRow label="Store" value={issue.location_name || '—'} />
                <InfoRow label="Issue Type" value={issue.issue_type_label || '—'} />
                <InfoRow label="Department" value={issue.department_name || '—'} />
                <InfoRow label="Project / Work Order" value={issue.project_or_work_order || '—'} />
                <InfoRow label="Challan No." value={issue.challan_number || '—'} />
                <InfoRow label="Vendor" value={issue.vendor_name || '—'} />
                {issue.expected_return_date && <InfoRow label="Date" value={issue.expected_return_date} />}
              </Row>
              <Row>
                <InfoRow label="Issue Date" value={issue.issue_date} />
                <InfoRow label="Requested By" value={issue.requested_by_name || '—'} />
                <InfoRow label="Issued By" value={issue.issued_by_name || '—'} />
              </Row>
              {issue.p2p_number && (
                <div>
                  <p style={{ fontSize: 10.5, fontWeight: 600, letterSpacing: '.04em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 2px' }}>Purchase Requisition</p>
                  <span onClick={() => router.push(`/dashboard/p2p/${issue.p2p_request_id}`)} style={{ fontSize: 13, fontWeight: 600, color: '#2563eb', cursor: 'pointer' }}>{issue.p2p_number}</span>
                </div>
              )}
              <InfoRow label="Remarks" value={issue.remarks || '—'} />
            </div>
          </div>

          <p style={{ fontSize: 12, fontWeight: 700, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 10px' }}>Items</p>
          <div data-tour="issue-detail-items" style={{ borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur, border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), overflow: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 500 }}>
              <thead>
                <tr>
                  {['Item', 'Quantity', 'Batch', 'Remarks'].map((h) => (
                    <th key={h} style={{ textAlign: 'left', padding: '12px 16px', fontSize: 11, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {issue.items.map((line) => (
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
