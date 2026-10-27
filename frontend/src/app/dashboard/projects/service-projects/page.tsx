'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

/** There is no separate machine list any more: a new project is created with
 * its machine (+ New Project), and past machines with Import / Export are under
 * All Projects › Past. Old links and bookmarks land there. */
export default function MachineListRedirect() {
  const router = useRouter()
  useEffect(() => { router.replace('/dashboard/projects/all') }, [router])
  return null
}
