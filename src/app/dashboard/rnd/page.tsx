'use client'

import { useRouter } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import RndNav from '@/components/rnd/RndNav'

const TOOLS = [
  {
    href: '/dashboard/rnd/braking',
    title: 'Braking Calculator',
    description: 'Calculate braking distances, deceleration, and gross braking ratio for rail and road scenarios.',
    icon: <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="3" /><path d="M12 3v3M12 18v3M3 12h3M18 12h3M6.3 6.3l2.1 2.1M15.6 15.6l2.1 2.1M6.3 17.7l2.1-2.1M15.6 8.4l2.1-2.1" /></svg>,
  },
  {
    href: '/dashboard/rnd/hydraulic',
    title: 'Hydraulic Calculator',
    description: 'Hydraulic motor/pump sizing, system requirements, and sensitivity analysis.',
    icon: <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path d="M12 2v20M2 12h20" /></svg>,
  },
  {
    href: '/dashboard/rnd/qmax',
    title: 'Qmax Calculator',
    description: 'Maximum load capacity calculations for rail wheels based on material properties.',
    icon: <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path d="M22 12h-4l-3 9L9 3l-3 9H2" /></svg>,
  },
  {
    href: '/dashboard/rnd/load-distribution',
    title: 'Load Distribution',
    description: 'Wheel load calculations (Q1-Q4) and safety margin validation for vehicles.',
    icon: <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><line x1="18" y1="20" x2="18" y2="10" /><line x1="12" y1="20" x2="12" y2="4" /><line x1="6" y1="20" x2="6" y2="14" /></svg>,
  },
  {
    href: '/dashboard/rnd/tractive-effort',
    title: 'Tractive Effort',
    description: 'Tractive force requirements, power calculations, and OHE current for rail traction.',
    icon: <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><polyline points="13 17 18 12 13 7" /><polyline points="6 17 11 12 6 7" /></svg>,
  },
  {
    href: '/dashboard/rnd/vehicle-performance',
    title: 'Vehicle Performance',
    description: 'Locomotive traction capability, performance envelopes, and gear selection analysis.',
    icon: <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" /></svg>,
  },
  {
    href: '/dashboard/rnd/spline',
    title: 'Spline Calculator',
    description: 'Spline shaft strength analysis, safety factor calculations, and design validation.',
    icon: <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><circle cx="12" cy="12" r="3" /><path d="M12 1v6M12 17v6" /></svg>,
  },
  {
    href: '/dashboard/rnd/history',
    title: 'Calculation History',
    description: 'View, rename, and manage all saved calculation records across every R&D tool.',
    icon: <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#7c3aed" strokeWidth={2}><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg>,
    accent: 'rgba(124,58,237,0.1)',
  },
] as const

export default function RndLandingPage() {
  const { isAuthorized, isLoading } = useRequireApp('rnd')
  const router = useRouter()

  if (isLoading || !isAuthorized) return null

  return (
    <div>
      <RndNav />
      <h1 style={{ fontSize: 24, fontWeight: 800, color: '#1f1108', margin: '0 0 4px' }}>R&amp;D Engineering Tools</h1>
      <p style={{ fontSize: 13, color: '#78716c', margin: '0 0 24px' }}>
        Calculation tools for braking, hydraulics, load capacity, and traction analysis.
      </p>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 16 }}>
        {TOOLS.map((tool) => (
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
                background: 'accent' in tool ? tool.accent : 'rgba(244,113,59,0.1)',
                color: 'accent' in tool ? '#7c3aed' : '#fa9b9b',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                marginBottom: 14,
              }}
            >
              {tool.icon}
            </div>
            <h3 style={{ fontSize: 15, fontWeight: 700, color: '#1f1108', margin: '0 0 6px' }}>{tool.title}</h3>
            <p style={{ fontSize: 12.5, color: '#78716c', margin: 0, lineHeight: 1.5 }}>{tool.description}</p>
          </div>
        ))}
      </div>
    </div>
  )
}
