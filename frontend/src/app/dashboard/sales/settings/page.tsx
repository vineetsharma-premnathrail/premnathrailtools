'use client'

import { useRequireApp } from '@/hooks/useAuth'
import { salesApi } from '@/lib/api'
import ModuleSettingsPage from '@/components/shared/ModuleSettingsPage'
import SalesNav from '@/components/sales/SalesNav'

export default function SalesSettingsPage() {
  const { isAuthorized, isLoading } = useRequireApp('sales')
  if (isLoading || !isAuthorized) return null
  return (
    <ModuleSettingsPage title="Sales settings" nav={<SalesNav />} backHref="/dashboard/sales"
      load={salesApi.getSettings} save={salesApi.saveSettings} reset={salesApi.resetSetting} />
  )
}
