'use client'

import { useEffect, useRef, useState } from 'react'
import { EnvelopeSimple, Phone } from '@phosphor-icons/react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useAuth } from '@/hooks/useAuth'
import { useCan } from '@/lib/permissions'
import { crmApi } from '@/lib/api'
import { recordVisit } from '@/lib/crmShortcuts'
import { OrganizationDetail, Inquiry, Tender, OrgContact } from '@/types'
import ConfirmDialog from '@/components/erp/ConfirmDialog'
import MessageDialog from '@/components/erp/MessageDialog'
import { extractErrorMessages, isValidEmail } from '@/lib/validation'
import { orgTypeHasRailwayFields, inquiryStatusColor, tenderStatusColor } from '@/components/crm/constants'
import { primaryBtnStyle, secondaryBtnStyle, dangerBtnStyle, handleEnterAsTab, smallSecondaryBtnStyle } from '@/components/crm/ui'
import { FormSheet, SheetSection, SheetIcon, Req, SHEET, sheetBtn, sheetInput, sheetLabel, SheetError } from '@/components/shared/FormSheet'
import { recordPath, refOf } from '@/lib/recordRef'
import { formatDateTime, formatDate } from '@/lib/format'
import { AddMoreButton, RemoveValueButton, ValueRow, canAddMore } from '@/components/shared/MoreValuesButtons'
import { segmentBtnStyle, RowCount, Pill, pillStyle, DetailCard, DetailSummary, DetailGroup, DetailRow } from '@/components/shared/ui'

const TABS = ['Overview', 'Contacts', 'Inquiries', 'Tenders', 'Audit Trail'] as const

// Links out to an inquiry/tender carry a `back` param so its Back button returns
// here — to this organization, on the tab the link was clicked from.
function useBackSuffix(tab: typeof TABS[number]) {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const params = new URLSearchParams(searchParams.toString())
  params.set('tab', tab)
  return `?back=${encodeURIComponent(`${pathname}?${params.toString()}`)}`
}

