'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

export default function OrganizationPage() {
  const router = useRouter()

  useEffect(() => {
    router.replace('/dashboard/organization/department')
  }, [router])

  return null
}
