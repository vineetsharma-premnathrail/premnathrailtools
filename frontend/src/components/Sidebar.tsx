'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { Fragment, ReactNode, useEffect, useRef, useState } from 'react'
import { User } from '@/types'
import { requestAppLock } from '@/components/shared/AppLock'
import { useAuthStore } from '@/store/authStore'
import { BRAND, TEXT, GLASS, SHADOWS, GRADIENTS } from '@/lib/theme'
import UpdatesButton from '@/components/UpdatesButton'
import FeedbackButton from '@/components/FeedbackButton'
import { House, Briefcase, Flask, Users, FileText, User as UserIcon, Storefront, Tray, Buildings, ShieldCheck, Factory, Package, ShoppingCart, Wrench, PenNib, Lightning, Drop, Kanban, IdentificationCard, CurrencyInr, CaretLeft, CaretUp, Envelope, SignOut } from '@phosphor-icons/react'

const icons: Record<string, ReactNode> = {
  dashboard: <House size={15} />,
  erp: <Briefcase size={15} />,
  rnd: <Flask size={15} />,
  crm: <Users size={15} />,
  p2p: <FileText size={15} />,
  users: <UserIcon size={15} />,
  store: <Storefront size={15} />,
  approvals: <Tray size={15} />,
  organization: <Buildings size={15} />,
  quality: <ShieldCheck size={15} />,
  production: <Factory size={15} />,
  products: <Package size={15} />,
  sales: <ShoppingCart size={15} />,
  maintenance: <Wrench size={15} />,
  design: <PenNib size={15} />,
  electrical: <Lightning size={15} />,
  hydraulic: <Drop size={15} />,
  projects: <Kanban size={15} />,
  hr: <IdentificationCard size={15} />,
  finance: <CurrencyInr size={15} />,
}

