'use client'

import { useRequireApp } from '@/hooks/useAuth'
import DesignNav from '@/components/design/DesignNav'
import DeptRequirementsList from '@/components/rnd/DeptRequirementsList'

// Requirements the R&D head shared with Design for a feasibility reply.
export default function DesignRequirementsPage() {
  const { isAuthorized, isLoading } = useRequireApp('design')
  if (isLoading || !isAuthorized) return null
  return (
    <div>
      <DesignNav />
      <DeptRequirementsList department="design" departmentLabel="Design" moduleLabel="Design Module" />
    </div>
  )
}
