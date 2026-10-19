'use client'

import { useRequireApp } from '@/hooks/useAuth'

// HR & Admin is only for users given the `hr` app (backend gates every HR
// route with require_hr_module) — anyone else is sent back to the dashboard.
export default function HrLayout({ children }: { children: React.ReactNode }) {
  const { isAuthorized, isLoading } = useRequireApp('hr')
  if (isLoading || !isAuthorized) return null
  return <>{children}</>
}