export default function Sidebar({ user, onNavigate }: { user: User | null; onNavigate?: () => void }) {
  const pathname = usePathname()
  const router = useRouter()
  const logout = useAuthStore((state) => state.logout)
  const [menuOpen, setMenuOpen] = useState(false)
  const [collapsed, setCollapsed] = useState(false)
  const menuCloseTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Collapse is manual (toggle button), remembered per browser.
  useEffect(() => {
    try {
      if (localStorage.getItem('sidebar-collapsed') === '1') setCollapsed(true)
    } catch {}
  }, [])

  const toggleCollapsed = () => {
    setCollapsed((v) => {
      const next = !v
      try { localStorage.setItem('sidebar-collapsed', next ? '1' : '0') } catch {}
      return next
    })
    setMenuOpen(false)
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
    // My Approvals and My Tasks are cards on the Dashboard home (2026-10-19), not menu entries.
    { href: '/dashboard/erp', label: 'Service Module', icon: 'erp', visible: !!user?.apps?.includes('erp') },
    { href: '/dashboard/rnd', label: 'R&D', icon: 'rnd', visible: !!user?.apps?.includes('rnd') },
    { href: '/dashboard/crm', label: 'CRM Module', icon: 'crm', visible: !!user?.apps?.includes('crm') },
    // Product Management lives inside Sales (a Products tab in SalesNav); a
    // products-only user lands straight on the product master.
    {
      href: user?.apps?.includes('sales') ? '/dashboard/sales' : '/dashboard/products',
      label: 'Sales', icon: 'sales',
      visible: !!user?.apps?.includes('sales') || !!user?.apps?.includes('products'),
    },
    { href: '/dashboard/p2p', label: 'Procurement', icon: 'p2p', visible: !!user?.apps?.includes('p2p') },
    { href: '/dashboard/store', label: 'Store & Inventory', icon: 'store', visible: !!user?.apps?.includes('store') },
    { href: '/dashboard/projects', label: 'Project Management', icon: 'projects', visible: !!user?.apps?.includes('projects') },
    { href: '/dashboard/finance', label: 'Finance & Accounting', icon: 'finance', visible: !!user?.apps?.includes('accounts') },
    // Organization isn't an "app": shown to anyone who can view at least one of
    // its tabs (organization:<tab>:view), admins always.
    {
      href: '/dashboard/organization', label: 'Organization', icon: 'organization',
      visible: isAdmin || !!user?.permissions?.some((p) => p.startsWith('organization:') && p.endsWith(':view')),
    },
    // Upcoming modules (planned roll-out) — listed last under their own heading (2026-10-19).
    { href: '/dashboard/production', label: 'Production', icon: 'production', upcoming: true, visible: !!user?.apps?.includes('production') },
    // Production supervisors raise breakdowns without holding the maintenance
    // app — they land straight on their own requests list.
    {
      href: user?.apps?.includes('maintenance') ? '/dashboard/maintenance' : '/dashboard/maintenance/requests',
      label: 'Maintenance', icon: 'maintenance', upcoming: true,
      visible: !!user?.apps?.includes('maintenance') || !!user?.apps?.includes('production'),
    },
    { href: '/dashboard/electrical', label: 'Electrical', icon: 'electrical', upcoming: true, visible: !!user?.apps?.includes('electrical') },
    { href: '/dashboard/hydraulic', label: 'Hydraulic & Pneumatic', icon: 'hydraulic', upcoming: true, visible: !!user?.apps?.includes('hydraulic') },
    // Visible to every logged-in user: My HR (leave, attendance, travel,
    // claims, assets) is self-service; HR-only tabs are gated inside HrNav.
    { href: '/dashboard/hr', label: 'HR & Admin', icon: 'hr', upcoming: true, visible: !!user?.apps?.includes('hr') },
    { href: '/dashboard/quality', label: 'Quality', icon: 'quality', upcoming: true, visible: !!user?.apps?.includes('quality') },
    { href: '/dashboard/design', label: 'Design', icon: 'design', upcoming: true, visible: !!user?.apps?.includes('design') },
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
      <div style={{ display: 'flex', flexDirection: collapsed ? 'column' : 'row', alignItems: 'center', justifyContent: collapsed ? 'center' : 'flex-start', gap: collapsed ? 8 : 10, padding: '0 6px', marginBottom: 22, overflow: 'hidden' }}>
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
        <button
          type="button"
          onClick={toggleCollapsed}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          style={{
            marginLeft: collapsed ? 0 : 'auto',
            width: 26,
            height: 26,
            flex: 'none',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: 8,
            border: '1px solid rgba(15,23,42,0.12)',
            background: GLASS.surface,
            color: TEXT.muted,
            cursor: 'pointer',
            padding: 0,
          }}
        >
          <CaretLeft size={14} style={{ transform: collapsed ? 'rotate(180deg)' : 'none', transition: 'transform .2s' }} />
        </button>
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
        {links.map((link, i) => {
          // "Upcoming" heading before the first planned module (a divider when collapsed).
          const upcomingHeading = link.upcoming && !links[i - 1]?.upcoming ? (
            <div key="upcoming-heading" style={{ flexShrink: 0, margin: '10px 0 4px', padding: collapsed ? 0 : '0 11px' }}>
              {collapsed
                ? <div style={{ height: 1, background: 'rgba(15,23,42,0.12)', margin: '0 8px' }} />
                : <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.08em', color: TEXT.muted, whiteSpace: 'nowrap' }}>UPCOMING</span>}
            </div>
          ) : null
          const matches = (href: string) => (href === '/dashboard'
            ? pathname === '/dashboard'
            : pathname === href || pathname.startsWith(`${href}/`))
          // The most specific link wins (My Tasks sits inside /dashboard/projects).
          const isActive = matches(link.href)
            && !links.some((o) => o.visible && o.href.length > link.href.length && o.href.startsWith(`${link.href}/`) && matches(o.href))
          return (
            <Fragment key={link.href}>
            {upcomingHeading}
            <Link
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
            </Fragment>
          )
        })}
      </nav>
      </div>

      <div
        style={{
          opacity: collapsed ? 0 : 1,
          maxHeight: collapsed ? 0 : 168,
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
                      {user.role.replace(/_/g, ' ')}
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
                    <Envelope size={15} />
                  }
                />
                <InfoRow
                  label="Designation"
                  value={user.designation || '—'}
                  icon={
                    <Briefcase size={15} />
                  }
                />
                <InfoRow
                  label="Department"
                  value={user.department || '—'}
                  icon={
                    <Buildings size={15} />
                  }
                />
              </div>

              <div style={{ padding: '10px 14px 14px' }}>
                <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                  {[['lock', 'Lock now'], ['change', 'Change app password']].map(([action, text]) => (
                    <button
                      key={action}
                      onClick={() => { setMenuOpen(false); requestAppLock(action as 'lock' | 'change') }}
                      style={{ flex: 1, padding: '9px 8px', borderRadius: 12, border: `1px solid ${GLASS.border}`, background: 'rgba(255,255,255,0.6)', cursor: 'pointer', fontSize: 12.5, fontWeight: 600, color: '#57534e' }}
                    >
                      {text}
                    </button>
                  ))}
                </div>
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
                  <SignOut size={15} />
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
                  <p style={{ fontSize: 10, color: TEXT.muted, margin: 0, textTransform: 'capitalize' }}>{user.role.replace(/_/g, ' ')}</p>
                </div>
                <CaretUp size={12} color={TEXT.muted} style={{ transform: menuOpen ? 'rotate(180deg)' : 'none', transition: 'transform .15s', flex: 'none' }} />
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
