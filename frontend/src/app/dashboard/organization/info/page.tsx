'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useRequireOrgTab } from '@/app/dashboard/organization/_lib/useRequireOrgTab'
import { organizationApi, storeApi } from '@/lib/api'
import { useCan } from '@/lib/permissions'
import { extractErrorMessages } from '@/lib/validation'
import { Company, CompanyAddress, CompanyContact, CompanyFinancialYear, CompanyDocument } from '@/types'
import { TEXT, GLASS, SHADOWS, BRAND, BORDER } from '@/lib/theme'
import OrganizationNav from '@/components/organization/OrganizationNav'
import MessageDialog from '@/components/erp/MessageDialog'
import CompanyPartnersPanel from '@/components/organization/CompanyPartnersPanel'
import OrgListItem, { orgEmptyStyle } from '@/components/organization/OrgListItem'
import { primaryBtnStyle, Pill, DetailCard, DetailSummary, DetailGroup, DetailRow } from '@/components/shared/ui'
import { formatDate } from '@/lib/format'

const sectionStyle: React.CSSProperties = {
  borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur,
  border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), padding: 20, marginBottom: 20,
}
const linkBtnStyle: React.CSSProperties = { fontSize: 11.5, fontWeight: 600, color: BRAND.primaryActive, cursor: 'pointer', background: 'none', border: 'none', padding: 0 }

const emptyStyle = orgEmptyStyle
const ListItem = OrgListItem

function Swatch({ hex }: { hex: string }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
      <span style={{ width: 16, height: 16, borderRadius: 4, background: hex, border: `1px solid ${BORDER.normal}` }} />{hex}
    </span>
  )
}

const TABS = ['Basic', 'Address', 'Legal & Registration', 'Tax Configuration', 'Partners', 'Contacts', 'Financial Year', 'Branding', 'Documents', 'Defaults & Controls'] as const

const TAB_TOUR_IDS: Record<typeof TABS[number], string> = {
  'Basic': 'org-info-tab-basic',
  'Address': 'org-info-tab-address',
  'Legal & Registration': 'org-info-tab-legal',
  'Tax Configuration': 'org-info-tab-tax',
  'Partners': 'org-info-tab-partners',
  'Contacts': 'org-info-tab-contacts',
  'Financial Year': 'org-info-tab-fy',
  'Branding': 'org-info-tab-branding',
  'Documents': 'org-info-tab-documents',
  'Defaults & Controls': 'org-info-tab-defaults',
}

