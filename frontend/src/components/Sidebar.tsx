'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { ReactNode, useRef, useState } from 'react'
import { User } from '@/types'
import { useAuthStore } from '@/store/authStore'
import { BRAND, TEXT, GLASS, SHADOWS, GRADIENTS } from '@/lib/theme'
import UpdatesButton from '@/components/UpdatesButton'
import FeedbackButton from '@/components/FeedbackButton'

const icons: Record<string, ReactNode> = {
  dashboard: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z" />
      <path d="M9 22V12h6v10" />
    </svg>
  ),
  erp: (
    <svg width="15" height="15" viewBox="0 0 512 512">
      <path fill="#8C8C8C" d="M332.8,85.333V153.6h-17.067v-42.667c0-4.693-3.84-8.533-8.533-8.533H204.8c-4.779,0-8.533,3.84-8.533,8.533V153.6H179.2V85.333H332.8z"  stroke="#1A1A1A" strokeWidth="4" />
      <path fill="#4D4D4D" d="M494.933,170.667v51.2h-76.8V204.8c0-4.693-3.84-8.533-8.533-8.533h-68.267c-4.779,0-8.533,3.84-8.533,8.533v17.067H179.2V204.8c0-4.693-3.84-8.533-8.533-8.533H102.4c-4.779,0-8.533,3.84-8.533,8.533v17.067h-76.8v-51.2H494.933z"  stroke="#1A1A1A" strokeWidth="4" />
      <rect x="110.933" y="213.333" fill="#8C8C8C" width="51.2" height="34.133"  stroke="#1A1A1A" strokeWidth="4" />
      <rect x="349.867" y="213.333" fill="#8C8C8C" width="51.2" height="34.133"  stroke="#1A1A1A" strokeWidth="4" />
      <path fill="#4D4D4D" d="M443.733,238.933v187.733H68.267V238.933h25.6V256c0,4.693,3.755,8.533,8.533,8.533h68.267c4.693,0,8.533-3.84,8.533-8.533v-17.067h153.6V256c0,4.693,3.755,8.533,8.533,8.533H409.6c4.693,0,8.533-3.84,8.533-8.533v-17.067H443.733z"  stroke="#1A1A1A" strokeWidth="4" />
      <path d="M503.467,153.6h-153.6V76.8c0-4.693-3.84-8.533-8.533-8.533H170.667c-4.779,0-8.533,3.84-8.533,8.533v76.8H8.533C3.755,153.6,0,157.44,0,162.133V230.4c0,4.693,3.755,8.533,8.533,8.533H51.2V435.2c0,4.693,3.755,8.533,8.533,8.533h392.533c4.693,0,8.533-3.84,8.533-8.533V238.933h42.667c4.693,0,8.533-3.84,8.533-8.533v-68.267C512,157.44,508.16,153.6,503.467,153.6z M179.2,85.333h153.6V153.6h-17.067v-42.667c0-4.693-3.84-8.533-8.533-8.533H204.8c-4.779,0-8.533,3.84-8.533,8.533V153.6H179.2V85.333z M298.667,119.467V153.6h-85.333v-34.133H298.667z M443.733,426.667H68.267V238.933h25.6V256c0,4.693,3.755,8.533,8.533,8.533h68.267c4.693,0,8.533-3.84,8.533-8.533v-17.067h153.6V256c0,4.693,3.755,8.533,8.533,8.533H409.6c4.693,0,8.533-3.84,8.533-8.533v-17.067h25.6V426.667z M110.933,247.467v-34.133h51.2v34.133H110.933z M349.867,247.467v-34.133h51.2v34.133H349.867z M494.933,221.867h-76.8V204.8c0-4.693-3.84-8.533-8.533-8.533h-68.267c-4.779,0-8.533,3.84-8.533,8.533v17.067H179.2V204.8c0-4.693-3.84-8.533-8.533-8.533H102.4c-4.779,0-8.533,3.84-8.533,8.533v17.067h-76.8v-51.2h477.867V221.867z"  stroke="#1A1A1A" strokeWidth="4" />
      <polygon fill="#1A1A1A" points="426.667,238.933 426.667,409.6 68.267,409.6 68.267,426.667 443.733,426.667 443.733,238.933"  stroke="#1A1A1A" strokeWidth="4" />
      <polygon fill="#666666" points="153.6,213.333 153.6,238.933 110.933,238.933 110.933,247.467 162.133,247.467 162.133,213.333"  stroke="#1A1A1A" strokeWidth="4" />
      <polygon fill="#666666" points="392.533,213.333 392.533,238.933 349.867,238.933 349.867,247.467 401.067,247.467 401.067,213.333"  stroke="#1A1A1A" strokeWidth="4" />
      <rect x="17.067" y="204.8" fill="#1A1A1A" width="76.8" height="17.067"  stroke="#1A1A1A" strokeWidth="4" />
      <polygon fill="#1A1A1A" points="477.867,170.667 477.867,204.8 418.133,204.8 418.133,221.867 494.933,221.867 494.933,170.667"  stroke="#1A1A1A" strokeWidth="4" />
      <rect x="179.2" y="204.8" fill="#1A1A1A" width="153.6" height="17.067"  stroke="#1A1A1A" strokeWidth="4" />
      <rect x="179.2" y="145.067" fill="#666666" width="17.067" height="8.533"  stroke="#1A1A1A" strokeWidth="4" />
      <rect x="315.733" y="145.067" fill="#666666" width="17.067" height="8.533"  stroke="#1A1A1A" strokeWidth="4" />
    </svg>
  ),
  rnd: (
    <svg width="15" height="15" viewBox="0 0 32 32">
      <path fill="#333333" d="M29,0H3C1.35,0,0,1.35,0,3v11h32V3C32,1.35,30.65,0,29,0z M28,12H4V4h24V12z"  stroke="#1A1A1A" strokeWidth="0.6" />
      <path fill="#808080" d="M0,29c0,1.65,1.35,3,3,3h26c1.65,0,3-1.35,3-3V14H0V29z"  stroke="#1A1A1A" strokeWidth="0.6" />
      <path fill="#E6E6E6" d="M4,4h24v8H4V4z M7,22c1.65,0,3-1.35,3-3c0-1.65-1.35-3-3-3s-3,1.35-3,3C4,20.65,5.35,22,7,22z
        M15,22c1.65,0,3-1.35,3-3c0-1.65-1.35-3-3-3s-3,1.35-3,3C12,20.65,13.35,22,15,22z M7,30c1.65,0,3-1.35,3-3c0-1.65-1.35-3-3-3
        s-3,1.35-3,3C4,28.65,5.35,30,7,30z M15,30c1.65,0,3-1.35,3-3c0-1.65-1.35-3-3-3s-3,1.35-3,3C12,28.65,13.35,30,15,30z M25,30
        c1.65,0,3-1.35,3-3c0-1.65-1.35-3-3-3s-3,1.35-3,3C22,28.65,23.35,30,25,30z"  stroke="#1A1A1A" strokeWidth="0.6" />
      <path fill="#4D4D4D" d="M25,22c1.65,0,3-1.35,3-3c0-1.65-1.35-3-3-3s-3,1.35-3,3C22,20.65,23.35,22,25,22z"  stroke="#1A1A1A" strokeWidth="0.6" />
    </svg>
  ),
  crm: (
    <svg width="15" height="15" viewBox="0 0 512 512">
      <circle fill="#1A1A1A" cx="256" cy="256" r="256"  stroke="#1A1A1A" strokeWidth="4" />
      <rect x="113.424" y="376" fill="#E6E5E5" width="285.144" height="8"  stroke="#1A1A1A" strokeWidth="4" />
      <rect x="157.296" y="400" fill="#E6E5E5" width="197.408" height="8"  stroke="#1A1A1A" strokeWidth="4" />
      <circle fill="#FFFFFF" cx="170.576" cy="179.488" r="37.384"  stroke="#1A1A1A" strokeWidth="4" />
      <path fill="#666666" d="M235.064,299.744c0,0,0,1.744,0-33.088s-38.016-35.472-38.016-35.472H144.12
        c0,0-38.016,0.424-38.016,35.472c0,34.832,0,33.088,0,33.088H235.064z"  stroke="#1A1A1A" strokeWidth="4" />
      <circle fill="#FFFFFF" cx="341.416" cy="179.488" r="37.384"  stroke="#1A1A1A" strokeWidth="4" />
      <path fill="#666666" d="M405.904,299.744c0,0,0,1.744,0-33.088s-38.016-35.472-38.016-35.472H314.96
        c0,0-38.016,0.424-38.016,35.472c0,34.832,0,33.088,0,33.088H405.904z"  stroke="#1A1A1A" strokeWidth="4" />
    </svg>
  ),
  purchase: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="9" cy="21" r="1" />
      <circle cx="20" cy="21" r="1" />
      <path d="M1 1h4l2.68 13.39a2 2 0 002 1.61h9.72a2 2 0 002-1.61L23 6H6" />
    </svg>
  ),
  p2p: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="16" y1="13" x2="8" y2="13" />
      <line x1="16" y1="17" x2="8" y2="17" />
    </svg>
  ),
  users: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21c0-4 4-6 8-6s8 2 8 6" />
    </svg>
  ),
  store: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 9l1-5h16l1 5" />
      <path d="M4 9v10a1 1 0 001 1h14a1 1 0 001-1V9" />
      <path d="M9 21V13h6v8" />
    </svg>
  ),
  hr: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" />
      <circle cx="12" cy="7" r="4" />
      <path d="M22 11h-6" /><path d="M19 8v6" />
    </svg>
  ),
  design: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 19l7-7 3 3-7 7-3-3z" />
      <path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z" />
      <path d="M2 2l7.586 7.586" />
      <circle cx="11" cy="11" r="2" />
    </svg>
  ),
  electrical: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
    </svg>
  ),
  organization: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="4" y="2" width="16" height="20" />
      <line x1="9" y1="7" x2="9" y2="7.01" />
      <line x1="15" y1="7" x2="15" y2="7.01" />
      <line x1="9" y1="12" x2="9" y2="12.01" />
      <line x1="15" y1="12" x2="15" y2="12.01" />
      <line x1="9" y1="17" x2="15" y2="17" />
    </svg>
  ),
  manufacturing: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14.7 6.3a4 4 0 00-5.6 5.6L2 19l3 3 7.1-7.1a4 4 0 005.6-5.6l-2.8 2.8-2-2z" />
    </svg>
  ),
}

