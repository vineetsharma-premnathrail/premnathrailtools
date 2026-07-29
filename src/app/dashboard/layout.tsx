'use client'

import { useEffect, useState } from 'react'
import { usePathname } from 'next/navigation'
import { useAuth } from '@/hooks/useAuth'
import Sidebar from '@/components/Sidebar'
import LoadingSpinner from '@/components/LoadingSpinner'
import { GLASS, GRADIENTS } from '@/lib/theme'

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const { user, isLoading } = useAuth()
  const pathname = usePathname()
  const [sidebarOpen, setSidebarOpen] = useState(false)

  // Close the mobile drawer whenever the route changes.
  useEffect(() => { setSidebarOpen(false) }, [pathname])

  if (isLoading) {
    return <LoadingSpinner />
  }

  if (!user) {
    return null
  }

  return (
    <div
      className="app-shell"
      style={{
        position: 'relative',
        display: 'flex',
        height: '100vh',
        overflow: 'hidden',
        background: GRADIENTS.page,
        padding: 16,
        gap: 16,
        boxSizing: 'border-box',
      }}
    >
      {/* Decorative color blobs — a glass panel needs something visibly
          textured behind it to blur/refract; a flat gradient alone makes
          backdrop-filter invisible no matter how correct the CSS is. */}
      <div style={{ position: 'absolute', top: '-10%', left: '15%', width: 460, height: 460, borderRadius: '50%', background: 'radial-gradient(circle, rgba(255,122,69,0.38), transparent 70%)', filter: 'blur(10px)', pointerEvents: 'none', zIndex: -1 }} />
      <div style={{ position: 'absolute', bottom: '-15%', left: '35%', width: 500, height: 500, borderRadius: '50%', background: 'radial-gradient(circle, rgba(232,90,31,0.26), transparent 70%)', filter: 'blur(10px)', pointerEvents: 'none', zIndex: -1 }} />
      <div style={{ position: 'absolute', top: '20%', right: '5%', width: 400, height: 400, borderRadius: '50%', background: 'radial-gradient(circle, rgba(99,102,241,0.20), transparent 70%)', filter: 'blur(10px)', pointerEvents: 'none', zIndex: -1 }} />

      <div className="mobile-topbar" style={{ position: 'sticky', zIndex: 50, alignItems: 'center', gap: 12, padding: '12px 16px', top: 0, background: GLASS.strong, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur, borderBottom: `1px solid ${GLASS.border}` }}>
        <button
          onClick={() => setSidebarOpen(true)}
          aria-label="Open menu"
          style={{ width: 38, height: 38, flex: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 10, border: `1px solid ${GLASS.border}`, background: 'rgba(255,255,255,0.5)', cursor: 'pointer' }}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#3a2416" strokeWidth="2" strokeLinecap="round">
            <line x1="4" y1="6" x2="20" y2="6" /><line x1="4" y1="12" x2="20" y2="12" /><line x1="4" y1="18" x2="20" y2="18" />
          </svg>
        </button>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo.png" alt="Premnathrail" style={{ width: 130, height: 26, borderRadius: 6, objectFit: 'contain' }} />
      </div>

      <div className={`sidebar-backdrop${sidebarOpen ? ' is-open' : ''}`} onClick={() => setSidebarOpen(false)} />

      <div className={`app-sidebar${sidebarOpen ? ' is-open' : ''}`}>
        <Sidebar user={user} onNavigate={() => setSidebarOpen(false)} />
      </div>

      <main className="dashboard-main" style={{ flex: 1, minWidth: 0, minHeight: 0, padding: 5, overflow: 'auto' }}>{children}</main>
    </div>
  )
}
