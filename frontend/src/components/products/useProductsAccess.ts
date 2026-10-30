'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { useCan } from '@/lib/permissions'

/** Page gate for Products (a CRM tab since 2026-10-30): the CRM app plus CRM › Products › View.
 *  Everyone else goes back to the CRM dashboard (no CRM app: useRequireApp sends them to /dashboard). */
export function useProductsAccess() {
  const { isAuthorized: hasApp, isLoading } = useRequireApp('crm')
  const { can } = useCan()
  const router = useRouter()
  const allowed = hasApp && can('crm', 'products', 'view')
  useEffect(() => {
    if (!isLoading && hasApp && !allowed) router.push('/dashboard/crm')
  }, [isLoading, hasApp, allowed, router])
  return { isAuthorized: allowed, isLoading }
}
