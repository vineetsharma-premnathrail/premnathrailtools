'use client'

import { useRouter } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { TEXT, SHADOWS, GRADIENTS } from '@/lib/theme'
import P2PNav from '@/components/p2p/P2PNav'
import P2PRequestList from '@/components/p2p/P2PRequestList'

export default function P2PHomePage() {
  const { isAuthorized, isLoading, user } = useRequireApp('p2p')
  const router = useRouter()

  if (isLoading || !isAuthorized) return null

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, marginBottom: 20, flexWrap: 'wrap' }}>
        <div>
          <p style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 4px' }}>
            P2P Module
          </p>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: TEXT.heading, margin: '0 0 4px' }}>My PRs</h1>
          <p style={{ fontSize: 13.5, color: TEXT.muted, margin: 0 }}>{user?.department ? `${user.department} — ` : ''}Purchase Requisitions</p>
        </div>
        <button
          onClick={() => router.push('/dashboard/p2p/new')}
          style={{
            padding: '12px 22px', borderRadius: 12, border: 'none', cursor: 'pointer',
            background: GRADIENTS.primary, color: '#fff', fontSize: 14, fontWeight: 600,
            boxShadow: `0 8px 20px ${SHADOWS.glowOrange}`,
          }}
        >
          + New PR
        </button>
      </div>

      <P2PNav />

      <P2PRequestList emptyLabel="You haven't raised any PRs yet." />
    </div>
  )
}
