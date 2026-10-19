'use client'

import { useRouter } from 'next/navigation'
import { CaretDoubleRight, ChartBar, ClockCounterClockwise, Disc, Drop, Gauge, Gear, Lightning } from '@phosphor-icons/react'
import { useAuth, useRequireApp } from '@/hooks/useAuth'
import { filterTabsByAccess } from '@/lib/tabAccess'
import RndNav from '@/components/rnd/RndNav'

const TOOLS = [
  {
    href: '/dashboard/rnd/braking',
    subtabKey: 'braking',
    title: 'Braking Calculator',
    description: 'Calculate braking distances, deceleration, and gross braking ratio for rail and road scenarios.',
    icon: <Disc size={24} />,
  },
  {
    href: '/dashboard/rnd/hydraulic',
    subtabKey: 'hydraulic',
    title: 'Hydraulic Calculator',
    description: 'Hydraulic motor/pump sizing, system requirements, and sensitivity analysis.',
    icon: <Drop size={24} />,
  },
  {
    href: '/dashboard/rnd/qmax',
    subtabKey: 'qmax',
    title: 'Qmax Calculator',
    description: 'Maximum load capacity calculations for rail wheels based on material properties.',
    icon: <Gauge size={24} />,
  },
  {
    href: '/dashboard/rnd/load-distribution',
    subtabKey: 'load_distribution',
    title: 'Load Distribution',
    description: 'Wheel load calculations (Q1-Q4) and safety margin validation for vehicles.',
    icon: <ChartBar size={24} />,
  },
  {
    href: '/dashboard/rnd/tractive-effort',
    subtabKey: 'tractive_effort',
    title: 'Tractive Effort',
    description: 'Tractive force requirements, power calculations, and OHE current for rail traction.',
    icon: <CaretDoubleRight size={24} />,
  },
  {
    href: '/dashboard/rnd/vehicle-performance',
    subtabKey: 'vehicle_performance',
    title: 'Vehicle Performance',
    description: 'Locomotive traction capability, performance envelopes, and gear selection analysis.',
    icon: <Lightning size={24} />,
  },
  {
    href: '/dashboard/rnd/spline',
    subtabKey: 'spline',
    title: 'Spline Calculator',
    description: 'Spline shaft strength analysis, safety factor calculations, and design validation.',
    icon: <Gear size={24} />,
  },
  {
    href: '/dashboard/rnd/history',
    subtabKey: 'history',
    title: 'Calculation History',
    description: 'Every saved calculation from the tools above — reopen, rename or compare past results.',
    icon: <ClockCounterClockwise size={24} />,
  },
] as const

export default function RndToolsPage() {
  const { isAuthorized, isLoading } = useRequireApp('rnd')
  const { user } = useAuth()
  const router = useRouter()
  // Same subtab keys as RndNav's TOOL_TABS and the backend's per-calculator
  // gate, so a card only shows when the user can actually run that tool.
  const visibleTools = filterTabsByAccess('rnd', TOOLS, user)

  if (isLoading || !isAuthorized) return null

  return (
    <div>
      <RndNav />
      <h1 style={{ fontSize: 24, fontWeight: 700, color: '#1f1108', margin: '0 0 4px' }}>R&amp;D Engineering Tools</h1>
      <p style={{ fontSize: 13, color: '#78716c', margin: '0 0 24px' }}>
        Calculation tools for braking, hydraulics, load capacity, and traction analysis.
      </p>

      <div data-tour="rnd-tools-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 16 }}>
        {visibleTools.length === 0 && (
          <p style={{ fontSize: 13, color: '#78716c', margin: 0 }}>
            You have no calculator access yet. Ask an administrator to grant the calculator tabs you need under R&amp;D in the Permission Matrix.
          </p>
        )}
        {visibleTools.map((tool) => (
          <div
            key={tool.href}
            onClick={() => router.push(tool.href)}
            style={{
              padding: 20,
              borderRadius: 16,
              background: 'rgba(255,255,255,.16)',
              backdropFilter: 'blur(28px)',
              WebkitBackdropFilter: 'blur(28px)',
              border: '1px solid rgba(255,255,255,.24)', boxShadow: '0 12px 32px rgba(15,23,42,0.16), 0 2px 6px rgba(15,23,42,.08), inset 0 1px 0 rgba(255,255,255,.35)',
              cursor: 'pointer',
              transition: 'box-shadow .15s, transform .15s',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.boxShadow = '0 20px 44px rgba(15,23,42,0.22), 0 2px 6px rgba(15,23,42,.08), inset 0 1px 0 rgba(255,255,255,.35)'; e.currentTarget.style.transform = 'translateY(-2px)' }}
            onMouseLeave={(e) => { e.currentTarget.style.boxShadow = '0 12px 32px rgba(15,23,42,0.16), 0 2px 6px rgba(15,23,42,.08), inset 0 1px 0 rgba(255,255,255,.35)'; e.currentTarget.style.transform = 'none' }}
          >
            <div
              style={{
                width: 44,
                height: 44,
                borderRadius: 12,
                background: 'rgba(244,113,59,0.1)',
                color: '#FF7A45',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                marginBottom: 14,
              }}
            >
              {tool.icon}
            </div>
            <h3 style={{ fontSize: 15, fontWeight: 600, color: '#1f1108', margin: '0 0 6px' }}>{tool.title}</h3>
            <p style={{ fontSize: 12.5, color: '#78716c', margin: 0, lineHeight: 1.5 }}>{tool.description}</p>
          </div>
        ))}
      </div>
    </div>
  )
}
