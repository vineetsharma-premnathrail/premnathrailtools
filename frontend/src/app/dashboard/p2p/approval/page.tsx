'use client'

import { useRequireApp } from '@/hooks/useAuth'
import { TEXT } from '@/lib/theme'
import P2PNav from '@/components/p2p/P2PNav'
import P2PRequestList from '@/components/p2p/P2PRequestList'

export default function P2PApprovalPage() {
  const { isAuthorized, isLoading } = useRequireApp('p2p')
  if (isLoading || !isAuthorized) return null

  return (
    <div>
      <p style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 4px' }}>
        P2P Module
      </p>
      <h1 style={{ fontSize: 24, fontWeight: 800, color: TEXT.heading, margin: '0 0 20px' }}>Approval</h1>
      <P2PNav />
      <P2PRequestList statuses={['submitted']} emptyLabel="No requests pending approval." />
    </div>
  )
}
