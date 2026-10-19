'use client'

import { useRequireApp } from '@/hooks/useAuth'
import { financePaymentsApi } from '@/lib/financePaymentsApi'
import ModuleSettingsPage from '@/components/shared/ModuleSettingsPage'
import FinanceNav from '@/components/finance/FinanceNav'

export default function FinanceSettingsPage() {
  const { isAuthorized, isLoading } = useRequireApp('accounts')
  if (isLoading || !isAuthorized) return null
  return (
    <ModuleSettingsPage title="Finance settings" nav={<FinanceNav />} backHref="/dashboard/finance/payments"
      load={financePaymentsApi.getSettings} save={financePaymentsApi.saveSettings} reset={financePaymentsApi.resetSetting} />
  )
}
