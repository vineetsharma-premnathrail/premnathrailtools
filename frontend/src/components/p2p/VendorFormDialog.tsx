'use client'

// Add / edit a vendor in the shared vendor master (Procurement → Vendors).
// Bank, credit and GL fields are Finance's (Accounts → Vendors) and not here.

import { useState } from 'react'
import { vendorsApi } from '@/lib/api'
import { ProcurementVendor } from '@/types'
import { useEscapeKey } from '@/hooks/useEscapeKey'
import { extractErrorMessages } from '@/lib/validation'
import SearchableSelect from '@/components/erp/SearchableSelect'
import VendorReferralSection, { referralError, referralFromVendor, referralPayload } from '@/components/shared/VendorReferral'
import { FormSheet, SheetColumns, SheetSection, SheetIcon, Req, SHEET, sheetBtn, sheetInput, sheetLabel, sheetHint } from '@/components/shared/FormSheet'

type FieldKey = 'name' | 'contact_name' | 'contact_phone' | 'contact_email' | 'address' | 'city' | 'state' | 'pin_code' | 'gstin' | 'website'
const FIELDS: { key: FieldKey; label: string; flex: string; max: number }[] = [
  { key: 'name', label: 'Company name', flex: '1 1 100%', max: 520 },
  { key: 'contact_name', label: 'Contact person', flex: '1 1 220px', max: 300 },
  { key: 'contact_phone', label: 'Contact number', flex: '0 1 170px', max: 200 },
  { key: 'contact_email', label: 'Email', flex: '1 1 220px', max: 300 },
  { key: 'address', label: 'Address', flex: '1 1 100%', max: 640 },
  { key: 'city', label: 'City', flex: '0 1 150px', max: 220 },
  { key: 'state', label: 'State', flex: '0 1 150px', max: 220 },
  { key: 'pin_code', label: 'PIN', flex: '0 1 100px', max: 120 },
  { key: 'gstin', label: 'GSTIN', flex: '0 1 200px', max: 220 },
  { key: 'website', label: 'Website', flex: '1 1 220px', max: 300 },
]
const SECTIONS: { icon: 'building' | 'user' | 'tag'; title: string; keys: FieldKey[] }[] = [
  { icon: 'building', title: 'Company', keys: ['name'] },
  { icon: 'user', title: 'Contact', keys: ['contact_name', 'contact_phone', 'contact_email'] },
  { icon: 'tag', title: 'Address & Tax', keys: ['address', 'city', 'state', 'pin_code', 'gstin', 'website'] },
]

const STATUS_OPTS = [{ value: 'active', label: 'Active' }, { value: 'inactive', label: 'Inactive' }, { value: 'blocked', label: 'Blocked' }]
const MSME_CAT_OPTS = [{ value: '', label: 'Not an MSME' }, { value: 'micro', label: 'Micro' }, { value: 'small', label: 'Small' }, { value: 'medium', label: 'Medium' }]
const MSME_ACT_OPTS = [{ value: '', label: '—' }, { value: 'manufacturing', label: 'Manufacturing' }, { value: 'services', label: 'Services' }, { value: 'trader', label: 'Trader' }]

const ErrorBox = ({ error }: { error: string }) => error
  ? <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>{error}</div>
  : null

