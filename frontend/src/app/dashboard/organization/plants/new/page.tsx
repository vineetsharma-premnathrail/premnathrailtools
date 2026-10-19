'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useRequireOrgTab } from '@/app/dashboard/organization/_lib/useRequireOrgTab'
import { organizationApi } from '@/lib/api'
import { SHEET } from '@/components/shared/FormSheet'
import OrganizationNav from '@/components/organization/OrganizationNav'
import { recordPath } from '@/lib/recordRef'
import PlantForm from '@/components/organization/PlantForm'

const TABS = ['Basic', 'Address', 'Operational Configuration', 'Branch Users', 'Branch Departments', 'Branch Stores', 'Branch Cost Centers', 'Branch Documents'] as const

export default function NewPlantPage() {
  const { isAuthorized, isLoading } = useRequireOrgTab('branches', 'create')
  const router = useRouter()
  const [showSaveFirst, setShowSaveFirst] = useState(false)

  if (isLoading || !isAuthorized) return null

  const tabBar = (
    <div>
      <div data-tour="org-plant-form-tabs" style={{ display: 'flex', gap: 8, borderBottom: `1px solid ${SHEET.LINE}`, flexWrap: 'wrap' }}>
        {TABS.map((t) => {
          const isBasic = t === 'Basic'
          return (
            <button
              key={t}
              type="button"
              disabled={!isBasic}
              onClick={() => { if (!isBasic) setShowSaveFirst(true) }}
              style={{
                padding: '10px 4px', marginRight: 16, marginBottom: -1, borderTop: 'none', borderLeft: 'none', borderRight: 'none', borderRadius: 0, boxShadow: 'none', outline: 'none',
                background: 'transparent', borderBottom: isBasic ? `2px solid ${SHEET.BLUE}` : '2px solid transparent',
                color: isBasic ? SHEET.BLUE : SHEET.MUTED, fontWeight: 600, fontSize: 13, fontFamily: 'inherit',
                cursor: isBasic ? 'default' : 'not-allowed', whiteSpace: 'nowrap', opacity: isBasic ? 1 : 0.55,
              }}
            >
              {t}
            </button>
          )
        })}
      </div>
      {showSaveFirst && (
        <p style={{ fontSize: 12, color: SHEET.MUTED, margin: '10px 0 0' }}>
          Save this branch first — Address, Users, Stores, Cost Centers, and Documents can be added from the Edit page once the branch exists.
        </p>
      )}
    </div>
  )

  return (
    <PlantForm
      nav={<OrganizationNav />}
      title="Add Branch"
      subtitle="Branches › New — fill the basic information and save; the other tabs open once the branch exists."
      tabBar={tabBar}
      submitLabel="Save Branch"
      onCancel={() => router.push('/dashboard/organization/plants')}
      onSubmit={(payload) => organizationApi.createBranch(payload)}
      onSaved={(plant) => router.push(`${recordPath('/dashboard/organization/plants', plant)}/edit`)}
    />
  )
}
