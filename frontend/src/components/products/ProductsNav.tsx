'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useAuth } from '@/hooks/useAuth'
import { filterTabsByAccess } from '@/lib/tabAccess'
import SalesNav from '@/components/sales/SalesNav'
import { Link as LinkIcon, Package, Target, type Icon } from '@phosphor-icons/react'

const TABS = [
  { href: '/dashboard/products', label: 'Products', icon: 'box', subtabKey: 'products' },
  { href: '/dashboard/products/applications', label: 'Applications', icon: 'target', subtabKey: 'applications' },
  { href: '/dashboard/products/mapping', label: 'Mapping', icon: 'link', subtabKey: 'product_mapping' },
] as const

// Tab icon key -> Phosphor icon (Regular weight). The key also feeds the
// tab's data-tour id, so keys stay as they are.
const TAB_ICONS: Record<string, Icon> = {
  box: Package,
  link: LinkIcon,
  target: Target,
}

function TabIcon({ name }: { name: string }) {
  const Cmp = TAB_ICONS[name]
  return Cmp ? <Cmp size={15} /> : null
}

export default function ProductsNav() {
  const pathname = usePathname()
  const { user } = useAuth()
  const visibleTabs = filterTabsByAccess('products', TABS, user)

  // Product Management lives inside Sales: the Sales nav on top (its Products
  // tab active), then the product sub-tabs as a pill row.
  return (
    <>
      <SalesNav />
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: -12, marginBottom: 20 }}>
        {visibleTabs.map((tab) => {
          // Product pages (/products, /products/new, /products/12) all belong to
          // the Products tab; Applications and Mapping are the other two.
          const isActive = tab.subtabKey === 'products'
            ? pathname.startsWith('/dashboard/products') && !pathname.startsWith('/dashboard/products/applications') && !pathname.startsWith('/dashboard/products/mapping')
            : pathname.startsWith(tab.href)
          return (
            <Link
              key={tab.href}
              href={tab.href}
              data-tour={`products-nav-${tab.icon}`}
              style={{
                display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px', borderRadius: 999,
                fontSize: 12, fontWeight: 600, textDecoration: 'none', whiteSpace: 'nowrap',
                color: isActive ? '#FF6A2A' : '#78716c',
                background: isActive ? 'rgba(255,106,42,0.10)' : 'rgba(0,0,0,0.04)',
                border: isActive ? '1px solid rgba(255,106,42,0.35)' : '1px solid transparent',
              }}
            >
              <TabIcon name={tab.icon} />
              <span>{tab.label}</span>
            </Link>
          )
        })}
      </div>
    </>
  )
}
