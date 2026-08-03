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
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z" />
      <path d="M9 22V12h6v10" />
    </svg>
  ),
  erp: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    </svg>
  ),
  rnd: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  ),
  crm: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 00-3-3.87" />
      <path d="M16 3.13a4 4 0 010 7.75" />
    </svg>
  ),
  purchase: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="9" cy="21" r="1" />
      <circle cx="20" cy="21" r="1" />
      <path d="M1 1h4l2.68 13.39a2 2 0 002 1.61h9.72a2 2 0 002-1.61L23 6H6" />
    </svg>
  ),
  users: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21c0-4 4-6 8-6s8 2 8 6" />
    </svg>
  ),
}

export default function Sidebar({ user, onNavigate }: { user: User | null; onNavigate?: () => void }) {
  const pathname = usePathname()
  const router = useRouter()
  const logout = useAuthStore((state) => state.logout)
  const [menuOpen, setMenuOpen] = useState(false)
  const menuCloseTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

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
    { href: '/dashboard/users', label: 'Users & Roles', icon: 'users', visible: isAdmin },
  ].filter((link) => link.visible)

  return (
    <aside
      style={{
        position: 'sticky',
        width: 260,
        flex: 'none',
        top: 16,
        height: 'calc(100vh - 32px)',
        display: 'flex',
        flexDirection: 'column',
        padding: '28px 20px',
        background: GLASS.card,
        backdropFilter: GLASS.blur,
        WebkitBackdropFilter: GLASS.blur,
        borderRadius: 26,
        boxShadow: SHADOWS.glass(),
        border: `1px solid ${GLASS.border}`,
        overflow: 'hidden',
      }}
    >
      {/* Glass edge highlight — a faint top sheen so the panel reads as
          "glass" even when the blurred backdrop alone isn't obvious. */}
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 1, background: `linear-gradient(90deg,transparent,${GLASS.highlight},transparent)`, pointerEvents: 'none' }} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '0 8px', marginBottom: 32 }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo.png" alt="Premnathrail" style={{ width: 140, height: 32, borderRadius: 8, objectFit: 'contain', flex: 'none' }} />
      </div>

      <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '.08em', color: TEXT.muted, padding: '0 8px', marginBottom: 12 }}>
        NAVIGATION
      </div>

      <nav style={{ display: 'flex', flexDirection: 'column', gap: 3, flex: 1 }}>
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
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 11,
                padding: '10px 14px',
                borderRadius: 12,
                textDecoration: 'none',
                fontSize: 14,
                fontWeight: isActive ? 600 : 500,
                color: isActive ? TEXT.white : TEXT.secondary,
                background: isActive ? GRADIENTS.primary : 'transparent',
                boxShadow: isActive ? `0 8px 20px ${SHADOWS.glowOrange}` : 'none',
              }}
            >
              {icons[link.icon]}
              {link.label}
            </Link>
          )
        })}
      </nav>

      <FeedbackButton variant="row" />
      <UpdatesButton variant="row" />

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
                border: `1px solid ${GLASS.border}`,
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
                      fontWeight: 700,
                      fontSize: 15,
                      background: GRADIENTS.primary,
                      boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
                    }}
                  >
                    {user.name.split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase()}
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <p style={{ fontSize: 14, fontWeight: 700, color: '#fff', margin: '0 0 4px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
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
                    fontWeight: 700,
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
              gap: 10,
              padding: '10px 12px',
              borderRadius: 14,
              border: `1px solid ${GLASS.border}`,
              background: GLASS.surface,
              backdropFilter: GLASS.blurLight,
              WebkitBackdropFilter: GLASS.blurLight,
              cursor: 'pointer',
              fontFamily: 'inherit',
            }}
          >
            <div style={{ position: 'relative', flex: 'none' }}>
              <div
                style={{
                  width: 34,
                  height: 34,
                  borderRadius: '50%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: '#fff',
                  fontWeight: 700,
                  fontSize: 12,
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
                  width: 10,
                  height: 10,
                  borderRadius: '50%',
                  background: '#22c55e',
                  border: '2px solid #fff',
                }}
              />
            </div>
            <div style={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
              <p style={{ fontSize: 13, fontWeight: 600, color: TEXT.heading, margin: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {user.name}
              </p>
              <p style={{ fontSize: 11, color: TEXT.muted, margin: 0, textTransform: 'capitalize' }}>{user.role}</p>
            </div>
            <svg
              width="14"
              height="14"
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
          </button>
        </div>
      )}
    </aside>
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
        <p style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 2px' }}>
          {label}
        </p>
        <p style={{ fontSize: 13, fontWeight: 600, color: BRAND.primaryHover, margin: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {value}
        </p>
      </div>
    </div>
  )
}
