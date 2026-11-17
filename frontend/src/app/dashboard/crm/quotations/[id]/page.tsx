'use client'

// Link target for a quotation (approval inbox / notifications): the quotation
// lives on its inquiry's or tender's Quotations tab, so open that.

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import CrmNav from '@/components/crm/CrmNav'
import InvalidRecordLink from '@/components/erp/InvalidRecordLink'
import { crmQuotationStatusApi } from '@/lib/sdApi'
import { extractErrorMessages } from '@/lib/validation'
import { recordPath, useRecordId } from '@/lib/recordRef'

export default function QuotationRedirectPage() {
  const { isAuthorized, isLoading } = useRequireApp('crm')
  const router = useRouter()
  const params = useParams()
  const { id, error: linkError } = useRecordId(params.id as string)
  const [error, setError] = useState<string | string[]>('')

  useEffect(() => {
    if (!isAuthorized || !id) return
    crmQuotationStatusApi.link(id)
      .then((q) => router.replace(q.tender_id
        ? `${recordPath('/dashboard/crm/tenders', q, 'tender_id')}?tab=quotations`
        : `${recordPath('/dashboard/crm/inquiries', q, 'inquiry_id')}?tab=quotations`))
      .catch((err) => setError(extractErrorMessages(err, "Could not open this quotation. It may have been deleted, or you may not have access to its inquiry or tender - ask the sender to check, or open it from CRM › Inquiries & Tenders › Quotations tab.")))
  }, [isAuthorized, id, router])

  if (isLoading || !isAuthorized) return null
  if (linkError) return (<div><CrmNav /><InvalidRecordLink message={linkError} listHref="/dashboard/crm/inquiries?type=inquiry" listLabel="Back to inquiries" /></div>)
  return (
    <div>
      <CrmNav />
      {error ? (
        <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
          {Array.isArray(error) ? error.join(' ') : error}
        </div>
      ) : <p style={{ fontSize: 13 }}>Opening the quotation…</p>}
    </div>
  )
}
