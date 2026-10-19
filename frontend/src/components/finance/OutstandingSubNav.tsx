'use client'

/** Second-level tabs of Finance › Outstanding (receivables management):
 *  aging, collections & dunning, disputes, credit management. Each pill shows
 *  only when the user may view its Permission Matrix tab. */
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useCan } from '@/lib/permissions'
import { BRAND, BORDER, TEXT } from '@/lib/theme'

const LINKS = [
  { href: '/dashboard/finance/outstanding', label: 'Receivables & Payables', tab: 'outstanding' },
  { href: '/dashboard/finance/outstanding/collections', label: 'Collections & Dunning', tab: 'collections' },
  { href: '/dashboard/finance/outstanding/disputes', label: 'Disputes', tab: 'disputes' },
  { href: '/dashboard/finance/outstanding/credit', label: 'Credit Management', tab: 'credit_management' },
  { href: '/dashboard/finance/outstanding/msme', label: 'MSME Dues', tab: 'outstanding', feature: 'msme_dues' },
] as const

export default function OutstandingSubNav() {
  const pathname = usePathname()
  const { can, canFeature } = useCan()
  const links = LINKS.filter((l) => ('feature' in l ? canFeature('accounts', l.tab, l.feature, 'view') : can('accounts', l.tab, 'view')))
  if (links.length < 2) return null
  return (
    <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
      {links.map((l) => {
        const active = pathname === l.href
        return (
          <Link key={l.href} href={l.href} data-tour={`fin-os-subnav-${l.tab}`} style={{
            padding: '7px 14px', borderRadius: 9999, border: `1px solid ${active ? BRAND.primary : BORDER.normal}`,
            background: active ? `${BRAND.primary}1a` : '#fff', color: active ? BRAND.primaryActive : TEXT.secondary,
            fontSize: 12.5, fontWeight: 600, textDecoration: 'none', whiteSpace: 'nowrap',
          }}>{l.label}</Link>
        )
      })}
    </div>
  )
}
