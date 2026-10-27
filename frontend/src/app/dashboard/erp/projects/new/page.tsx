'use client'

import { useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'

// Service Projects moved to Project Management (2026-10-26). Old links (bookmarks, notifications) land here and go on.
export default function MovedServiceProjectNew() {
  const router = useRouter()
  const params = useParams<{ id?: string }>()
  useEffect(() => {
    router.replace(`/dashboard/projects/service-projects/new${window.location.search}`)
  }, [router, params])
  return <p style={{ fontSize: 13, color: '#78716c' }}>Service Projects moved to Project Management - opening...</p>
}
