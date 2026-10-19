'use client'

import { useAuth } from '@/hooks/useAuth'
import { p2pApi } from '@/lib/api'
import ModuleSettingsPage from '@/components/shared/ModuleSettingsPage'
import P2PNav from '@/components/p2p/P2PNav'
import ApprovalFlowCard from '@/components/p2p/ApprovalFlowCard'

export default function ProcurementSettingsPage() {
  // Requesters hold `p2p`, the purchase team `purchase` — either may open Settings (read-only unless allowed to edit).
  const { user, isLoading } = useAuth()
  const allowed = !!user && (user.role === 'admin' || !!user.apps?.some((a) => a === 'p2p' || a === 'purchase'))
  if (isLoading || !allowed) return null
  return (
    <ModuleSettingsPage title="Procurement settings" nav={<P2PNav />} backHref="/dashboard/p2p"
      load={p2pApi.getSettings} save={p2pApi.saveSettings} reset={p2pApi.resetSetting}
      leadSections={<ApprovalFlowCard />} tourPrefix="p2p-settings" />
  )
}
