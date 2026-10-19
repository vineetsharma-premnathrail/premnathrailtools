'use client'

import Link from 'next/link'
import { Gear } from '@phosphor-icons/react'

// Module settings live behind a gear next to the tour button / bell, not as a
// tab in the module's tab row (same as R&D) — one pattern for every module.
export default function NavSettingsGear({ href, active, label, tour }: { href: string; active: boolean; label: string; tour?: string }) {
  return (
    <Link href={href} data-tour={tour} title={label} aria-label={label}
      style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center', width: 34, height: 34, borderRadius: 999, flex: 'none',
        color: active ? '#FF7A45' : '#78716c', border: `1px solid ${active ? '#FF7A45' : 'rgba(0,0,0,0.1)'}`, background: 'rgba(255,255,255,.7)',
      }}>
      <Gear size={15} />
    </Link>
  )
}
