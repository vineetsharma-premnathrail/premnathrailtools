'use client'

import { useEffect, useRef, useState } from 'react'
import { usePathname } from 'next/navigation'
import { useAuth } from '@/hooks/useAuth'
import Sidebar from '@/components/Sidebar'
import LoadingSpinner from '@/components/LoadingSpinner'
import ScrollRevealObserver from '@/components/ScrollRevealObserver'
import { GLASS } from '@/lib/theme'

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const { user, isLoading } = useAuth()
  const pathname = usePathname()
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const mainRef = useRef<HTMLElement>(null)

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
      className="app-shell animated-gradient-bg"
      style={{
        position: 'relative',
        display: 'flex',
        height: '100vh',
        overflow: 'hidden',
        padding: 16,
        gap: 16,
        boxSizing: 'border-box',
      }}
    >
      {/* Decorative color blobs — a glass panel needs something visibly
          textured behind it to blur/refract; a flat gradient alone makes
          backdrop-filter invisible no matter how correct the CSS is.
          Wrapped in its own overflow:hidden, inset:0 box (rather than
          relying on .app-shell's own overflow) because the blobs use
          percentage top/bottom offsets (e.g. bottom:-15%) that read against
          .app-shell's own auto height on mobile — on desktop .app-shell's
          overflow:hidden clips the excess, but on mobile it's overflow:visible
          (for natural single-page scroll), so the clipped-off ~15-20% of
          each blob was instead adding ~300px of true page scrollHeight below
          all real content. Clipping locally keeps that overflow invisible
          regardless of the shell's own overflow setting. */}
      <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', pointerEvents: 'none', zIndex: -1 }}>
        <div style={{ position: 'absolute', top: '-10%', left: '15%', width: 460, height: 460, borderRadius: '50%', background: 'radial-gradient(circle, rgba(255,122,69,0.48), transparent 70%)', filter: 'blur(8px)' }} />
        <div style={{ position: 'absolute', bottom: '-15%', left: '35%', width: 500, height: 500, borderRadius: '50%', background: 'radial-gradient(circle, rgba(232,90,31,0.34), transparent 70%)', filter: 'blur(8px)' }} />
        <div style={{ position: 'absolute', top: '20%', right: '5%', width: 400, height: 400, borderRadius: '50%', background: 'radial-gradient(circle, rgba(99,102,241,0.28), transparent 70%)', filter: 'blur(8px)' }} />
        <div style={{ position: 'absolute', top: '55%', left: '5%', width: 360, height: 360, borderRadius: '50%', background: 'radial-gradient(circle, rgba(16,185,129,0.30), transparent 70%)', filter: 'blur(8px)' }} />
        <div style={{ position: 'absolute', top: '5%', right: '25%', width: 320, height: 320, borderRadius: '50%', background: 'radial-gradient(circle, rgba(236,72,153,0.26), transparent 70%)', filter: 'blur(8px)' }} />
      </div>

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

      <main ref={mainRef} className="dashboard-main" style={{ flex: 1, minWidth: 0, minHeight: 0, padding: 5, overflow: 'auto' }}>
        {children}
      </main>
      <ScrollRevealObserver containerRef={mainRef} />
    </div>
  )
}
