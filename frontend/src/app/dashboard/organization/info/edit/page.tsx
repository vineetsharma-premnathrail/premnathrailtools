'use client'

import Select from '@/components/shared/Select'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useRequireOrgTab } from '@/app/dashboard/organization/_lib/useRequireOrgTab'
import { organizationApi, storeApi } from '@/lib/api'
import { Company, Branch, StoreLocation, CompanyAddress, CompanyContact, CompanyFinancialYear, CompanyDocument } from '@/types'
import OrganizationNav from '@/components/organization/OrganizationNav'
import ConfirmDialog from '@/components/erp/ConfirmDialog'
import DateField from '@/components/erp/DateField'
import FileUploadField from '@/components/shared/FileUploadField'
import { FormPage, SheetSection, SheetIcon, Req, Optional, SHEET, sheetBtn, sheetInput, sheetLabel, sheetHint, SheetError } from '@/components/shared/FormSheet'
import { extractErrorMessages } from '@/lib/validation'
import { useCan } from '@/lib/permissions'
import { formatDate } from '@/lib/format'

const { INK, BODY, MUTED, LINE, SOFT, BLUE } = SHEET

const rowStyle: React.CSSProperties = { display: 'flex', flexWrap: 'wrap', gap: 14, marginBottom: 14 }
const checkStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: BODY }
/** The add/edit block above each list (address, contact, FY, document). */
const subFormStyle: React.CSSProperties = { padding: 16, borderRadius: 12, background: SOFT, border: `1px solid ${LINE}`, marginBottom: 18 }
const listRowStyle: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 6, padding: '12px 14px', borderRadius: 12, background: '#fff', border: `1px solid ${LINE}` }
const linkBtnStyle: React.CSSProperties = { fontSize: 12, fontWeight: 600, color: BLUE, cursor: 'pointer', background: 'none', border: 'none', padding: 0 }
const dangerLinkStyle: React.CSSProperties = { ...linkBtnStyle, color: '#b91c1c' }
const pill = (bg: string, color: string): React.CSSProperties => ({ fontSize: 10.5, fontWeight: 700, padding: '2px 8px', borderRadius: 9999, background: bg, color })

/** One field: label + control, sized by its flex basis (short fields stay short). */
function F({ label, req, opt, basis = 240, max, children }: { label: string; req?: boolean; opt?: boolean; basis?: number; max?: number; children: React.ReactNode }) {
  return (
    <div style={{ flex: `1 1 ${basis}px`, minWidth: Math.min(basis, 160), maxWidth: max }}>
      <label style={sheetLabel}>{label} {req && <Req />}{opt && <Optional />}</label>
      {children}
    </div>
  )
}

/** Flat underline tab — every border side set explicitly so the app-wide <button> style doesn't show through. */
function tabStyle(active: boolean): React.CSSProperties {
  return {
    padding: '10px 4px', marginRight: 18, marginBottom: -1, borderTop: 'none', borderLeft: 'none', borderRight: 'none', borderRadius: 0, boxShadow: 'none', outline: 'none',
    background: 'transparent', borderBottom: active ? `2px solid ${BLUE}` : '2px solid transparent',
    color: active ? BLUE : MUTED, fontWeight: 600, fontSize: 13, cursor: 'pointer', whiteSpace: 'nowrap', fontFamily: 'inherit',
  }
}

type FormState = Partial<Company>

const TABS = ['Basic', 'Address', 'Legal & Registration', 'Tax Configuration', 'Contacts', 'Financial Year', 'Branding', 'Documents', 'Defaults & Controls'] as const
const LIST_TABS = new Set(['Address', 'Contacts', 'Financial Year', 'Documents'])

const TAB_TOUR_IDS: Record<typeof TABS[number], string> = {
  'Basic': 'org-edit-tab-basic',
  'Address': 'org-edit-tab-address',
  'Legal & Registration': 'org-edit-tab-legal',
  'Tax Configuration': 'org-edit-tab-tax',
  'Contacts': 'org-edit-tab-contacts',
  'Financial Year': 'org-edit-tab-fy',
  'Branding': 'org-edit-tab-branding',
  'Documents': 'org-edit-tab-documents',
  'Defaults & Controls': 'org-edit-tab-defaults',
}

