'use client'

// Purchase Orders: create the PO (from a requisition whose RFQ is done),
// approve it, and track its delivery — one tab, like Purchase Requisitions.

import { useState } from 'react'
import { useAuth } from '@/hooks/useAuth'
import { useCan } from '@/lib/permissions'
import { TEXT, GRADIENTS, SHADOWS } from '@/lib/theme'
import P2PNav from '@/components/p2p/P2PNav'
import POReadyList from '@/components/p2p/POReadyList'
import POApprovalQueue from '@/components/p2p/POApprovalQueue'
import POTrackingList from '@/components/p2p/POTrackingList'
import POOpenItems from '@/components/p2p/POOpenItems'
import CreatePODialog from '@/components/p2p/CreatePODialog'
import { useP2PApproverFlags } from '@/components/p2p/useP2PApproverFlags'

type View = 'create' | 'approvals' | 'tracking' | 'open_items'

export default function PurchaseOrdersPage() {
  const { user, isLoading } = useAuth()
  const { can } = useCan()
  const isPurchase = !!user?.apps?.includes('purchase') || user?.role === 'admin'
  const canCreatePo = isPurchase && can('p2p', 'purchase_orders', 'create')
  const isApprover = useP2PApproverFlags().is_po_approver
  const views: { key: View; label: string }[] = [
    ...(canCreatePo ? [{ key: 'create' as const, label: 'Create PO' }] : []),
    ...(isApprover ? [{ key: 'approvals' as const, label: 'Approvals' }] : []),
    ...(isPurchase ? [{ key: 'tracking' as const, label: 'Tracking' }] : []),
    // ME2N / ME2L / ME2M line-level open PO report + ME23N PO history.
    ...(isPurchase || can('p2p', 'purchase_orders', 'view') ? [{ key: 'open_items' as const, label: 'Open Items' }] : []),
  ]
  const [createFor, setCreateFor] = useState<number | 'new' | null>(null)
  const [picked, setPicked] = useState<View | null>(() => {
    if (typeof window === 'undefined') return null
    const v = new URLSearchParams(window.location.search).get('view')
    return v === 'create' || v === 'approvals' || v === 'tracking' || v === 'open_items' ? v : null
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
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', marginBottom: 14 }}>
        <div>
          <p style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 4px' }}>Procurement Module</p>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: TEXT.heading, margin: 0 }}>Purchase Orders</h1>
        </div>
        {canCreatePo && (
          <button type="button" data-tour="po-create-btn" onClick={() => setCreateFor('new')}
            style={{ padding: '12px 22px', borderRadius: 12, border: 'none', cursor: 'pointer', background: GRADIENTS.primary, color: '#fff', fontSize: 14, fontWeight: 600, boxShadow: `0 8px 20px ${SHADOWS.glowOrange}` }}>
            + Create PO
          </button>
        )}
      </div>

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

      {view === 'create' && <POReadyList onCreate={(rfqId) => setCreateFor(rfqId)} />}
      {createFor !== null && <CreatePODialog initialRfqId={createFor === 'new' ? undefined : createFor} onClose={() => setCreateFor(null)} />}
      {view === 'approvals' && <POApprovalQueue />}
      {view === 'tracking' && <POTrackingList />}
      {view === 'open_items' && <POOpenItems />}
    </div>
  )
}
