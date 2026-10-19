'use client'

import { useEffect, useState } from 'react'
import { designApi } from '@/lib/api'
import type { DesignMe } from '@/types'

// The caller's Design role (head / reviewer / designer / viewer). Only used
// to hide team-only buttons — the backend enforces every rule regardless.
export function useDesignMe(enabled = true): DesignMe | null {
  const [me, setMe] = useState<DesignMe | null>(null)
  useEffect(() => {
    if (!enabled) return
    designApi.getMe().then(setMe).catch(() => setMe(null))
  }, [enabled])
  return me
}
