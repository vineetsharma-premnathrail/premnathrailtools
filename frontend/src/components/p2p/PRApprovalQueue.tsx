'use client'

// The requisitions waiting on the viewer's approval — shown as the "Approvals"
// view of the Purchase Requisitions page (the separate P.R Approval tab was
// folded in, 2026-10-07). Approvers come from Organization › Approval Workflows.

import { useState } from 'react'
import P2PRequestList from '@/components/p2p/P2PRequestList'

type Bucket = 'pending' | 'approved' | 'rejected' | 'all'

const BUCKETS: { key: Bucket; label: string; statuses?: string[]; emptyLabel: string }[] = [
  { key: 'pending', label: 'Waiting for me', statuses: ['submitted'], emptyLabel: 'Nothing is waiting for your approval.' },
  { key: 'approved', label: 'Approved', statuses: ['approved', 'vendor_quotations', 'technical_evaluation', 'commercial_evaluation', 'vendor_selected', 'po_drafted', 'po_raised', 'po_approved', 'partially_received', 'received', 'closed'], emptyLabel: 'No approved requests yet.' },
  { key: 'rejected', label: 'Rejected', statuses: ['rejected'], emptyLabel: 'No rejected requests.' },
  { key: 'all', label: 'All', statuses: undefined, emptyLabel: 'No requests found.' },
]

const bucketFromUrl = (): Bucket => {
  if (typeof window === 'undefined') return 'pending'
  const b = new URLSearchParams(window.location.search).get('bucket') as Bucket
  return BUCKETS.some((x) => x.key === b) ? b : 'pending'
}

export default function PRApprovalQueue() {
  const [bucket, setBucket] = useState<Bucket>(bucketFromUrl)
  const active = BUCKETS.find((b) => b.key === bucket) || BUCKETS[0]
  return (
    <div>
      <div style={{ display: 'inline-flex', gap: 4, padding: 4, borderRadius: 12, background: 'rgba(0,0,0,0.05)', marginBottom: 16 }}>
        {BUCKETS.map((b) => (
          <button key={b.key} type="button" data-tour={`pr-approval-bucket-${b.key}`} onClick={() => setBucket(b.key)}
            style={{
              padding: '8px 16px', borderRadius: 8, border: 'none', fontSize: 12.5, fontWeight: 600, cursor: 'pointer',
              background: bucket === b.key ? '#fff' : 'transparent', color: bucket === b.key ? '#FF7A45' : '#78716c',
              boxShadow: bucket === b.key ? '0 2px 6px rgba(0,0,0,0.08)' : 'none',
            }}>
            {b.label}
          </button>
        ))}
      </div>
      <P2PRequestList key={bucket} statuses={active.statuses} emptyLabel={active.emptyLabel} context="approval" queue="pr-approval" onlyPendingForViewer={bucket === 'pending'} />
    </div>
  )
}
