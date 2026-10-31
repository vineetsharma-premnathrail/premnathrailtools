'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

// Old address of My Approvals (now /dashboard/approvals). Kept so links in
// approval emails and bookmarks sent before the move still land there.
export default function OldMyApprovalsRedirect() {
  const router = useRouter()
  useEffect(() => { router.replace('/dashboard/approvals') }, [router])
  return null
}