export default function EditOrganizationInfoPage() {
  const { isAuthorized, isLoading } = useRequireOrgTab('info', 'edit')
  const router = useRouter()
  // Company Info features (core/features/organization.py). Legal / Tax are
  // left out without their Edit: the server keeps those values as they are.
  const { canFeature } = useCan()
  const editStatutory = canFeature('organization', 'info', 'statutory', 'edit')
  const editFy = canFeature('organization', 'info', 'financial_years', 'edit')
  const seeDocs = canFeature('organization', 'info', 'documents', 'view')
  const seeTab = (t: typeof TABS[number]) => (t === 'Legal & Registration' || t === 'Tax Configuration' ? editStatutory
    : t === 'Financial Year' ? editFy : t === 'Documents' ? seeDocs : true)
  const [form, setForm] = useState<FormState>({})
  const [branches, setBranches] = useState<Branch[]>([])
  const [locations, setLocations] = useState<StoreLocation[]>([])
  const [addresses, setAddresses] = useState<CompanyAddress[]>([])
  const [contacts, setContacts] = useState<CompanyContact[]>([])
  const [financialYears, setFinancialYears] = useState<CompanyFinancialYear[]>([])
  const [documents, setDocuments] = useState<CompanyDocument[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [tab, setTab] = useState<typeof TABS[number]>('Basic')
  const [isNew, setIsNew] = useState(false)

  const loadLists = () => {
    Promise.all([
      organizationApi.listCompanyAddresses(),
      organizationApi.listCompanyContacts(),
      editFy ? organizationApi.listCompanyFinancialYears() : Promise.resolve([]),
      seeDocs ? organizationApi.listCompanyDocuments() : Promise.resolve([]),
    ]).then(([a, ct, fy, d]) => {
      setAddresses(a); setContacts(ct); setFinancialYears(fy); setDocuments(d)
    })
  }

  useEffect(() => {
    if (isAuthorized) {
      setLoading(true)
      setError('')
      Promise.all([organizationApi.listBranches(), storeApi.listLocations()])
        .then(([branchList, locationList]) => {
          setBranches(branchList)
          setLocations(locationList)
        })
        .catch((err: unknown) => setError(extractErrorMessages(err, 'Could not load plants/store locations for the address pickers. Reload the page; if it keeps failing, check that you still have access to Organization and Store.').join(' ')))

      // Company info (and everything under it — addresses/contacts/FYs/
      // documents) 404s until the one-time setup row exists. That's not a
      // load failure here — it means this is a first-time setup, so start
      // from a blank form instead of showing an error.
      organizationApi.getCompanyInfo()
        .then((company) => {
          setForm(company)
          loadLists()
        })
        .catch((err: unknown) => {
          const status = (err as { response?: { status?: number } })?.response?.status
          if (status === 404) {
            setIsNew(true)
            setForm({})
          } else {
            setError(extractErrorMessages(err, 'Could not load company info. Reload the page; if it keeps failing, the server may be down — contact IT.').join(' '))
          }
        })
        .finally(() => setLoading(false))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthorized])

  const setField = (field: keyof Company, value: unknown) => setForm((f) => ({ ...f, [field]: value }))

  const handleSave = async () => {
    if (!form.name?.trim()) {
      setError('Company name is required — enter it on the Basic tab.')
      setTab('Basic')
      return
    }
    if (!form.code?.trim()) {
      setError('Company code is required — enter it on the Basic tab (e.g. PNR).')
      setTab('Basic')
      return
    }
    setSaving(true)
    setError('')
    try {
      if (isNew) {
        await organizationApi.createCompanyInfo(form)
      } else {
        await organizationApi.updateCompanyInfo(form)
      }
      router.push('/dashboard/organization/info')
    } catch (err: unknown) {
      setError(extractErrorMessages(err, 'Could not save company info. Check the highlighted fields and try again; if it keeps failing, the server may be down — contact IT.').join(' '))
      setSaving(false)
    }
  }

  // Plain render helpers (called as functions, not components, so inputs keep focus while typing).
  const text = (field: keyof Company, label: string, o: { tour?: string; req?: boolean; ph?: string; basis?: number; max?: number; keepEmpty?: boolean; upper?: boolean } = {}) => (
    <F label={label} req={o.req} basis={o.basis} max={o.max}>
      <input data-tour={o.tour} style={sheetInput} value={(form[field] as string | null | undefined) || ''} placeholder={o.ph}
        onChange={(e) => setField(field, o.upper ? e.target.value.toUpperCase() : o.keepEmpty ? e.target.value : (e.target.value || null))} />
    </F>
  )
  const date = (field: keyof Company, label: string, tour?: string) => (
    <F label={label} basis={170} max={260}>
      <div data-tour={tour}><DateField value={(form[field] as string | null | undefined) || ''} onChange={(v) => setField(field, v || null)} /></div>
    </F>
  )
  const area = (field: keyof Company, label: string, tour: string, minHeight = 70, ph?: string) => (
    <div style={{ marginBottom: 14 }}>
      <label style={sheetLabel}>{label}</label>
      <textarea data-tour={tour} style={{ ...sheetInput, minHeight, resize: 'vertical' }} value={(form[field] as string | null | undefined) || ''} placeholder={ph} onChange={(e) => setField(field, e.target.value || null)} />
    </div>
  )
  const color = (field: keyof Company, label: string, fallback: string, ph: string) => (
    <F label={label} basis={200} max={280}>
      <div style={{ display: 'flex', gap: 8 }}>
        <input type="color" value={(form[field] as string | null | undefined) || fallback} onChange={(e) => setField(field, e.target.value)} style={{ width: 44, height: 40, padding: 2, borderRadius: 8, border: `1px solid ${LINE}`, flexShrink: 0 }} />
        <input style={sheetInput} value={(form[field] as string | null | undefined) || ''} onChange={(e) => setField(field, e.target.value || null)} placeholder={ph} />
      </div>
    </F>
  )

  if (isLoading || !isAuthorized) return null

  const isList = LIST_TABS.has(tab)
  const backToInfo = () => router.push('/dashboard/organization/info')

  return (
    <FormPage
      nav={<OrganizationNav />}
      icon="building"
      title={isNew ? 'Set Up Company Info' : 'Edit Info'}
      subtitle="Organization › Info — master details printed on letterheads, invoices and other generated documents."
      onBack={backToInfo} backTour="org-edit-back"
      footer={isList ? (
        <p style={{ fontSize: 12.5, color: MUTED, margin: 0, alignSelf: 'center' }}>Each {tab === 'Financial Year' ? 'financial year' : tab.toLowerCase().replace(/s$/, '')} saves on its own with its Save button above.</p>
      ) : (
        <>
          <button type="button" data-tour="org-edit-cancel" onClick={backToInfo} disabled={saving} style={sheetBtn('secondary', INK, saving)}>Cancel</button>
          <button type="button" data-tour="org-edit-save" onClick={handleSave} disabled={saving || loading} style={sheetBtn('primary', BLUE, saving || loading)}>
            <SheetIcon name="check" size={16} />{saving ? 'Saving…' : 'Save Changes'}
          </button>
        </>
      )}
    >
      {loading ? (
        <div style={{ textAlign: 'center', padding: '40px 20px', color: MUTED, fontSize: 13 }}>Loading…</div>
      ) : (
        <>
          <div style={{ display: 'flex', flexWrap: 'wrap', padding: '0 24px', borderBottom: `1px solid ${LINE}` }}>
            {TABS.filter(seeTab).map((t) => (
              <button key={t} type="button" data-tour={TAB_TOUR_IDS[t]} onClick={() => setTab(t)} style={tabStyle(tab === t)}>{t}</button>
            ))}
          </div>

          <div style={{ padding: '20px 24px' }}>
            <SheetError error={error} />

            {isNew && (
              <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: '#fff7ed', border: '1px solid #fed7aa', color: '#9a3412', fontSize: 12.5 }}>
                Company info hasn&apos;t been set up yet. Fill in at least Name and Code and Save — Address, Contacts,
                Financial Year, and Documents can only be added after that first save.
              </div>
            )}

            {(tab === 'Basic' || !seeTab(tab)) && (
              <>
                <SheetSection icon="building" title="Basic Information">
                  <div style={rowStyle}>
                    {text('name', 'Company Name', { tour: 'org-edit-name', req: true, keepEmpty: true, basis: 280 })}
                    {text('legal_name', 'Legal Name', { tour: 'org-edit-legal-name', req: true, basis: 280 })}
                  </div>
                  <div style={rowStyle}>
                    {text('short_name', 'Short Name', { tour: 'org-edit-short-name', basis: 160, max: 240 })}
                    {text('code', 'Code', { tour: 'org-edit-code', req: true, upper: true, basis: 140, max: 200 })}
                    {text('company_type', 'Company Type', { tour: 'org-edit-company-type', ph: 'Private Limited', basis: 220 })}
                  </div>
                  <div style={rowStyle}>
                    {text('industry', 'Industry', { tour: 'org-edit-industry', basis: 240 })}
                    {text('business_nature', 'Business Nature', { tour: 'org-edit-business-nature', basis: 240 })}
                    {text('website', 'Website', { tour: 'org-edit-website', basis: 240, max: 340 })}
                  </div>
                  {area('description', 'Description', 'org-edit-description')}
                  <div style={{ ...rowStyle, marginBottom: 0 }}>
                    {date('date_of_incorporation', 'Date of Incorporation', 'org-edit-incorporation-date')}
                  </div>
                </SheetSection>
                <SheetSection icon="gear" title="Locale">
                  <div style={{ ...rowStyle, marginBottom: 0 }}>
                    {text('country', 'Country', { tour: 'org-edit-country', req: true, basis: 200, max: 280 })}
                    {text('currency', 'Default Currency', { tour: 'org-edit-currency', req: true, ph: 'INR', basis: 140, max: 200 })}
                    {text('default_language', 'Default Language', { tour: 'org-edit-language', ph: 'English', basis: 160, max: 240 })}
                    {text('timezone', 'Time Zone', { tour: 'org-edit-timezone', req: true, ph: 'Asia/Kolkata', basis: 180, max: 260 })}
                  </div>
                </SheetSection>
              </>
            )}

            {tab === 'Address' && (isNew
              ? <p style={{ fontSize: 12.5, color: MUTED }}>Save the Basic tab first to add addresses.</p>
              : <AddressesEditor addresses={addresses} onRefresh={loadLists} />)}

            {tab === 'Legal & Registration' && editStatutory && (
              <>
                <SheetSection icon="shield" title="Legal & Registration">
                  <div style={rowStyle}>
                    {text('legal_entity_type', 'Legal Entity Type', { tour: 'org-edit-legal-entity-type', ph: 'Private Limited Company', basis: 260 })}
                    {text('legal_status', 'Legal Status', { tour: 'org-edit-legal-status', ph: 'Active', basis: 160, max: 240 })}
                  </div>
                  <div style={rowStyle}>
                    {text('cin', 'CIN', { tour: 'org-edit-cin', basis: 220, max: 300 })}
                    {text('pan', 'PAN', { tour: 'org-edit-pan', basis: 150, max: 200 })}
                    {text('tan', 'TAN', { tour: 'org-edit-tan', basis: 150, max: 200 })}
                    {text('gstin', 'GSTIN', { tour: 'org-edit-gstin', basis: 190, max: 240 })}
                  </div>
                  <div style={rowStyle}>
                    {text('udyam_registration_no', 'Udyam Registration No.', { tour: 'org-edit-udyam', basis: 220, max: 300 })}
                    {text('iec', 'IEC', { tour: 'org-edit-iec', basis: 160, max: 220 })}
                    {text('msme_registration_no', 'MSME Registration No.', { tour: 'org-edit-msme', basis: 220, max: 300 })}
                  </div>
                  <div style={{ ...rowStyle, marginBottom: 0 }}>
                    {text('pf_registration_no', 'PF Registration No.', { tour: 'org-edit-pf', basis: 220, max: 300 })}
                    {text('esic_registration_no', 'ESIC Registration No.', { tour: 'org-edit-esic', basis: 220, max: 300 })}
                  </div>
                </SheetSection>

                <div data-tour="org-edit-other-registration">
                  <SheetSection icon="doc" title="Other Registration" extra={<Optional />}>
                    <div style={rowStyle}>
                      {text('other_registration_type', 'Other Registration Type', { basis: 240 })}
                      {text('other_registration_number', 'Registration Number', { basis: 220, max: 300 })}
                      {text('issuing_authority', 'Issuing Authority', { basis: 220 })}
                    </div>
                    <div style={{ ...rowStyle, marginBottom: 0 }}>
                      {date('other_registration_date', 'Registration Date')}
                      {date('expiry_date', 'Expiry Date')}
                    </div>
                  </SheetSection>
                </div>

                <SheetSection icon="rupee" title="Representative & Capital">
                  <div style={{ ...rowStyle, marginBottom: 0 }}>
                    {text('legal_representative', 'Legal Representative', { tour: 'org-edit-legal-representative', basis: 260, max: 340 })}
                    <F label="Authorized Capital" basis={180} max={240}>
                      <input data-tour="org-edit-authorized-capital" type="number" style={sheetInput} value={form.authorized_capital ?? ''} onChange={(e) => setField('authorized_capital', e.target.value ? Number(e.target.value) : null)} />
                    </F>
                    <F label="Paid-up Capital" basis={180} max={240}>
                      <input type="number" data-tour="org-edit-paid-up-capital" style={sheetInput} value={form.paid_up_capital ?? ''} onChange={(e) => setField('paid_up_capital', e.target.value ? Number(e.target.value) : null)} />
                    </F>
                  </div>
                  <p data-tour="org-edit-legal-docs-note" style={sheetHint}>Legal documents (licenses, certificates, agreements) are managed from the Company Documents tab on the Info page.</p>
                </SheetSection>
              </>
            )}

            {tab === 'Tax Configuration' && editStatutory && (
              <SheetSection icon="rupee" title="Tax Configuration">
                <div style={rowStyle}>
                  {text('gst_registration_type', 'GST Registration Type', { tour: 'org-edit-gst-type', ph: 'Regular', basis: 200, max: 280 })}
                  {text('default_tax_region', 'Default Tax Region', { tour: 'org-edit-tax-region', basis: 200, max: 280 })}
                  {text('tax_deductibility', 'Tax Deductibility', { tour: 'org-edit-tax-deductibility', basis: 200, max: 280 })}
                </div>
                <div style={rowStyle}>
                  {text('tax_registration_status', 'Tax Registration Status', { tour: 'org-edit-tax-reg-status', ph: 'Active', basis: 200, max: 280 })}
                  {date('tax_effective_date', 'Tax Effective Date', 'org-edit-tax-effective-date')}
                </div>
                <div style={{ display: 'flex', gap: 24 }} data-tour="org-edit-tax-applicability">
                  <label style={checkStyle}>
                    <input type="checkbox" checked={!!form.tds_applicable} onChange={(e) => setField('tds_applicable', e.target.checked)} />
                    TDS Applicable
                  </label>
                  <label style={checkStyle}>
                    <input type="checkbox" checked={!!form.tcs_applicable} onChange={(e) => setField('tcs_applicable', e.target.checked)} />
                    TCS Applicable
                  </label>
                </div>
                <p style={sheetHint}>Tax documents (registration certificates, filings) are managed from the Company Documents tab on the Info page.</p>
              </SheetSection>
            )}

            {tab === 'Contacts' && (isNew
              ? <p style={{ fontSize: 12.5, color: MUTED }}>Save the Basic tab first to add contacts.</p>
              : <ContactsEditor contacts={contacts} onRefresh={loadLists} />)}

            {tab === 'Financial Year' && editFy && (isNew
              ? <p style={{ fontSize: 12.5, color: MUTED }}>Save the Basic tab first to add financial years.</p>
              : <FinancialYearsEditor financialYears={financialYears} onRefresh={loadLists} />)}

            {tab === 'Branding' && (
              <>
                <SheetSection icon="star" title="Logo & Colors">
                  <div style={rowStyle}>
                    {text('logo_url', 'Company Logo URL', { tour: 'org-edit-logo-url', basis: 360 })}
                  </div>
                  <div style={{ ...rowStyle, marginBottom: 0 }} data-tour="org-edit-brand-colors">
                    {color('primary_brand_color', 'Primary Brand Color', '#ff7a45', '#FF7A45')}
                    {color('secondary_brand_color', 'Secondary Brand Color', '#1f1108', '#1F1108')}
                    {color('accent_color', 'Accent Color', '#3b82f6', '#3B82F6')}
                  </div>
                </SheetSection>
                <SheetSection icon="doc" title="Documents & Email">
                  {area('company_header', 'Company Header', 'org-edit-header', 60, 'Text shown at the top of generated documents')}
                  {area('company_footer', 'Company Footer', 'org-edit-footer', 60, 'Text shown at the bottom of generated documents')}
                  <div style={rowStyle}>
                    {text('watermark', 'Watermark', { tour: 'org-edit-watermark', ph: 'e.g. DRAFT, or a watermark image URL', basis: 320 })}
                  </div>
                  {area('email_signature', 'Email Signature', 'org-edit-email-signature', 80)}
                </SheetSection>
              </>
            )}

            {tab === 'Documents' && seeDocs && (isNew
              ? <p style={{ fontSize: 12.5, color: MUTED }}>Save the Basic tab first to add documents.</p>
              : <DocumentsEditor documents={documents} onRefresh={loadLists} />)}

            {tab === 'Defaults & Controls' && (
              <SheetSection icon="gear" title="Company Defaults & Controls">
                <div style={rowStyle}>
                  {text('default_tax', 'Default Tax', { tour: 'org-edit-default-tax', ph: 'GST 18%', basis: 180, max: 260 })}
                  <F label="Default Plant" basis={240} max={340}>
                    <Select data-tour="org-edit-default-plant" style={sheetInput} value={form.default_plant_id || ''} onChange={(e) => setField('default_plant_id', e.target.value ? Number(e.target.value) : null)}>
                      <option value="">— Select —</option>
                      {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                    </Select>
                  </F>
                  <F label="Default Store" basis={240} max={340}>
                    <Select data-tour="org-edit-default-warehouse" style={sheetInput} value={form.default_warehouse_id || ''} onChange={(e) => setField('default_warehouse_id', e.target.value ? Number(e.target.value) : null)}>
                      <option value="">— Select —</option>
                      {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                    </Select>
                  </F>
                </div>
                <div style={{ ...rowStyle, marginBottom: 0 }}>
                  {text('default_cost_center', 'Default Cost Center', { tour: 'org-edit-default-cost-center', basis: 220, max: 320 })}
                  {text('default_profit_center', 'Default Profit Center', { tour: 'org-edit-default-profit-center', basis: 220, max: 320 })}
                </div>
              </SheetSection>
            )}
          </div>
        </>
      )}
    </FormPage>
  )
}

/** Header row of a list tab's add/edit block: title + "Cancel edit" while editing. */
function SubFormHead({ title, editing, onCancel }: { title: string; editing: boolean; onCancel: () => void }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
      <h4 style={{ fontSize: 13.5, fontWeight: 700, color: INK, margin: 0 }}>{title}</h4>
      {editing && <button type="button" style={linkBtnStyle} onClick={onCancel}>Cancel edit</button>}
    </div>
  )
}

function SaveBtn({ tour, saving, label, busyLabel = 'Saving…' }: { tour: string; saving: boolean; label: string; busyLabel?: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
      <button type="submit" data-tour={tour} disabled={saving} style={sheetBtn('primary', BLUE, saving)}><SheetIcon name="check" size={16} />{saving ? busyLabel : label}</button>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Address
// ---------------------------------------------------------------------------

function emptyAddress() {
  return { address_type: '', address_line1: '', address_line2: '', landmark: '', country: '', state: '', city: '', district: '', pincode: '', is_primary: false, is_active: true }
}

function AddressesEditor({ addresses, onRefresh }: { addresses: CompanyAddress[]; onRefresh: () => void }) {
  const [editingId, setEditingId] = useState<number | null>(null)
  const [form, setForm] = useState(emptyAddress())
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<CompanyAddress | null>(null)

  const startEdit = (a: CompanyAddress) => {
    setEditingId(a.id)
    setError('')
    setForm({
      address_type: a.address_type || '', address_line1: a.address_line1, address_line2: a.address_line2 || '',
      landmark: a.landmark || '', country: a.country || '', state: a.state || '', city: a.city || '',
      district: a.district || '', pincode: a.pincode || '', is_primary: a.is_primary, is_active: a.is_active,
    })
  }
  const cancel = () => { setEditingId(null); setForm(emptyAddress()) }
  const set = (k: keyof ReturnType<typeof emptyAddress>, v: string | boolean) => setForm((f) => ({ ...f, [k]: v }))

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.address_line1.trim()) { setError('Address Line 1 is required — enter the building / street.'); return }
    setSaving(true)
    setError('')
    try {
      if (editingId) await organizationApi.updateCompanyAddress(editingId, form)
      else await organizationApi.createCompanyAddress(form)
      cancel()
      onRefresh()
    } catch (err: unknown) {
      setError(extractErrorMessages(err, 'Could not save the address. Check the fields and try again.').join(' '))
    } finally {
      setSaving(false)
    }
  }

  const doDelete = async () => {
    if (!deleteTarget) return
    try {
      await organizationApi.deleteCompanyAddress(deleteTarget.id)
      setDeleteTarget(null)
      onRefresh()
    } catch (err) {
      setError(extractErrorMessages(err, 'Failed to delete address.').join(' '))
      setDeleteTarget(null)
    }
  }

  return (
    <SheetSection icon="building" title="Addresses">
      <ConfirmDialog
        open={!!deleteTarget}
        title="Delete this address?"
        message={`Delete the "${deleteTarget?.address_type || 'address'}" record? This cannot be undone.`}
        onConfirm={doDelete}
        onCancel={() => setDeleteTarget(null)}
      />

      <form onSubmit={submit} style={subFormStyle}>
        <SubFormHead title={editingId ? 'Edit Address' : 'Add Address'} editing={!!editingId} onCancel={cancel} />
        <SheetError error={error} />
        <div style={rowStyle}>
          <F label="Address Type" basis={220} max={320}><input data-tour="org-addr-type" style={sheetInput} value={form.address_type} onChange={(e) => set('address_type', e.target.value)} placeholder="Registered Office" /></F>
          <F label="Landmark" basis={220}><input style={sheetInput} value={form.landmark} onChange={(e) => set('landmark', e.target.value)} /></F>
        </div>
        <div style={rowStyle}>
          <F label="Address Line 1" req basis={400}><input data-tour="org-addr-line1" style={sheetInput} value={form.address_line1} onChange={(e) => set('address_line1', e.target.value)} /></F>
        </div>
        <div style={rowStyle}>
          <F label="Address Line 2" basis={400}><input style={sheetInput} value={form.address_line2} onChange={(e) => set('address_line2', e.target.value)} /></F>
        </div>
        <div style={rowStyle}>
          <F label="Country" basis={160} max={220}><input style={sheetInput} value={form.country} onChange={(e) => set('country', e.target.value)} /></F>
          <F label="State / UT" basis={160} max={220}><input style={sheetInput} value={form.state} onChange={(e) => set('state', e.target.value)} /></F>
          <F label="City" basis={160} max={220}><input style={sheetInput} value={form.city} onChange={(e) => set('city', e.target.value)} /></F>
          <F label="District" basis={160} max={220}><input style={sheetInput} value={form.district} onChange={(e) => set('district', e.target.value)} /></F>
          <F label="PIN Code" basis={110} max={140}><input data-tour="org-addr-pincode" style={sheetInput} value={form.pincode} onChange={(e) => set('pincode', e.target.value)} /></F>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', gap: 16 }} data-tour="org-addr-flags">
            <label style={checkStyle}><input type="checkbox" checked={form.is_primary} onChange={(e) => set('is_primary', e.target.checked)} /> Primary</label>
            <label style={checkStyle}><input type="checkbox" checked={form.is_active} onChange={(e) => set('is_active', e.target.checked)} /> Active</label>
          </div>
          <SaveBtn tour="org-addr-save" saving={saving} label={editingId ? 'Save Changes' : 'Save Address'} />
        </div>
      </form>

      {addresses.length === 0 ? (
        <p style={{ fontSize: 13, color: MUTED }}>No addresses added yet.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }} data-tour="org-addr-list">
          {addresses.map((a) => (
            <div key={a.id} style={listRowStyle}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 13.5, fontWeight: 600, color: INK }}>{a.address_type || 'Address'}</span>
                    {a.is_primary && <span style={pill('rgba(16,185,129,0.12)', '#047857')}>PRIMARY</span>}
                    {!a.is_active && <span style={pill('rgba(220,38,38,0.1)', '#b91c1c')}>INACTIVE</span>}
                  </div>
                  <p style={{ fontSize: 12.5, color: MUTED, margin: 0 }}>
                    {[a.address_line1, a.address_line2, a.landmark, a.city, a.district, a.state, a.country, a.pincode].filter(Boolean).join(', ')}
                  </p>
                </div>
                <div style={{ display: 'flex', gap: 10, flexShrink: 0 }}>
                  <button type="button" style={linkBtnStyle} onClick={() => startEdit(a)}>Edit</button>
                  <button type="button" style={dangerLinkStyle} onClick={() => setDeleteTarget(a)}>Delete</button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </SheetSection>
  )
}

// ---------------------------------------------------------------------------
// Contacts
// ---------------------------------------------------------------------------

function emptyContact() {
  return { contact_type: '', contact_person: '', designation: '', department: '', mobile: '', phone: '', email: '', alternate_email: '', communication_preference: '', is_primary: false, is_active: true }
}

function ContactsEditor({ contacts, onRefresh }: { contacts: CompanyContact[]; onRefresh: () => void }) {
  const [editingId, setEditingId] = useState<number | null>(null)
  const [form, setForm] = useState(emptyContact())
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<CompanyContact | null>(null)

  const startEdit = (c: CompanyContact) => {
    setEditingId(c.id)
    setError('')
    setForm({
      contact_type: c.contact_type || '', contact_person: c.contact_person, designation: c.designation || '',
      department: c.department || '', mobile: c.mobile || '', phone: c.phone || '', email: c.email || '',
      alternate_email: c.alternate_email || '', communication_preference: c.communication_preference || '',
      is_primary: c.is_primary, is_active: c.is_active,
    })
  }
  const cancel = () => { setEditingId(null); setForm(emptyContact()) }
  const set = (k: keyof ReturnType<typeof emptyContact>, v: string | boolean) => setForm((f) => ({ ...f, [k]: v }))

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.contact_person.trim()) { setError('Contact Person is required — enter the person\'s name.'); return }
    setSaving(true)
    setError('')
    try {
      if (editingId) await organizationApi.updateCompanyContact(editingId, form)
      else await organizationApi.createCompanyContact(form)
      cancel()
      onRefresh()
    } catch (err: unknown) {
      setError(extractErrorMessages(err, 'Could not save the contact. Check the fields (e.g. a valid email) and try again.').join(' '))
    } finally {
      setSaving(false)
    }
  }

  const doDelete = async () => {
    if (!deleteTarget) return
    try {
      await organizationApi.deleteCompanyContact(deleteTarget.id)
      setDeleteTarget(null)
      onRefresh()
    } catch (err) {
      setError(extractErrorMessages(err, 'Failed to delete contact.').join(' '))
      setDeleteTarget(null)
    }
  }

  return (
    <SheetSection icon="users" title="Contacts">
      <ConfirmDialog
        open={!!deleteTarget}
        title="Delete this contact?"
        message={`Delete "${deleteTarget?.contact_person}"? This cannot be undone.`}
        onConfirm={doDelete}
        onCancel={() => setDeleteTarget(null)}
      />

      <form onSubmit={submit} style={subFormStyle}>
        <SubFormHead title={editingId ? 'Edit Contact' : 'Add Contact'} editing={!!editingId} onCancel={cancel} />
        <SheetError error={error} />
        <div style={rowStyle}>
          <F label="Contact Person" req basis={240} max={340}><input data-tour="org-contact-person" style={sheetInput} value={form.contact_person} onChange={(e) => set('contact_person', e.target.value)} /></F>
          <F label="Contact Type" basis={160} max={220}><input style={sheetInput} value={form.contact_type} onChange={(e) => set('contact_type', e.target.value)} placeholder="Primary" /></F>
          <F label="Designation" basis={180} max={260}><input style={sheetInput} value={form.designation} onChange={(e) => set('designation', e.target.value)} /></F>
          <F label="Department" basis={180} max={260}><input style={sheetInput} value={form.department} onChange={(e) => set('department', e.target.value)} /></F>
        </div>
        <div style={rowStyle}>
          <F label="Mobile" basis={170} max={220}><input data-tour="org-contact-mobile" style={sheetInput} value={form.mobile} onChange={(e) => set('mobile', e.target.value)} /></F>
          <F label="Phone" basis={170} max={220}><input style={sheetInput} value={form.phone} onChange={(e) => set('phone', e.target.value)} /></F>
          <F label="Email" basis={240} max={320}><input data-tour="org-contact-email" style={sheetInput} value={form.email} onChange={(e) => set('email', e.target.value)} /></F>
          <F label="Alternate Email" basis={240} max={320}><input style={sheetInput} value={form.alternate_email} onChange={(e) => set('alternate_email', e.target.value)} /></F>
        </div>
        <div style={rowStyle}>
          <F label="Communication Preference" basis={220} max={280}><input style={sheetInput} value={form.communication_preference} onChange={(e) => set('communication_preference', e.target.value)} placeholder="Email" /></F>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', gap: 16 }}>
            <label style={checkStyle}><input type="checkbox" checked={form.is_primary} onChange={(e) => set('is_primary', e.target.checked)} /> Primary</label>
            <label style={checkStyle}><input type="checkbox" checked={form.is_active} onChange={(e) => set('is_active', e.target.checked)} /> Active</label>
          </div>
          <SaveBtn tour="org-contact-save" saving={saving} label={editingId ? 'Save Changes' : 'Save Contact'} />
        </div>
      </form>

      {contacts.length === 0 ? (
        <p style={{ fontSize: 13, color: MUTED }}>No contacts added yet.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }} data-tour="org-contact-list">
          {contacts.map((c) => (
            <div key={c.id} style={listRowStyle}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 13.5, fontWeight: 600, color: INK }}>{c.contact_person}</span>
                    {c.designation && <span style={pill('#eff6ff', BLUE)}>{c.designation}</span>}
                    {c.is_primary && <span style={pill('rgba(16,185,129,0.12)', '#047857')}>PRIMARY</span>}
                    {!c.is_active && <span style={pill('rgba(220,38,38,0.1)', '#b91c1c')}>INACTIVE</span>}
                  </div>
                  <p style={{ fontSize: 12.5, color: MUTED, margin: 0 }}>
                    {[c.department, c.mobile, c.email].filter(Boolean).join(' · ') || '—'}
                  </p>
                </div>
                <div style={{ display: 'flex', gap: 10, flexShrink: 0 }}>
                  <button type="button" style={linkBtnStyle} onClick={() => startEdit(c)}>Edit</button>
                  <button type="button" style={dangerLinkStyle} onClick={() => setDeleteTarget(c)}>Delete</button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </SheetSection>
  )
}

// ---------------------------------------------------------------------------
// Financial Year
// ---------------------------------------------------------------------------

function emptyFinancialYear() {
  return { name: '', start_date: '', end_date: '', fiscal_year_code: '', status: 'open', lock_date: '', period_closing_rule: '', number_series_reset: false }
}

function FinancialYearsEditor({ financialYears, onRefresh }: { financialYears: CompanyFinancialYear[]; onRefresh: () => void }) {
  const [editingId, setEditingId] = useState<number | null>(null)
  const [form, setForm] = useState(emptyFinancialYear())
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<CompanyFinancialYear | null>(null)

  const startEdit = (fy: CompanyFinancialYear) => {
    setEditingId(fy.id)
    setError('')
    setForm({
      name: fy.name, start_date: fy.start_date, end_date: fy.end_date, fiscal_year_code: fy.fiscal_year_code || '',
      // Legacy statuses (e.g. 'locked') map to Open — the select only offers Open/Closed.
      status: fy.status === 'closed' ? 'closed' : 'open', lock_date: fy.lock_date || '', period_closing_rule: fy.period_closing_rule || '',
      number_series_reset: fy.number_series_reset,
    })
  }
  const cancel = () => { setEditingId(null); setForm(emptyFinancialYear()) }
  const set = (k: keyof ReturnType<typeof emptyFinancialYear>, v: string | boolean) => setForm((f) => ({ ...f, [k]: v }))

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.name.trim() || !form.start_date || !form.end_date) { setError('Name, Start Date, and End Date are required — e.g. FY 2025-26, 01-04-2025 to 31-03-2026.'); return }
    setSaving(true)
    setError('')
    try {
      const payload = { ...form, lock_date: form.lock_date || null, fiscal_year_code: form.fiscal_year_code || null, period_closing_rule: form.period_closing_rule || null }
      if (editingId) await organizationApi.updateCompanyFinancialYear(editingId, payload)
      else await organizationApi.createCompanyFinancialYear(payload)
      cancel()
      onRefresh()
    } catch (err: unknown) {
      setError(extractErrorMessages(err, 'Could not save the financial year. Check the dates (start before end, no overlap with another year) and try again.').join(' '))
    } finally {
      setSaving(false)
    }
  }

  const doDelete = async () => {
    if (!deleteTarget) return
    try {
      await organizationApi.deleteCompanyFinancialYear(deleteTarget.id)
      setDeleteTarget(null)
      onRefresh()
    } catch (err) {
      setError(extractErrorMessages(err, 'Failed to delete financial year.').join(' '))
      setDeleteTarget(null)
    }
  }

  return (
    <SheetSection icon="calendar" title="Financial Years">
      <ConfirmDialog
        open={!!deleteTarget}
        title="Delete this financial year?"
        message={`Delete "${deleteTarget?.name}"? This cannot be undone.`}
        onConfirm={doDelete}
        onCancel={() => setDeleteTarget(null)}
      />

      <form onSubmit={submit} style={subFormStyle}>
        <SubFormHead title={editingId ? 'Edit Financial Year' : 'Add Financial Year'} editing={!!editingId} onCancel={cancel} />
        <SheetError error={error} />
        <div style={rowStyle}>
          <F label="Financial Year Name" req basis={200} max={280}><input data-tour="org-fy-name" style={sheetInput} value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="FY 2025-26" /></F>
          <F label="Start Date" req basis={170} max={220}><div data-tour="org-fy-start"><DateField value={form.start_date} onChange={(v) => set('start_date', v)} /></div></F>
          <F label="End Date" req basis={170} max={220}><div data-tour="org-fy-end"><DateField value={form.end_date} onChange={(v) => set('end_date', v)} /></div></F>
          <F label="Fiscal Year Code" basis={150} max={200}><input style={sheetInput} value={form.fiscal_year_code} onChange={(e) => set('fiscal_year_code', e.target.value)} /></F>
        </div>
        <div style={rowStyle}>
          <F label="Status" basis={140} max={180}>
            <Select data-tour="org-fy-status" style={sheetInput} value={form.status} onChange={(e) => set('status', e.target.value)}>
              <option value="open">Open</option>
              <option value="closed">Closed</option>
            </Select>
          </F>
          <F label="Lock Date" basis={170} max={220}><DateField value={form.lock_date} onChange={(v) => set('lock_date', v)} /></F>
          <F label="Period Closing Rule" basis={260}><input style={sheetInput} value={form.period_closing_rule} onChange={(e) => set('period_closing_rule', e.target.value)} /></F>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
          <label style={checkStyle}><input type="checkbox" checked={form.number_series_reset} onChange={(e) => set('number_series_reset', e.target.checked)} /> Reset number series</label>
          <SaveBtn tour="org-fy-save" saving={saving} label={editingId ? 'Save Changes' : 'Save Financial Year'} />
        </div>
      </form>

      {financialYears.length === 0 ? (
        <p style={{ fontSize: 13, color: MUTED }}>No financial years added yet.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }} data-tour="org-fy-list">
          {financialYears.map((fy) => (
            <div key={fy.id} style={listRowStyle}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 13.5, fontWeight: 600, color: INK }}>{fy.name}</span>
                    <span style={{ ...pill(fy.status === 'open' ? 'rgba(16,185,129,0.12)' : 'rgba(220,38,38,0.1)', fy.status === 'open' ? '#047857' : '#b91c1c'), textTransform: 'uppercase' }}>{fy.status}</span>
                  </div>
                  <p style={{ fontSize: 12.5, color: MUTED, margin: 0 }}>{formatDate(fy.start_date)} → {formatDate(fy.end_date)}{fy.fiscal_year_code ? ` · ${fy.fiscal_year_code}` : ''}</p>
                </div>
                <div style={{ display: 'flex', gap: 10, flexShrink: 0 }}>
                  <button type="button" style={linkBtnStyle} onClick={() => startEdit(fy)}>Edit</button>
                  <button type="button" style={dangerLinkStyle} onClick={() => setDeleteTarget(fy)}>Delete</button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </SheetSection>
  )
}

