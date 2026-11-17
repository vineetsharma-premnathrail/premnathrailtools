'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { firstViewableTab } from '@/lib/tabAccess'
import FinanceNav, { FINANCE_TABS } from '@/components/finance/FinanceNav'
import { NoSectionAccess, PageHeader } from '@/components/finance/financeUi'

/** Finance landing: opens the first Finance tab the role can view (owner,
 *  2026-11-14 — a hard redirect to Masters showed nothing to a role without
 *  Masters, which looked like "permission di hai fir bhi show nahi hota"). */
export default function FinancePage() {
  const router = useRouter()
  const { isAuthorized, isLoading, user } = useRequireApp('accounts')
  const first = firstViewableTab('accounts', FINANCE_TABS, user)

  useEffect(() => {
    if (!isLoading && isAuthorized && first) router.replace(first.href)
  }, [isLoading, isAuthorized, first, router])

  if (isLoading || !isAuthorized || first) return null

  return (
    <div>
      <FinanceNav />
      <PageHeader title="Finance & Accounting" />
      <NoSectionAccess />
    </div>
  )
}
