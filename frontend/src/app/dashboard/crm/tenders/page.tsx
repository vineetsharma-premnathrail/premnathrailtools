'use client'

import { useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'

export default function TendersRedirectPage() {
  const router = useRouter()
  const searchParams = useSearchParams()

  useEffect(() => {
    const id = searchParams.get('id')
    router.replace(id ? `/dashboard/crm/inquiries?id=${id}&type=tender` : '/dashboard/crm/inquiries')
  }, [router, searchParams])

  return null
}
