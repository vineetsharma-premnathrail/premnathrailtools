'use client'

// WBS and task pages are shared by Project Management and every department
// module's "Ongoing Projects" tab. The module tab remembers itself as the
// origin (per browser tab) so those pages keep the module's nav, breadcrumb
// and a working Back — instead of dropping a department user into an empty
// Project Management nav.

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { useAuth } from '@/hooks/useAuth'
import { TEXT } from '@/lib/theme'
import { secondaryBtnStyle } from '@/components/shared/ui'
import ProjectsNav from '@/components/projects/ProjectsNav'
import DesignNav from '@/components/design/DesignNav'
import ElectricalNav from '@/components/electrical/ElectricalNav'
import HydraulicNav from '@/components/hydraulic/HydraulicNav'
import MaintenanceNav from '@/components/maintenance/MaintenanceNav'
import P2PNav from '@/components/p2p/P2PNav'
import ProductionNav from '@/components/production/ProductionNav'
import QualityNav from '@/components/quality/QualityNav'
import RndNav from '@/components/rnd/RndNav'
import StoreNav from '@/components/store/StoreNav'

export type PmOriginKey = 'design' | 'electrical' | 'hydraulic' | 'maintenance' | 'p2p' | 'production' | 'quality' | 'rnd' | 'store'

const MODULES: Record<PmOriginKey, { label: string; href: string; Nav: () => React.ReactElement | null }> = {
  design: { label: 'Design', href: '/dashboard/ongoing-projects', Nav: DesignNav },
  electrical: { label: 'Electrical', href: '/dashboard/ongoing-projects', Nav: ElectricalNav },
  hydraulic: { label: 'Hydraulic', href: '/dashboard/ongoing-projects', Nav: HydraulicNav },
  maintenance: { label: 'Maintenance', href: '/dashboard/ongoing-projects', Nav: MaintenanceNav },
  p2p: { label: 'Purchase', href: '/dashboard/ongoing-projects', Nav: P2PNav },
  production: { label: 'Production', href: '/dashboard/ongoing-projects', Nav: ProductionNav },
  quality: { label: 'Quality', href: '/dashboard/ongoing-projects', Nav: QualityNav },
  rnd: { label: 'R&D', href: '/dashboard/ongoing-projects', Nav: RndNav },
  store: { label: 'Store', href: '/dashboard/ongoing-projects', Nav: StoreNav },
}

const KEY = 'pm-origin'

function readOrigin(): PmOriginKey | null {
  try {
    const v = sessionStorage.getItem(KEY)
    return v && v in MODULES ? (v as PmOriginKey) : null
  } catch { return null }
}

/** Module "Ongoing Projects" tabs call this; Project Management pages clear it. */
export function useMarkPmOrigin(key: PmOriginKey | null) {
  useEffect(() => {
    try {
      if (key) sessionStorage.setItem(KEY, key)
      else sessionStorage.removeItem(KEY)
    } catch { /* storage blocked — pages fall back to Project Management */ }
  }, [key])
}

/** Where the WBS / task page belongs: the remembered module tab (if the user
 * still has that app), else Project Management (if they have it), else the
 * first department module they hold. */
export function usePmOrigin() {
  const { user } = useAuth()
  // Read on first render: these pages render only after auth loads (never on
  // the server), and ProjectsNav clears the origin in its own effect.
  const [stored] = useState<PmOriginKey | null>(() => (typeof window === 'undefined' ? null : readOrigin()))
  const apps = (user?.apps || []) as string[]
  let key: PmOriginKey | null = stored && apps.includes(stored) ? stored : null
  if (!key && !apps.includes('projects')) key = (Object.keys(MODULES) as PmOriginKey[]).find((k) => apps.includes(k)) || null
  const mod = key ? MODULES[key] : null
  return {
    Nav: mod ? mod.Nav : ProjectsNav,
    label: mod ? `${mod.label} · Ongoing Projects` : 'Project Management',
    href: mod ? mod.href : apps.includes('projects') ? '/dashboard/projects' : '/dashboard',
  }
}

/** Module nav + "Module › Page" breadcrumb + Back (falls back to the origin
 * list when the page was opened directly, e.g. from a notification). */
export function PmPageHeader({ page, tourBack }: { page: string; tourBack: string }) {
  const router = useRouter()
  const origin = usePmOrigin()
  const back = () => {
    if (typeof window !== 'undefined' && window.history.length > 1) router.back()
    else router.push(origin.href)
  }
  return (
    <>
      <origin.Nav />
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        <p style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: 0 }}>
          <Link href={origin.href} style={{ color: '#6366f1', textDecoration: 'none' }}>{origin.label}</Link> › {page}
        </p>
        <button data-tour={tourBack} onClick={back} type="button" style={secondaryBtnStyle}>← Back</button>
      </div>
    </>
  )
}

/** Nav only — for the invalid-link / loading states. */
export function PmPageNav() {
  const origin = usePmOrigin()
  return <origin.Nav />
}