export default function OrganizationInfoPage() {
  const { isAuthorized, isLoading } = useRequireOrgTab('info')
  const { can, canFeature } = useCan()
  const router = useRouter()
  // Company Info features (core/features/organization.py).
  const seeStatutory = canFeature('organization', 'info', 'statutory', 'view')
  const seeFy = canFeature('organization', 'info', 'financial_years', 'view')
  const seeDocs = canFeature('organization', 'info', 'documents', 'view')
  const seeTab = (t: typeof TABS[number]) => (t === 'Legal & Registration' || t === 'Tax Configuration' ? seeStatutory
    : t === 'Partners' ? canFeature('organization', 'info', 'partners', 'view')
      : t === 'Financial Year' ? seeFy : t === 'Documents' ? seeDocs : true)
  const [company, setCompany] = useState<Company | null>(null)
  const [addresses, setAddresses] = useState<CompanyAddress[]>([])
  const [contacts, setContacts] = useState<CompanyContact[]>([])
  const [financialYears, setFinancialYears] = useState<CompanyFinancialYear[]>([])
  const [documents, setDocuments] = useState<CompanyDocument[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notSetUp, setNotSetUp] = useState(false)
  const [tab, setTab] = useState<typeof TABS[number]>('Basic')
  // Names for the default plant / store (read-only lookup; falls back to the number).
  const [plantNames, setPlantNames] = useState<Record<number, string>>({})
  const [storeNames, setStoreNames] = useState<Record<number, string>>({})
  const canEdit = can('organization', 'info', 'edit')
  const currentFy = financialYears.find((f) => f.status === 'open')

  useEffect(() => {
    if (!company) return
    if (company.default_plant_id) {
      organizationApi.listBranches()
        .then((list) => setPlantNames(Object.fromEntries(list.map((b: { id: number; name: string }) => [b.id, b.name]))))
        .catch(() => undefined)
    }
    if (company.default_warehouse_id) {
      storeApi.listLocations()
        .then((list) => setStoreNames(Object.fromEntries(list.map((l: { id: number; name: string }) => [l.id, l.name]))))
        .catch(() => undefined)
    }
  }, [company])

  useEffect(() => {
    if (isAuthorized) {
      setLoading(true)
      setError('')
      setNotSetUp(false)
      organizationApi.getCompanyInfo()
        .then((c) =>
          Promise.all([
            organizationApi.listCompanyAddresses(),
            organizationApi.listCompanyContacts(),
            seeFy ? organizationApi.listCompanyFinancialYears() : Promise.resolve([]),
            seeDocs ? organizationApi.listCompanyDocuments() : Promise.resolve([]),
          ]).then(([a, ct, fy, d]) => {
            setCompany(c); setAddresses(a); setContacts(ct); setFinancialYears(fy); setDocuments(d)
          })
        )
        .catch((err: unknown) => {
          const status = (err as { response?: { status?: number } })?.response?.status
          if (status === 404) {
            setNotSetUp(true)
          } else {
            setError(extractErrorMessages(err, 'Could not load company info. Reload the page; if it keeps failing, the server may be down — contact IT.').join(' '))
          }
        })
        .finally(() => setLoading(false))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthorized])

  if (isLoading || !isAuthorized) return null

  return (
    <div>
      <OrganizationNav />

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
        <div>
          <p style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 4px' }}>
            Organization
          </p>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: TEXT.heading, margin: '0 0 8px' }}>Info</h1>
        </div>
        {(company || notSetUp) && can('organization', 'info', 'edit') && (
          <button
            data-tour="org-info-edit-btn"
            onClick={() => router.push('/dashboard/organization/info/edit')}
            style={primaryBtnStyle}
          >
            {notSetUp ? 'Set Up Company Info' : 'Edit'}
          </button>
        )}
      </div>
      <p style={{ fontSize: 12.5, color: TEXT.muted, margin: '0 0 20px' }}>
        Master information about this organization — used on letterheads, invoices, and other generated documents.
      </p>

      <MessageDialog
        open={!!error}
        variant="error"
        title="Company Info Error"
        message={error}
        onClose={() => setError('')}
        actionLabel="Reload"
        onAction={() => window.location.reload()}
      />

      {loading ? (
        <div style={{ textAlign: 'center', padding: '40px 20px', color: TEXT.muted, fontSize: 13 }}>Loading…</div>
      ) : notSetUp ? (
        <div style={{ ...sectionStyle, textAlign: 'center', padding: '40px 20px' }}>
          <p style={{ fontSize: 13.5, color: TEXT.body, margin: '0 0 4px', fontWeight: 600 }}>Company info hasn&apos;t been set up yet</p>
          <p style={{ fontSize: 12.5, color: TEXT.muted, margin: 0 }}>Click &quot;Set Up Company Info&quot; above to add your organization&apos;s name, address, and other master details.</p>
        </div>
      ) : !company ? null : (
        <DetailCard>
          <DetailSummary
            title={company.name}
            text={company.description || (company.legal_name && company.legal_name !== company.name ? `Registered as ${company.legal_name}.` : undefined)}
            meta={<>
              <span>Code {company.code}</span>
              {company.gstin && seeStatutory && <><span>·</span><span>GSTIN {company.gstin}</span></>}
              {company.country && <><span>·</span><span>{company.country}</span></>}
              {currentFy && <><span>·</span><Pill label={`${currentFy.name} open`} hex="#047857" /></>}
            </>}
          />

          <div style={{ display: 'flex', gap: 8, margin: '4px 0', borderBottom: `1px solid ${BORDER.normal}`, flexWrap: 'wrap' }}>
            {TABS.filter(seeTab).map((t) => (
              <button
                key={t}
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

          {(tab === 'Basic' || !seeTab(tab)) && (
            <div data-tour="org-info-basic-panel">
              <DetailGroup title="Basic information">
                <DetailRow label="Company name">{company.name}</DetailRow>
                <DetailRow label="Legal name">{company.legal_name}</DetailRow>
                <DetailRow label="Short name">{company.short_name}</DetailRow>
                <DetailRow label="Code">{company.code}</DetailRow>
                <DetailRow label="Company type">{company.company_type}</DetailRow>
                <DetailRow label="Industry">{company.industry}</DetailRow>
                <DetailRow label="Business nature">{company.business_nature}</DetailRow>
                <DetailRow label="Website">{company.website}</DetailRow>
                <DetailRow label="Date of incorporation">{company.date_of_incorporation ? formatDate(company.date_of_incorporation) : null}</DetailRow>
              </DetailGroup>
              <DetailGroup title="Locale" last>
                <DetailRow label="Country">{company.country}</DetailRow>
                <DetailRow label="Default currency">{company.currency}</DetailRow>
                <DetailRow label="Default language">{company.default_language}</DetailRow>
                <DetailRow label="Time zone">{company.timezone}</DetailRow>
              </DetailGroup>
            </div>
          )}

          {tab === 'Address' && (
            <div data-tour="org-info-address-panel" style={{ paddingTop: 8 }}>
              {addresses.length === 0 ? (
                <p style={emptyStyle}>No addresses added yet{canEdit ? ' — use Edit › Address to add the registered office and plant addresses.' : '.'}</p>
              ) : addresses.map((a, i) => (
                <ListItem key={a.id} last={i === addresses.length - 1}
                  title={a.address_type || 'Address'}
                  tags={<>{a.is_primary && <Pill label="Primary" hex="#047857" />}{!a.is_active && <Pill label="Inactive" hex="#b91c1c" />}</>}
                  body={[a.address_line1, a.address_line2, a.landmark, a.city, a.district, a.state, a.country, a.pincode].filter(Boolean).join(', ')} />
              ))}
            </div>
          )}

          {tab === 'Legal & Registration' && seeStatutory && (
            <div data-tour="org-info-legal-panel">
              <DetailGroup title="Legal entity">
                <DetailRow label="Legal entity type">{company.legal_entity_type}</DetailRow>
                <DetailRow label="Legal status">{company.legal_status}</DetailRow>
              </DetailGroup>
              <DetailGroup title="Registration numbers">
                <DetailRow label="CIN">{company.cin}</DetailRow>
                <DetailRow label="PAN">{company.pan}</DetailRow>
                <DetailRow label="TAN">{company.tan}</DetailRow>
                <DetailRow label="GSTIN">{company.gstin}</DetailRow>
                <DetailRow label="Udyam registration no.">{company.udyam_registration_no}</DetailRow>
                <DetailRow label="IEC">{company.iec}</DetailRow>
                <DetailRow label="MSME registration no.">{company.msme_registration_no}</DetailRow>
                <DetailRow label="PF registration no.">{company.pf_registration_no}</DetailRow>
                <DetailRow label="ESIC registration no.">{company.esic_registration_no}</DetailRow>
              </DetailGroup>
              <DetailGroup title="Other registration">
                <DetailRow label="Registration type">{company.other_registration_type}</DetailRow>
                <DetailRow label="Registration number">{company.other_registration_number}</DetailRow>
                <DetailRow label="Registration date">{company.other_registration_date ? formatDate(company.other_registration_date) : null}</DetailRow>
                <DetailRow label="Issuing authority">{company.issuing_authority}</DetailRow>
                <DetailRow label="Expiry date">{company.expiry_date ? formatDate(company.expiry_date) : null}</DetailRow>
              </DetailGroup>
              <DetailGroup title="Representative & capital" last>
                <DetailRow label="Legal representative">{company.legal_representative}</DetailRow>
                <DetailRow label="Authorized capital">{company.authorized_capital != null ? `₹ ${company.authorized_capital.toLocaleString('en-IN')}` : null}</DetailRow>
                <DetailRow label="Paid-up capital">{company.paid_up_capital != null ? `₹ ${company.paid_up_capital.toLocaleString('en-IN')}` : null}</DetailRow>
              </DetailGroup>
            </div>
          )}

          {tab === 'Tax Configuration' && seeStatutory && (
            <div data-tour="org-info-tax-panel">
              <DetailGroup title="GST">
                <DetailRow label="GST registration type">{company.gst_registration_type}</DetailRow>
                <DetailRow label="Tax registration status">{company.tax_registration_status}</DetailRow>
                <DetailRow label="Tax effective date">{company.tax_effective_date ? formatDate(company.tax_effective_date) : null}</DetailRow>
                <DetailRow label="Default tax region">{company.default_tax_region}</DetailRow>
                <DetailRow label="Tax deductibility">{company.tax_deductibility}</DetailRow>
              </DetailGroup>
              <DetailGroup title="Deducted / collected at source" last>
                <DetailRow label="TDS applicable">{company.tds_applicable ? 'Yes' : 'No'}</DetailRow>
                <DetailRow label="TCS applicable">{company.tcs_applicable ? 'Yes' : 'No'}</DetailRow>
              </DetailGroup>
            </div>
          )}

          {tab === 'Partners' && seeTab('Partners') && <CompanyPartnersPanel sectionStyle={{ paddingTop: 14 }} />}

          {tab === 'Contacts' && (
            <div data-tour="org-info-contacts-panel" style={{ paddingTop: 8 }}>
              {contacts.length === 0 ? (
                <p style={emptyStyle}>No contacts added yet{canEdit ? ' — use Edit › Contacts to add the people customers and vendors should reach.' : '.'}</p>
              ) : contacts.map((c, i) => (
                <ListItem key={c.id} last={i === contacts.length - 1}
                  title={c.contact_person}
                  sub={[c.designation, c.department].filter(Boolean).join(', ')}
                  tags={<>{c.is_primary && <Pill label="Primary" hex="#047857" />}{!c.is_active && <Pill label="Inactive" hex="#b91c1c" />}</>}
                  body={[c.mobile, c.phone, c.email, c.alternate_email].filter(Boolean).join(' · ') || '—'} />
              ))}
            </div>
          )}

          {tab === 'Financial Year' && seeFy && (
            <div data-tour="org-info-fy-panel" style={{ paddingTop: 8 }}>
              {financialYears.length === 0 ? (
                <p style={emptyStyle}>No financial years added yet{canEdit ? ' — use Edit › Financial Year to add the current year (e.g. FY 2026-27).' : '.'}</p>
              ) : financialYears.map((fy, i) => (
                <ListItem key={fy.id} last={i === financialYears.length - 1}
                  title={fy.name}
                  sub={fy.fiscal_year_code || undefined}
                  tags={<Pill label={fy.status ? fy.status.charAt(0).toUpperCase() + fy.status.slice(1) : '—'} hex={fy.status === 'open' ? '#047857' : '#b91c1c'} />}
                  body={`${formatDate(fy.start_date)} → ${formatDate(fy.end_date)}${fy.lock_date ? ` · Locked up to ${formatDate(fy.lock_date)}` : ''}`} />
              ))}
            </div>
          )}

          {tab === 'Branding' && (
            <div data-tour="org-info-branding-panel">
              <DetailGroup title="Logo & colours">
                <DetailRow label="Company logo">{company.logo_url}</DetailRow>
                <DetailRow label="Primary brand colour">{company.primary_brand_color && <Swatch hex={company.primary_brand_color} />}</DetailRow>
                <DetailRow label="Secondary brand colour">{company.secondary_brand_color && <Swatch hex={company.secondary_brand_color} />}</DetailRow>
                <DetailRow label="Accent colour">{company.accent_color && <Swatch hex={company.accent_color} />}</DetailRow>
              </DetailGroup>
              <DetailGroup title="Documents & email" last>
                <DetailRow label="Company header">{company.company_header}</DetailRow>
                <DetailRow label="Company footer">{company.company_footer}</DetailRow>
                <DetailRow label="Watermark">{company.watermark}</DetailRow>
                <DetailRow label="Email signature">{company.email_signature}</DetailRow>
              </DetailGroup>
            </div>
          )}

          {tab === 'Documents' && seeDocs && (
            <div data-tour="org-info-documents-panel" style={{ paddingTop: 8 }}>
              {documents.length === 0 ? (
                <p style={emptyStyle}>No documents uploaded yet{canEdit ? ' — use Edit › Documents to upload registration certificates and licences.' : '.'}</p>
              ) : documents.map((d, i) => (
                <ListItem key={d.id} last={i === documents.length - 1}
                  title={d.document_name}
                  sub={d.document_type}
                  tags={d.confidentiality ? <Pill label={d.confidentiality} hex="#64748b" /> : null}
                  body={[d.filename, d.expiry_date ? `Expires ${formatDate(d.expiry_date)}` : '', d.issuing_authority || ''].filter(Boolean).join(' · ')}
                  action={d.sharepoint_url && canFeature('organization', 'info', 'documents', 'export') ? <a href={d.sharepoint_url} target="_blank" rel="noreferrer" style={linkBtnStyle}>Open</a> : null} />
              ))}
            </div>
          )}

          {tab === 'Defaults & Controls' && (
            <div data-tour="org-info-defaults-panel">
              <DetailGroup title="Used when a form leaves these blank" last>
                <DetailRow label="Default tax">{company.default_tax}</DetailRow>
                <DetailRow label="Default plant">{company.default_plant_id ? (plantNames[company.default_plant_id] || `Plant #${company.default_plant_id}`) : null}</DetailRow>
                <DetailRow label="Default store">{company.default_warehouse_id ? (storeNames[company.default_warehouse_id] || `Store #${company.default_warehouse_id}`) : null}</DetailRow>
                <DetailRow label="Default cost center">{company.default_cost_center}</DetailRow>
                <DetailRow label="Default profit center">{company.default_profit_center}</DetailRow>
              </DetailGroup>
            </div>
          )}
        </DetailCard>
      )}
    </div>
  )
}
