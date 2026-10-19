'use client'

// A purchase order's approval (central approval engine, entity p2p_purchase_order)
// links here with the PO id — the PO is approved on its requisition's page, so
// look the requisition up and go there.
import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { p2pApi } from '@/lib/api'
import { extractErrorMessages } from '@/lib/validation'
import { TEXT } from '@/lib/theme'
import { recordPath, useRecordId } from '@/lib/recordRef'
import InvalidRecordLink from '@/components/erp/InvalidRecordLink'

export default function PurchaseOrderRedirect() {
  const router = useRouter()
  const params = useParams()
  const { id: poId, error: linkError } = useRecordId(params?.id as string)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!poId) return
    p2pApi.getByPo(poId)
      .then((pr: { id: number }) => router.replace(`${recordPath('/dashboard/p2p', pr)}?from=po-approval`))
      .catch((err) => setError(extractErrorMessages(err, `Purchase order #${poId} could not be opened.`).join(' ')))
  }, [poId, router])

  if (linkError) return <InvalidRecordLink message={linkError} listHref="/dashboard/p2p/purchase-orders" listLabel="Back to purchase orders" />
  if (error) return <p style={{ fontSize: 13, color: '#b91c1c' }}>{error}</p>
  return <p style={{ fontSize: 13, color: TEXT.secondary }}>Opening the purchase order…</p>
}
