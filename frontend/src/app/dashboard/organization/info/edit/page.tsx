'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useRequireAdmin } from '@/hooks/useAuth'
import { organizationApi, storeApi } from '@/lib/api'
import { Company, Branch, StoreLocation, CompanyAddress, CompanyContact, CompanyFinancialYear, CompanyDocument } from '@/types'
import { TEXT, GLASS, SHADOWS, BRAND, BORDER } from '@/lib/theme'
import OrganizationNav from '@/components/organization/OrganizationNav'
import MessageDialog from '@/components/erp/MessageDialog'
import ConfirmDialog from '@/components/erp/ConfirmDialog'
import FileUploadField from '@/components/shared/FileUploadField'
import { extractErrorMessages } from '@/lib/validation'

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '10px 12px', borderRadius: 10, border: `1px solid ${BORDER.normal}`,
  background: 'rgba(255,255,255,.7)', fontSize: 13.5, outline: 'none', color: TEXT.body,
}
const labelStyle: React.CSSProperties = { fontSize: 12, fontWeight: 700, color: TEXT.secondary, marginBottom: 6, display: 'block' }
const sectionStyle: React.CSSProperties = {
  borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur,
  border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), padding: 20, marginBottom: 20,
}
const gridStyle: React.CSSProperties = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }
const checkboxRowStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: TEXT.body, marginTop: 6 }
const cardRowStyle: React.CSSProperties = {
  display: 'flex', flexDirection: 'column', gap: 8, padding: '14px 16px', borderRadius: 12,
  background: 'rgba(255,255,255,.5)', border: `1px solid ${BORDER.normal}`,
}
const primaryBtnStyle: React.CSSProperties = {
  padding: '9px 16px', borderRadius: 9, border: 'none', fontSize: 12.5, fontWeight: 700, cursor: 'pointer',
  background: `linear-gradient(140deg,${BRAND.primary},${BRAND.primaryHover})`, color: '#fff',
}
const linkBtnStyle: React.CSSProperties = { fontSize: 11.5, fontWeight: 600, color: BRAND.primaryActive, cursor: 'pointer', background: 'none', border: 'none', padding: 0 }
const dangerLinkStyle: React.CSSProperties = { ...linkBtnStyle, color: '#b91c1c' }
const fieldLabelStyle: React.CSSProperties = labelStyle

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><label style={fieldLabelStyle}>{label}</label>{children}</div>
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
  const { isAuthorized, isLoading } = useRequireAdmin()
  const router = useRouter()
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
      organizationApi.listCompanyFinancialYears(),
      organizationApi.listCompanyDocuments(),
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
        .catch(() => setError('Failed to load company info.'))

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
            setError('Failed to load company info.')
          }
        })
        .finally(() => setLoading(false))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthorized])

  const setField = (field: keyof Company, value: unknown) => setForm((f) => ({ ...f, [field]: value }))

  const handleSave = async () => {
    if (!form.name?.trim()) {
      setError('Company name is required')
      return
    }
    if (!form.code?.trim()) {
      setError('Company code is required')
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
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      setError(detail || 'Failed to save company info.')
      setSaving(false)
    }
  }

  if (isLoading || !isAuthorized) return null

  return (
    <div>
      <OrganizationNav />

      <p style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 4px' }}>
        <span onClick={() => router.push('/dashboard/organization/info')} style={{ cursor: 'pointer' }}>Organization › Info</span> › Edit
      </p>
      <h1 style={{ fontSize: 24, fontWeight: 700, color: TEXT.heading, margin: '0 0 20px' }}>Edit Info</h1>

      <MessageDialog
        open={!!error}
        variant="error"
        title="Company Info Error"
        message={error}
        onClose={() => setError('')}
      />

      {loading ? (
        <div style={{ textAlign: 'center', padding: '40px 20px', color: TEXT.muted, fontSize: 13 }}>Loading…</div>
      ) : (
        <>
          <div style={{ display: 'flex', gap: 8, marginBottom: 20, borderBottom: `1px solid ${BORDER.normal}`, flexWrap: 'wrap' }}>
            {TABS.map((t) => (
              <button
                key={t}
                type="button"
                data-tour={TAB_TOUR_IDS[t]}
                onClick={() => setTab(t)}
                style={{
                  padding: '10px 6px',
                  marginRight: 16,
                  border: 'none',
                  borderRadius: 0,
                  boxShadow: 'none',
                  outline: 'none',
                  background: 'transparent',
                  borderBottom: tab === t ? `2px solid ${BRAND.primary}` : '2px solid transparent',
                  color: tab === t ? BRAND.primary : TEXT.secondary,
                  fontWeight: 600,
                  fontSize: 13,
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                }}
              >
                {t}
              </button>
            ))}
          </div>

          {isNew && (
            <div style={{ ...sectionStyle, background: 'rgba(255,122,69,0.08)', borderColor: 'rgba(255,122,69,0.3)' }}>
              <p style={{ fontSize: 12.5, color: TEXT.body, margin: 0 }}>
                Company info hasn&apos;t been set up yet. Fill in at least Name and Code below and Save — Address, Contacts,
                Financial Year, and Documents can only be added after that first save.
              </p>
            </div>
          )}

          {tab === 'Basic' && (
            <div style={sectionStyle}>
              <h2 style={{ fontSize: 14, fontWeight: 700, color: TEXT.heading, margin: '0 0 16px 0' }}>Basic Information</h2>
              <div style={gridStyle}>
                <div>
                  <label style={labelStyle}>Company Name *</label>
                  <input data-tour="org-edit-name" style={inputStyle} value={form.name || ''} onChange={(e) => setField('name', e.target.value)} />
                </div>
                <div>
                  <label style={labelStyle}>Legal Name *</label>
                  <input data-tour="org-edit-legal-name" style={inputStyle} value={form.legal_name || ''} onChange={(e) => setField('legal_name', e.target.value || null)} />
                </div>
              </div>
              <div style={gridStyle}>
                <div>
                  <label style={labelStyle}>Short Name</label>
                  <input style={inputStyle} value={form.short_name || ''} onChange={(e) => setField('short_name', e.target.value || null)} />
                </div>
                <div>
                  <label style={labelStyle}>Code *</label>
                  <input data-tour="org-edit-code" style={inputStyle} value={form.code || ''} onChange={(e) => setField('code', e.target.value.toUpperCase())} />
                </div>
              </div>
              <div style={gridStyle}>
                <div>
                  <label style={labelStyle}>Company Type</label>
                  <input style={inputStyle} value={form.company_type || ''} onChange={(e) => setField('company_type', e.target.value || null)} placeholder="Private Limited" />
                </div>
                <div>
                  <label style={labelStyle}>Industry</label>
                  <input style={inputStyle} value={form.industry || ''} onChange={(e) => setField('industry', e.target.value || null)} />
                </div>
              </div>
              <div style={gridStyle}>
                <div>
                  <label style={labelStyle}>Business Nature</label>
                  <input style={inputStyle} value={form.business_nature || ''} onChange={(e) => setField('business_nature', e.target.value || null)} />
                </div>
                <div>
                  <label style={labelStyle}>Website</label>
                  <input style={inputStyle} value={form.website || ''} onChange={(e) => setField('website', e.target.value || null)} />
                </div>
              </div>
              <div style={{ marginBottom: 16 }}>
                <label style={labelStyle}>Description</label>
                <textarea style={{ ...inputStyle, minHeight: 70, resize: 'vertical' }} value={form.description || ''} onChange={(e) => setField('description', e.target.value || null)} />
              </div>
              <div style={gridStyle}>
                <div>
                  <label style={labelStyle}>Date of Incorporation</label>
                  <input type="date" style={inputStyle} value={form.date_of_incorporation || ''} onChange={(e) => setField('date_of_incorporation', e.target.value || null)} />
                </div>
                <div>
                  <label style={labelStyle}>Country *</label>
                  <input data-tour="org-edit-country" style={inputStyle} value={form.country || ''} onChange={(e) => setField('country', e.target.value || null)} />
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16 }}>
                <div>
                  <label style={labelStyle}>Default Currency *</label>
                  <input data-tour="org-edit-currency" style={inputStyle} value={form.currency || ''} onChange={(e) => setField('currency', e.target.value || null)} placeholder="INR" />
                </div>
                <div>
                  <label style={labelStyle}>Default Language</label>
                  <input style={inputStyle} value={form.default_language || ''} onChange={(e) => setField('default_language', e.target.value || null)} placeholder="English" />
                </div>
                <div>
                  <label style={labelStyle}>Time Zone *</label>
                  <input data-tour="org-edit-timezone" style={inputStyle} value={form.timezone || ''} onChange={(e) => setField('timezone', e.target.value || null)} placeholder="Asia/Kolkata" />
                </div>
              </div>
            </div>
          )}

          {tab === 'Address' && (isNew
            ? <p style={{ fontSize: 12.5, color: TEXT.muted }}>Save the Basic tab first to add addresses.</p>
            : <AddressesEditor addresses={addresses} onRefresh={loadLists} />)}

          {tab === 'Legal & Registration' && (
            <div style={sectionStyle}>
              <h2 style={{ fontSize: 14, fontWeight: 700, color: TEXT.heading, margin: '0 0 16px 0' }}>Legal & Registration</h2>
              <div style={gridStyle}>
                <div>
                  <label style={labelStyle}>Legal Entity Type</label>
                  <input style={inputStyle} value={form.legal_entity_type || ''} onChange={(e) => setField('legal_entity_type', e.target.value || null)} placeholder="Private Limited Company" />
                </div>
                <div>
                  <label style={labelStyle}>Legal Status</label>
                  <input style={inputStyle} value={form.legal_status || ''} onChange={(e) => setField('legal_status', e.target.value || null)} placeholder="Active" />
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16, marginBottom: 16 }}>
                <div>
                  <label style={labelStyle}>CIN</label>
                  <input data-tour="org-edit-cin" style={inputStyle} value={form.cin || ''} onChange={(e) => setField('cin', e.target.value || null)} />
                </div>
                <div>
                  <label style={labelStyle}>PAN</label>
                  <input data-tour="org-edit-pan" style={inputStyle} value={form.pan || ''} onChange={(e) => setField('pan', e.target.value || null)} />
                </div>
                <div>
                  <label style={labelStyle}>TAN</label>
                  <input style={inputStyle} value={form.tan || ''} onChange={(e) => setField('tan', e.target.value || null)} />
                </div>
              </div>
              <div style={gridStyle}>
                <div>
                  <label style={labelStyle}>GSTIN</label>
                  <input data-tour="org-edit-gstin" style={inputStyle} value={form.gstin || ''} onChange={(e) => setField('gstin', e.target.value || null)} />
                </div>
                <div>
                  <label style={labelStyle}>Udyam Registration No.</label>
                  <input style={inputStyle} value={form.udyam_registration_no || ''} onChange={(e) => setField('udyam_registration_no', e.target.value || null)} />
                </div>
              </div>
              <div style={gridStyle}>
                <div>
                  <label style={labelStyle}>IEC</label>
                  <input style={inputStyle} value={form.iec || ''} onChange={(e) => setField('iec', e.target.value || null)} />
                </div>
                <div>
                  <label style={labelStyle}>MSME Registration No.</label>
                  <input style={inputStyle} value={form.msme_registration_no || ''} onChange={(e) => setField('msme_registration_no', e.target.value || null)} />
                </div>
              </div>
              <div style={gridStyle}>
                <div>
                  <label style={labelStyle}>PF Registration No.</label>
                  <input style={inputStyle} value={form.pf_registration_no || ''} onChange={(e) => setField('pf_registration_no', e.target.value || null)} />
                </div>
                <div>
                  <label style={labelStyle}>ESIC Registration No.</label>
                  <input style={inputStyle} value={form.esic_registration_no || ''} onChange={(e) => setField('esic_registration_no', e.target.value || null)} />
                </div>
              </div>

              <h3 style={{ fontSize: 12.5, fontWeight: 700, color: TEXT.muted, textTransform: 'uppercase', margin: '20px 0 12px' }}>Other Registration</h3>
              <div style={gridStyle}>
                <div>
                  <label style={labelStyle}>Other Registration Type</label>
                  <input style={inputStyle} value={form.other_registration_type || ''} onChange={(e) => setField('other_registration_type', e.target.value || null)} />
                </div>
                <div>
                  <label style={labelStyle}>Registration Number</label>
                  <input style={inputStyle} value={form.other_registration_number || ''} onChange={(e) => setField('other_registration_number', e.target.value || null)} />
                </div>
              </div>
              <div style={gridStyle}>
                <div>
                  <label style={labelStyle}>Registration Date</label>
                  <input type="date" style={inputStyle} value={form.other_registration_date || ''} onChange={(e) => setField('other_registration_date', e.target.value || null)} />
                </div>
                <div>
                  <label style={labelStyle}>Issuing Authority</label>
                  <input style={inputStyle} value={form.issuing_authority || ''} onChange={(e) => setField('issuing_authority', e.target.value || null)} />
                </div>
              </div>
              <div style={gridStyle}>
                <div>
                  <label style={labelStyle}>Expiry Date</label>
                  <input type="date" style={inputStyle} value={form.expiry_date || ''} onChange={(e) => setField('expiry_date', e.target.value || null)} />
                </div>
                <div>
                  <label style={labelStyle}>Legal Representative</label>
                  <input style={inputStyle} value={form.legal_representative || ''} onChange={(e) => setField('legal_representative', e.target.value || null)} />
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                <div>
                  <label style={labelStyle}>Authorized Capital</label>
                  <input data-tour="org-edit-authorized-capital" type="number" style={inputStyle} value={form.authorized_capital ?? ''} onChange={(e) => setField('authorized_capital', e.target.value ? Number(e.target.value) : null)} />
                </div>
                <div>
                  <label style={labelStyle}>Paid-up Capital</label>
                  <input type="number" style={inputStyle} value={form.paid_up_capital ?? ''} onChange={(e) => setField('paid_up_capital', e.target.value ? Number(e.target.value) : null)} />
                </div>
              </div>
              <p data-tour="org-edit-legal-docs-note" style={{ fontSize: 11.5, color: TEXT.muted, margin: '16px 0 0' }}>Legal documents (licenses, certificates, agreements) are managed from the Company Documents tab on the Info page.</p>
            </div>
          )}

          {tab === 'Tax Configuration' && (
            <div style={sectionStyle}>
              <h2 style={{ fontSize: 14, fontWeight: 700, color: TEXT.heading, margin: '0 0 16px 0' }}>Tax Configuration</h2>
              <div style={gridStyle}>
                <div>
                  <label style={labelStyle}>GST Registration Type</label>
                  <input data-tour="org-edit-gst-type" style={inputStyle} value={form.gst_registration_type || ''} onChange={(e) => setField('gst_registration_type', e.target.value || null)} placeholder="Regular" />
                </div>
                <div>
                  <label style={labelStyle}>Default Tax Region</label>
                  <input style={inputStyle} value={form.default_tax_region || ''} onChange={(e) => setField('default_tax_region', e.target.value || null)} />
                </div>
              </div>
              <div style={gridStyle}>
                <div>
                  <label style={labelStyle}>Tax Deductibility</label>
                  <input style={inputStyle} value={form.tax_deductibility || ''} onChange={(e) => setField('tax_deductibility', e.target.value || null)} />
                </div>
                <div>
                  <label style={labelStyle}>Tax Registration Status</label>
                  <input style={inputStyle} value={form.tax_registration_status || ''} onChange={(e) => setField('tax_registration_status', e.target.value || null)} placeholder="Active" />
                </div>
              </div>
              <div style={{ marginBottom: 16 }}>
                <label style={labelStyle}>Tax Effective Date</label>
                <input type="date" style={{ ...inputStyle, maxWidth: 260 }} value={form.tax_effective_date || ''} onChange={(e) => setField('tax_effective_date', e.target.value || null)} />
              </div>
              <div style={{ display: 'flex', gap: 24 }} data-tour="org-edit-tax-applicability">
                <label style={checkboxRowStyle}>
                  <input type="checkbox" checked={!!form.tds_applicable} onChange={(e) => setField('tds_applicable', e.target.checked)} />
                  TDS Applicable
                </label>
                <label style={checkboxRowStyle}>
                  <input type="checkbox" checked={!!form.tcs_applicable} onChange={(e) => setField('tcs_applicable', e.target.checked)} />
                  TCS Applicable
                </label>
              </div>
              <p style={{ fontSize: 11.5, color: TEXT.muted, margin: '16px 0 0' }}>Tax documents (registration certificates, filings) are managed from the Company Documents tab on the Info page.</p>
            </div>
          )}

          {tab === 'Contacts' && (isNew
            ? <p style={{ fontSize: 12.5, color: TEXT.muted }}>Save the Basic tab first to add contacts.</p>
            : <ContactsEditor contacts={contacts} onRefresh={loadLists} />)}

          {tab === 'Financial Year' && (isNew
            ? <p style={{ fontSize: 12.5, color: TEXT.muted }}>Save the Basic tab first to add financial years.</p>
            : <FinancialYearsEditor financialYears={financialYears} onRefresh={loadLists} />)}

          {tab === 'Branding' && (
            <div style={sectionStyle}>
              <h2 style={{ fontSize: 14, fontWeight: 700, color: TEXT.heading, margin: '0 0 16px 0' }}>Branding</h2>
              <div style={{ marginBottom: 16 }}>
                <label style={labelStyle}>Company Logo URL</label>
                <input data-tour="org-edit-logo-url" style={inputStyle} value={form.logo_url || ''} onChange={(e) => setField('logo_url', e.target.value || null)} />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16, marginBottom: 16 }} data-tour="org-edit-brand-colors">
                <div>
                  <label style={labelStyle}>Primary Brand Color</label>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <input type="color" value={form.primary_brand_color || '#ff7a45'} onChange={(e) => setField('primary_brand_color', e.target.value)} style={{ width: 44, height: 38, padding: 2, borderRadius: 8, border: `1px solid ${BORDER.normal}` }} />
                    <input style={inputStyle} value={form.primary_brand_color || ''} onChange={(e) => setField('primary_brand_color', e.target.value || null)} placeholder="#FF7A45" />
                  </div>
                </div>
                <div>
                  <label style={labelStyle}>Secondary Brand Color</label>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <input type="color" value={form.secondary_brand_color || '#1f1108'} onChange={(e) => setField('secondary_brand_color', e.target.value)} style={{ width: 44, height: 38, padding: 2, borderRadius: 8, border: `1px solid ${BORDER.normal}` }} />
                    <input style={inputStyle} value={form.secondary_brand_color || ''} onChange={(e) => setField('secondary_brand_color', e.target.value || null)} placeholder="#1F1108" />
                  </div>
                </div>
                <div>
                  <label style={labelStyle}>Accent Color</label>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <input type="color" value={form.accent_color || '#3b82f6'} onChange={(e) => setField('accent_color', e.target.value)} style={{ width: 44, height: 38, padding: 2, borderRadius: 8, border: `1px solid ${BORDER.normal}` }} />
                    <input style={inputStyle} value={form.accent_color || ''} onChange={(e) => setField('accent_color', e.target.value || null)} placeholder="#3B82F6" />
                  </div>
                </div>
              </div>
              <div style={{ marginBottom: 16 }}>
                <label style={labelStyle}>Company Header</label>
                <textarea data-tour="org-edit-header" style={{ ...inputStyle, minHeight: 60, resize: 'vertical' }} value={form.company_header || ''} onChange={(e) => setField('company_header', e.target.value || null)} placeholder="Text shown at the top of generated documents" />
              </div>
              <div style={{ marginBottom: 16 }}>
                <label style={labelStyle}>Company Footer</label>
                <textarea data-tour="org-edit-footer" style={{ ...inputStyle, minHeight: 60, resize: 'vertical' }} value={form.company_footer || ''} onChange={(e) => setField('company_footer', e.target.value || null)} placeholder="Text shown at the bottom of generated documents" />
              </div>
              <div style={{ marginBottom: 16 }}>
                <label style={labelStyle}>Watermark</label>
                <input style={inputStyle} value={form.watermark || ''} onChange={(e) => setField('watermark', e.target.value || null)} placeholder="e.g. DRAFT, or a watermark image URL" />
              </div>
              <div>
                <label style={labelStyle}>Email Signature</label>
                <textarea data-tour="org-edit-email-signature" style={{ ...inputStyle, minHeight: 80, resize: 'vertical' }} value={form.email_signature || ''} onChange={(e) => setField('email_signature', e.target.value || null)} />
              </div>
            </div>
          )}

          {tab === 'Documents' && (isNew
            ? <p style={{ fontSize: 12.5, color: TEXT.muted }}>Save the Basic tab first to add documents.</p>
            : <DocumentsEditor documents={documents} onRefresh={loadLists} />)}

          {tab === 'Defaults & Controls' && (
            <div style={sectionStyle}>
              <h2 style={{ fontSize: 14, fontWeight: 700, color: TEXT.heading, margin: '0 0 16px 0' }}>Company Defaults & Controls</h2>
              <div style={gridStyle}>
                <div>
                  <label style={labelStyle}>Default Tax</label>
                  <input style={inputStyle} value={form.default_tax || ''} onChange={(e) => setField('default_tax', e.target.value || null)} placeholder="GST 18%" />
                </div>
                <div>
                  <label style={labelStyle}>Default Plant</label>
                  <select data-tour="org-edit-default-plant" style={inputStyle} value={form.default_plant_id || ''} onChange={(e) => setField('default_plant_id', e.target.value ? Number(e.target.value) : null)}>
                    <option value="">— Select —</option>
                    {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                  </select>
                </div>
              </div>
              <div style={gridStyle}>
                <div>
                  <label style={labelStyle}>Default Warehouse</label>
                  <select data-tour="org-edit-default-warehouse" style={inputStyle} value={form.default_warehouse_id || ''} onChange={(e) => setField('default_warehouse_id', e.target.value ? Number(e.target.value) : null)}>
                    <option value="">— Select —</option>
                    {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                  </select>
                </div>
                <div>
                  <label style={labelStyle}>Default Cost Center</label>
                  <input style={inputStyle} value={form.default_cost_center || ''} onChange={(e) => setField('default_cost_center', e.target.value || null)} />
                </div>
              </div>
              <div style={{ maxWidth: 'calc(50% - 8px)' }}>
                <label style={labelStyle}>Default Profit Center</label>
                <input style={inputStyle} value={form.default_profit_center || ''} onChange={(e) => setField('default_profit_center', e.target.value || null)} />
              </div>
            </div>
          )}

          {!LIST_TABS.has(tab) && (
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
            <button
              data-tour="org-edit-cancel"
              onClick={() => router.push('/dashboard/organization/info')}
              disabled={saving}
              style={{
                padding: '10px 20px', borderRadius: 8, border: '1px solid #d4d4d8', background: '#fff',
                color: TEXT.body, fontSize: 13.5, fontWeight: 600,
                cursor: saving ? 'not-allowed' : 'pointer', opacity: saving ? 0.5 : 1,
              }}
            >
              Cancel
            </button>
            <button
              data-tour="org-edit-save"
              onClick={handleSave}
              disabled={saving}
              style={{
                padding: '10px 24px', borderRadius: 10, border: 'none',
                background: saving ? '#999' : `linear-gradient(140deg,${BRAND.primary},${BRAND.primaryHover})`,
                color: '#fff', fontSize: 13.5, fontWeight: 700, cursor: saving ? 'not-allowed' : 'pointer',
                boxShadow: saving ? 'none' : `0 4px 14px ${BRAND.primaryGlow}`,
              }}
            >
              {saving ? 'Saving…' : 'Save Changes'}
            </button>
          </div>
          )}
        </>
      )}
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
    setForm({
      address_type: a.address_type || '', address_line1: a.address_line1, address_line2: a.address_line2 || '',
      landmark: a.landmark || '', country: a.country || '', state: a.state || '', city: a.city || '',
      district: a.district || '', pincode: a.pincode || '', is_primary: a.is_primary, is_active: a.is_active,
    })
  }
  const cancel = () => { setEditingId(null); setForm(emptyAddress()) }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.address_line1.trim()) { setError('Address Line 1 is required'); return }
    setSaving(true)
    setError('')
    try {
      if (editingId) await organizationApi.updateCompanyAddress(editingId, form)
      else await organizationApi.createCompanyAddress(form)
      cancel()
      onRefresh()
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      setError(detail || 'Failed to save address.')
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
    <div style={sectionStyle}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
        <h2 style={{ fontSize: 14, fontWeight: 700, color: TEXT.heading, margin: 0 }}>{editingId ? 'Edit Address' : 'Add Address'}</h2>
        {editingId && <button type="button" style={linkBtnStyle} onClick={cancel}>Cancel edit</button>}
      </div>

      <MessageDialog open={!!error} variant="error" title="Address Error" message={error} onClose={() => setError('')} />
      <ConfirmDialog
        open={!!deleteTarget}
        title="Delete this address?"
        message={`Delete the "${deleteTarget?.address_type || 'address'}" record? This cannot be undone.`}
        onConfirm={doDelete}
        onCancel={() => setDeleteTarget(null)}
      />

      <form onSubmit={submit} style={{ marginBottom: 20, padding: 16, borderRadius: 12, background: 'rgba(255,255,255,.6)', border: `1px solid ${BORDER.normal}`, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <Field label="Address Type"><input data-tour="org-addr-type" style={inputStyle} value={form.address_type} onChange={(e) => setForm((f) => ({ ...f, address_type: e.target.value }))} placeholder="Registered Office" /></Field>
        <Field label="Landmark"><input style={inputStyle} value={form.landmark} onChange={(e) => setForm((f) => ({ ...f, landmark: e.target.value }))} /></Field>
        <div style={{ gridColumn: '1 / -1' }}>
          <Field label="Address Line 1 *"><input data-tour="org-addr-line1" style={inputStyle} value={form.address_line1} onChange={(e) => setForm((f) => ({ ...f, address_line1: e.target.value }))} /></Field>
        </div>
        <div style={{ gridColumn: '1 / -1' }}>
          <Field label="Address Line 2"><input style={inputStyle} value={form.address_line2} onChange={(e) => setForm((f) => ({ ...f, address_line2: e.target.value }))} /></Field>
        </div>
        <Field label="Country"><input style={inputStyle} value={form.country} onChange={(e) => setForm((f) => ({ ...f, country: e.target.value }))} /></Field>
        <Field label="State / UT"><input style={inputStyle} value={form.state} onChange={(e) => setForm((f) => ({ ...f, state: e.target.value }))} /></Field>
        <Field label="City"><input style={inputStyle} value={form.city} onChange={(e) => setForm((f) => ({ ...f, city: e.target.value }))} /></Field>
        <Field label="District"><input style={inputStyle} value={form.district} onChange={(e) => setForm((f) => ({ ...f, district: e.target.value }))} /></Field>
        <Field label="PIN Code"><input data-tour="org-addr-pincode" style={inputStyle} value={form.pincode} onChange={(e) => setForm((f) => ({ ...f, pincode: e.target.value }))} /></Field>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 16 }} data-tour="org-addr-flags">
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, color: TEXT.body }}>
            <input type="checkbox" checked={form.is_primary} onChange={(e) => setForm((f) => ({ ...f, is_primary: e.target.checked }))} /> Primary
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, color: TEXT.body }}>
            <input type="checkbox" checked={form.is_active} onChange={(e) => setForm((f) => ({ ...f, is_active: e.target.checked }))} /> Active
          </label>
        </div>
        <div style={{ gridColumn: '1 / -1', display: 'flex', justifyContent: 'flex-end' }}>
          <button type="submit" data-tour="org-addr-save" disabled={saving} style={{ ...primaryBtnStyle, opacity: saving ? 0.6 : 1 }}>{saving ? 'Saving…' : editingId ? 'Save Changes' : 'Save Address'}</button>
        </div>
      </form>

      {addresses.length === 0 ? (
        <p style={{ fontSize: 13, color: TEXT.muted }}>No addresses added yet.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }} data-tour="org-addr-list">
          {addresses.map((a) => (
            <div key={a.id} style={cardRowStyle}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 13.5, fontWeight: 600, color: TEXT.heading }}>{a.address_type || 'Address'}</span>
                    {a.is_primary && <span style={{ fontSize: 10.5, fontWeight: 700, padding: '2px 8px', borderRadius: 9999, background: 'rgba(16,185,129,0.12)', color: '#047857' }}>PRIMARY</span>}
                    {!a.is_active && <span style={{ fontSize: 10.5, fontWeight: 700, padding: '2px 8px', borderRadius: 9999, background: 'rgba(220,38,38,0.1)', color: '#b91c1c' }}>INACTIVE</span>}
                  </div>
                  <p style={{ fontSize: 12.5, color: TEXT.secondary, margin: 0 }}>
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
    </div>
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
    setForm({
      contact_type: c.contact_type || '', contact_person: c.contact_person, designation: c.designation || '',
      department: c.department || '', mobile: c.mobile || '', phone: c.phone || '', email: c.email || '',
      alternate_email: c.alternate_email || '', communication_preference: c.communication_preference || '',
      is_primary: c.is_primary, is_active: c.is_active,
    })
  }
  const cancel = () => { setEditingId(null); setForm(emptyContact()) }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.contact_person.trim()) { setError('Contact Person is required'); return }
    setSaving(true)
    setError('')
    try {
      if (editingId) await organizationApi.updateCompanyContact(editingId, form)
      else await organizationApi.createCompanyContact(form)
      cancel()
      onRefresh()
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      setError(detail || 'Failed to save contact.')
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
    <div style={sectionStyle}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
        <h2 style={{ fontSize: 14, fontWeight: 700, color: TEXT.heading, margin: 0 }}>{editingId ? 'Edit Contact' : 'Add Contact'}</h2>
        {editingId && <button type="button" style={linkBtnStyle} onClick={cancel}>Cancel edit</button>}
      </div>

      <MessageDialog open={!!error} variant="error" title="Contact Error" message={error} onClose={() => setError('')} />
      <ConfirmDialog
        open={!!deleteTarget}
        title="Delete this contact?"
        message={`Delete "${deleteTarget?.contact_person}"? This cannot be undone.`}
        onConfirm={doDelete}
        onCancel={() => setDeleteTarget(null)}
      />

      <form onSubmit={submit} style={{ marginBottom: 20, padding: 16, borderRadius: 12, background: 'rgba(255,255,255,.6)', border: `1px solid ${BORDER.normal}`, display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
        <Field label="Contact Type"><input style={inputStyle} value={form.contact_type} onChange={(e) => setForm((f) => ({ ...f, contact_type: e.target.value }))} placeholder="Primary" /></Field>
        <Field label="Contact Person *"><input data-tour="org-contact-person" style={inputStyle} value={form.contact_person} onChange={(e) => setForm((f) => ({ ...f, contact_person: e.target.value }))} /></Field>
        <Field label="Designation"><input style={inputStyle} value={form.designation} onChange={(e) => setForm((f) => ({ ...f, designation: e.target.value }))} /></Field>
        <Field label="Department"><input style={inputStyle} value={form.department} onChange={(e) => setForm((f) => ({ ...f, department: e.target.value }))} /></Field>
        <Field label="Mobile"><input data-tour="org-contact-mobile" style={inputStyle} value={form.mobile} onChange={(e) => setForm((f) => ({ ...f, mobile: e.target.value }))} /></Field>
        <Field label="Phone"><input style={inputStyle} value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} /></Field>
        <Field label="Email"><input data-tour="org-contact-email" style={inputStyle} value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} /></Field>
        <Field label="Alternate Email"><input style={inputStyle} value={form.alternate_email} onChange={(e) => setForm((f) => ({ ...f, alternate_email: e.target.value }))} /></Field>
        <Field label="Communication Preference"><input style={inputStyle} value={form.communication_preference} onChange={(e) => setForm((f) => ({ ...f, communication_preference: e.target.value }))} placeholder="Email" /></Field>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 16 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, color: TEXT.body }}>
            <input type="checkbox" checked={form.is_primary} onChange={(e) => setForm((f) => ({ ...f, is_primary: e.target.checked }))} /> Primary
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, color: TEXT.body }}>
            <input type="checkbox" checked={form.is_active} onChange={(e) => setForm((f) => ({ ...f, is_active: e.target.checked }))} /> Active
          </label>
        </div>
        <div style={{ gridColumn: '1 / -1', display: 'flex', justifyContent: 'flex-end' }}>
          <button type="submit" data-tour="org-contact-save" disabled={saving} style={{ ...primaryBtnStyle, opacity: saving ? 0.6 : 1 }}>{saving ? 'Saving…' : editingId ? 'Save Changes' : 'Save Contact'}</button>
        </div>
      </form>

      {contacts.length === 0 ? (
        <p style={{ fontSize: 13, color: TEXT.muted }}>No contacts added yet.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }} data-tour="org-contact-list">
          {contacts.map((c) => (
            <div key={c.id} style={cardRowStyle}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 13.5, fontWeight: 600, color: TEXT.heading }}>{c.contact_person}</span>
                    {c.designation && <span style={{ fontSize: 10.5, fontWeight: 600, padding: '2px 8px', borderRadius: 9999, background: 'rgba(244,113,59,0.1)', color: BRAND.primary }}>{c.designation}</span>}
                    {c.is_primary && <span style={{ fontSize: 10.5, fontWeight: 700, padding: '2px 8px', borderRadius: 9999, background: 'rgba(16,185,129,0.12)', color: '#047857' }}>PRIMARY</span>}
                    {!c.is_active && <span style={{ fontSize: 10.5, fontWeight: 700, padding: '2px 8px', borderRadius: 9999, background: 'rgba(220,38,38,0.1)', color: '#b91c1c' }}>INACTIVE</span>}
                  </div>
                  <p style={{ fontSize: 12.5, color: TEXT.secondary, margin: 0 }}>
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
    </div>
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
    setForm({
      name: fy.name, start_date: fy.start_date, end_date: fy.end_date, fiscal_year_code: fy.fiscal_year_code || '',
      status: fy.status, lock_date: fy.lock_date || '', period_closing_rule: fy.period_closing_rule || '',
      number_series_reset: fy.number_series_reset,
    })
  }
  const cancel = () => { setEditingId(null); setForm(emptyFinancialYear()) }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.name.trim() || !form.start_date || !form.end_date) { setError('Name, Start Date, and End Date are required'); return }
    setSaving(true)
    setError('')
    try {
      const payload = { ...form, lock_date: form.lock_date || null, fiscal_year_code: form.fiscal_year_code || null, period_closing_rule: form.period_closing_rule || null }
      if (editingId) await organizationApi.updateCompanyFinancialYear(editingId, payload)
      else await organizationApi.createCompanyFinancialYear(payload)
      cancel()
      onRefresh()
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      setError(detail || 'Failed to save financial year.')
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
    <div style={sectionStyle}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
        <h2 style={{ fontSize: 14, fontWeight: 700, color: TEXT.heading, margin: 0 }}>{editingId ? 'Edit Financial Year' : 'Add Financial Year'}</h2>
        {editingId && <button type="button" style={linkBtnStyle} onClick={cancel}>Cancel edit</button>}
      </div>

      <MessageDialog open={!!error} variant="error" title="Financial Year Error" message={error} onClose={() => setError('')} />
      <ConfirmDialog
        open={!!deleteTarget}
        title="Delete this financial year?"
        message={`Delete "${deleteTarget?.name}"? This cannot be undone.`}
        onConfirm={doDelete}
        onCancel={() => setDeleteTarget(null)}
      />

      <form onSubmit={submit} style={{ marginBottom: 20, padding: 16, borderRadius: 12, background: 'rgba(255,255,255,.6)', border: `1px solid ${BORDER.normal}`, display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
        <Field label="Financial Year Name *"><input data-tour="org-fy-name" style={inputStyle} value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="FY 2025-26" /></Field>
        <Field label="Start Date *"><input data-tour="org-fy-start" type="date" style={inputStyle} value={form.start_date} onChange={(e) => setForm((f) => ({ ...f, start_date: e.target.value }))} /></Field>
        <Field label="End Date *"><input data-tour="org-fy-end" type="date" style={inputStyle} value={form.end_date} onChange={(e) => setForm((f) => ({ ...f, end_date: e.target.value }))} /></Field>
        <Field label="Fiscal Year Code"><input style={inputStyle} value={form.fiscal_year_code} onChange={(e) => setForm((f) => ({ ...f, fiscal_year_code: e.target.value }))} /></Field>
        <Field label="Status">
          <select data-tour="org-fy-status" style={inputStyle} value={form.status} onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}>
            <option value="open">Open</option>
            <option value="locked">Locked</option>
            <option value="closed">Closed</option>
          </select>
        </Field>
        <Field label="Lock Date"><input type="date" style={inputStyle} value={form.lock_date} onChange={(e) => setForm((f) => ({ ...f, lock_date: e.target.value }))} /></Field>
        <div style={{ gridColumn: '1 / -1' }}>
          <Field label="Period Closing Rule"><input style={inputStyle} value={form.period_closing_rule} onChange={(e) => setForm((f) => ({ ...f, period_closing_rule: e.target.value }))} /></Field>
        </div>
        <div style={{ display: 'flex', alignItems: 'flex-end' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, color: TEXT.body }}>
            <input type="checkbox" checked={form.number_series_reset} onChange={(e) => setForm((f) => ({ ...f, number_series_reset: e.target.checked }))} /> Reset number series
          </label>
        </div>
        <div style={{ gridColumn: '1 / -1', display: 'flex', justifyContent: 'flex-end' }}>
          <button type="submit" data-tour="org-fy-save" disabled={saving} style={{ ...primaryBtnStyle, opacity: saving ? 0.6 : 1 }}>{saving ? 'Saving…' : editingId ? 'Save Changes' : 'Save Financial Year'}</button>
        </div>
      </form>

      {financialYears.length === 0 ? (
        <p style={{ fontSize: 13, color: TEXT.muted }}>No financial years added yet.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }} data-tour="org-fy-list">
          {financialYears.map((fy) => (
            <div key={fy.id} style={cardRowStyle}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 13.5, fontWeight: 600, color: TEXT.heading }}>{fy.name}</span>
                    <span style={{
                      fontSize: 10.5, fontWeight: 700, padding: '2px 8px', borderRadius: 9999, textTransform: 'uppercase',
                      background: fy.status === 'open' ? 'rgba(16,185,129,0.12)' : fy.status === 'locked' ? 'rgba(245,158,11,0.12)' : 'rgba(220,38,38,0.1)',
                      color: fy.status === 'open' ? '#047857' : fy.status === 'locked' ? '#92400e' : '#b91c1c',
                    }}>{fy.status}</span>
                  </div>
                  <p style={{ fontSize: 12.5, color: TEXT.secondary, margin: 0 }}>{fy.start_date} → {fy.end_date}{fy.fiscal_year_code ? ` · ${fy.fiscal_year_code}` : ''}</p>
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
    </div>
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
  const [file, setFile] = useState<File | null>(null)
  const [meta, setMeta] = useState(emptyDocumentMeta())
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<CompanyDocument | null>(null)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!file) { setError('Select a file to upload'); return }
    if (!meta.document_name.trim()) { setError('Document Name is required'); return }
    setSaving(true)
    setError('')
    try {
      await organizationApi.uploadCompanyDocument(file, meta)
      setFile(null)
      setMeta(emptyDocumentMeta())
      onRefresh()
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      setError(detail || 'Failed to upload document.')
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
    <div style={sectionStyle}>
      <h2 style={{ fontSize: 14, fontWeight: 700, color: TEXT.heading, margin: '0 0 14px' }}>Add Company Document</h2>

      <MessageDialog open={!!error} variant="error" title="Document Error" message={error} onClose={() => setError('')} />
      <ConfirmDialog
        open={!!deleteTarget}
        title="Delete this document?"
        message={`Delete "${deleteTarget?.document_name}"? This cannot be undone.`}
        onConfirm={doDelete}
        onCancel={() => setDeleteTarget(null)}
      />

      <form onSubmit={submit} style={{ marginBottom: 20, padding: 16, borderRadius: 12, background: 'rgba(255,255,255,.6)', border: `1px solid ${BORDER.normal}`, display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
        <div style={{ gridColumn: '1 / -1' }} data-tour="org-doc-file">
          <Field label="Document File *">
            <FileUploadField file={file} onChange={setFile} onRemove={() => setFile(null)} uploading={saving} />
          </Field>
        </div>
        <Field label="Document Type *">
          <select data-tour="org-doc-type" style={inputStyle} value={meta.document_type} onChange={(e) => setMeta((m) => ({ ...m, document_type: e.target.value }))}>
            {DOCUMENT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </Field>
        <Field label="Document Name *"><input data-tour="org-doc-name" style={inputStyle} value={meta.document_name} onChange={(e) => setMeta((m) => ({ ...m, document_name: e.target.value }))} /></Field>
        <Field label="Document Number"><input style={inputStyle} value={meta.document_number} onChange={(e) => setMeta((m) => ({ ...m, document_number: e.target.value }))} /></Field>
        <Field label="Issue Date"><input type="date" style={inputStyle} value={meta.issue_date} onChange={(e) => setMeta((m) => ({ ...m, issue_date: e.target.value }))} /></Field>
        <Field label="Expiry Date"><input data-tour="org-doc-expiry" type="date" style={inputStyle} value={meta.expiry_date} onChange={(e) => setMeta((m) => ({ ...m, expiry_date: e.target.value }))} /></Field>
        <Field label="Issuing Authority"><input style={inputStyle} value={meta.issuing_authority} onChange={(e) => setMeta((m) => ({ ...m, issuing_authority: e.target.value }))} /></Field>
        <Field label="Confidentiality">
          <select data-tour="org-doc-confidentiality" style={inputStyle} value={meta.confidentiality} onChange={(e) => setMeta((m) => ({ ...m, confidentiality: e.target.value }))}>
            {CONFIDENTIALITY_LEVELS.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </Field>
        <Field label="Tags (comma separated)"><input style={inputStyle} value={meta.tags} onChange={(e) => setMeta((m) => ({ ...m, tags: e.target.value }))} /></Field>
        <div style={{ gridColumn: '1 / -1' }}>
          <Field label="Description"><input style={inputStyle} value={meta.description} onChange={(e) => setMeta((m) => ({ ...m, description: e.target.value }))} /></Field>
        </div>
        <div style={{ gridColumn: '1 / -1' }}>
          <Field label="Remarks"><input style={inputStyle} value={meta.remarks} onChange={(e) => setMeta((m) => ({ ...m, remarks: e.target.value }))} /></Field>
        </div>
        <div style={{ gridColumn: '1 / -1', display: 'flex', justifyContent: 'flex-end' }}>
          <button type="submit" data-tour="org-doc-save" disabled={saving} style={{ ...primaryBtnStyle, opacity: saving ? 0.6 : 1 }}>{saving ? 'Uploading…' : 'Save Document'}</button>
        </div>
      </form>

      {documents.length === 0 ? (
        <p style={{ fontSize: 13, color: TEXT.muted }}>No documents uploaded yet.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }} data-tour="org-doc-list">
          {documents.map((d) => (
            <div key={d.id} style={cardRowStyle}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 13.5, fontWeight: 600, color: TEXT.heading }}>{d.document_name}</span>
                    <span style={{ fontSize: 10.5, fontWeight: 600, padding: '2px 8px', borderRadius: 9999, background: 'rgba(244,113,59,0.1)', color: BRAND.primary }}>{d.document_type}</span>
                    {d.confidentiality && <span style={{ fontSize: 10.5, fontWeight: 600, padding: '2px 8px', borderRadius: 9999, background: 'rgba(0,0,0,0.05)', color: TEXT.secondary }}>{d.confidentiality}</span>}
                  </div>
                  <p style={{ fontSize: 12.5, color: TEXT.secondary, margin: 0 }}>
                    {d.filename}{d.expiry_date ? ` · Expires ${d.expiry_date}` : ''}{d.issuing_authority ? ` · ${d.issuing_authority}` : ''}
                  </p>
                </div>
                <div style={{ display: 'flex', gap: 10, flexShrink: 0 }}>
                  {d.sharepoint_url && <a href={d.sharepoint_url} target="_blank" rel="noreferrer" style={linkBtnStyle}>Open</a>}
                  <button type="button" style={dangerLinkStyle} onClick={() => setDeleteTarget(d)}>Delete</button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
