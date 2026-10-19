'use client'

// Bulk Import moved to the Import button on the Organizations and
// Inquiries & Tenders lists; old links land on Organizations.
import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

export default function BulkImportRedirect() {
  const router = useRouter()
  useEffect(() => { router.replace('/dashboard/crm/organizations') }, [router])
  return null
}
