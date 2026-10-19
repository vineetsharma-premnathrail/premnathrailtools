'use client'

import { useRequireApp } from '@/hooks/useAuth'
import { hrApi } from '@/lib/api'
import ModuleSettingsPage from '@/components/shared/ModuleSettingsPage'
import HrNav from '@/components/hr/HrNav'

export default function HrSettingsPage() {
  const { isAuthorized, isLoading } = useRequireApp('hr')
  if (isLoading || !isAuthorized) return null
  return (
    <ModuleSettingsPage title="HR settings" nav={<HrNav />} backHref="/dashboard/hr"
      load={hrApi.getSettings} save={hrApi.saveSettings} reset={hrApi.resetSetting} />
  )
}
