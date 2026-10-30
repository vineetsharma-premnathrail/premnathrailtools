'use client'

import { useState } from 'react'
import { useAuth } from '@/hooks/useAuth'
import ModuleCard from '@/components/ModuleCard'
import { BRAND, TEXT, GLASS } from '@/lib/theme'
import { Briefcase, Flask, Users, ShoppingCart, FileText, Storefront, ShieldCheck, Factory, Wrench, PenNib, Lightning, Drop, Kanban, CurrencyInr, Buildings, IdentificationCard } from '@phosphor-icons/react'

const WrenchIcon = <Briefcase size={20} />
const CalculatorIcon = <Flask size={20} />
const UsersIcon = <Users size={20} />
const CartIcon = <ShoppingCart size={20} />
const FileTextIcon = <FileText size={20} />
const WarehouseIcon = <Storefront size={20} />
const QualityIcon = <ShieldCheck size={20} />
const ProductionIcon = <Factory size={20} />
const MaintenanceIcon = <Wrench size={20} />
const DesignIcon = <PenNib size={20} />
const ElectricalIcon = <Lightning size={20} />
const HydraulicIcon = <Drop size={20} />
const ProjectsIcon = <Kanban size={20} />
const FinanceIcon = <CurrencyInr size={20} />
const OrganizationIcon = <Buildings size={20} />
const modules = [
  {
    title: 'Service Module',
    app: 'erp' as const,
    description: 'Machines at customer sites, service requests, engineer visits, service contracts and warranty tracking.',
    icon: WrenchIcon,
    href: '/dashboard/erp',
    features: ['Machines', 'Service Requests', 'Contracts', 'Reports'],
    barColor: 'linear-gradient(90deg,#FF7A45,#FF6A2A)',
    iconBg: 'rgba(255,122,69,0.14)',
    iconColor: BRAND.primaryHover,
    tagBg: 'rgba(255,122,69,0.14)',
    tagColor: BRAND.primaryActive,
  },
  {
    title: 'R&D',
    app: 'rnd' as const,
    description: 'R&D projects, experiments & test data, prototypes, feasibility, and railway engineering calculators.',
    icon: CalculatorIcon,
    href: '/dashboard/rnd',
    features: ['Projects', 'Experiments', 'Prototypes', 'Feasibility', 'Engineering Tools'],
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
    features: ['Contacts', 'Leads', 'Deals', 'Customer Organizations'],
    barColor: 'linear-gradient(90deg,#10b981,#34d399)',
    iconBg: 'rgba(16,185,129,0.12)',
    iconColor: '#059669',
    tagBg: 'rgba(16,185,129,0.12)',
    tagColor: '#047857',
  },
  {
    title: 'Procurement',
    app: 'p2p' as const,
    description: 'Purchase requisitions, vendors, RFQs and purchase orders — raise, approve and track every buy.',
    icon: FileTextIcon,
    href: '/dashboard/p2p',
    features: ['Requisitions', 'Vendors', 'RFQ', 'Purchase Orders'],
    barColor: 'linear-gradient(90deg,#0ea5e9,#38bdf8)',
    iconBg: 'rgba(14,165,233,0.12)',
    iconColor: '#0284c7',
    tagBg: 'rgba(14,165,233,0.12)',
    tagColor: '#0369a1',
  },
  {
    title: 'Store & Inventory',
    app: 'store' as const,
    description: 'Item master, stores, stock ledger, issues, returns, transfers, and reservations.',
    icon: WarehouseIcon,
    href: '/dashboard/store',
    features: ['Items', 'Stores', 'Stock', 'Issues', '+3 more'],
    barColor: 'linear-gradient(90deg,#a855f7,#c084fc)',
    iconBg: 'rgba(168,85,247,0.12)',
    iconColor: '#9333ea',
    tagBg: 'rgba(168,85,247,0.12)',
    tagColor: '#7e22ce',
  },
  {
    title: 'Quality',
    app: 'quality' as const,
    description: 'Standards, checklists, inspection plans, and incoming/in-process/final inspections.',
    icon: QualityIcon,
    href: '/dashboard/quality',
    features: ['Standards', 'Checklists', 'Inspections'],
    barColor: 'linear-gradient(90deg,#0d9488,#14b8a6)',
    iconBg: 'rgba(13,148,136,0.12)',
    iconColor: '#0d9488',
    tagBg: 'rgba(13,148,136,0.12)',
    tagColor: '#0f766e',
  },
  {
    title: 'Production',
    app: 'production' as const,
    description: 'BOM & routing, work orders, shop-floor bookings, material planning, and production cost.',
    icon: ProductionIcon,
    href: '/dashboard/production',
    features: ['Work Orders', 'Shop Floor', 'BOM', 'Planning'],
    barColor: 'linear-gradient(90deg,#475569,#64748b)',
    iconBg: 'rgba(71,85,105,0.12)',
    iconColor: '#475569',
    tagBg: 'rgba(71,85,105,0.12)',
    tagColor: '#334155',
  },
  {
    title: 'Maintenance',
    app: 'maintenance' as const,
    description: 'Plant equipment register, breakdown requests, maintenance work orders, spares issue and downtime tracking.',
    icon: MaintenanceIcon,
    href: '/dashboard/maintenance',
    features: ['Assets', 'Breakdowns', 'Work Orders', 'Downtime'],
    barColor: 'linear-gradient(90deg,#b45309,#d97706)',
    iconBg: 'rgba(180,83,9,0.12)',
    iconColor: '#b45309',
    tagBg: 'rgba(180,83,9,0.12)',
    tagColor: '#92400e',
  },
  {
    title: 'Design',
    app: 'design' as const,
    description: 'Controlled engineering drawings and documents — revisions, check & approval sign-off, and change notices.',
    icon: DesignIcon,
    href: '/dashboard/design',
    features: ['Drawings', 'Revisions', 'Approvals', 'ECN'],
    barColor: 'linear-gradient(90deg,#4f46e5,#6366f1)',
    iconBg: 'rgba(79,70,229,0.12)',
    iconColor: '#4f46e5',
    tagBg: 'rgba(79,70,229,0.12)',
    tagColor: '#3730a3',
  },
  {
    title: 'Electrical',
    app: 'electrical' as const,
    description: 'RRV electrical creation — requirement, design, BOM, wiring, panels, testing, QC, commissioning and handover.',
    icon: ElectricalIcon,
    href: '/dashboard/electrical',
    features: ['RRV Jobs', 'Drawings', 'Testing', 'Handover'],
    barColor: 'linear-gradient(90deg,#ca8a04,#eab308)',
    iconBg: 'rgba(202,138,4,0.12)',
    iconColor: '#ca8a04',
    tagBg: 'rgba(202,138,4,0.12)',
    tagColor: '#a16207',
  },
  {
    title: 'Hydraulic & Pneumatic',
    app: 'hydraulic' as const,
    description: 'Hydraulic and pneumatic systems — component master, circuits, BOM, calculations, testing, maintenance and spares.',
    icon: HydraulicIcon,
    href: '/dashboard/hydraulic',
    features: ['Systems', 'Circuits', 'Calculations', 'Maintenance'],
    barColor: 'linear-gradient(90deg,#0369a1,#0ea5e9)',
    iconBg: 'rgba(3,105,161,0.12)',
    iconColor: '#0369a1',
    tagBg: 'rgba(3,105,161,0.12)',
    tagColor: '#075985',
  },
  {
    title: 'Project Management',
    app: 'projects' as const,
    description: 'Project workspaces — scope, planning, tasks, budget, risks, and closure.',
    icon: ProjectsIcon,
    href: '/dashboard/projects',
    features: ['Projects', 'My Projects', 'Reports'],
    barColor: 'linear-gradient(90deg,#6366f1,#818cf8)',
    iconBg: 'rgba(99,102,241,0.12)',
    iconColor: '#4f46e5',
    tagBg: 'rgba(99,102,241,0.12)',
    tagColor: '#4338ca',
  },
  {
    title: 'Finance & Accounting',
    app: 'accounts' as const,
    description: 'GL, journal entries, accounts payable/receivable, period close, banking, and financial reports.',
    icon: FinanceIcon,
    href: '/dashboard/finance',
    features: ['Ledger', 'AR / AP', 'Banking', 'Reports'],
    barColor: 'linear-gradient(90deg,#f59e0b,#fbbf24)',
    iconBg: 'rgba(245,158,11,0.12)',
    iconColor: '#d97706',
    tagBg: 'rgba(245,158,11,0.12)',
    tagColor: '#b45309',
  },
]