// ---------------------------------------------------------------------------
// Documents
// ---------------------------------------------------------------------------

const DOCUMENT_TYPES = ['License', 'Certificate', 'Registration', 'Agreement', 'Legal', 'Tax', 'Other']
const CONFIDENTIALITY_LEVELS = ['Public', 'Internal', 'Confidential']

function emptyDocumentMeta() {
  return { document_type: 'Other', document_name: '', document_number: '', issue_date: '', expiry_date: '', issuing_authority: '', description: '', confidentiality: 'Internal', tags: '', remarks: '' }
}

function DocumentsEditor({ documents, onRefresh }: { documents: CompanyDocument[]; onRefresh: () => void }) {
  const { canFeature } = useCan()
  const mayUpload = canFeature('organization', 'info', 'documents', 'create')
  const mayDelete = canFeature('organization', 'info', 'documents', 'delete')
  const mayOpen = canFeature('organization', 'info', 'documents', 'export')
  const [file, setFile] = useState<File | null>(null)
  const [meta, setMeta] = useState(emptyDocumentMeta())
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<CompanyDocument | null>(null)
  const set = (k: keyof ReturnType<typeof emptyDocumentMeta>, v: string) => setMeta((m) => ({ ...m, [k]: v }))

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!file) { setError('Select a file to upload — click the Document File box.'); return }
    if (!meta.document_name.trim()) { setError('Document Name is required — e.g. GST Registration Certificate.'); return }
    setSaving(true)
    setError('')
    try {
      await organizationApi.uploadCompanyDocument(file, meta)
      setFile(null)
      setMeta(emptyDocumentMeta())
      onRefresh()
    } catch (err: unknown) {
      setError(extractErrorMessages(err, 'Could not upload the document. Check the file and try again; if it keeps failing, SharePoint may be unreachable — contact IT.').join(' '))
    } finally {
      setSaving(false)
    }
  }

  const doDelete = async () => {
    if (!deleteTarget) return
    try {
      await organizationApi.deleteCompanyDocument(deleteTarget.id)
      setDeleteTarget(null)
      onRefresh()
    } catch (err) {
      setError(extractErrorMessages(err, 'Failed to delete document.').join(' '))
      setDeleteTarget(null)
    }
  }

  return (
    <SheetSection icon="clip" title="Company Documents">
      <ConfirmDialog
        open={!!deleteTarget}
        title="Delete this document?"
        message={`Delete "${deleteTarget?.document_name}"? This cannot be undone.`}
        onConfirm={doDelete}
        onCancel={() => setDeleteTarget(null)}
      />

      {mayUpload && <form onSubmit={submit} style={subFormStyle}>
        <SubFormHead title="Add Company Document" editing={false} onCancel={() => undefined} />
        <SheetError error={error} />
        <div style={{ marginBottom: 14 }} data-tour="org-doc-file">
          <label style={sheetLabel}>Document File <Req /></label>
          <FileUploadField file={file} onChange={setFile} onRemove={() => setFile(null)} uploading={saving} />
        </div>
        <div style={rowStyle}>
          <F label="Document Type" req basis={170} max={220}>
            <Select data-tour="org-doc-type" style={sheetInput} value={meta.document_type} onChange={(e) => set('document_type', e.target.value)}>
              {DOCUMENT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </Select>
          </F>
          <F label="Document Name" req basis={260} max={360}><input data-tour="org-doc-name" style={sheetInput} value={meta.document_name} onChange={(e) => set('document_name', e.target.value)} /></F>
          <F label="Document Number" basis={180} max={260}><input style={sheetInput} value={meta.document_number} onChange={(e) => set('document_number', e.target.value)} /></F>
        </div>
        <div style={rowStyle}>
          <F label="Issue Date" basis={170} max={220}><DateField value={meta.issue_date} onChange={(v) => set('issue_date', v)} /></F>
          <F label="Expiry Date" basis={170} max={220}><div data-tour="org-doc-expiry"><DateField value={meta.expiry_date} onChange={(v) => set('expiry_date', v)} /></div></F>
          <F label="Issuing Authority" basis={220} max={320}><input style={sheetInput} value={meta.issuing_authority} onChange={(e) => set('issuing_authority', e.target.value)} /></F>
          <F label="Confidentiality" basis={150} max={200}>
            <Select data-tour="org-doc-confidentiality" style={sheetInput} value={meta.confidentiality} onChange={(e) => set('confidentiality', e.target.value)}>
              {CONFIDENTIALITY_LEVELS.map((c) => <option key={c} value={c}>{c}</option>)}
            </Select>
          </F>
        </div>
        <div style={rowStyle}>
          <F label="Tags (comma separated)" basis={240}><input style={sheetInput} value={meta.tags} onChange={(e) => set('tags', e.target.value)} /></F>
        </div>
        <div style={rowStyle}>
          <F label="Description" basis={400}><input style={sheetInput} value={meta.description} onChange={(e) => set('description', e.target.value)} /></F>
        </div>
        <div style={rowStyle}>
          <F label="Remarks" basis={400}><input style={sheetInput} value={meta.remarks} onChange={(e) => set('remarks', e.target.value)} /></F>
        </div>
        <SaveBtn tour="org-doc-save" saving={saving} label="Save Document" busyLabel="Uploading…" />
      </form>}

      {documents.length === 0 ? (
        <p style={{ fontSize: 13, color: MUTED }}>No documents uploaded yet.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }} data-tour="org-doc-list">
          {documents.map((d) => (
            <div key={d.id} style={listRowStyle}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 13.5, fontWeight: 600, color: INK }}>{d.document_name}</span>
                    <span style={pill('#eff6ff', BLUE)}>{d.document_type}</span>
                    {d.confidentiality && <span style={pill('rgba(0,0,0,0.05)', MUTED)}>{d.confidentiality}</span>}
                  </div>
                  <p style={{ fontSize: 12.5, color: MUTED, margin: 0 }}>
                    {d.filename}{d.expiry_date ? ` · Expires ${formatDate(d.expiry_date)}` : ''}{d.issuing_authority ? ` · ${d.issuing_authority}` : ''}
                  </p>
                </div>
                <div style={{ display: 'flex', gap: 10, flexShrink: 0 }}>
                  {d.sharepoint_url && mayOpen && <a href={d.sharepoint_url} target="_blank" rel="noreferrer" style={linkBtnStyle}>Open</a>}
                  {mayDelete && <button type="button" style={dangerLinkStyle} onClick={() => setDeleteTarget(d)}>Delete</button>}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </SheetSection>
  )
}
