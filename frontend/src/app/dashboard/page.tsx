'use client'

import { useAuth } from '@/hooks/useAuth'
import ModuleCard from '@/components/ModuleCard'
import { BRAND, TEXT } from '@/lib/theme'

const ShieldIcon = (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
  </svg>
)
const ClockIcon = (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10" />
    <polyline points="12 6 12 12 16 14" />
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
const CartIcon = (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="9" cy="21" r="1" />
    <circle cx="20" cy="21" r="1" />
    <path d="M1 1h4l2.68 13.39a2 2 0 002 1.61h9.72a2 2 0 002-1.61L23 6H6" />
  </svg>
)

const modules = [
  {
    title: 'Service Module',
    app: 'erp' as const,
    description: 'Project management, service requests, warranty tracking, and operational reports.',
    icon: ShieldIcon,
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
    icon: ClockIcon,
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
      <h1 style={{ fontSize: 30, fontWeight: 800, color: TEXT.heading, margin: '0 0 6px' }}>
        {greeting}, {user?.name.split(' ')[0]}
      </h1>
      <p style={{ fontSize: 14, color: TEXT.muted, margin: '0 0 36px' }}>{today}</p>

      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.08em', color: TEXT.muted, marginBottom: 14 }}>
        YOUR APPLICATIONS
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 20 }}>
        {visibleModules.map((module) => (
          <ModuleCard key={module.title} {...module} />
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
