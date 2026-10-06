'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

// Retired in Quality Phase 1 — this free-text screen was replaced by the
// stock-linked workflow (inspection lots / characteristics + plans / NCR
// disposition). Old records stay in the database; old links land here.
export default function IncomingInspectionRetired() {
  const router = useRouter()
  useEffect(() => { router.replace('/dashboard/quality/lots?type=incoming') }, [router])
  return null
}
