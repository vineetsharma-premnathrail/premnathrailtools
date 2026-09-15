'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { TEXT } from '@/lib/theme'
import P2PNav from '@/components/p2p/P2PNav'
import P2PRequestList from '@/components/p2p/P2PRequestList'

type Bucket = 'pending' | 'approved' | 'rejected' | 'all'

const BUCKETS: { key: Bucket; label: string; statuses?: string[]; emptyLabel: string }[] = [
  { key: 'pending', label: 'Pending', statuses: ['submitted'], emptyLabel: 'No requests pending approval.' },
  { key: 'approved', label: 'Approved', statuses: ['approved', 'po_raised', 'po_approved', 'partially_received', 'received', 'closed'], emptyLabel: 'No approved requests yet.' },
  { key: 'rejected', label: 'Rejected', statuses: ['rejected'], emptyLabel: 'No rejected requests.' },
  { key: 'all', label: 'All', statuses: undefined, emptyLabel: 'No requests found.' },
]

export default function P2PApprovalPage() {
  const { isAuthorized, isLoading } = useRequireApp('p2p')
  const router = useRouter()
  const searchParams = useSearchParams()
  const bucket: Bucket = (['pending', 'approved', 'rejected', 'all'] as Bucket[]).includes(searchParams.get('bucket') as Bucket)
    ? (searchParams.get('bucket') as Bucket)
    : 'pending'
  const active = BUCKETS.find((b) => b.key === bucket) || BUCKETS[0]

  if (isLoading || !isAuthorized) return null

  return (
    <div>
      <P2PNav />
      <p style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 4px' }}>
        Procure-to-Pay Module
      </p>
      <h1 style={{ fontSize: 24, fontWeight: 700, color: TEXT.heading, margin: '0 0 16px' }}>P.R Approval</h1>

      <div style={{ display: 'inline-flex', gap: 4, padding: 4, borderRadius: 12, background: 'rgba(0,0,0,0.05)', marginBottom: 16 }}>
        {BUCKETS.map((b) => (
          <button
            key={b.key}
            data-tour={`pr-approval-bucket-${b.key}`}
            onClick={() => router.push(`/dashboard/p2p/approval?bucket=${b.key}`)}
            style={{
              padding: '8px 16px',
              borderRadius: 8,
              border: 'none',
              fontSize: 12.5,
              fontWeight: 600,
              cursor: 'pointer',
              background: bucket === b.key ? '#fff' : 'transparent',
              color: bucket === b.key ? '#FF7A45' : '#78716c',
              boxShadow: bucket === b.key ? '0 2px 6px rgba(0,0,0,0.08)' : 'none',
            }}
          >
            {b.label}
          </button>
        ))}
      </div>

      <P2PRequestList statuses={active.statuses} emptyLabel={active.emptyLabel} context="approval" />
    </div>
  )
}
