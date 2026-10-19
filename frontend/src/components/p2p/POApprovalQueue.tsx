'use client'

// POs waiting for the viewer's approval — the "Approvals" view of Purchase
// Orders. Who approves is the "Purchase order" approval workflow.

import { useState } from 'react'
import P2PRequestList from '@/components/p2p/P2PRequestList'

type Bucket = 'pending' | 'approved' | 'rejected' | 'all'

const BUCKETS: { key: Bucket; label: string; statuses?: string[]; emptyLabel: string }[] = [
  { key: 'pending', label: 'Waiting for approval', statuses: ['po_raised'], emptyLabel: 'No PO is waiting for approval.' },
  { key: 'approved', label: 'Approved', statuses: ['po_approved', 'partially_received', 'received', 'closed'], emptyLabel: 'No approved POs yet.' },
  { key: 'rejected', label: 'Rejected', statuses: ['rejected'], emptyLabel: 'No rejected POs.' },
  { key: 'all', label: 'All', statuses: ['po_raised', 'po_approved', 'partially_received', 'received', 'closed', 'rejected'], emptyLabel: 'No POs found.' },
]

const bucketFromUrl = (): Bucket => {
  if (typeof window === 'undefined') return 'pending'
  const b = new URLSearchParams(window.location.search).get('bucket') as Bucket
  return BUCKETS.some((x) => x.key === b) ? b : 'pending'
}

export default function POApprovalQueue() {
  const [bucket, setBucket] = useState<Bucket>(bucketFromUrl)
  const active = BUCKETS.find((b) => b.key === bucket) || BUCKETS[0]
  return (
    <div>
      <div style={{ display: 'inline-flex', gap: 4, padding: 4, borderRadius: 12, background: 'rgba(0,0,0,0.05)', marginBottom: 16 }}>
        {BUCKETS.map((b) => (
          <button key={b.key} type="button" data-tour={`po-approval-bucket-${b.key}`} onClick={() => setBucket(b.key)}
            style={{
              padding: '8px 16px', borderRadius: 8, border: 'none', fontSize: 12.5, fontWeight: 600, cursor: 'pointer',
              background: bucket === b.key ? '#fff' : 'transparent', color: bucket === b.key ? '#FF7A45' : '#78716c',
              boxShadow: bucket === b.key ? '0 2px 6px rgba(0,0,0,0.08)' : 'none',
            }}>
            {b.label}
          </button>
        ))}
      </div>
      <P2PRequestList key={bucket} statuses={active.statuses} emptyLabel={active.emptyLabel} context="po-approval" queue="po-approval" />
    </div>
  )
}
