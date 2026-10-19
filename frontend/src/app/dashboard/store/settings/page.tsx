'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useAuthStore } from '@/store/authStore'
import { filterTabsByAccess } from '@/lib/tabAccess'
import { STORE_SETTINGS_SECTIONS } from '@/components/store/StoreSettingsNav'

// Opens the first Settings section the user may view (roles decide which).
export default function StoreSettingsPage() {
  const router = useRouter()
  const user = useAuthStore((s) => s.user)

  useEffect(() => {
    const first = filterTabsByAccess('store', STORE_SETTINGS_SECTIONS, user)[0]
    router.replace(first ? first.href : '/dashboard/store/settings/item-types')
  }, [router, user])

  return null
}
