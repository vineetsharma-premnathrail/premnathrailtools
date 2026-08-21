'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

export default function NewTenderRedirectPage() {
  const router = useRouter()

  useEffect(() => {
    router.replace('/dashboard/crm/inquiries/new?type=tender')
  }, [router])

  return null
}
