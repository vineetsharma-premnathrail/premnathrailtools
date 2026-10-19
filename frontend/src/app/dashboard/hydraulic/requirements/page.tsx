'use client'

import { useRequireApp } from '@/hooks/useAuth'
import HydraulicNav from '@/components/hydraulic/HydraulicNav'
import DeptRequirementsList from '@/components/rnd/DeptRequirementsList'

// Requirements the R&D head shared with Hydraulic & Pneumatic for a feasibility reply.
export default function HydraulicRequirementsPage() {
  const { isAuthorized, isLoading } = useRequireApp('hydraulic')
  if (isLoading || !isAuthorized) return null
  return (
    <div>
      <HydraulicNav />
      <DeptRequirementsList department="hydraulic" departmentLabel="Hydraulic & Pneumatic" moduleLabel="Hydraulic & Pneumatic Module" />
    </div>
  )
}
