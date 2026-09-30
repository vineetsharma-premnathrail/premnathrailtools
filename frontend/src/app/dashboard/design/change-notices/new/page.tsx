'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { designApi } from '@/lib/api'
import { TEXT } from '@/lib/theme'
import DesignNav from '@/components/design/DesignNav'
import ChangeNoticeForm from '@/components/design/ChangeNoticeForm'
import { secondaryBtnStyle } from '@/components/shared/ui'
import { extractErrorMessages } from '@/lib/validation'

export default function NewChangeNoticePage() {
  const { isAuthorized, isLoading, user } = useRequireApp('design')
  const router = useRouter()
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | string[]>('')

  if (isLoading || !isAuthorized) return null

  const create = async (payload: Record<string, unknown>) => {
    setSaving(true)
    setError('')
    try {
      const ecn = await designApi.createChangeNotice(payload)
      router.push(`/dashboard/design/change-notices/${ecn.id}`)
    } catch (err) {
      setError(extractErrorMessages(err, 'Failed to raise the change notice.'))
      setSaving(false)
    }
  }

  return (
    <div>
      <DesignNav />

      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, marginBottom: 20, flexWrap: 'wrap' }}>
        <div>
          <p style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 4px' }}>Design Module</p>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: TEXT.heading, margin: 0 }}>Raise Change Notice</h1>
          <p style={{ fontSize: 13, color: TEXT.muted, margin: '4px 0 0' }}>Saved as a draft first — submit it for approval from its page once the affected documents are listed.</p>
        </div>
        <button onClick={() => router.push('/dashboard/design/change-notices')} type="button" style={secondaryBtnStyle}>← Back</button>
      </div>

      {error && (
        <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
          {Array.isArray(error) ? error.join(' ') : error}
        </div>
      )}

      <ChangeNoticeForm
        currentUserId={user?.id}
        submitLabel="Save Draft"
        saving={saving}
        onSubmit={create}
        onCancel={() => router.push('/dashboard/design/change-notices')}
        onError={setError}
      />
    </div>
  )
}
