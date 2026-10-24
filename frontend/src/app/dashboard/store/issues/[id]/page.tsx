'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { storeApi } from '@/lib/api'
import { StoreMaterialIssue } from '@/types'
import { TEXT, GLASS, SHADOWS } from '@/lib/theme'
import { Row, InfoRow, secondaryBtnStyle } from '@/components/shared/ui'
import StoreNav from '@/components/store/StoreNav'
import ManagedDocumentPanel from '@/components/shared/ManagedDocumentPanel'
import { useCan } from '@/lib/permissions'
import InvalidRecordLink from '@/components/erp/InvalidRecordLink'
import { recordPath, useRecordId } from '@/lib/recordRef'
import MessageDialog from '@/components/erp/MessageDialog'
import { extractErrorMessages } from '@/lib/validation'
import { OrderProjectChip } from '@/components/sales/OrderProjectPicker'

export default function StoreMaterialIssueDetailPage() {
  const { isAuthorized, isLoading } = useRequireApp('store')
  const { can } = useCan()
  const router = useRouter()
  const params = useParams()
  const ref = params.id as string
  const { id: resolvedIssueId, error: linkError } = useRecordId(ref)
  const issueId = resolvedIssueId ?? 0

  const [issue, setIssue] = useState<StoreMaterialIssue | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')

  useEffect(() => {
    if (!isAuthorized || !issueId) return
    setLoading(true)
    storeApi.getMaterialIssue(issueId).then(setIssue).catch((err) => setLoadError(extractErrorMessages(err, 'Could not load this material issue — check your connection and reload; if it persists your account may lack access to this module.').join(' '))).finally(() => setLoading(false))
  }, [isAuthorized, issueId])

  // A dispatch can ship several vehicles: show each line's element when they differ from the header's.
  const showLineElement = !!issue && issue.items.some((l) => l.order_project_element_id && l.order_project_element_id !== issue.order_project_element_id)

  if (isLoading || !isAuthorized) return null
  if (linkError) return (<div><StoreNav /><InvalidRecordLink message={linkError} listHref="/dashboard/store/issues" listLabel="Back to issues" /></div>)
  if (!issueId) return <div><StoreNav /></div>

  return (
    <div>
      <StoreNav />
      <MessageDialog open={!!loadError} variant="error" title="Failed to Load Material Issue" message={loadError} onClose={() => setLoadError('')} actionLabel="Back to Issues" onAction={() => router.push('/dashboard/store/issues')} />

      {loading || !issue ? (
        <p style={{ fontSize: 13, color: TEXT.muted }}>Loading…</p>
      ) : (
        <>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap', marginBottom: 20 }}>
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
                {issue.project_or_work_order && <InfoRow label="Work Order / Reference" value={issue.project_or_work_order} />}
                {issue.against_label && <InfoRow label="Against" value={issue.against_label} />}
                {issue.challan_number && <InfoRow label="Challan No." value={issue.challan_number} />}
                {issue.expected_return_date && <InfoRow label="Expected return" value={issue.expected_return_date} />}
                {issue.returnable != null && <InfoRow label="Returnable" value={issue.returnable ? 'Yes' : 'No'} />}
                {issue.destructive != null && <InfoRow label="Destructive test" value={issue.destructive ? 'Yes' : 'No'} />}
                {issue.purpose && <InfoRow label="Purpose" value={issue.purpose === 'trial' ? 'Trial' : 'Sample'} />}
                {issue.site_address && <InfoRow label="Site" value={issue.site_address} />}
                {(issue.vehicle_number || issue.transporter || issue.lr_number) && (
                  <InfoRow label="Transport" value={[issue.transporter, issue.vehicle_number, issue.lr_number && `LR ${issue.lr_number}`].filter(Boolean).join(' · ')} />
                )}
                {issue.scrap_buyer && <InfoRow label="Scrap buyer" value={issue.scrap_buyer} />}
              </Row>
              <Row>
                <InfoRow label="Issue Date" value={issue.issue_date} />
                <InfoRow label="Requested By" value={issue.requested_by_name || '—'} />
                <InfoRow label="Issued By" value={issue.issued_by_name || '—'} />
              </Row>
              {issue.op_number && (
                <div data-tour="issue-detail-order-project">
                  <p style={{ fontSize: 10.5, fontWeight: 600, letterSpacing: '.04em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 4px' }}>Order Project</p>
                  <OrderProjectChip opNumber={issue.op_number} elementNo={issue.element_no} label={issue.element_label}
                    onClick={can('projects', 'order_projects', 'view') ? () => router.push(recordPath('/dashboard/projects/order-projects', issue, 'order_project_id')) : undefined} />
                </div>
              )}
              {issue.project_stock_override_reason && (
                <InfoRow label="Project stock used (Store Manager override)" value={issue.project_stock_override_reason} />
              )}
              {issue.p2p_number && (
                <div>
                  <p style={{ fontSize: 10.5, fontWeight: 600, letterSpacing: '.04em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 2px' }}>Purchase Requisition</p>
                  <span onClick={() => router.push(recordPath('/dashboard/p2p', issue, 'p2p_request_id'))} style={{ fontSize: 13, fontWeight: 600, color: '#2563eb', cursor: 'pointer' }}>{issue.p2p_number}</span>
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
                  {['Item', 'Quantity', 'Batch', ...(showLineElement ? ['Vehicle / lot'] : []), 'Remarks'].map((h) => (
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
                    {showLineElement && <td style={{ padding: '12px 16px', fontSize: 13, color: TEXT.secondary }}>{line.element_display || '—'}</td>}
                    <td style={{ padding: '12px 16px', fontSize: 13, color: TEXT.secondary }}>{line.remarks || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {issue.issue_type === 'job_work' && (
            <div style={{ marginTop: 20 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 10 }}>
                <p style={{ fontSize: 12, fontWeight: 700, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: 0 }}>Job Work Challan</p>
                <span onClick={() => router.push('/dashboard/store/job-work')} style={{ fontSize: 12.5, fontWeight: 600, color: '#2563eb', cursor: 'pointer' }}>
                  Open in Job Work (stock at vendor, receive back) →
                </span>
              </div>
              <ManagedDocumentPanel entityType="store_job_work_challan" entityId={issue.id} revision={0}
                canModify={can('store', 'issues', 'edit')} recordLabel={`Job work challan ${issue.challan_number || issue.issue_number}`}
                downloadName={`JW-Challan-${(issue.challan_number || issue.issue_number).replace(/\//g, '-')}`} />
            </div>
          )}
        </>
      )}
    </div>
  )
}
