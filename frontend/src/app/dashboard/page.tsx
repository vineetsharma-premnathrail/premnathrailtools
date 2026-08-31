'use client'

import { useAuth } from '@/hooks/useAuth'
import ModuleCard from '@/components/ModuleCard'
import { BRAND, TEXT } from '@/lib/theme'

const WrenchIcon = (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M14.7 6.3a4 4 0 00-5.6 5.6L2 19l3 3 7.1-7.1a4 4 0 005.6-5.6l-2.8 2.8-2-2z" />
  </svg>
)
const CalculatorIcon = (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="4" y="2" width="16" height="20" rx="2" />
    <line x1="8" y1="6" x2="16" y2="6" />
    <line x1="8" y1="10" x2="8" y2="10.01" />
    <line x1="12" y1="10" x2="12" y2="10.01" />
    <line x1="16" y1="10" x2="16" y2="10.01" />
    <line x1="8" y1="14" x2="8" y2="14.01" />
    <line x1="12" y1="14" x2="12" y2="14.01" />
    <line x1="16" y1="14" x2="16" y2="14.01" />
    <line x1="8" y1="18" x2="16" y2="18" />
  </svg>
)
const UsersIcon = (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" />
    <circle cx="9" cy="7" r="4" />
    <path d="M23 21v-2a4 4 0 00-3-3.87" />
    <path d="M16 3.13a4 4 0 010 7.75" />
  </svg>
)
const BoltIcon = (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
  </svg>
)
const DraftingIcon = (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 19l7-7 3 3-7 7-3-3z" />
    <path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z" />
    <circle cx="11" cy="11" r="2" />
  </svg>
)
const UserGroupIcon = (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" />
    <circle cx="12" cy="7" r="4" />
    <path d="M22 11h-6" /><path d="M19 8v6" />
  </svg>
)
const CartIcon = (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="9" cy="21" r="1" />
    <circle cx="20" cy="21" r="1" />
    <path d="M1 1h4l2.68 13.39a2 2 0 002 1.61h9.72a2 2 0 002-1.61L23 6H6" />
  </svg>
)
const WarehouseIcon = (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 9l1-5h16l1 5" />
    <path d="M4 9v10a1 1 0 001 1h14a1 1 0 001-1V9" />
    <path d="M9 21V13h6v8" />
  </svg>
)
const FileTextIcon = (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
    <polyline points="14 2 14 8 20 8" />
    <line x1="16" y1="13" x2="8" y2="13" />
    <line x1="16" y1="17" x2="8" y2="17" />
  </svg>
)

