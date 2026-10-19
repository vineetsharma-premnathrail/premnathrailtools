'use client'

// Link target for an amendment (approval notifications, My Approvals): the
// amendment lives on its order's Amendments tab, so open that.

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { salesApi } from '@/lib/api'
import { extractErrorMessages } from '@/lib/validation'
import SalesNav from '@/components/sales/SalesNav'
import { ErrorBanner, PageHeader } from '@/components/sales/SalesUi'
import { recordPath, useRecordId } from '@/lib/recordRef'
import InvalidRecordLink from '@/components/erp/InvalidRecordLink'

export default function SalesAmendmentRedirectPage() {
  const { isAuthorized, isLoading } = useRequireApp('sales')
  const router = useRouter()
  const { id: ref } = useParams<{ id: string }>()
  const { id, error: linkError } = useRecordId(ref)
  const [error, setError] = useState<string | string[]>('')

  useEffect(() => {
    if (!isAuthorized || !id) return
    salesApi.getAmendment(id)
      .then((a) => router.replace(`${recordPath('/dashboard/sales/orders', a, 'so_id')}?tab=amendments`))
      .catch((err) => setError(extractErrorMessages(err, 'Failed to open the amendment.')))
  }, [isAuthorized, id, router])

  if (isLoading || !isAuthorized) return null
  if (linkError) return (<div><SalesNav /><InvalidRecordLink message={linkError} listHref="/dashboard/sales/orders" listLabel="Back to sales orders" /></div>)
  return (
    <div>
      <SalesNav />
      <PageHeader title="Sales order amendment" backHref="/dashboard/sales/orders" />
      {error ? <ErrorBanner error={error} /> : <p style={{ fontSize: 13 }}>Opening the amendment…</p>}
    </div>
  )
}