export default function OrganizationDetailPanel({ orgId, onDeleted, showEditLink = true }: { orgId: number; onDeleted?: () => void; showEditLink?: boolean }) {
  const { user } = useAuth()
  const { can, canDelete, canFeature } = useCan()
  const router = useRouter()

  const [org, setOrg] = useState<OrganizationDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | string[]>('')
  const searchParams = useSearchParams()
  const initialTab = (t: string | null): typeof TABS[number] =>
    TABS.includes(t as typeof TABS[number]) ? (t as typeof TABS[number]) : 'Overview'
  const [tab, setTab] = useState<typeof TABS[number]>(() => initialTab(searchParams.get('tab')))
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)

  const load = async () => {
    setLoading(true)
    setError('')
    try {
      const detail = await crmApi.getOrganizationDetail(orgId)
      setOrg(detail)
      recordVisit({ kind: 'organization', id: detail.id, ref: refOf(detail), title: detail.name, sub: detail.city || detail.org_type })
    } catch (err) {
      setError(extractErrorMessages(err, 'Customer Organization not found.'))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    // Deferred so the effect itself sets no state.
    if (orgId) Promise.resolve().then(() => { setTab(initialTab(searchParams.get('tab'))); load() })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId])

  // Creator-or-admin (backend rule) AND the Permission Matrix grant for the action.
  const isOwnerOrAdmin = !!org && !!user && (user.role === 'admin' || org.created_by_id === user.id)
  const canModify = isOwnerOrAdmin && can('crm', 'organizations', 'edit')
  // Organization sub-tabs are features of the Organizations tab (core/features/crm.py).
  const seeTab = (t: typeof TABS[number]) => t === 'Overview'
    || (t === 'Contacts' && canFeature('crm', 'organizations', 'contacts', 'view'))
    || ((t === 'Inquiries' || t === 'Tenders') && canFeature('crm', 'organizations', 'linked_records', 'view'))
    || (t === 'Audit Trail' && canFeature('crm', 'organizations', 'audit_trail', 'view'))
  const canDeleteOrg = !!org && canDelete('crm', 'organizations', org.created_by_id ?? null)

  const handleDelete = async () => {
    try {
      await crmApi.deleteOrganization(orgId)
      if (onDeleted) onDeleted()
      else router.push('/dashboard/crm/organizations')
    } catch (err) {
      setError(extractErrorMessages(err, 'Failed to delete customer organization.'))
    }
  }

  if (loading) return <p style={{ fontSize: 13, color: '#78716c' }}>Loading…</p>
  if (error && !org) return <p style={{ fontSize: 13, color: '#b91c1c' }}>{error}</p>
  if (!org) return null

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, marginBottom: 20, flexWrap: 'wrap' }}>
        <div>
          <p style={{ fontSize: 11.5, fontWeight: 600, color: '#a8a29e', margin: '0 0 4px' }}>{org.org_type || 'Customer Organization'}{org.org_code ? ` · ${org.org_code}` : ''}</p>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: '#1f1108', margin: 0 }}>{org.name}</h1>
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <button onClick={() => router.push('/dashboard/crm/organizations')} type="button" data-tour="orgdetail-back-btn" style={secondaryBtnStyle}>
            ← Back
          </button>
          {canModify && showEditLink && <button type="button" onClick={() => router.push(`${recordPath('/dashboard/crm/organizations', org)}/edit`)} data-tour="orgdetail-edit-link" style={secondaryBtnStyle}>Edit</button>}
          {canDeleteOrg && <button onClick={() => setShowDeleteConfirm(true)} data-tour="orgdetail-delete-btn" style={dangerBtnStyle}>Delete</button>}
        </div>
      </div>

      <div className="hide-scrollbar" style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 20, overflowX: 'auto', overflowY: 'visible' }}>
        {TABS.filter(seeTab).map((t) => {
          const count = t === 'Inquiries' ? org.inquiry_count : t === 'Tenders' ? org.tender_count : t === 'Contacts' ? org.contacts.length : null
          return (
            <button
              key={t}
              onClick={() => setTab(t)}
              data-tour={`orgdetail-tab-${t}`}
              className="org-detail-tab"
              style={{ ...segmentBtnStyle(tab === t), flexShrink: 0, transition: 'background .15s, color .15s' }}
            >
              {t}
              {count !== null && (
                <span style={{ ...pillStyle(tab === t ? '#FF7A45' : '#78716c'), fontSize: 11, padding: '1px 7px' }}>
                  {count}
                </span>
              )}
            </button>
          )
        })}
      </div>

      {(tab === 'Overview' || !seeTab(tab)) && <OverviewTab org={org} />}
      {tab === 'Contacts' && seeTab(tab) && <ContactsTab org={org} canModify={isOwnerOrAdmin && canFeature('crm', 'organizations', 'contacts', 'edit')} canCreate={isOwnerOrAdmin && canFeature('crm', 'organizations', 'contacts', 'create')} onRefresh={load} />}
      {tab === 'Inquiries' && seeTab(tab) && <InquiriesTab orgId={org.id} orgRef={refOf(org)} canModify={isOwnerOrAdmin && can('crm', 'inquiries_tenders', 'create')} contacts={org.contacts} />}
      {tab === 'Tenders' && seeTab(tab) && <TendersTab orgId={org.id} orgRef={refOf(org)} canModify={isOwnerOrAdmin && can('crm', 'inquiries_tenders', 'create')} />}
      {tab === 'Audit Trail' && seeTab(tab) && <AuditTab orgId={org.id} />}

      <ConfirmDialog
        open={showDeleteConfirm}
        title="Delete this customer organization?"
        message={`Delete customer organization ${org.name}? Its inquiries and tenders will also be deleted. This action cannot be undone.`}
        onConfirm={() => { setShowDeleteConfirm(false); handleDelete() }}
        onCancel={() => setShowDeleteConfirm(false)}
      />
      <MessageDialog open={!!error} variant="error" title="Customer Organization Action Failed" message={error} onClose={() => setError('')} />
    </div>
  )
}

