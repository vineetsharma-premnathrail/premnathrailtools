'use client'

// "Referred by" for the shared vendor master — used by Procurement's vendor
// form and Finance's vendor form so both capture it the same way.
// One searchable list: Direct (nobody referred) / External (name + phone
// below) / an employee. Required when adding a vendor, so "nobody referred"
// is an answer, not a blank. "Created by" is never an input — the server
// records the signed-in user.

import { useEffect, useMemo, useState } from 'react'
import { usersApi } from '@/lib/api'
import { extractErrorMessages } from '@/lib/validation'
import type { DirectoryUser } from '@/types'
import SearchableSelect from '@/components/erp/SearchableSelect'
import { SheetSection, Req, sheetInput, sheetLabel, sheetHint } from '@/components/shared/FormSheet'

export type ReferralValue = { choice: string; name: string; phone: string }
export const EMPTY_REFERRAL: ReferralValue = { choice: '', name: '', phone: '' }

type VendorReferralFields = {
  referral_type?: string | null
  referred_by_user_id?: number | null
  referred_by_name?: string | null
  referred_by_phone?: string | null
}

/** choice: '' (not answered) | 'direct' | 'external' | 'u:<userId>' */
export function referralFromVendor(v?: VendorReferralFields | null): ReferralValue {
  if (!v?.referral_type) return EMPTY_REFERRAL
  if (v.referral_type === 'employee' && v.referred_by_user_id) return { choice: `u:${v.referred_by_user_id}`, name: '', phone: '' }
  if (v.referral_type === 'external') return { choice: 'external', name: v.referred_by_name || '', phone: v.referred_by_phone || '' }
  return { choice: 'direct', name: '', phone: '' }
}

/** Real error text (what is missing + how to fix) or '' when valid. */
export function referralError(r: ReferralValue, required: boolean): string {
  if (!r.choice) return required ? "Choose who referred this vendor — pick an employee, 'External / other', or 'Direct (no referral)'." : ''
  if (r.choice === 'external' && !r.name.trim()) return "Enter the name (person or company) who referred this vendor, or choose 'Direct (no referral)'."
  return ''
}

export function referralPayload(r: ReferralValue): Record<string, unknown> {
  if (!r.choice) return {}
  if (r.choice === 'direct') return { referral_type: 'direct', referred_by_user_id: null, referred_by_name: null, referred_by_phone: null }
  if (r.choice === 'external') return { referral_type: 'external', referred_by_user_id: null, referred_by_name: r.name.trim(), referred_by_phone: r.phone.trim() || null }
  return { referral_type: 'employee', referred_by_user_id: Number(r.choice.slice(2)), referred_by_name: null, referred_by_phone: null }
}

export default function VendorReferralSection({ value, onChange, required, tour, current, bare }: {
  value: ReferralValue
  onChange: (v: ReferralValue) => void
  required?: boolean
  tour?: string
  /** Render just the field (no "Referred by" section card) so it can sit in a grid next to another field. */
  bare?: boolean
  /** The vendor's saved employee referrer, kept pickable even if they've left the directory. */
  current?: { id: number; name: string } | null
}) {
  const [people, setPeople] = useState<DirectoryUser[]>([])
  const [peopleError, setPeopleError] = useState('')
  useEffect(() => {
    usersApi.directory().then(setPeople)
      .catch((err) => { setPeople([]); setPeopleError(extractErrorMessages(err, 'Could not load the employee list.').join(' ')) })
  }, [])
  const options = useMemo(() => {
    const emp = [...people].sort((a, b) => (a.name || '').localeCompare(b.name || '', undefined, { numeric: true }))
      .map((p) => ({ value: `u:${p.id}`, label: p.department ? `${p.name} — ${p.department}` : p.name }))
    if (current && !emp.some((o) => o.value === `u:${current.id}`)) emp.unshift({ value: `u:${current.id}`, label: `${current.name} (inactive)` })
    return [{ value: 'direct', label: 'Direct (no referral)' }, { value: 'external', label: 'External / other person or company' }, ...emp]
  }, [people, current])
  const body = (
    <>
      <div data-tour={tour}>
        <label style={sheetLabel}>Who referred this vendor?{required && <> <Req /></>}</label>
        <SearchableSelect ariaLabel="Who referred this vendor" value={value.choice} onChange={(v: string) => onChange({ choice: v, name: v === 'external' ? value.name : '', phone: v === 'external' ? value.phone : '' })}
          options={options} placeholder="Search an employee, or pick External / Direct" />
      </div>
      {peopleError && <p role="alert" style={{ ...sheetHint, color: '#B91C1C' }}>{peopleError} Reload the page, or choose External and type the name.</p>}
      {value.choice === 'external' && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 12 }}>
          <div style={{ flex: '1 1 200px', maxWidth: 320 }}>
            <label style={sheetLabel}>Name / company <Req /></label>
            <input style={sheetInput} value={value.name} maxLength={150} onChange={(e) => onChange({ ...value, name: e.target.value })} />
          </div>
          <div style={{ flex: '0 1 160px' }}>
            <label style={sheetLabel}>Phone</label>
            <input style={sheetInput} value={value.phone} maxLength={30} onChange={(e) => onChange({ ...value, phone: e.target.value })} />
          </div>
        </div>
      )}
    </>
  )
  return bare ? <div style={{ minWidth: 0 }}>{body}</div> : <SheetSection icon="user" title="Referred by">{body}</SheetSection>
}
