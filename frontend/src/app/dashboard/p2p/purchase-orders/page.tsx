'use client'

// Purchase Orders: approve POs, track their delivery, and see goods the store
// received Before PO — one tab. POs are not created here (owner, 2026-10-30):
// the PO is made in Tally and uploaded on its requisition (Upload PO).

import { useState } from 'react'
import { useAuth } from '@/hooks/useAuth'
import { useCan } from '@/lib/permissions'
import { TEXT } from '@/lib/theme'
import P2PNav from '@/components/p2p/P2PNav'
import POApprovalQueue from '@/components/p2p/POApprovalQueue'
import POTrackingList from '@/components/p2p/POTrackingList'
import { useP2PApproverFlags } from '@/components/p2p/useP2PApproverFlags'
import BeforePOPendingList from '@/components/p2p/BeforePOPendingList'

type View = 'before_po' | 'approvals' | 'tracking'

export default function PurchaseOrdersPage() {
  const { user, isLoading } = useAuth()
  const { can } = useCan()
  const isPurchase = !!user?.apps?.includes('purchase') || user?.role === 'admin'
  const canCreatePo = isPurchase && can('p2p', 'purchase_orders', 'create')
  const isApprover = useP2PApproverFlags().is_po_approver
  const views: { key: View; label: string }[] = [
    ...(canCreatePo ? [{ key: 'before_po' as const, label: 'Before PO' }] : []),
    ...(isApprover ? [{ key: 'approvals' as const, label: 'Approvals' }] : []),
    ...(isPurchase ? [{ key: 'tracking' as const, label: 'Tracking' }] : []),
  ]
  const [picked, setPicked] = useState<View | null>(() => {
    if (typeof window === 'undefined') return null
    const v = new URLSearchParams(window.location.search).get('view')
    return v === 'before_po' || v === 'approvals' || v === 'tracking' ? v : null
  })

  if (isLoading || !user) return null
  if (!views.length) {
    return (
      <div>
        <P2PNav />
        <p style={{ fontSize: 13, color: TEXT.muted }}>Purchase Orders are for the purchase team and the PO approvers.</p>
      </div>
    )
  }
  const view = picked && views.some((v) => v.key === picked) ? picked : views[0].key
  return (
    <div>
      <P2PNav />
      <h1 style={{ fontSize: 24, fontWeight: 700, color: TEXT.heading, margin: '0 0 14px' }}>Purchase Orders</h1>

      <div style={{ display: 'flex', gap: 4, marginBottom: 16, borderBottom: '1px solid rgba(0,0,0,0.08)' }}>
        {views.map((v) => (
          <button key={v.key} type="button" data-tour={`po-view-${v.key}`} onClick={() => setPicked(v.key)}
            style={{
              padding: '9px 14px', marginBottom: -1, border: 'none', background: 'transparent', cursor: 'pointer', fontSize: 13, fontWeight: 600,
              color: view === v.key ? '#FF7A45' : '#78716c', borderBottom: view === v.key ? '2px solid #FF7A45' : '2px solid transparent',
            }}>
            {v.label}
          </button>
        ))}
      </div>

      {view === 'before_po' && <BeforePOPendingList />}
      {view === 'approvals' && <POApprovalQueue />}
      {view === 'tracking' && <POTrackingList />}
    </div>
  )
}
