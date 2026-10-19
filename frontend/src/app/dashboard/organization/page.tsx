'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/hooks/useAuth'
import { firstOrgTabHref } from './_lib/useRequireOrgTab'

export default function OrganizationPage() {
  const router = useRouter()
  const { user, isLoading } = useAuth()

  useEffect(() => {
    if (isLoading || !user) return
    router.replace(firstOrgTabHref(user) ?? '/dashboard')
  }, [isLoading, user, router])

  return null
}
