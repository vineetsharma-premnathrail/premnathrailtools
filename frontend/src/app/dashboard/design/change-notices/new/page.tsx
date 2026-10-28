'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { designApi } from '@/lib/api'
import DesignNav from '@/components/design/DesignNav'
import ChangeNoticeForm from '@/components/design/ChangeNoticeForm'
import { extractErrorMessages } from '@/lib/validation'
import { recordPath } from '@/lib/recordRef'

export default function NewChangeNoticePage() {
  const { isAuthorized, isLoading, user } = useRequireApp('design')
  const router = useRouter()
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | string[]>('')
  const draftRef = useRef<{ clear: () => void } | null>(null)

  if (isLoading || !isAuthorized) return null

  const create = async (payload: Record<string, unknown>) => {
    setSaving(true)
    setError('')
    try {
      const ecn = await designApi.createChangeNotice(payload)
      draftRef.current?.clear()
      router.push(recordPath('/dashboard/design/change-notices', ecn))
    } catch (err) {
      setError(extractErrorMessages(err, 'Failed to raise the change notice.'))
      setSaving(false)
    }
  }

  return (
    <ChangeNoticeForm
      nav={<DesignNav />}
      tour="design-ecnnew-form"
      backTour="design-ecnnew-back-btn"
      title="Raise Change Notice"
      subtitle="Saved as a draft first — submit it for approval from its page once the affected documents are listed."
      onBack={() => router.push('/dashboard/design/change-notices')}
      error={error}
      currentUserId={user?.id}
      submitLabel="Save Draft"
      saving={saving}
      onSubmit={create}
      onCancel={() => router.push('/dashboard/design/change-notices')}
      onError={setError}
      draftRef={draftRef}
    />
  )
}