export default function VendorFormDialog({ vendor, onClose, onSaved }: {
  vendor?: ProcurementVendor
  onClose: () => void
  onSaved: (v: ProcurementVendor) => void
}) {
  const [form, setForm] = useState<Record<string, string>>(() => {
    const out: Record<string, string> = {}
    for (const f of FIELDS) out[f.key] = (vendor?.[f.key] as string | null | undefined) || ''
    out.terms_conditions = vendor?.terms_conditions || ''
    out.status = vendor?.status || 'active'
    // MSME (MSMED Act): Udyam no. + category; payment days capped at 45 for an MSME.
    const m = (vendor || {}) as Record<string, unknown>
    for (const k of ['msme_category', 'udyam_number', 'msme_activity']) out[k] = (m[k] as string | null) || ''
    out.payment_days = m.payment_days != null ? String(m.payment_days) : ''
    return out
  })
  const [referral, setReferral] = useState(() => referralFromVendor(vendor))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const close = () => { if (!saving) onClose() }
  useEscapeKey(true, close)
  const set = (k: string, v: string) => setForm((s) => ({ ...s, [k]: v }))

  const save = async () => {
    if (!form.name.trim()) { setError('Company name is required.'); return }
    // Required for a new vendor; an older vendor with nothing recorded can be edited without it.
    const refErr = referralError(referral, !vendor || !!vendor.referral_type)
    if (refErr) { setError(refErr); return }
    setSaving(true)
    setError('')
    try {
      const payload: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(form)) payload[k] = v.trim() || null
      payload.status = form.status
      payload.payment_days = form.payment_days.trim() === '' ? null : Number(form.payment_days)
      Object.assign(payload, referralPayload(referral))
      onSaved(vendor ? await vendorsApi.update(vendor.id, payload) : await vendorsApi.create(payload))
    } catch (err) {
      setError(extractErrorMessages(err, 'Could not save the vendor — try again.').join(' '))
    } finally {
      setSaving(false)
    }
  }

  return (
    <FormSheet icon={vendor ? 'edit' : 'building'} title={vendor ? `Edit ${vendor.name}` : 'Add vendor'}
      subtitle="Shared vendor master — Finance adds bank, credit and GL details in Accounts → Vendors."
      onClose={close} busy={saving}
      footer={<>
        <button type="button" onClick={close} disabled={saving} style={sheetBtn('secondary', SHEET.INK, saving)}>Cancel</button>
        <button type="button" onClick={save} disabled={saving} style={sheetBtn('primary', SHEET.BLUE, saving)}><SheetIcon name={vendor ? 'check' : 'plus'} size={16} />{saving ? 'Saving…' : vendor ? 'Save changes' : 'Add vendor'}</button>
      </>}>
      <SheetColumns
        left={<>
          <ErrorBox error={error} />
          {SECTIONS.map((s) => (
            <SheetSection key={s.title} icon={s.icon} title={s.title}>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
                {FIELDS.filter((f) => s.keys.includes(f.key)).map((f) => (
                  <div key={f.key} style={{ flex: f.flex, maxWidth: f.max, minWidth: 0 }}>
                    <label style={sheetLabel}>{f.label}{f.key === 'name' && <> <Req /></>}</label>
                    <input value={form[f.key]} onChange={(e) => set(f.key, e.target.value)} style={sheetInput} autoFocus={f.key === 'name'} />
                  </div>
                ))}
              </div>
            </SheetSection>
          ))}
        </>}
        right={<>
          <SheetSection icon="flag" title="Status">
            <SearchableSelect value={form.status} onChange={(v: string) => set('status', v)} options={STATUS_OPTS} placeholder="Status" />
          </SheetSection>
          <VendorReferralSection value={referral} onChange={setReferral} required={!vendor || !!vendor.referral_type} tour="vendor-form-referred-by"
            current={vendor?.referred_by_user_id ? { id: vendor.referred_by_user_id, name: vendor.referred_by_user_name || 'Former employee' } : null} />
          {vendor && (
            <SheetSection icon="clock" title="Record">
              <p style={{ ...sheetHint, margin: 0 }}>Created by {vendor.created_by_name || '—'}{vendor.created_at ? ` on ${new Date(vendor.created_at).toLocaleDateString('en-GB')}` : ''}</p>
            </SheetSection>
          )}
          <SheetSection icon="shield" title="MSME & Payment">
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
              <div style={{ flex: '1 1 130px' }}>
                <label style={sheetLabel}>MSME category</label>
                <SearchableSelect value={form.msme_category} onChange={(v: string) => set('msme_category', v)} options={MSME_CAT_OPTS} placeholder="Not an MSME" />
              </div>
              <div style={{ flex: '1 1 130px' }}>
                <label style={sheetLabel}>MSME activity</label>
                <SearchableSelect value={form.msme_activity} onChange={(v: string) => set('msme_activity', v)} options={MSME_ACT_OPTS} placeholder="—" />
              </div>
              <div style={{ flex: '1 1 180px' }}>
                <label style={sheetLabel}>Udyam registration no.</label>
                <input value={form.udyam_number} placeholder="UDYAM-HR-05-0012345" onChange={(e) => set('udyam_number', e.target.value)} style={sheetInput} />
              </div>
              <div style={{ flex: '0 1 110px' }}>
                <label style={sheetLabel}>Payment days</label>
                <input type="number" min={0} value={form.payment_days} onChange={(e) => set('payment_days', e.target.value)} style={sheetInput} />
              </div>
            </div>
            {form.msme_category && (
              <p style={sheetHint}>
                MSMED Act: pay within the agreed days, at most 45 days from acceptance (15 days if none agreed). Micro / small dues unpaid
                past the limit at 31 March are disallowed under sec. 43B(h) — see Finance › Outstanding › MSME dues.
              </p>
            )}
          </SheetSection>
          <SheetSection icon="doc" title="Vendor's terms & conditions">
            <textarea value={form.terms_conditions} rows={4} onChange={(e) => set('terms_conditions', e.target.value)}
              placeholder="e.g. 30 days credit, prices ex-works Pune, freight extra" style={{ ...sheetInput, resize: 'vertical' }} />
            <p style={sheetHint}>Copied onto POs to this vendor, after the company&apos;s own terms (Procurement → Settings).</p>
          </SheetSection>
        </>}
      />
    </FormSheet>
  )
}
