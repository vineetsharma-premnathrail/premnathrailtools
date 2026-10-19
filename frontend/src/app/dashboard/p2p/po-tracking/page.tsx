'use client'

// Folded into the Purchase Orders tab (2026-10-08); old links land on its tracking view.
import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

export default function Redirect() {
  const router = useRouter()
  useEffect(() => {
    const bucket = typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('bucket') : null
    router.replace(`/dashboard/p2p/purchase-orders?view=tracking${bucket ? `&bucket=${bucket}` : ''}`)
  }, [router])
  return null
}
