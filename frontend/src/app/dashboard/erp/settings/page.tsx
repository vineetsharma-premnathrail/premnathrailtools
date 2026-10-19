'use client'

import { useRequireApp } from '@/hooks/useAuth'
import { erpApi } from '@/lib/api'
import ModuleSettingsPage from '@/components/shared/ModuleSettingsPage'
import ErpNav from '@/components/erp/ErpNav'

export default function ServiceSettingsPage() {
  const { isAuthorized, isLoading } = useRequireApp('erp')
  if (isLoading || !isAuthorized) return null
  return (
    <ModuleSettingsPage title="Service settings" nav={<ErpNav />} backHref="/dashboard/erp"
      load={erpApi.getSettings} save={erpApi.saveSettings} reset={erpApi.resetSetting} tourPrefix="erp-settings" />
  )
}
