'use client'

// Add / edit a vendor in the shared vendor master (Procurement → Vendors).
// Bank, credit and GL fields are Finance's (Finance › Masters & Setup › Vendors) and not here.

import { useEffect, useRef, useState } from 'react'
import { vendorsApi } from '@/lib/api'
import { useFormDraft } from '@/lib/formDraft'
import DraftBanner from '@/components/shared/DraftBanner'
import { ProcurementVendor } from '@/types'
import { useEscapeKey } from '@/hooks/useEscapeKey'
import { extractErrorMessages, isValidEmail, isValidPinCode, VALIDATION_MESSAGES } from '@/lib/validation'
import { formatDate } from '@/lib/format'
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

const STATUS_OPTS = [{ value: 'active', label: 'Active' }, { value: 'inactive', label: 'Inactive' }, { value: 'blocked', label: 'Blocked' }]
const MSME_CAT_OPTS = [{ value: '', label: 'Not an MSME' }, { value: 'micro', label: 'Micro' }, { value: 'small', label: 'Small' }, { value: 'medium', label: 'Medium' }]
const MSME_ACT_OPTS = [{ value: '', label: '—' }, { value: 'manufacturing', label: 'Manufacturing' }, { value: 'services', label: 'Services' }, { value: 'trader', label: 'Trader' }]

