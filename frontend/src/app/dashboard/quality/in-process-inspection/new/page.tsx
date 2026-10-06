'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

// Retired in Quality Phase 2 — in-process inspections are inspection lots,
// raised by Production's "Request Inspection" on a gated routing step (or a
// manual lot). Old free-text records stay readable on the list page.
export default function InProcessInspectionNewRetired() {
  const router = useRouter()
  useEffect(() => { router.replace('/dashboard/quality/lots/new') }, [router])
  return null
}