const modules = [
  {
    title: 'Service Module',
    app: 'erp' as const,
    description: 'Project management, service requests, warranty tracking, and operational reports.',
    icon: WrenchIcon,
    href: '/dashboard/erp',
    features: ['Projects', 'Service Requests', 'Dashboard', 'Reports'],
    barColor: 'linear-gradient(90deg,#FF7A45,#FF6A2A)',
    iconBg: 'rgba(255,122,69,0.14)',
    iconColor: BRAND.primaryHover,
    tagBg: 'rgba(255,122,69,0.14)',
    tagColor: BRAND.primaryActive,
  },
  {
    title: 'R&D Tools',
    app: 'rnd' as const,
    description: 'Railway engineering calculators — braking, hydraulic, load distribution, and more.',
    icon: CalculatorIcon,
    href: '/dashboard/rnd',
    features: ['Braking', 'Hydraulic', 'Qmax', 'Tractive Effort', '+3 more'],
    barColor: 'linear-gradient(90deg,#3b82f6,#60a5fa)',
    iconBg: 'rgba(59,130,246,0.12)',
    iconColor: '#2563eb',
    tagBg: 'rgba(59,130,246,0.12)',
    tagColor: '#1d4ed8',
  },
  {
    title: 'CRM',
    app: 'crm' as const,
    description: 'Customer relationship management, leads, contacts, deals, and organizations.',
    icon: UsersIcon,
    href: '/dashboard/crm',
    features: ['Contacts', 'Leads', 'Deals', 'Organizations'],
    barColor: 'linear-gradient(90deg,#10b981,#34d399)',
    iconBg: 'rgba(16,185,129,0.12)',
    iconColor: '#059669',
    tagBg: 'rgba(16,185,129,0.12)',
    tagColor: '#047857',
  },
  {
    title: 'Purchase',
    app: 'purchase' as const,
    description: 'Purchase requisitions raised from service materials — approvals, PO tracking, and receiving.',
    icon: CartIcon,
    href: '/dashboard/purchase',
    features: ['Requisitions', 'Approvals', 'PO Tracking'],
    barColor: 'linear-gradient(90deg,#a855f7,#c084fc)',
    iconBg: 'rgba(168,85,247,0.12)',
    iconColor: '#7e22ce',
    tagBg: 'rgba(168,85,247,0.12)',
    tagColor: '#6b21a8',
  },
  {
    title: 'Procure-to-Pay',
    app: 'p2p' as const,
    description: 'Standalone purchase requisitions — raise, approve, and track requests.',
    icon: FileTextIcon,
    href: '/dashboard/p2p',
    features: ['Requisitions'],
    barColor: 'linear-gradient(90deg,#0ea5e9,#38bdf8)',
    iconBg: 'rgba(14,165,233,0.12)',
    iconColor: '#0284c7',
    tagBg: 'rgba(14,165,233,0.12)',
    tagColor: '#0369a1',
  },
  {
    title: 'Store',
    app: 'store' as const,
    description: 'Stock ledger — items, locations, receipts, issues, and stock transactions.',
    icon: WarehouseIcon,
    href: '/dashboard/store',
    features: ['Stock Items', 'Locations', 'Transactions'],
    barColor: 'linear-gradient(90deg,#14b8a6,#2dd4bf)',
    iconBg: 'rgba(20,184,166,0.12)',
    iconColor: '#0d9488',
    tagBg: 'rgba(20,184,166,0.12)',
    tagColor: '#0f766e',
  },
  {
    title: 'HR',
    app: 'hr' as const,
    description: 'Employee directory and org chart.',
    icon: UserGroupIcon,
    href: '/dashboard/hr',
    features: ['Directory', 'Org Chart'],
    barColor: 'linear-gradient(90deg,#ec4899,#f472b6)',
    iconBg: 'rgba(236,72,153,0.12)',
    iconColor: '#db2777',
    tagBg: 'rgba(236,72,153,0.12)',
    tagColor: '#be185d',
  },
  {
    title: 'Design',
    app: 'design' as const,
    description: 'Engineering drawings, BOM, and document revisions — shared across Mechanical, Electrical, Fluids, and R&D.',
    icon: DraftingIcon,
    href: '/dashboard/design',
    features: ['Drawings', 'BOM', 'Revisions'],
    barColor: 'linear-gradient(90deg,#6366f1,#818cf8)',
    iconBg: 'rgba(99,102,241,0.12)',
    iconColor: '#4f46e5',
    tagBg: 'rgba(99,102,241,0.12)',
    tagColor: '#4338ca',
  },
  {
    title: 'Electrical',
    app: 'electrical' as const,
    description: 'Electrical work orders, fault tracking, and assignment.',
    icon: BoltIcon,
    href: '/dashboard/electrical',
    features: ['Work Orders', 'Fault Tracking'],
    barColor: 'linear-gradient(90deg,#eab308,#facc15)',
    iconBg: 'rgba(234,179,8,0.12)',
    iconColor: '#a16207',
    tagBg: 'rgba(234,179,8,0.12)',
    tagColor: '#854d0e',
  },
]

export default function DashboardPage() {
  const { user } = useAuth()

  const greeting = getGreeting()
  const today = new Date().toLocaleDateString('en-IN', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })

  const visibleModules = modules.filter((module) => user?.apps?.includes(module.app))

  return (
    <div>
      <h1 style={{ fontSize: 30, fontWeight: 700, color: TEXT.heading, margin: '0 0 6px' }}>
        {greeting}, {user?.name.split(' ')[0]}
      </h1>
      <p style={{ fontSize: 14, color: TEXT.muted, margin: '0 0 36px' }}>{today}</p>

      <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '.08em', color: TEXT.muted, marginBottom: 14 }}>
        YOUR APPLICATIONS
      </div>

      {/* Shared goo filter for ModuleCard's hover blob effect — defined once
          here since all cards reference the same filter id. */}
      <svg width="0" height="0" style={{ position: 'absolute' }}>
        <defs>
          <filter id="module-card-goo">
            <feGaussianBlur in="SourceGraphic" stdDeviation="10" result="blur" />
            <feColorMatrix in="blur" mode="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 19 -9" result="goo" />
            <feComposite in="SourceGraphic" in2="goo" operator="atop" />
          </filter>
        </defs>
      </svg>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 20 }}>
        {visibleModules.map((module, index) => (
          <ModuleCard key={module.title} {...module} index={index} />
        ))}
      </div>
    </div>
  )
}

function getGreeting() {
  const hour = new Date().getHours()
  if (hour < 12) return 'Good morning'
  if (hour < 17) return 'Good afternoon'
  return 'Good evening'
}
