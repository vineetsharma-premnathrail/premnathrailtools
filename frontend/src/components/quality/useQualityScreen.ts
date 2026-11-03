'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/hooks/useAuth'
import { useVisibility, type VisibilityApi } from '@/lib/visibility'

/**
 * A Quality screen's gate + role-wise visibility in one call (core/features/quality.py catalogue keys).
 *
 * Normal use: same as useRequireApp('quality') — someone without the Quality app is sent to the dashboard.
 * Inside the Role editor's "Preview & choose" (vis.preview) the screen draws sample data for whoever edits the
 * role, so the app check and the redirect are skipped and nothing is loaded from the server.
 */
export function useQualityScreen(key: string): { vis: VisibilityApi; isLoading: boolean; isAuthorized: boolean } {
  const vis = useVisibility(key)
  const router = useRouter()
  const { user, isLoading } = useAuth()
  const hasAccess = !!user?.apps?.includes('quality')
  useEffect(() => {
    if (!vis.preview && !isLoading && user && !hasAccess) router.push('/dashboard')
  }, [vis.preview, isLoading, user, hasAccess, router])
  return { vis, isLoading: !vis.preview && isLoading, isAuthorized: vis.preview || hasAccess }
}

/** A coded dropdown's choices for this user: the role's allowed values (every value in the preview), plus the
 *  value a saved record already holds so editing an older record never blanks it. */
export function visChoices<T extends { value: string }>(vis: VisibilityApi, dropdown: string, all: T[], current?: string): T[] {
  const kept = vis.options(dropdown, all, (o) => o.value)
  if (current && !kept.some((o) => o.value === current)) {
    const saved = all.find((o) => o.value === current)
    if (saved) return [...kept, saved]
  }
  return kept
}
