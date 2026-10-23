'use client'

import { useCallback, useEffect, useSyncExternalStore } from 'react'
import { PermissionRegistry } from '@/types'
import { rolesApi } from '@/lib/api'

/**
 * Plain words for permission ids — users never see "p2p:purchase_requisitions:approve",
 * they see "Procurement › Purchase Requisitions — Approve".
 *
 * Id shape: "<module>:<tab>[.<feature>]:<action>", any part may be "*".
 * Labels come from the permission registry (/roles/catalog). Without the
 * registry (not loaded yet, or the viewer can't read it) the keys are turned
 * into readable words instead of being shown raw.
 */

/** "purchase_requisitions" -> "Purchase requisitions" */
function humanize(key: string): string {
  const s = key.replace(/[_\-.]+/g, ' ').trim()
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : key
}

export function moduleWords(registry: PermissionRegistry | null | undefined, moduleKey: string): string {
  if (moduleKey === '*') return 'All modules'
  return registry?.modules[moduleKey]?.label || humanize(moduleKey)
}

export function permissionWords(registry: PermissionRegistry | null | undefined, id: string | null | undefined): string {
  if (!id) return ''
  if (id === '*' || id === '*:*:*') return 'Everything (all modules)'
  const [mk = '', tk = '*', a = '*'] = id.split(':')
  const mod = registry?.modules[mk]
  const modLabel = moduleWords(registry, mk)
  let place: string
  if (!tk || tk === '*') {
    place = 'any tab'
  } else {
    const [tab, fk] = tk.split('.')
    const tabLabel = mod?.subtabs[tab] || humanize(tab)
    const featLabel = fk ? (mod?.features?.[tab]?.[fk]?.label || humanize(fk)) : ''
    place = featLabel ? `${tabLabel} › ${featLabel}` : tabLabel
  }
  const action = !a || a === '*' ? 'any action' : (registry?.action_labels?.[a] || humanize(a))
  return `${modLabel} › ${place} — ${action}`
}

// ---- shared, load-once registry -------------------------------------------

let cached: PermissionRegistry | null = null
let loading: Promise<void> | null = null
const listeners = new Set<() => void>()

function load() {
  if (cached || loading) return
  loading = rolesApi.catalog()
    .then((r) => { cached = r; listeners.forEach((l) => l()) })
    // the viewer may not be allowed to read the catalog — fall back to humanized keys
    .catch(() => undefined)
}

function subscribe(cb: () => void) {
  listeners.add(cb)
  return () => { listeners.delete(cb) }
}

/**
 * Loads the permission registry once per page session and returns label
 * helpers. Pass `registry` when the page already has it to skip the fetch.
 */
export function usePermissionWords(registry?: PermissionRegistry | null) {
  const shared = useSyncExternalStore(subscribe, () => cached, () => null)
  useEffect(() => { if (!registry) load() }, [registry])
  const reg = registry || shared
  const perm = useCallback((id: string | null | undefined) => permissionWords(reg, id), [reg])
  const mod = useCallback((key: string) => moduleWords(reg, key), [reg])
  return { registry: reg, permLabel: perm, moduleLabel: mod }
}
