'use client'

import { useRequireApp } from '@/hooks/useAuth'
import { TEXT } from '@/lib/theme'
import P2PNav from '@/components/p2p/P2PNav'
import P2PRequestList from '@/components/p2p/P2PRequestList'

export default function P2PPoApprovalPage() {
  const { isAuthorized, isLoading } = useRequireApp('p2p')
  if (isLoading || !isAuthorized) return null

  return (
    <div>
      <P2PNav />
      <p style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 4px' }}>
        Procure-to-Pay Module
      </p>
      <h1 style={{ fontSize: 24, fontWeight: 700, color: TEXT.heading, margin: '0 0 20px' }}>P.O Approval</h1>
      <P2PRequestList statuses={['po_raised']} emptyLabel="No requests at PO Approval stage." context="po-approval" />
    </div>
  )
}