// Card order + live/upcoming split — keep in step with the sidebar (Sidebar.tsx `upcoming: true`).
const LIVE_APPS = ['erp', 'rnd', 'crm', 'p2p', 'store', 'projects', 'accounts']
const UPCOMING_APPS = ['production', 'maintenance', 'electrical', 'hydraulic', 'hr', 'quality', 'design']

const HrIcon = <IdentificationCard size={20} />

// Shown to users with the `hr` app (like the sidebar's "HR & Admin" link and
// the HR layout guard). HR-management tabs inside are gated per tab in HrNav.
const hrModule = {
  title: 'HR & Administration',
  description: 'My HR self-service, approvals, employees, lifecycle, leave, attendance, assets, visitors, travel & claims.',
  icon: HrIcon,
  href: '/dashboard/hr',
  features: ['My HR', 'Leave', 'Attendance', 'Travel & Claims', '+4 more'],
  barColor: 'linear-gradient(90deg,#ec4899,#f472b6)',
  iconBg: 'rgba(236,72,153,0.12)',
  iconColor: '#db2777',
  tagBg: 'rgba(236,72,153,0.12)',
  tagColor: '#be185d',
}

// Not an app — shown regardless of `assigned_apps` to admins and anyone who
// can view one of its tabs (same rule as the sidebar's "Organization" link).
const adminModule = {
  title: 'Organization',
  description: 'Company info, branches and departments, users, roles & permissions, approval workflows and audit logs.',
  icon: OrganizationIcon,
  href: '/dashboard/organization',
  features: ['Company', 'Branches', 'Users & Roles', 'Workflows'],
  barColor: 'linear-gradient(90deg,#64748b,#94a3b8)',
  iconBg: 'rgba(100,116,139,0.12)',
  iconColor: '#475569',
  tagBg: 'rgba(100,116,139,0.12)',
  tagColor: '#334155',
}

