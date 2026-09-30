'use client'

import { useAuth } from '@/hooks/useAuth'
import ModuleCard from '@/components/ModuleCard'
import { BRAND, TEXT } from '@/lib/theme'

const WrenchIcon = (
  <svg width="20" height="20" viewBox="0 0 512 512">
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
)
const CalculatorIcon = (
  <svg width="20" height="20" viewBox="0 0 32 32">
    <path fill="#333333" d="M29,0H3C1.35,0,0,1.35,0,3v11h32V3C32,1.35,30.65,0,29,0z M28,12H4V4h24V12z"  stroke="#1A1A1A" strokeWidth="0.6" />
    <path fill="#808080" d="M0,29c0,1.65,1.35,3,3,3h26c1.65,0,3-1.35,3-3V14H0V29z"  stroke="#1A1A1A" strokeWidth="0.6" />
    <path fill="#E6E6E6" d="M4,4h24v8H4V4z M7,22c1.65,0,3-1.35,3-3c0-1.65-1.35-3-3-3s-3,1.35-3,3C4,20.65,5.35,22,7,22z
      M15,22c1.65,0,3-1.35,3-3c0-1.65-1.35-3-3-3s-3,1.35-3,3C12,20.65,13.35,22,15,22z M7,30c1.65,0,3-1.35,3-3c0-1.65-1.35-3-3-3
      s-3,1.35-3,3C4,28.65,5.35,30,7,30z M15,30c1.65,0,3-1.35,3-3c0-1.65-1.35-3-3-3s-3,1.35-3,3C12,28.65,13.35,30,15,30z M25,30
      c1.65,0,3-1.35,3-3c0-1.65-1.35-3-3-3s-3,1.35-3,3C22,28.65,23.35,30,25,30z"  stroke="#1A1A1A" strokeWidth="0.6" />
    <path fill="#4D4D4D" d="M25,22c1.65,0,3-1.35,3-3c0-1.65-1.35-3-3-3s-3,1.35-3,3C22,20.65,23.35,22,25,22z"  stroke="#1A1A1A" strokeWidth="0.6" />
  </svg>
)
const UsersIcon = (
  <svg width="20" height="20" viewBox="0 0 512 512">
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
)
const CartIcon = (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="9" cy="21" r="1" />
    <circle cx="20" cy="21" r="1" />
    <path d="M1 1h4l2.68 13.39a2 2 0 002 1.61h9.72a2 2 0 002-1.61L23 6H6" />
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
const WarehouseIcon = (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 9l1-5h16l1 5" />
    <path d="M4 9v10a1 1 0 001 1h14a1 1 0 001-1V9" />
    <path d="M9 21V13h6v8" />
  </svg>
)
const QualityIcon = (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 2l7 3v6c0 5-3.5 8.5-7 10-3.5-1.5-7-5-7-10V5z" />
    <polyline points="9 12 11 14 15 10" />
  </svg>
)
const ProductionIcon = (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M2 20V9l6 4V9l6 4V5h4l2 15z" />
    <line x1="2" y1="20" x2="22" y2="20" />
  </svg>
)
const MaintenanceIcon = (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M14.7 6.3a1 1 0 000 1.4l1.6 1.6a1 1 0 001.4 0l3.77-3.77a6 6 0 01-7.94 7.94l-6.91 6.91a2.12 2.12 0 01-3-3l6.91-6.91a6 6 0 017.94-7.94l-3.76 3.76z" />
  </svg>
)
const DesignIcon = (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 19l7-7 3 3-7 7-3-3z" />
    <path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z" />
    <path d="M2 2l7.586 7.586" />
    <circle cx="11" cy="11" r="2" />
  </svg>
)
const ElectricalIcon = (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
  </svg>
)
const HydraulicIcon = (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 2.7l5.66 5.66a8 8 0 11-11.32 0z" />
    <path d="M9 14a3 3 0 003 3" />
  </svg>
)
const ProjectsIcon = (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <line x1="9" y1="3" x2="9" y2="21" />
    <path d="M13 8l3 3-3 3" />
  </svg>
)
const FinanceIcon = (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="12" y1="1" x2="12" y2="23" />
    <path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6" />
  </svg>
)
const OrganizationIcon = (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="4" y="2" width="16" height="20" />
    <line x1="9" y1="7" x2="9" y2="7.01" />
    <line x1="15" y1="7" x2="15" y2="7.01" />
    <line x1="9" y1="12" x2="9" y2="12.01" />
    <line x1="15" y1="12" x2="15" y2="12.01" />
    <line x1="9" y1="17" x2="15" y2="17" />
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
    features: ['Contacts', 'Leads', 'Deals', 'Organizations'],
    barColor: 'linear-gradient(90deg,#10b981,#34d399)',
    iconBg: 'rgba(16,185,129,0.12)',
    iconColor: '#059669',
    tagBg: 'rgba(16,185,129,0.12)',
    tagColor: '#047857',
  },
  {
    title: 'Procurement',
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
    title: 'Store & Inventory',
    app: 'store' as const,
    description: 'Item master, warehouses, stock ledger, issues, returns, transfers, and reservations.',
    icon: WarehouseIcon,
    href: '/dashboard/store',
    features: ['Items', 'Warehouses', 'Stock', 'Issues', '+3 more'],
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

const HrIcon = (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="2" y="5" width="20" height="14" rx="2" />
    <circle cx="8" cy="11" r="2" />
    <path d="M5 16c.6-1.5 1.7-2.2 3-2.2s2.4.7 3 2.2" />
    <line x1="14" y1="10" x2="19" y2="10" />
    <line x1="14" y1="14" x2="17" y2="14" />
  </svg>
)

// Shown to every logged-in user (like the sidebar's "HR & Admin" link):
// My HR — leave, attendance, travel, claims, assets — is self-service. The
// HR-management tabs inside are gated on the `hr` app.
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

// Admin-only — shown regardless of `assigned_apps` (like the sidebar's
// "Organization" link), not filtered through the modules[] app-access check.
const adminModule = {
  title: 'Organization',
  description: 'Branch and department masters, plus user roles and permissions.',
  icon: OrganizationIcon,
  href: '/dashboard/organization',
  features: ['Branch', 'Department', 'Users & Roles'],
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

  const visibleModules = [
    ...modules.filter((module) => user?.apps?.includes(module.app)),
    ...(user ? [hrModule] : []),
    ...(user?.role === 'admin' ? [adminModule] : []),
  ]

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
          <filter id="module-card-goo" x="-20%" y="-20%" width="140%" height="140%" filterUnits="objectBoundingBox">
            <feGaussianBlur in="SourceGraphic" stdDeviation="10" result="blur" />
            <feColorMatrix in="blur" mode="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 19 -9" result="goo" />
            <feComposite in="SourceGraphic" in2="goo" operator="atop" />
          </filter>
        </defs>
      </svg>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: 12 }}>
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