export default function Sidebar({ user, onNavigate }: { user: User | null; onNavigate?: () => void }) {
  const pathname = usePathname()
  const router = useRouter()
  const logout = useAuthStore((state) => state.logout)
  const [menuOpen, setMenuOpen] = useState(false)
  const [collapsed, setCollapsed] = useState(false)
  const menuCloseTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const collapseTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const scheduleCollapse = () => {
    if (collapseTimer.current) clearTimeout(collapseTimer.current)
    collapseTimer.current = setTimeout(() => {
      setCollapsed(true)
      setMenuOpen(false)
    }, 600)
  }

  const cancelCollapse = () => {
    if (collapseTimer.current) {
      clearTimeout(collapseTimer.current)
      collapseTimer.current = null
    }
    setCollapsed(false)
  }

  const cancelMenuClose = () => {
    if (menuCloseTimer.current) {
      clearTimeout(menuCloseTimer.current)
      menuCloseTimer.current = null
    }
  }

  const scheduleMenuClose = () => {
    cancelMenuClose()
    menuCloseTimer.current = setTimeout(() => setMenuOpen(false), 150)
  }

  const handleLogout = async () => {
    await logout()
    router.push('/login')
  }

  const isAdmin = user?.role === 'admin'

  const links = [
    { href: '/dashboard', label: 'Dashboard', icon: 'dashboard', visible: true },
    { href: '/dashboard/erp', label: 'Service Module', icon: 'erp', visible: !!user?.apps?.includes('erp') },
    { href: '/dashboard/rnd', label: 'R&D Tools', icon: 'rnd', visible: !!user?.apps?.includes('rnd') },
    { href: '/dashboard/crm', label: 'CRM Module', icon: 'crm', visible: !!user?.apps?.includes('crm') },
    { href: '/dashboard/purchase', label: 'Purchase', icon: 'purchase', visible: !!user?.apps?.includes('purchase') },
    { href: '/dashboard/p2p', label: 'Procure-to-Pay', icon: 'p2p', visible: !!user?.apps?.includes('p2p') },
    { href: '/dashboard/store', label: 'Store', icon: 'store', visible: !!user?.apps?.includes('store') },
    { href: '/dashboard/hr', label: 'HR', icon: 'hr', visible: !!user?.apps?.includes('hr') },
    { href: '/dashboard/design', label: 'Design', icon: 'design', visible: !!user?.apps?.includes('design') },
    { href: '/dashboard/electrical', label: 'Electrical', icon: 'electrical', visible: !!user?.apps?.includes('electrical') },
    { href: '/dashboard/manufacturing', label: 'Manufacturing', icon: 'manufacturing', visible: !!user?.apps?.includes('manufacturing') },
    { href: '/dashboard/users', label: 'Users & Roles', icon: 'users', visible: isAdmin },
    { href: '/dashboard/organization', label: 'Organization', icon: 'organization', visible: isAdmin },
  ].filter((link) => link.visible)

  return (
    <div
      style={{
        position: 'sticky',
        width: collapsed ? 72 : 216,
        flex: 'none',
        top: 16,
        height: 'calc(100vh - 32px)',
        borderRadius: 22,
        // box-shadow lives on this plain wrapper — no overflow:hidden and no
        // backdrop-filter here — while the <aside> below keeps those. Mixing
        // box-shadow with overflow:hidden + backdrop-filter on the same
        // element caused a jagged/dashed rendering artifact that bled into
        // neighboring rows (Feedback, the user card).
        boxShadow: '-1px 1px 0px rgba(15,23,42,0.14), -4px 5px 3px rgba(15,23,42,0.1), -20px 26px 22px -6px rgba(15,23,42,0.25)',
        transition: 'width .28s cubic-bezier(.4,0,.2,1)',
        // Own compositing layer so this backdrop-filter panel doesn't sample
        // GPU repaint from nearby SVG-filtered elements (e.g. the dashboard
        // module cards' hover "goo" blob) — without this, hovering a card
        // near the sidebar could bleed a stray color tint into it.
        isolation: 'isolate',
        transform: 'translateZ(0)',
      }}
    >
    <aside
      onMouseEnter={cancelCollapse}
      onMouseLeave={scheduleCollapse}
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        padding: collapsed ? '20px 12px' : '20px 14px',
        background: GLASS.card,
        backdropFilter: GLASS.blur,
        WebkitBackdropFilter: GLASS.blur,
        borderRadius: 22,
        border: '1px solid rgba(15,23,42,0.12)',
        overflow: 'hidden',
        transition: 'padding .28s cubic-bezier(.4,0,.2,1)',
      }}
    >
      {/* Glass edge highlight — a faint top sheen so the panel reads as
          "glass" even when the blurred backdrop alone isn't obvious. */}
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 1, background: `linear-gradient(90deg,transparent,${GLASS.highlight},transparent)`, pointerEvents: 'none' }} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '0 6px', marginBottom: 22, overflow: 'hidden' }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/logo.png"
          alt="Premnathrail"
          style={{
            width: collapsed ? 26 : 118,
            height: 26,
            borderRadius: 8,
            objectFit: 'cover',
            objectPosition: 'left center',
            flex: 'none',
            transition: 'width .28s cubic-bezier(.4,0,.2,1)',
          }}
        />
      </div>

      <div
        style={{
          fontSize: 10,
          fontWeight: 600,
          letterSpacing: '.08em',
          color: TEXT.muted,
          padding: '0 6px',
          marginBottom: 8,
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          opacity: collapsed ? 0 : 1,
          maxHeight: collapsed ? 0 : 20,
          transition: 'opacity .18s, max-height .28s',
        }}
      >
        NAVIGATION
      </div>

      <div
        style={{
          flex: 1,
          minHeight: 0,
          borderRadius: 16,
          border: '1px solid rgba(15,23,42,0.12)',
          overflow: 'hidden',
          display: 'flex',
        }}
      >
      <nav
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 3,
          flex: 1,
          padding: '5px 5px 5px 5px',
          overflowY: 'auto',
          overflowX: 'hidden',
          minHeight: 0,
        }}
        className="sidebar-nav-list"
      >
        {links.map((link) => {
          const isActive =
            link.href === '/dashboard'
              ? pathname === '/dashboard'
              : pathname === link.href || pathname.startsWith(`${link.href}/`)
          return (
            <Link
              key={link.href}
              href={link.href}
              onClick={onNavigate}
              title={collapsed ? link.label : undefined}
              className="sidebar-nav-link"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: collapsed ? 0 : 9,
                justifyContent: collapsed ? 'center' : 'flex-start',
                height: 36,
                flexShrink: 0,
                boxSizing: 'border-box',
                padding: collapsed ? '0 8px' : '0 11px',
                borderRadius: 10,
                textDecoration: 'none',
                fontSize: 13,
                fontWeight: isActive ? 600 : 500,
                color: isActive ? TEXT.white : TEXT.secondary,
                background: isActive ? GRADIENTS.primary : 'transparent',
                border: 'none',
                // Same crisp offset-shadow language as the module cards, but
                // with a small, tight blur/spread — a wider blur here bleeds
                // past this row's own bounds into neighboring sidebar rows
                // (Feedback, the user card) since they all share the
                // sidebar's clipped, blurred glass container.
                boxShadow: isActive ? '0 2px 6px rgba(224,98,31,0.3)' : 'none',
                transition: 'padding .28s cubic-bezier(.4,0,.2,1), justify-content .28s',
                overflow: 'hidden',
              }}
            >
              <span className="sidebar-nav-icon" style={{ flex: 'none', display: 'flex' }}>{icons[link.icon]}</span>
              <span
                style={{
                  whiteSpace: 'nowrap',
                  opacity: collapsed ? 0 : 1,
                  maxWidth: collapsed ? 0 : 200,
                  transition: 'opacity .18s, max-width .28s',
                  overflow: 'hidden',
                }}
              >
                {link.label}
              </span>
            </Link>
          )
        })}
      </nav>
      </div>

      <div
        style={{
          opacity: collapsed ? 0 : 1,
          maxHeight: collapsed ? 0 : 120,
          overflow: 'hidden',
          transition: 'opacity .18s, max-height .28s',
          marginTop: 10,
          marginBottom: 10,
          padding: 6,
          borderRadius: 16,
          border: '1px solid rgba(15,23,42,0.12)',
        }}
      >
        <FeedbackButton variant="row" />
        <UpdatesButton variant="row" />
      </div>

      {user && (
        <div style={{ position: 'relative' }} onMouseEnter={cancelMenuClose} onMouseLeave={scheduleMenuClose}>
          {menuOpen && (
            <div
              style={{
                position: 'absolute',
                bottom: '100%',
                left: 0,
                right: 0,
                marginBottom: 8,
                background: '#fff',
                borderRadius: 20,
                border: 'none',
                boxShadow: SHADOWS.glass(),
                overflow: 'hidden',
              }}
            >
              {/* header */}
              <div
                style={{
                  position: 'relative',
                  padding: '20px 16px 18px',
                  background: 'linear-gradient(135deg,#1e293b,#0f172a)',
                  overflow: 'hidden',
                }}
              >
                <div style={{ position: 'absolute', inset: 0, opacity: 0.5, backgroundImage: 'radial-gradient(rgba(255,255,255,0.15) 1px, transparent 1px)', backgroundSize: '14px 14px' }} />
                <div style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 12 }}>
                  <div
                    style={{
                      width: 44,
                      height: 44,
                      borderRadius: '50%',
                      flex: 'none',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: '#fff',
                      fontWeight: 600,
                      fontSize: 15,
                      background: GRADIENTS.primary,
                      boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
                    }}
                  >
                    {user.name.split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase()}
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <p style={{ fontSize: 14, fontWeight: 600, color: '#fff', margin: '0 0 4px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {user.name}
                    </p>
                    <span
                      style={{
                        display: 'inline-block',
                        fontSize: 10.5,
                        fontWeight: 600,
                        color: '#fff',
                        background: 'rgba(255,255,255,0.18)',
                        padding: '2px 10px',
                        borderRadius: 9999,
                        textTransform: 'capitalize',
                      }}
                    >
                      {user.role.replace('_', ' ')}
                    </span>
                  </div>
                </div>
              </div>

              {/* details */}
              <div style={{ padding: '14px 16px 8px', display: 'flex', flexDirection: 'column', gap: 14 }}>
                <InfoRow
                  label="Email"
                  value={user.email}
                  icon={
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="2" y="4" width="20" height="16" rx="2" />
                      <path d="M22 6l-10 7L2 6" />
                    </svg>
                  }
                />
                <InfoRow
                  label="Designation"
                  value={user.designation || '—'}
                  icon={
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="2" y="7" width="20" height="14" rx="2" />
                      <path d="M16 21V5a2 2 0 00-2-2h-4a2 2 0 00-2 2v16" />
                    </svg>
                  }
                />
                <InfoRow
                  label="Department"
                  value={user.department || '—'}
                  icon={
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M3 21h18" />
                      <path d="M5 21V7l7-4 7 4v14" />
                      <path d="M9 9h.01M15 9h.01M9 13h.01M15 13h.01" />
                    </svg>
                  }
                />
              </div>

              <div style={{ padding: '10px 14px 14px' }}>
                <button
                  onClick={handleLogout}
                  style={{
                    width: '100%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 8,
                    padding: '11px 14px',
                    borderRadius: 12,
                    border: '1px solid rgba(220,38,38,0.25)',
                    background: 'rgba(220,38,38,0.08)',
                    cursor: 'pointer',
                    fontSize: 13.5,
                    fontWeight: 600,
                    color: '#dc2626',
                  }}
                >
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4" />
                    <polyline points="16 17 21 12 16 7" />
                    <line x1="21" y1="12" x2="9" y2="12" />
                  </svg>
                  Sign out
                </button>
              </div>
            </div>
          )}

          <button
            onClick={() => setMenuOpen((v) => !v)}
            style={{
              width: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: collapsed ? 'center' : 'flex-start',
              gap: 8,
              padding: collapsed ? '7px 0' : '7px 10px',
              borderRadius: 12,
              border: 'none',
              background: GLASS.surface,
              backdropFilter: GLASS.blurLight,
              WebkitBackdropFilter: GLASS.blurLight,
              cursor: 'pointer',
              fontFamily: 'inherit',
              transition: 'padding .28s cubic-bezier(.4,0,.2,1), justify-content .28s',
            }}
          >
            <div style={{ position: 'relative', flex: 'none' }}>
              <div
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: '50%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: '#fff',
                  fontWeight: 600,
                  fontSize: 11,
                  background: GRADIENTS.primary,
                }}
              >
                {user.name.split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase()}
              </div>
              <span
                style={{
                  position: 'absolute',
                  bottom: -1,
                  right: -1,
                  width: 9,
                  height: 9,
                  borderRadius: '50%',
                  background: '#22c55e',
                  border: '2px solid #fff',
                }}
              />
            </div>
            {!collapsed && (
              <>
                <div style={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
                  <p style={{ fontSize: 12, fontWeight: 600, color: TEXT.heading, margin: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {user.name}
                  </p>
                  <p style={{ fontSize: 10, color: TEXT.muted, margin: 0, textTransform: 'capitalize' }}>{user.role}</p>
                </div>
                <svg
                  width="12"
                  height="12"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke={TEXT.muted}
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  style={{ transform: menuOpen ? 'rotate(180deg)' : 'none', transition: 'transform .15s', flex: 'none' }}
                >
                  <polyline points="18 15 12 9 6 15" />
                </svg>
              </>
            )}
          </button>
        </div>
      )}
    </aside>
    </div>
  )
}

function InfoRow({ label, value, icon }: { label: string; value: string; icon: ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
      <div
        style={{
          width: 30,
          height: 30,
          flex: 'none',
          borderRadius: 8,
          background: 'rgba(255,255,255,0.4)',
          color: TEXT.secondary,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {icon}
      </div>
      <div style={{ minWidth: 0 }}>
        <p style={{ fontSize: 10, fontWeight: 600, letterSpacing: '.06em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 2px' }}>
          {label}
        </p>
        <p style={{ fontSize: 13, fontWeight: 600, color: TEXT.heading, margin: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {value}
        </p>
      </div>
    </div>
  )
}
