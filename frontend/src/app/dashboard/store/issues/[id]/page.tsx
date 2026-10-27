'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { storeApi } from '@/lib/api'
import { StoreMaterialIssue } from '@/types'
import { TEXT } from '@/lib/theme'
import { secondaryBtnStyle, smallSecondaryBtnStyle, RowCount, Pill, TableScroll, thStyle, tdStyle, numThStyle, numTdStyle, DetailCard, DetailSummary, DetailGroup, DetailRow } from '@/components/shared/ui'
import { formatDate } from '@/lib/format'
import StoreNav from '@/components/store/StoreNav'
import ManagedDocumentPanel from '@/components/shared/ManagedDocumentPanel'
import { useCan } from '@/lib/permissions'
import InvalidRecordLink from '@/components/erp/InvalidRecordLink'
import { recordPath, useRecordId } from '@/lib/recordRef'
import MessageDialog from '@/components/erp/MessageDialog'
import { extractErrorMessages } from '@/lib/validation'
import { OrderProjectChip } from '@/components/sales/ProjectUnitPicker'

const linkBtn: React.CSSProperties = { background: 'none', border: 'none', padding: 0, fontSize: 13.5, fontWeight: 600, color: '#2563eb', cursor: 'pointer' }
const yesNo = (v?: boolean | null) => (v == null ? null : v ? 'Yes' : 'No')

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

  // A dispatch can ship several vehicles: show each line's unit when they differ from the header's.
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

          {/* One record view: what was issued, from where, to whom — then every fact as label–value rows. */}
          <DetailCard tour="issue-detail-summary">
            <DetailSummary
              title={issue.issue_number}
              text={`${issue.issue_type_label || 'Material'} issue from ${issue.location_name || 'the store'}${issue.department_name ? ` to ${issue.department_name}` : ''}${issue.against_label ? ` against ${issue.against_label}` : ''} — ${issue.items.length} item line${issue.items.length === 1 ? '' : 's'}.`}
              meta={<>
                {issue.issue_type_label && <Pill label={issue.issue_type_label} hex="#2563eb" />}
                <span>· Issued {formatDate(issue.issue_date)}</span>
                {issue.issued_by_name && <span>· by <strong style={{ color: TEXT.heading }}>{issue.issued_by_name}</strong></span>}
                {issue.requested_by_name && <span>· Requested by <strong style={{ color: TEXT.heading }}>{issue.requested_by_name}</strong></span>}
              </>}
            />
            <DetailGroup title="Issued To">
              <DetailRow label="Store">{issue.location_name}</DetailRow>
              <DetailRow label="Department">{issue.department_name}</DetailRow>
              {issue.against_label && <DetailRow label="Against">{issue.against_label}</DetailRow>}
              {issue.project_or_work_order && <DetailRow label="Work Order / Reference">{issue.project_or_work_order}</DetailRow>}
              {issue.op_number && (
                <div data-tour="issue-detail-order-project">
                  <DetailRow label="Project">
                    <OrderProjectChip opNumber={issue.op_number} elementNo={issue.element_no} label={issue.element_label}
                      onClick={can('projects', 'all_projects', 'view') ? () => router.push(recordPath('/dashboard/projects', issue, 'order_project_id')) : undefined} />
                  </DetailRow>
                </div>
              )}
              {issue.p2p_number && (
                <DetailRow label="Purchase Requisition">
                  <button type="button" onClick={() => router.push(recordPath('/dashboard/p2p', issue, 'p2p_request_id'))} style={linkBtn}>{issue.p2p_number}</button>
                </DetailRow>
              )}
            </DetailGroup>
            {(issue.challan_number || issue.expected_return_date || issue.returnable != null || issue.destructive != null || issue.purpose || issue.site_address || issue.vehicle_number || issue.transporter || issue.lr_number || issue.scrap_buyer) && (
              <DetailGroup title="Dispatch & Return">
                {issue.challan_number && <DetailRow label="Challan No.">{issue.challan_number}</DetailRow>}
                {issue.returnable != null && <DetailRow label="Returnable">{yesNo(issue.returnable)}</DetailRow>}
                {issue.expected_return_date && <DetailRow label="Expected return">{formatDate(issue.expected_return_date)}</DetailRow>}
                {issue.purpose && <DetailRow label="Purpose">{issue.purpose === 'trial' ? 'Trial' : 'Sample'}</DetailRow>}
                {issue.destructive != null && <DetailRow label="Destructive test">{yesNo(issue.destructive)}</DetailRow>}
                {issue.site_address && <DetailRow label="Site">{issue.site_address}</DetailRow>}
                {(issue.vehicle_number || issue.transporter || issue.lr_number) && (
                  <DetailRow label="Transport">{[issue.transporter, issue.vehicle_number, issue.lr_number && `LR ${issue.lr_number}`].filter(Boolean).join(' · ')}</DetailRow>
                )}
                {issue.scrap_buyer && <DetailRow label="Scrap buyer">{issue.scrap_buyer}</DetailRow>}
              </DetailGroup>
            )}
            <DetailGroup last>
              {issue.project_stock_override_reason && (
                <DetailRow label="Project stock used (Store Manager override)">{issue.project_stock_override_reason}</DetailRow>
              )}
              <DetailRow label="Remarks">{issue.remarks}</DetailRow>
            </DetailGroup>
          </DetailCard>

          <p style={{ fontSize: 12, fontWeight: 700, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 10px' }}>Items</p>
          <div data-tour="issue-detail-items">
            <TableScroll maxHeight="none" minWidth={560}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={thStyle}>Item <RowCount count={issue.items.length} /></th>
                    <th style={numThStyle}>Quantity</th>
                    <th style={thStyle}>Batch</th>
                    {showLineElement && <th style={thStyle}>Vehicle / lot</th>}
                    <th style={thStyle}>Remarks</th>
                  </tr>
                </thead>
                <tbody>
                  {issue.items.length === 0 ? (
                    <tr><td colSpan={showLineElement ? 5 : 4} style={{ ...tdStyle, textAlign: 'center', color: TEXT.muted }}>No item lines on this issue.</td></tr>
                  ) : issue.items.map((line) => (
                    <tr key={line.id}>
                      <td style={{ ...tdStyle, fontWeight: 600 }}>{line.item_code} — {line.item_name}</td>
                      <td style={numTdStyle}>{line.quantity.toLocaleString('en-IN', { maximumFractionDigits: 3 })} {line.uom}</td>
                      <td style={tdStyle}>{line.batch_number || '—'}</td>
                      {showLineElement && <td style={tdStyle}>{line.element_display || '—'}</td>}
                      <td style={tdStyle}>{line.remarks || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableScroll>
          </div>

          {issue.issue_type === 'job_work' && (
            <div style={{ marginTop: 20 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 10 }}>
                <p style={{ fontSize: 12, fontWeight: 700, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: 0 }}>Job Work Challan</p>
                <button type="button" onClick={() => router.push('/dashboard/store/job-work')} style={smallSecondaryBtnStyle}>
                  Open in Job Work (stock at vendor, receive back) →
                </button>
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