function ErrorBox({ error }: { error: string }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => { if (error) ref.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }) }, [error])
  return error
    ? <div ref={ref} role="alert" style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>{error}</div>
    : null
}

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
  // A new vendor's typed data survives a refresh / network failure (lib/formDraft.ts).
  const draft = useFormDraft(vendor ? null : 'p2p-vendor-new', { form, referral }, (d) => {
    if (d.form) setForm((s) => ({ ...s, ...d.form }))
    if (d.referral) setReferral(d.referral)
  })
  const close = () => { if (!saving) onClose() }
  useEscapeKey(true, close)
  const set = (k: string, v: string) => setForm((s) => ({ ...s, [k]: v }))
  const isMsme = !!form.msme_category
  const textField = (key: FieldKey, label: string) => (
    <div key={key} style={{ minWidth: 0 }}>
      <label style={sheetLabel}>{label}</label>
      <input value={form[key]} onChange={(e) => set(key, e.target.value)} style={sheetInput} />
    </div>
  )

  const save = async () => {
    if (!form.name.trim()) { setError('Company name is required — type the vendor\'s registered name.'); return }
    if (form.contact_email.trim() && !isValidEmail(form.contact_email)) { setError(`Email: ${VALIDATION_MESSAGES.email}`); return }
    if (form.gstin.trim() && form.gstin.trim().length !== 15) { setError(`GSTIN: ${VALIDATION_MESSAGES.gst}`); return }
    if (form.pin_code.trim() && !isValidPinCode(form.pin_code)) { setError(`PIN: ${VALIDATION_MESSAGES.pin}`); return }
    if (form.msme_category && form.payment_days.trim() !== '' && Number(form.payment_days) > 45) { setError('MSME vendors must be paid within 45 days — enter 45 or less.'); return }
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
      const saved = vendor ? await vendorsApi.update(vendor.id, payload) : await vendorsApi.create(payload)
      draft.clear()
      onSaved(saved)
    } catch (err) {
      setError(extractErrorMessages(err, 'Could not save the vendor — try again.').join(' '))
    } finally {
      setSaving(false)
    }
  }

  return (
    <FormSheet icon={vendor ? 'edit' : 'building'} title={vendor ? `Edit ${vendor.name}` : 'Add vendor'}
      onClose={close} busy={saving}
      footer={<>
        <button type="button" onClick={close} disabled={saving} style={sheetBtn('secondary', SHEET.INK, saving)}>Cancel</button>
        <button type="button" onClick={save} disabled={saving} style={sheetBtn('primary', SHEET.BLUE, saving)}><SheetIcon name={vendor ? 'check' : 'plus'} size={16} />{saving ? 'Saving…' : vendor ? 'Save changes' : 'Add vendor'}</button>
      </>}>
      <SheetColumns
        left={<>
          <ErrorBox error={error} />
          <DraftBanner draft={draft} />
          <SheetSection icon="building" title="Company">
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, alignItems: 'start' }}>
              <div style={{ minWidth: 0 }}>
                <label style={sheetLabel}>Company name <Req /></label>
                <input value={form.name} onChange={(e) => set('name', e.target.value)} style={sheetInput} autoFocus />
              </div>
              <VendorReferralSection bare value={referral} onChange={setReferral} required={!vendor || !!vendor.referral_type} tour="vendor-form-referred-by"
                current={vendor?.referred_by_user_id ? { id: vendor.referred_by_user_id, name: vendor.referred_by_user_name || 'Former employee' } : null} />
            </div>
          </SheetSection>
          <SheetSection icon="contact" title="Contact">
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              {textField('contact_name', 'Contact person')}
              {textField('contact_phone', 'Contact number')}
              {textField('contact_email', 'Email')}
              {textField('website', 'Website')}
            </div>
          </SheetSection>
          <SheetSection icon="location" title="Address">
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
              <div style={{ gridColumn: '1 / -1' }}>{textField('address', 'Address')}</div>
              {textField('city', 'City')}
              {textField('state', 'State')}
              {textField('pin_code', 'PIN')}
              <div style={{ gridColumn: '1 / 3' }}>{textField('gstin', 'GSTIN')}</div>
            </div>
          </SheetSection>
        </>}
        right={<>
          {vendor && (
            <SheetSection icon="clock" title="Record">
              <p style={{ ...sheetHint, margin: 0 }}>Created by {vendor.created_by_name || '—'}{vendor.created_at ? ` on ${formatDate(vendor.created_at)}` : ''}</p>
            </SheetSection>
          )}
          <SheetSection icon="shield" title="MSME & Payment">
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div style={{ minWidth: 0 }}>
                <label style={sheetLabel}>MSME category</label>
                <SearchableSelect value={form.msme_category} onChange={(v: string) => set('msme_category', v)} options={MSME_CAT_OPTS} placeholder="Not an MSME" ariaLabel="MSME category" />
              </div>
              <div style={{ minWidth: 0 }}>
                <label style={sheetLabel}>MSME activity</label>
                <SearchableSelect value={form.msme_activity} onChange={(v: string) => set('msme_activity', v)} options={MSME_ACT_OPTS} disabled={!isMsme} placeholder="—" ariaLabel="MSME activity" />
              </div>
              <div style={{ minWidth: 0 }}>
                <label style={sheetLabel}>Udyam registration no.</label>
                <input value={form.udyam_number} placeholder="UDYAM-HR-05-0012345" disabled={!isMsme} aria-label="Udyam registration number" onChange={(e) => set('udyam_number', e.target.value)} style={{ ...sheetInput, ...(isMsme ? {} : { opacity: 0.6, cursor: 'not-allowed' }) }} />
              </div>
              <div style={{ minWidth: 0 }}>
                <label style={sheetLabel}>Payment days</label>
                <input type="number" min={0} value={form.payment_days} onChange={(e) => set('payment_days', e.target.value)} style={sheetInput} />
              </div>
            </div>
            {!isMsme && <p style={sheetHint}>Choose an MSME category (Micro, Small or Medium) to fill the activity and Udyam number.</p>}
            {isMsme && (
              <p style={sheetHint}>
                MSMED Act: pay within the agreed days, at most 45 days from acceptance (15 days if none agreed). Micro / small dues unpaid
                past the limit at 31 March are disallowed under sec. 43B(h) — see Finance › Outstanding › MSME dues.
              </p>
            )}
          </SheetSection>
          <SheetSection icon="doc" title="Vendor's terms & conditions">
            <textarea value={form.terms_conditions} rows={4} onChange={(e) => set('terms_conditions', e.target.value)} aria-label="Vendor's terms and conditions"
              placeholder="e.g. 30 days credit, prices ex-works Pune, freight extra" style={{ ...sheetInput, resize: 'vertical' }} />
          </SheetSection>
          <SheetSection icon="flag" title="Status">
            <SearchableSelect value={form.status} onChange={(v: string) => set('status', v)} options={STATUS_OPTS} placeholder="Status" ariaLabel="Status" />
          </SheetSection>
        </>}
      />
    </FormSheet>
  )
}
