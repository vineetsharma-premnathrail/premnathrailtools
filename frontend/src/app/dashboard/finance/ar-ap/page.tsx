'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

/** Old AR/AP page — replaced by Finance > Purchase and Finance > Sales. */
export default function FinanceArApPage() {
  const router = useRouter()

  useEffect(() => {
    router.replace('/dashboard/finance/purchase')
  }, [router])

  return null
}
