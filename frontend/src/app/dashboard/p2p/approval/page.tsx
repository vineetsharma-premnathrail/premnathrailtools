'use client'

// P.R Approval is now the "Approvals" view of the Purchase Requisitions page
// (2026-10-07); old links and notifications land there.
import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

export default function P2PApprovalRedirect() {
  const router = useRouter()
  useEffect(() => {
    const bucket = typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('bucket') : null
    router.replace(`/dashboard/p2p?view=approvals${bucket ? `&bucket=${bucket}` : ''}`)
  }, [router])
  return null
}
