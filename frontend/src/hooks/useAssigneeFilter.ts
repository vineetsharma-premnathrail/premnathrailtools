'use client'

import { useCallback, useEffect, useState } from 'react'
import { apiClient } from '@/lib/api'

/**
 * The role's "Assign to" rule for one field (backend core/assignee_rules.py,
 * set in Role & Permissions on the feature's row). Use it where a picker is
 * fed by a generic user list (users directory) instead of a module endpoint
 * that already filters:
 *
 *   const allow = useAssigneeFilter('projects:my_tasks.tasks')
 *   options = people.filter((u) => allow(u.id))
 *
 * Until the rule loads, or if it can't load, nothing is hidden — the server
 * still refuses a person outside the rule on save, with the real reason.
 */
export function useAssigneeFilter(key: string): (userId: number) => boolean {
  const [ids, setIds] = useState<Set<number> | null>(null)
  useEffect(() => {
    let alive = true
    apiClient.get('/assignee-rules/allowed', { params: { key } })
      .then(({ data }) => { if (alive) setIds(data.restricted ? new Set<number>(data.user_ids) : null) })
      .catch(() => { if (alive) setIds(null) })
    return () => { alive = false }
  }, [key])
  return useCallback((userId: number) => ids === null || ids.has(userId), [ids])
}