export default function DashboardPage() {
  const { user } = useAuth()

  const greeting = getGreeting()
  const today = new Date().toLocaleDateString('en-IN', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })

  const byApp = (app: string) => {
    return modules.find((m) => m.app === app && user?.apps?.includes(app))
  }
  const canSeeOrganization = user?.role === 'admin' || !!user?.permissions?.some((p) => p.startsWith('organization:') && p.endsWith(':view'))
  // Same split and order as the sidebar: live modules first, then the
  // planned roll-out under its own "Upcoming" heading.
  const liveModules = [
    ...LIVE_APPS.map(byApp),
    ...(canSeeOrganization ? [adminModule] : []),
  ].filter((m) => !!m)
  const [showUpcoming, setShowUpcoming] = useState(false)
  const upcomingModules = UPCOMING_APPS
    .map((app) => (app === 'hr' ? (user?.apps?.includes('hr') ? hrModule : undefined) : byApp(app)))
    .filter((m) => !!m)

  return (
    <div>
      <h1 style={{ fontSize: 30, fontWeight: 700, color: TEXT.heading, margin: '0 0 6px' }}>
        {greeting}{user?.name ? `, ${user.name.split(' ')[0]}` : ''}
      </h1>
      <p style={{ fontSize: 14, color: TEXT.muted, margin: '0 0 28px' }}>{today}</p>

      <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '.08em', color: TEXT.muted, marginBottom: 14 }}>
        YOUR APPLICATIONS
      </div>

      {/* Shared goo filter for ModuleCard's hover blob effect — defined once
          here since all cards reference the same filter id. */}
      <svg width="0" height="0" style={{ position: 'absolute' }}>
        <defs>
          <filter id="module-card-goo" x="-20%" y="-20%" width="140%" height="140%" filterUnits="objectBoundingBox">
            <feGaussianBlur in="SourceGraphic" stdDeviation="10" result="blur" />
            <feColorMatrix in="blur" mode="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 19 -9" result="goo" />
            <feComposite in="SourceGraphic" in2="goo" operator="atop" />
          </filter>
        </defs>
      </svg>

      {liveModules.length === 0 && upcomingModules.length === 0 && (
        <div style={{ padding: '28px 20px', borderRadius: 16, textAlign: 'center', background: GLASS.card, border: `1px solid ${GLASS.border}`, maxWidth: 640 }}>
          <p style={{ fontSize: 14, fontWeight: 600, color: TEXT.heading, margin: '0 0 4px' }}>No applications assigned to you yet</p>
          <p style={{ fontSize: 12.5, color: TEXT.muted, margin: 0 }}>Ask your administrator to give you a role in Organization › Users — the modules you can use will then appear here and in the sidebar.</p>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: 12 }}>
        {liveModules.map((module, index) => (
          <ModuleCard key={module.title} {...module} index={index} />
        ))}
      </div>

      {upcomingModules.length > 0 && (
        <>
          <button type="button" aria-expanded={showUpcoming} onClick={() => setShowUpcoming((v) => !v)}
            style={{ display: 'block', background: 'none', border: 'none', cursor: 'pointer', padding: 0, fontSize: 11, fontWeight: 600, letterSpacing: '.08em', color: '#475569', margin: '32px 0 14px' }}>
            {showUpcoming ? '▾' : '▸'} COMING SOON ({upcomingModules.length})
          </button>
          {showUpcoming && <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: 12 }}>
            {upcomingModules.map((module, index) => (
              <ModuleCard key={module.title} {...module} index={liveModules.length + index} />
            ))}
          </div>}
        </>
      )}
    </div>
  )
}

function getGreeting() {
  const hour = new Date().getHours()
  if (hour < 12) return 'Good morning'
  if (hour < 17) return 'Good afternoon'
  return 'Good evening'
}
