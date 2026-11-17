'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { useCan } from '@/lib/permissions'
import { crmHomeHref } from '@/components/crm/CrmNav'

/** Page gate for Products (a CRM tab since 2026-10-30): the CRM app plus CRM › Products › View.
 *  Everyone else goes to the first CRM tab their role opens (no CRM app: useRequireApp sends them to /dashboard). */
export function useProductsAccess() {
  const { isAuthorized: hasApp, isLoading } = useRequireApp('crm')
  const { can, user } = useCan()
  const router = useRouter()
  const allowed = hasApp && can('crm', 'products', 'view')
  useEffect(() => {
    // The CRM tab the role may open (Dashboard, else the first viewable one) — never a 403 landing.
    if (!isLoading && hasApp && !allowed) router.push(crmHomeHref(user) || '/dashboard')
  }, [isLoading, hasApp, allowed, router, user])
  return { isAuthorized: allowed, isLoading }
}
