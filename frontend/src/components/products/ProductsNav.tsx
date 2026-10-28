'use client'

import SalesNav from '@/components/sales/SalesNav'

// Product Management lives inside Sales (its Products tab). Products and
// applications are one master since 2026-10-28, so there are no sub-tabs —
// the Sales nav is the whole navigation.
export default function ProductsNav() {
  return <SalesNav />
}
