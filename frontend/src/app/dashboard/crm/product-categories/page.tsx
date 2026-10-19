'use client'

// Moved into CRM → Settings; old links and bookmarks land there.
import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

export default function ProductCategoriesPageRedirect() {
  const router = useRouter()
  useEffect(() => { router.replace('/dashboard/crm/settings?section=product-categories') }, [router])
  return null
}
