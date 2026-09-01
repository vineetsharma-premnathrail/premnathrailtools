'use client'

import { useRouter } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { TEXT } from '@/lib/theme'
import P2PNav from '@/components/p2p/P2PNav'
import P2PRequestList from '@/components/p2p/P2PRequestList'

export default function P2PPaymentPage() {
  const { isAuthorized, isLoading } = useRequireApp('p2p')
  const router = useRouter()
  if (isLoading || !isAuthorized) return null

  return (
    <div>
      <P2PNav />
      <button onClick={() => router.push('/dashboard/p2p')} style={{ fontSize: 13, fontWeight: 600, color: TEXT.secondary, background: 'none', border: 'none', cursor: 'pointer', padding: 0, marginBottom: 12 }}>
        ← Back
      </button>
      <p style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 4px' }}>
        Procure-to-Pay Module
      </p>
      <h1 style={{ fontSize: 24, fontWeight: 700, color: TEXT.heading, margin: '0 0 20px' }}>Payment</h1>
      <P2PRequestList statuses={['closed']} emptyLabel="No requests at Payment stage." />
    </div>
  )
}
