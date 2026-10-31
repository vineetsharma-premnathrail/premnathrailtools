'use client'

// Landing page for Electrical approval links (My Approvals, notifications):
// a drawing revision or BOM line has no page of its own, so this resolves the
// job and tab that hold it and opens that tab with the record in focus.
import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { electricalApi } from '@/lib/api'
import { TEXT } from '@/lib/theme'
import { extractErrorMessages } from '@/lib/validation'
import { secondaryBtnStyle } from '@/components/shared/ui'
import ElectricalNav from '@/components/electrical/ElectricalNav'
import { ErrorBanner } from '@/components/electrical/shared'
import InvalidRecordLink from '@/components/erp/InvalidRecordLink'
import { recordPath, useRecordId } from '@/lib/recordRef'

export default function ElectricalApprovalLinkPage() {
  const { isAuthorized, isLoading } = useRequireApp('electrical')
  const router = useRouter()
  const params = useParams<{ entityType: string; id: string }>()
  const [error, setError] = useState<string | string[]>('')
  const ref = params.id
  const { id, error: linkError } = useRecordId(ref)

  useEffect(() => {
    if (!isAuthorized || !id) return
    electricalApi.approvalTarget(params.entityType, id)
      .then((t) => router.replace(`${recordPath('/dashboard/electrical/jobs', t, 'job_id')}?tab=${t.tab}&focus=${ref}`))
      .catch((err) => setError(extractErrorMessages(err, 'Could not open this approval — the record may have been deleted.')))
  }, [isAuthorized, params.entityType, id, ref, router])

  if (isLoading || !isAuthorized) return null
  if (linkError) return (<div><ElectricalNav /><InvalidRecordLink message={linkError} listHref="/dashboard/approvals" listLabel="Back to approvals" /></div>)

  return (
    <div>
      <ElectricalNav />
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, marginBottom: 20, flexWrap: 'wrap' }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, color: TEXT.heading, margin: 0 }}>Opening approval…</h1>
        <button type="button" style={secondaryBtnStyle} onClick={() => router.push('/dashboard/approvals')}>← Back</button>
      </div>
      <ErrorBanner error={error} />
    </div>
  )
}
