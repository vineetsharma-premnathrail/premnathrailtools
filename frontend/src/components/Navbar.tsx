'use client'

import { User } from '@/types'
import { useAuthStore } from '@/store/authStore'
import { useRouter } from 'next/navigation'
import UpdatesButton from '@/components/UpdatesButton'

export default function Navbar({ user }: { user: User | null }) {
  const router = useRouter()
  const logout = useAuthStore((state) => state.logout)

  const handleLogout = async () => {
    await logout()
    router.push('/login')
  }

  return (
    <nav
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: '14px 32px',
        position: 'sticky',
        top: 0,
        zIndex: 20,
        background: 'rgba(255,250,245,0.85)',
        backdropFilter: 'blur(14px)',
        borderBottom: '1px solid rgba(180,120,80,0.15)',
      }}
    >
      <div />

      {user && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
          <UpdatesButton />

          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 12px', borderRadius: 14, cursor: 'pointer' }}>
            <div
              style={{
                width: 36,
                height: 36,
                borderRadius: '50%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#fff',
                fontWeight: 600,
                fontSize: 13,
                background: 'linear-gradient(140deg,#FF7A45,#ffffff)',
                boxShadow: '0 4px 12px rgba(224,98,31,.35)',
              }}
            >
              {user.name.split(' ').map((n) => n[0]).join('').toUpperCase()}
            </div>
            <div style={{ display: 'none' }} className="navbar-user-info">
              <p style={{ fontSize: 13, fontWeight: 600, color: '#2e1c10', margin: 0 }}>{user.name}</p>
              <p style={{ fontSize: 11, color: '#a8663a', margin: 0, textTransform: 'capitalize' }}>{user.role}</p>
            </div>
          </div>

          <div style={{ height: 24, width: 1, background: 'rgba(180,120,80,0.25)' }} />

          <button
            onClick={handleLogout}
            style={{
              fontSize: 13,
              fontWeight: 500,
              color: '#8a4a20',
              background: 'transparent',
              border: 'none',
              padding: '8px 16px',
              borderRadius: 12,
              cursor: 'pointer',
            }}
          >
            Sign out
          </button>
        </div>
      )}

      <style jsx>{`
        @media (min-width: 768px) {
          .navbar-user-info {
            display: block !important;
          }
        }
      `}</style>
    </nav>
  )
}
