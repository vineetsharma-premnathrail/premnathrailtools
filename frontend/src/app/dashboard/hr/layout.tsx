'use client'

import { useRequireApp } from '@/hooks/useAuth'

// HR & Admin is locked to the allow-list in backend
// app/core/module_visibility.py — anyone without `hr` in their apps is sent
// back to the dashboard instead of seeing pages whose API calls all 403.
export default function HrLayout({ children }: { children: React.ReactNode }) {
  const { isAuthorized, isLoading } = useRequireApp('hr')
  if (isLoading || !isAuthorized) return null
  return <>{children}</>
}