function OverviewTab({ org }: { org: OrganizationDetail }) {
  // Keep the rows for legacy records that carry a value under a non-railway type.
  const showRailwayFields = orgTypeHasRailwayFields(org.org_type) || !!org.railway_zone || !!org.division_workshop
  const place = [org.city, org.state].filter(Boolean).join(', ')
  const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`
  const dot = <span style={{ color: '#cbd5e1' }}>·</span>
  // One card, same order as the organization form: details, address, contact & registration.
  return (
    <DetailCard tour="orgdetail-overview">
      <DetailSummary
        title={org.name}
        text={`${org.org_type || 'Customer'} organization${place ? ` in ${place}` : ''} — ${plural(org.contacts.length, 'contact')}, ${org.inquiry_count} ${org.inquiry_count === 1 ? 'inquiry' : 'inquiries'}, ${plural(org.tender_count, 'tender')}.`}
        meta={<>
          <span>Code: <strong style={{ color: '#0f172a' }}>{org.org_code || '—'}</strong></span>
          {org.created_at && <>{dot}<span>Added {formatDate(org.created_at)}{org.created_by_name ? ` by ${org.created_by_name}` : ''}</span></>}
        </>}
      />
      <DetailGroup title="Customer Organization Details">
        <DetailRow label="Scope">{org.org_scope === 'international' ? 'International' : 'Domestic'}</DetailRow>
        <DetailRow label="Type">{org.org_type}</DetailRow>
        {showRailwayFields && <DetailRow label="Railway zone">{org.railway_zone}</DetailRow>}
        {showRailwayFields && <DetailRow label="Division / Workshop">{org.division_workshop}</DetailRow>}
      </DetailGroup>
      <DetailGroup title="Address">
        <DetailRow label="Address">{org.address}</DetailRow>
        <DetailRow label="City / State">{place || null}</DetailRow>
        <DetailRow label="PIN code">{org.pin_code}</DetailRow>
        <DetailRow label="Country">{org.country}</DetailRow>
      </DetailGroup>
      <DetailGroup title="Contact & Registration" last>
        <DetailRow label="Official phone">{[org.official_phone, ...(org.additional_phones || [])].filter(Boolean).join(', ') || null}</DetailRow>
        <DetailRow label="Official email">{[org.official_email, ...(org.additional_emails || [])].filter(Boolean).join(', ') || null}</DetailRow>
        <DetailRow label="Website">{org.website}</DetailRow>
        {org.org_scope === 'international' ? (
          <>
            <DetailRow label="Tax / VAT ID">{org.tax_vat_id}</DetailRow>
            <DetailRow label="Company registration number">{org.company_registration_no}</DetailRow>
          </>
        ) : (
          <>
            <DetailRow label="GSTIN">{org.gst_number}</DetailRow>
            <DetailRow label="PAN">{org.pan}</DetailRow>
            <DetailRow label="GST state code (place of supply)">{org.gst_state_code}</DetailRow>
          </>
        )}
      </DetailGroup>
    </DetailCard>
  )
}

function ContactsTab({ org, canModify, canCreate, onRefresh }: { org: OrganizationDetail; canModify: boolean; canCreate: boolean; onRefresh: () => void }) {
  const backSuffix = useBackSuffix('Contacts')
  const router = useRouter()
  const emptyForm = { name: '', designation: '', mobile: '', email: '', department: '' }
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [form, setForm] = useState(emptyForm)
  // More mobiles / emails for the same person (besides the main one).
  const [extraMobiles, setExtraMobiles] = useState<string[]>([])
  const [extraEmails, setExtraEmails] = useState<string[]>([])
  const [saving, setSaving] = useState(false)
  const submittingRef = useRef(false)
  const [dupeConfirm, setDupeConfirm] = useState(false)
  const [errorDialog, setErrorDialog] = useState<string[] | null>(null)
  const [inquiries, setInquiries] = useState<Inquiry[]>([])
  const [tenders, setTenders] = useState<Tender[]>([])

  useEffect(() => {
    crmApi.listInquiries({ org_id: org.id, limit: 10000 }).then(setInquiries).catch(() => setInquiries([]))
    crmApi.listTenders({ org_id: org.id, limit: 10000 }).then(setTenders).catch(() => setTenders([]))
  }, [org.id])

  const startEdit = (c: OrganizationDetail['contacts'][number]) => {
    setEditingId(c.id)
    setForm({ name: c.name, designation: c.designation || '', mobile: c.mobile || '', email: c.email || '', department: c.department || '' })
    setExtraMobiles(c.additional_mobiles || [])
    setExtraEmails(c.additional_emails || [])
    setShowForm(true)
  }

  const cancelForm = () => {
    setEditingId(null)
    setForm(emptyForm)
    setExtraMobiles([])
    setExtraEmails([])
    setShowForm(false)
    setErrorDialog(null)
  }

  const otherContacts = org.contacts.filter((c) => !(editingId && c.id === editingId))
  const mobileTrim = form.mobile.trim()
  const emailLower = form.email.trim().toLowerCase()
  // Live, as-you-type duplicate flags against every other contact on this
  // organization — surfaced inline instead of only at save time.
  const dupMobile = !!mobileTrim && otherContacts.some((c) => (c.mobile || '').trim() === mobileTrim)
  const dupEmail = !!emailLower && otherContacts.some((c) => (c.email || '').trim().toLowerCase() === emailLower)
  const dupName = !!form.name.trim() && otherContacts.some((c) => c.name.trim().toLowerCase() === form.name.trim().toLowerCase())

  const doSave = async () => {
    submittingRef.current = true
    setSaving(true)
    try {
      const payload = {
        ...form,
        additional_mobiles: extraMobiles.map((m) => m.trim()).filter(Boolean),
        additional_emails: extraEmails.map((e) => e.trim()).filter(Boolean),
      }
      if (editingId) await crmApi.updateOrgContact(org.id, editingId, payload)
      else await crmApi.createOrgContact(org.id, payload)
      cancelForm()
      onRefresh()
    } catch (err) {
      setErrorDialog(extractErrorMessages(err, 'Failed to save contact.'))
    } finally {
      submittingRef.current = false
      setSaving(false)
    }
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (submittingRef.current) return
    setErrorDialog(null)
    if (!form.name.trim()) { setErrorDialog(['Enter the contact person\'s name — it is required.']); return }
    if (form.email && !isValidEmail(form.email)) {
      setErrorDialog(['Enter a valid email address for this contact.'])
      return
    }
    const badExtra = extraEmails.map((e) => e.trim()).filter((e) => e && !isValidEmail(e))
    if (badExtra.length) { setErrorDialog([`Enter a valid email address — "${badExtra[0]}" isn't one. Fix it or remove that row.`]); return }
    if ((extraMobiles.some((m) => m.trim()) && !form.mobile.trim()) || (extraEmails.some((e) => e.trim()) && !form.email.trim())) {
      setErrorDialog(['Fill in the main Phone / Email first — the extra rows are for a second or third number/address.'])
      return
    }
    // Phone/email matching another contact on the same org is a hard stop —
    // only a same-name-but-different-details match gets a soft "save anyway?".
    if (dupMobile || dupEmail) {
      const parts: string[] = []
      if (dupMobile) parts.push('This phone number is already used by another contact on this customer organization.')
      if (dupEmail) parts.push('This email address is already used by another contact on this customer organization.')
      setErrorDialog(parts)
      return
    }
    if (dupName) {
      setDupeConfirm(true)
      return
    }
    await doSave()
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {(canCreate || canModify) && (
        <div>
          {canCreate && <button onClick={() => { cancelForm(); setShowForm(true) }} data-tour="orgdetail-add-contact-btn" style={primaryBtnStyle}>+ Add Contact</button>}
          {showForm && (
            <FormSheet tour="orgdetail-contact-form" width={640} icon={editingId ? 'edit' : 'user'} title={editingId ? 'Edit Contact' : 'Add Contact'}
              subtitle={`Contact person at ${org.name}.`} onClose={cancelForm} busy={saving}
              footer={<>
                <button type="button" onClick={cancelForm} disabled={saving} data-tour="orgdetail-contact-cancel-btn" style={sheetBtn('secondary', SHEET.INK, saving)}>Cancel</button>
                <button type="submit" form="orgdetail-contact-form" disabled={saving || dupMobile || dupEmail} data-tour="orgdetail-contact-save" style={sheetBtn('primary', SHEET.BLUE, saving || dupMobile || dupEmail)}>
                  <SheetIcon name={editingId ? 'check' : 'plus'} size={16} />{saving ? 'Saving…' : editingId ? 'Save Changes' : 'Save Contact'}
                </button>
              </>}>
              <form id="orgdetail-contact-form" onSubmit={submit} onKeyDown={handleEnterAsTab} style={{ padding: '20px 24px' }}>
                <SheetError error={errorDialog} />
                <SheetSection icon="user" title="Person">
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
                    <div style={{ flex: '1 1 100%' }}><div data-tour="orgdetail-contact-name"><label style={sheetLabel}>Name <Req /></label><input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} style={sheetInput} autoFocus /></div></div>
                    <div style={{ flex: '1 1 200px' }}><div data-tour="orgdetail-contact-designation"><label style={sheetLabel}>Designation</label><input value={form.designation} onChange={(e) => setForm((f) => ({ ...f, designation: e.target.value }))} style={sheetInput} /></div></div>
                    <div style={{ flex: '1 1 200px' }}><div data-tour="orgdetail-contact-department"><label style={sheetLabel}>Department</label><input value={form.department} onChange={(e) => setForm((f) => ({ ...f, department: e.target.value }))} style={sheetInput} /></div></div>
                  </div>
                </SheetSection>
                <SheetSection icon="chat" title="Reach">
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
                    <div style={{ flex: '1 1 200px' }}>
                      <div data-tour="orgdetail-contact-mobile"><label style={sheetLabel}>Phone</label>
                        <ValueRow button={<AddMoreButton label="Add another phone" extras={extraMobiles} primary={form.mobile} onClick={() => canAddMore(extraMobiles, form.mobile) && setExtraMobiles((v) => [...v, ''])} />}>
                          <input
                            value={form.mobile}
                            onChange={(e) => setForm((f) => ({ ...f, mobile: e.target.value }))}
                            style={{ ...sheetInput, ...(dupMobile ? { borderColor: '#f59e0b', background: '#fffbeb' } : {}) }}
                          />
                        </ValueRow>
                        {dupMobile && <p style={{ fontSize: 11, color: '#b45309', fontWeight: 600, margin: '4px 0 0' }}>Already used by another contact on this customer organization.</p>}
                        {extraMobiles.map((m, i) => (
                          <div key={i} style={{ marginTop: 8 }}>
                            <ValueRow button={<RemoveValueButton label="Remove this phone" onClick={() => setExtraMobiles((v) => v.filter((_, j) => j !== i))} />}>
                              <input value={m} placeholder={`Phone ${i + 2}`} onChange={(e) => setExtraMobiles((v) => v.map((x, j) => (j === i ? e.target.value : x)))} style={sheetInput} />
                            </ValueRow>
                          </div>
                        ))}
                      </div>
                    </div>
                    <div style={{ flex: '1 1 240px' }}>
                      <div data-tour="orgdetail-contact-email"><label style={sheetLabel}>Email</label>
                        <ValueRow button={<AddMoreButton label="Add another email" extras={extraEmails} primary={form.email} onClick={() => canAddMore(extraEmails, form.email) && setExtraEmails((v) => [...v, ''])} />}>
                          <input
                            value={form.email}
                            onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                            style={{ ...sheetInput, ...(dupEmail ? { borderColor: '#f59e0b', background: '#fffbeb' } : {}) }}
                          />
                        </ValueRow>
                        {dupEmail && <p style={{ fontSize: 11, color: '#b45309', fontWeight: 600, margin: '4px 0 0' }}>Already used by another contact on this customer organization.</p>}
                        {extraEmails.map((m, i) => (
                          <div key={i} style={{ marginTop: 8 }}>
                            <ValueRow button={<RemoveValueButton label="Remove this email" onClick={() => setExtraEmails((v) => v.filter((_, j) => j !== i))} />}>
                              <input value={m} type="email" placeholder={`Email ${i + 2}`} onChange={(e) => setExtraEmails((v) => v.map((x, j) => (j === i ? e.target.value : x)))} style={sheetInput} />
                            </ValueRow>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </SheetSection>
              </form>
            </FormSheet>
          )}
        </div>
      )}

      {org.contacts.length === 0 ? (
        <p style={{ fontSize: 13, color: '#a8a29e' }}>No contacts added yet{canCreate ? ' — use + Add Contact.' : '.'}</p>
      ) : (
        <div data-tour="orgdetail-contacts-list" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {org.contacts.map((c) => {
            const linkedInquiries = inquiries.filter((i) => i.org_contact_id === c.id)
            const linkedTenders = tenders.filter((t) => t.org_contact_id === c.id)
            return (
            <div key={c.id} style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '14px 16px', borderRadius: 12, background: 'rgba(255,255,255,.16)', backdropFilter: 'blur(28px)', WebkitBackdropFilter: 'blur(28px)', border: '1px solid rgba(255,255,255,.24)', boxShadow: '0 12px 32px rgba(15,23,42,0.16), 0 2px 6px rgba(15,23,42,.08), inset 0 1px 0 rgba(255,255,255,.35)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 14 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
                <div
                  style={{
                    width: 38, height: 38, borderRadius: '50%', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
                    background: 'linear-gradient(140deg,#FF7A45,#ffe3d0)', color: '#fff', fontSize: 13, fontWeight: 600,
                  }}
                >
                  {c.name.split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase()}
                </div>
                <div style={{ minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <p style={{ fontSize: 13.5, fontWeight: 600, color: '#1f1108', margin: 0 }}>{c.name}</p>
                    {c.designation && <Pill label={c.designation} hex="#FF7A45" title="Designation" />}
                    {c.department && <Pill label={c.department} hex="#78716c" title="Department" />}
                  </div>
                  {(c.mobile || c.email) && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 4, flexWrap: 'wrap' }}>
                      {c.mobile && (
                        <span style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, color: '#78716c' }}>
                          <Phone size={12} />
                          {[c.mobile, ...(c.additional_mobiles || [])].filter(Boolean).join(', ')}
                        </span>
                      )}
                      {c.email && (
                        <span style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, color: '#78716c' }}>
                          <EnvelopeSimple size={12} />
                          {[c.email, ...(c.additional_emails || [])].filter(Boolean).join(', ')}
                        </span>
                      )}
                    </div>
                  )}
                </div>
              </div>
              {canModify && (
                <button onClick={() => startEdit(c)} data-tour={c.id === org.contacts[0]?.id ? 'orgdetail-contact-edit-btn' : undefined} style={{ ...smallSecondaryBtnStyle, flexShrink: 0 }}>Edit</button>
              )}
              </div>

              {(linkedInquiries.length > 0 || linkedTenders.length > 0) && (
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', paddingLeft: 50 }}>
                  {linkedInquiries.map((i) => (
                    <button
                      type="button"
                      key={`inq-${i.id}`}
                      title="Open this inquiry"
                      onClick={() => router.push(`/dashboard/crm/inquiries/${refOf(i)}${backSuffix}`)}
                      style={{ ...pillStyle('#3b82f6'), border: 'none', cursor: 'pointer', fontFamily: 'monospace' }}
                    >
                      Inquiry {i.universal_id || `#${i.id}`}
                    </button>
                  ))}
                  {linkedTenders.map((t) => (
                    <button
                      type="button"
                      key={`tnd-${t.id}`}
                      title="Open this tender"
                      onClick={() => router.push(`/dashboard/crm/tenders/${refOf(t)}${backSuffix}`)}
                      style={{ ...pillStyle('#f4713b'), border: 'none', cursor: 'pointer', fontFamily: 'monospace' }}
                    >
                      Tender {t.universal_id || `#${t.id}`}
                    </button>
                  ))}
                </div>
              )}
            </div>
            )
          })}
        </div>
      )}

      <ConfirmDialog
        open={dupeConfirm}
        title="Possible duplicate contact"
        message={`A contact with the same name, phone, or email already exists for this customer organization. Save anyway?`}
        onConfirm={() => { setDupeConfirm(false); doSave() }}
        onCancel={() => setDupeConfirm(false)}
      />
    </div>
  )
}

