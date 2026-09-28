'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useRequireAdmin } from '@/hooks/useAuth'
import { organizationApi } from '@/lib/api'
import { TEXT, BRAND, BORDER } from '@/lib/theme'
import OrganizationNav from '@/components/organization/OrganizationNav'
import PlantForm from '@/components/organization/PlantForm'

const TABS = ['Basic', 'Address', 'Operational Configuration', 'Branch Users', 'Branch Departments', 'Branch Warehouses', 'Branch Cost Centers', 'Branch Documents'] as const

export default function NewPlantPage() {
  const { isAuthorized, isLoading } = useRequireAdmin()
  const router = useRouter()
  const [showSaveFirst, setShowSaveFirst] = useState(false)

  if (isLoading || !isAuthorized) return null

  const tabBar = (
    <div>
      <div data-tour="org-plant-form-tabs" style={{ display: 'flex', gap: 8, marginBottom: 8, borderBottom: `1px solid ${BORDER.normal}`, flexWrap: 'wrap' }}>
        {TABS.map((t) => {
          const isBasic = t === 'Basic'
          return (
            <button
              key={t}
              type="button"
              disabled={!isBasic}
              onClick={() => { if (!isBasic) setShowSaveFirst(true) }}
              style={{
                padding: '10px 6px', marginRight: 16, border: 'none', borderRadius: 0, boxShadow: 'none', outline: 'none',
                background: 'transparent', borderBottom: isBasic ? `2px solid ${BRAND.primary}` : '2px solid transparent',
                color: isBasic ? BRAND.primary : TEXT.muted, fontWeight: 600, fontSize: 13,
                cursor: isBasic ? 'default' : 'not-allowed', whiteSpace: 'nowrap', opacity: isBasic ? 1 : 0.55,
              }}
            >
              {t}
            </button>
          )
        })}
      </div>
      {showSaveFirst && (
        <p style={{ fontSize: 12, color: TEXT.muted, margin: '0 0 16px' }}>
          Save this branch first — Address, Users, Warehouses, Cost Centers, and Documents can be added from the Edit page once the branch exists.
        </p>
      )}
    </div>
  )

  return (
    <div>
      <OrganizationNav />
      <PlantForm
        title="Add Branch"
        breadcrumb={<><span onClick={() => router.push('/dashboard/organization/plants')} style={{ cursor: 'pointer' }}>Branches</span> › New</>}
        tabBar={tabBar}
        submitLabel="Save Branch"
        onCancel={() => router.push('/dashboard/organization/plants')}
        onSubmit={(payload) => organizationApi.createBranch(payload)}
        onSaved={(plant) => router.push(`/dashboard/organization/plants/${plant.id}/edit`)}
      />
    </div>
  )
}
