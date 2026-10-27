'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

// There is no separate machine registration any more: a machine is registered
// together with its project on New Project.
export default function NewMachineRedirect() {
  const router = useRouter()
  useEffect(() => { router.replace('/dashboard/projects/new') }, [router])
  return null
}
