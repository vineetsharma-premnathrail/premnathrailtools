// Who may CHANGE a CRM record they can see (edit, stage, upload, quotations,
// follow-ups) — the client mirror of the backend's Edit scope (core/data_scope
// can_change + crm/access.py). Owner, 2026-11-03: "see others' data, change
// only your own" is set per role (Role › Data access › Edit), never coded as
// creator-only; 2026-11-14: the tab / feature tick + the scopes alone decide.
// Detail reads carry the server's answer in `can_change`; lists fall back to
// the creator / assignee ids (and the free-text BD owner / assignee names the
// backend also matches).

import type { CrmActivity, Inquiry, Organization, QuotationItem, Tender, User } from '@/types'
import { canChangeRecord, editScope } from '@/lib/permissions'

type Maybe<T> = T | null | undefined

/** The server's Edit-scope answer on a detail read (absent on list rows). */
function serverFlag(rec: object): boolean | undefined {
  const v = (rec as { can_change?: boolean | null }).can_change
  return typeof v === 'boolean' ? v : undefined
}

/** "Own + assigned" also matches the record's free-text assignee names (backend _name_is). */
function namedAssignee(user: Maybe<User>, names: Maybe<string>[]): boolean {
  if (!user?.name || editScope(user, 'crm') !== 'assigned') return false
  const me = user.name.trim().toLowerCase()
  return names.some((n) => !!n && n.trim().toLowerCase() === me)
}

export function orgChangeable(user: Maybe<User>, org: Maybe<Organization>): boolean {
  if (!user || !org) return false
  return serverFlag(org) ?? canChangeRecord(user, 'crm', { ownerIds: [org.created_by_id] })
}

export function inquiryChangeable(user: Maybe<User>, inq: Maybe<Inquiry>): boolean {
  if (!user || !inq) return false
  return serverFlag(inq) ?? (
    canChangeRecord(user, 'crm', { ownerIds: [inq.created_by_id], assignedIds: [inq.bd_owner_id, inq.sales_engineer_id] })
    || namedAssignee(user, [inq.bd_owner, inq.sales_engineer, inq.followup_assigned_to])
  )
}

export function tenderChangeable(user: Maybe<User>, tender: Maybe<Tender>): boolean {
  if (!user || !tender) return false
  return serverFlag(tender) ?? (
    canChangeRecord(user, 'crm', { ownerIds: [tender.created_by_id] }) || namedAssignee(user, [tender.bd_owner])
  )
}

/** A quotation: its creator, or whoever may change its parent (crm/access.py can_change_quotation) - an inquiry or a tender. */
export function quotationChangeable(user: Maybe<User>, quot: Maybe<QuotationItem>, parent: Maybe<Inquiry | Tender>, parentKind: 'inquiry' | 'tender' = 'inquiry'): boolean {
  if (!user) return false
  if (quot?.created_by_id != null && quot.created_by_id === user.id) return true
  return parentKind === 'tender' ? tenderChangeable(user, parent as Maybe<Tender>) : inquiryChangeable(user, parent as Maybe<Inquiry>)
}

/** A follow-up: its own Edit scope — creator, or the person it is assigned to. */
export function activityChangeable(user: Maybe<User>, a: Maybe<CrmActivity>): boolean {
  if (!user || !a) return false
  return canChangeRecord(user, 'crm', { ownerIds: [a.created_by_id] }) || namedAssignee(user, [a.assigned_to])
}
