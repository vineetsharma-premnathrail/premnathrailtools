'use client'

// Whether the viewer approves requisitions / POs at all (shows the Approvals
// views). /auth/me's is_pr_approver / is_po_approver only know the old
// Procurement routing tables; GET /p2p/requests/approver-flags adds the
// central approval engine's steps. Fetched once per page load.

import { useEffect, useState } from 'react'
import { useAuth } from '@/hooks/useAuth'
import { p2pApi } from '@/lib/api'

type Flags = { is_pr_approver: boolean; is_po_approver: boolean }
let cached: Promise<Flags> | null = null

export function useP2PApproverFlags(): Flags {
  const { user } = useAuth()
  const admin = user?.role === 'admin'
  const [engineFlags, setEngineFlags] = useState<Flags>({ is_pr_approver: false, is_po_approver: false })

  useEffect(() => {
    if (!user || admin) return
    let alive = true
    if (!cached) cached = p2pApi.approverFlags().catch(() => ({ is_pr_approver: false, is_po_approver: false }))
    cached.then((f) => { if (alive) setEngineFlags(f) })
    return () => { alive = false }
  }, [user, admin])

  return {
    is_pr_approver: admin || !!user?.is_pr_approver || engineFlags.is_pr_approver,
    is_po_approver: admin || !!user?.is_po_approver || engineFlags.is_po_approver,
  }
}