function TabLoadError({ message }: { message: string | string[] }) {
  const lines = Array.isArray(message) ? message : [message]
  return (
    <div role="alert" style={{ padding: '12px 16px', borderRadius: 12, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.25)' }}>
      {lines.map((m, i) => <p key={i} style={{ fontSize: 13, color: '#b91c1c', margin: i ? '4px 0 0' : 0 }}>{m}</p>)}
    </div>
  )
}

function StatusPill({ value, hex = '#57534e' }: { value: string; hex?: string }) {
  return <Pill label={value || '—'} hex={hex} />
}

function InquiriesTab({ orgId, orgRef, canModify, contacts }: { orgId: number; orgRef: string; canModify: boolean; contacts: OrgContact[] }) {
  const backSuffix = useBackSuffix('Inquiries')
  const router = useRouter()
  const [inquiries, setInquiries] = useState<Inquiry[]>([])
  const contactName = (contactId?: number) => contacts.find((c) => c.id === contactId)?.name
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | string[]>('')
  const load = () => crmApi.listInquiries({ org_id: orgId })
    .then((rows) => { setInquiries(rows); setLoadError('') })
    .catch((err) => setLoadError(extractErrorMessages(err, "Could not load this customer organization's inquiries. Reload the page; if it persists, check that you still have CRM access.")))
    .finally(() => setLoading(false))
  useEffect(() => { load() }, [orgId]) // eslint-disable-line react-hooks/exhaustive-deps

  if (loading) return <p style={{ fontSize: 13, color: '#78716c' }}>Loading…</p>
  if (loadError) return <TabLoadError message={loadError} />

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {canModify && (
        <div>
          {/* Opens the New Inquiry page for this organization (not an inline form above its old inquiries). */}
          <button onClick={() => router.push(`/dashboard/crm/inquiries/new${backSuffix}&type=inquiry&org=${encodeURIComponent(orgRef)}`)} data-tour="orgdetail-add-inquiry-btn" style={primaryBtnStyle}>+ Add Inquiry</button>
        </div>
      )}

      {inquiries.length === 0 ? (
        <p style={{ fontSize: 13, color: '#a8a29e' }}>No inquiries for this customer organization yet{canModify ? ' — use + Add Inquiry.' : '.'}</p>
      ) : (
        <div data-tour="orgdetail-inquiries-table" style={{ borderRadius: 14, background: '#fff', border: '1px solid rgba(0,0,0,0.06)', overflow: 'hidden' }}>
        <div style={{ overflow: 'auto', maxHeight: 'calc(100vh - 320px)' }}>
          <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: '#fffaf5' }}>
                {['ID', 'Product', 'Contact Person', 'Status', 'Priority', 'Follow-up'].map((h, hi) => (
                  <th key={h} style={{ textAlign: 'left', padding: '10px 16px', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', color: '#a8a29e', whiteSpace: 'nowrap', position: 'sticky', top: 0, background: '#fffaf5', zIndex: 1 }}>{h}{hi === 0 && <RowCount count={inquiries.length} />}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {inquiries.map((i) => (
                <tr key={i.id} onClick={() => router.push(`/dashboard/crm/inquiries/${refOf(i)}${backSuffix}`)} style={{ borderBottom: '1px solid rgba(0,0,0,0.04)', cursor: 'pointer' }}>
                  <td style={{ padding: '10px 16px', fontFamily: 'monospace', fontSize: 12, color: '#FF7A45', fontWeight: 600 }}>{i.universal_id || '—'}</td>
                  <td style={{ padding: '10px 16px', color: '#1f1108', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{i.product || '—'}</td>
                  <td style={{ padding: '10px 16px', color: '#57534e', whiteSpace: 'nowrap' }}>{contactName(i.org_contact_id) || '—'}</td>
                  <td style={{ padding: '10px 16px' }}><StatusPill value={i.status} hex={inquiryStatusColor(i.status).text} /></td>
                  <td style={{ padding: '10px 16px', whiteSpace: 'nowrap', color: '#57534e' }}>{i.priority || '—'}</td>
                  <td style={{ padding: '10px 16px', color: '#57534e', whiteSpace: 'nowrap' }}>{i.next_followup_date ? formatDate(i.next_followup_date) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        </div>
      )}
    </div>
  )
}

function TendersTab({ orgId, orgRef, canModify }: { orgId: number; orgRef: string; canModify: boolean }) {
  const backSuffix = useBackSuffix('Tenders')
  const router = useRouter()
  const [tenders, setTenders] = useState<Tender[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | string[]>('')
  const load = () => crmApi.listTenders({ org_id: orgId })
    .then((rows) => { setTenders(rows); setLoadError('') })
    .catch((err) => setLoadError(extractErrorMessages(err, "Could not load this customer organization's tenders. Reload the page; if it persists, check that you still have CRM access.")))
    .finally(() => setLoading(false))
  useEffect(() => { load() }, [orgId]) // eslint-disable-line react-hooks/exhaustive-deps

  if (loading) return <p style={{ fontSize: 13, color: '#78716c' }}>Loading…</p>
  if (loadError) return <TabLoadError message={loadError} />

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {canModify && (
        <div>
          {/* Opens the New Tender page for this organization (not an inline form above its old tenders). */}
          <button onClick={() => router.push(`/dashboard/crm/inquiries/new${backSuffix}&type=tender&org=${encodeURIComponent(orgRef)}`)} data-tour="orgdetail-add-tender-btn" style={primaryBtnStyle}>+ Add Tender</button>
        </div>
      )}

      {tenders.length === 0 ? (
        <p style={{ fontSize: 13, color: '#a8a29e' }}>No tenders for this customer organization yet{canModify ? ' — use + Add Tender.' : '.'}</p>
      ) : (
        <div data-tour="orgdetail-tenders-table" style={{ borderRadius: 14, background: '#fff', border: '1px solid rgba(0,0,0,0.06)', overflow: 'hidden' }}>
        <div style={{ overflow: 'auto', maxHeight: 'calc(100vh - 320px)' }}>
          <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: '#fffaf5' }}>
                {['ID', 'Tender No.', 'Name', 'Status', 'Submission'].map((h, hi) => (
                  <th key={h} style={{ textAlign: 'left', padding: '10px 16px', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', color: '#a8a29e', whiteSpace: 'nowrap', position: 'sticky', top: 0, background: '#fffaf5', zIndex: 1 }}>{h}{hi === 0 && <RowCount count={tenders.length} />}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {tenders.map((t) => (
                <tr
                  key={t.id}
                  onClick={() => router.push(`/dashboard/crm/tenders/${refOf(t)}${backSuffix}`)}
                  onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(255,122,69,0.05)')}
                  onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                  style={{ borderBottom: '1px solid rgba(0,0,0,0.04)', cursor: 'pointer' }}
                >
                  <td style={{ padding: '10px 16px', fontFamily: 'monospace', fontSize: 12, color: '#FF7A45', fontWeight: 600 }}>{t.universal_id || '—'}</td>
                  <td style={{ padding: '10px 16px', color: '#57534e' }}>{t.tender_number || '—'}</td>
                  <td style={{ padding: '10px 16px', color: '#1f1108', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.tender_name || '—'}</td>
                  <td style={{ padding: '10px 16px' }}><StatusPill value={t.status} hex={tenderStatusColor(t.status).text} /></td>
                  <td style={{ padding: '10px 16px', color: '#57534e', whiteSpace: 'nowrap' }}>{t.submission_date ? formatDate(t.submission_date) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        </div>
      )}
    </div>
  )
}

function AuditTab({ orgId }: { orgId: number }) {
  const [entries, setEntries] = useState<{ id: number; action: string; summary: string | null; performed_by: string; performed_at: string | null }[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | string[]>('')
  useEffect(() => {
    crmApi.getOrganizationAudit(orgId)
      .then(setEntries)
      .catch((err) => setLoadError(extractErrorMessages(err, "Could not load this customer organization's audit history. Reload the page; if it persists, check that you still have CRM access.")))
      .finally(() => setLoading(false))
  }, [orgId])

  if (loading) return <p style={{ fontSize: 13, color: '#78716c' }}>Loading…</p>
  if (loadError) return <TabLoadError message={loadError} />
  if (entries.length === 0) return <p style={{ fontSize: 13, color: '#a8a29e' }}>No audit history yet.</p>

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {entries.map((e, idx) => (
        <div key={e.id} data-tour={idx === 0 ? 'orgdetail-audit-list' : undefined} style={{ padding: '12px 16px', borderRadius: 12, background: 'rgba(255,255,255,.16)', backdropFilter: 'blur(28px)', WebkitBackdropFilter: 'blur(28px)', border: '1px solid rgba(255,255,255,.24)', boxShadow: '0 12px 32px rgba(15,23,42,0.16), 0 2px 6px rgba(15,23,42,.08), inset 0 1px 0 rgba(255,255,255,.35)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
            <span style={{ fontSize: 12.5, fontWeight: 600, color: '#1f1108' }}>{e.performed_by}</span>
            <span style={{ fontSize: 11.5, color: '#a8a29e' }}>{e.performed_at ? formatDateTime(e.performed_at) : ''}</span>
          </div>
          <p style={{ fontSize: 13, color: '#57534e', margin: 0 }}>{e.summary || e.action}</p>
        </div>
      ))}
    </div>
  )
}
