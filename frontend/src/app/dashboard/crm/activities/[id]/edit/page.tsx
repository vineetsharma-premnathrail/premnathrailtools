'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { crmApi } from '@/lib/api'
import { CrmActivity } from '@/types'
import CrmNav from '@/components/crm/CrmNav'
import ActivityForm from '@/components/crm/ActivityForm'

export default function EditActivityPage() {
  const { isAuthorized, isLoading } = useRequireApp('crm')
  const params = useParams()
  const router = useRouter()
  const activityId = Number(params.id)

  const [activity, setActivity] = useState<CrmActivity | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!isAuthorized) return
    crmApi.listActivities({}).then((activities: CrmActivity[]) => {
      const found = activities.find((a) => a.id === activityId)
      if (found) setActivity(found)
      else setError('Activity not found.')
      setLoading(false)
    })
  }, [isAuthorized, activityId])

  if (isLoading || !isAuthorized) return null
  if (loading) return <p style={{ fontSize: 13, color: '#78716c' }}>Loading…</p>
  if (error || !activity) return <p style={{ fontSize: 13, color: '#b91c1c' }}>{error || 'Activity not found.'}</p>

  return (
    <div>
      <CrmNav />
      <div style={{ marginBottom: 20 }}>
        <p style={{ fontSize: 11.5, fontWeight: 700, color: '#a8a29e', margin: '0 0 6px' }}>
          <span onClick={() => router.push('/dashboard/crm/activities')} style={{ cursor: 'pointer' }}>Activities</span> › Edit
        </p>
        <h1 style={{ fontSize: 22, fontWeight: 800, color: '#1f1108', margin: 0 }}>Edit Activity</h1>
      </div>

      <ActivityForm
        initial={activity}
        submitLabel="Save Changes"
        onCancel={() => router.push('/dashboard/crm/activities')}
        onSubmit={async (payload, photos) => {
          await crmApi.updateActivity(activity.id, payload)
          if (photos.length) await crmApi.uploadActivityAttachments(activity.id, photos)
          router.push('/dashboard/crm/activities')
        }}
      />
    </div>
  )
}
