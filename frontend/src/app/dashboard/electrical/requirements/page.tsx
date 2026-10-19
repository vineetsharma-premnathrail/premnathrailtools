'use client'

import { useRequireApp } from '@/hooks/useAuth'
import ElectricalNav from '@/components/electrical/ElectricalNav'
import DeptRequirementsList from '@/components/rnd/DeptRequirementsList'

// Requirements the R&D head shared with Electrical for a feasibility reply.
export default function ElectricalRequirementsPage() {
  const { isAuthorized, isLoading } = useRequireApp('electrical')
  if (isLoading || !isAuthorized) return null
  return (
    <div>
      <ElectricalNav />
      <DeptRequirementsList department="electrical" departmentLabel="Electrical" moduleLabel="Electrical Module" />
    </div>
  )
}
