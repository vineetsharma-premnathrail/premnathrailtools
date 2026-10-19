// CRM shortcuts for the dashboard: records the user has recently opened, and
// the inquiries/tenders they pinned on the Inquiries & Tenders list.
// Both live in this browser's localStorage (same as the existing list pins),
// so they are a per-browser convenience, never shared data. Every access is
// wrapped: private mode / blocked storage just means no shortcuts.
import { useAuthStore } from '@/store/authStore'

export type RecentKind = 'organization' | 'inquiry' | 'tender'

export interface RecentVisit {
  kind: RecentKind
  id: number
  /** signed page reference (lib/recordRef.ts) from the API record — links use it, never the id */
  ref?: string
  title: string
  sub?: string
  at: number
}

/** Same key the Inquiries & Tenders list pins with (`inquiry-12`, `tender-4`). */
export const PINNED_INQUIRY_TENDER_KEY = 'crm_pinned_inquiry_tender_keys'

// The dashboard shows each user's last 5 opened records per kind; they can't remove them.
const MAX_RECENT_PER_KIND = 5

// Keyed by user so a shared PC doesn't show one person's history to another.
function recentKey(): string {
  return `crm_recent_visits_${useAuthStore.getState().user?.id ?? 'anon'}`
}

export function getRecentVisits(kind?: RecentKind): RecentVisit[] {
  try {
    const all: RecentVisit[] = JSON.parse(localStorage.getItem(recentKey()) || '[]')
    return (kind ? all.filter((v) => v.kind === kind) : all).sort((a, b) => b.at - a.at)
  } catch {
    return []
  }
}

export function recordVisit(visit: Omit<RecentVisit, 'at'>): void {
  try {
    const rest = getRecentVisits().filter((v) => !(v.kind === visit.kind && v.id === visit.id))
    const next = [{ ...visit, at: Date.now() }, ...rest]
    const kept = (['organization', 'inquiry', 'tender'] as RecentKind[])
      .flatMap((k) => next.filter((v) => v.kind === k).slice(0, MAX_RECENT_PER_KIND))
    localStorage.setItem(recentKey(), JSON.stringify(kept))
  } catch {
    // storage unavailable: nothing is remembered
  }
}

export function getPinnedInquiryTenderKeys(): string[] {
  try {
    return JSON.parse(localStorage.getItem(PINNED_INQUIRY_TENDER_KEY) || '[]')
  } catch {
    return []
  }
}

export function setPinnedInquiryTenderKeys(keys: string[]): void {
  try {
    localStorage.setItem(PINNED_INQUIRY_TENDER_KEY, JSON.stringify(keys))
  } catch {
    // storage unavailable: the pin stays for this session only
  }
}
