'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useRequireAdmin } from '@/hooks/useAuth'
import { organizationApi } from '@/lib/api'
import { Company, CompanyAddress, CompanyContact, CompanyFinancialYear, CompanyDocument } from '@/types'
import { TEXT, GLASS, SHADOWS, BRAND, BORDER } from '@/lib/theme'
import OrganizationNav from '@/components/organization/OrganizationNav'
import MessageDialog from '@/components/erp/MessageDialog'

const sectionStyle: React.CSSProperties = {
  borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur,
  border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), padding: 20, marginBottom: 20,
}
const labelStyle: React.CSSProperties = { fontSize: 11, fontWeight: 700, color: TEXT.muted, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }
const valueStyle: React.CSSProperties = { fontSize: 14, color: TEXT.body, marginBottom: 16 }
const cardRowStyle: React.CSSProperties = {
  display: 'flex', flexDirection: 'column', gap: 8, padding: '14px 16px', borderRadius: 12,
  background: 'rgba(255,255,255,.5)', border: `1px solid ${BORDER.normal}`,
}
const linkBtnStyle: React.CSSProperties = { fontSize: 11.5, fontWeight: 600, color: BRAND.primaryActive, cursor: 'pointer', background: 'none', border: 'none', padding: 0 }

const TABS = ['Basic', 'Address', 'Legal & Registration', 'Tax Configuration', 'Contacts', 'Financial Year', 'Branding', 'Documents', 'Defaults & Controls'] as const

const TAB_TOUR_IDS: Record<typeof TABS[number], string> = {
  'Basic': 'org-info-tab-basic',
  'Address': 'org-info-tab-address',
  'Legal & Registration': 'org-info-tab-legal',
  'Tax Configuration': 'org-info-tab-tax',
  'Contacts': 'org-info-tab-contacts',
  'Financial Year': 'org-info-tab-fy',
  'Branding': 'org-info-tab-branding',
  'Documents': 'org-info-tab-documents',
  'Defaults & Controls': 'org-info-tab-defaults',
}

export default function OrganizationInfoPage() {
  const { isAuthorized, isLoading } = useRequireAdmin()
  const router = useRouter()
  const [company, setCompany] = useState<Company | null>(null)
  const [addresses, setAddresses] = useState<CompanyAddress[]>([])
  const [contacts, setContacts] = useState<CompanyContact[]>([])
  const [financialYears, setFinancialYears] = useState<CompanyFinancialYear[]>([])
  const [documents, setDocuments] = useState<CompanyDocument[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [tab, setTab] = useState<typeof TABS[number]>('Basic')

  useEffect(() => {
    if (isAuthorized) {
      setLoading(true)
      setError('')
      Promise.all([
        organizationApi.getCompanyInfo(),
        organizationApi.listCompanyAddresses(),
        organizationApi.listCompanyContacts(),
        organizationApi.listCompanyFinancialYears(),
        organizationApi.listCompanyDocuments(),
      ])
        .then(([c, a, ct, fy, d]) => {
          setCompany(c); setAddresses(a); setContacts(ct); setFinancialYears(fy); setDocuments(d)
        })
        .catch(() => setError('Failed to load company info.'))
        .finally(() => setLoading(false))
    }
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
        {company && (
          <button
            data-tour="org-info-edit-btn"
            onClick={() => router.push('/dashboard/organization/info/edit')}
            style={{
              padding: '10px 20px', borderRadius: 10, border: 'none',
              background: `linear-gradient(140deg,${BRAND.primary},${BRAND.primaryHover})`,
              color: '#fff', fontSize: 13.5, fontWeight: 700, cursor: 'pointer',
              boxShadow: `0 4px 14px ${BRAND.primaryGlow}`,
            }}
          >
            Edit
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
      ) : !company ? null : (
        <>
          <div style={{ display: 'flex', gap: 8, marginBottom: 20, borderBottom: `1px solid ${BORDER.normal}`, flexWrap: 'wrap' }}>
            {TABS.map((t) => (
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

          {tab === 'Basic' && (
            <div style={sectionStyle} data-tour="org-info-basic-panel">
              <h2 style={{ fontSize: 12, fontWeight: 700, color: TEXT.muted, textTransform: 'uppercase', marginBottom: 12 }}>Basic Information</h2>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
                <div><div style={labelStyle}>Company Name</div><div style={valueStyle}>{company.name}</div></div>
                <div><div style={labelStyle}>Legal Name</div><div style={valueStyle}>{company.legal_name || '—'}</div></div>
                <div><div style={labelStyle}>Short Name</div><div style={valueStyle}>{company.short_name || '—'}</div></div>
                <div><div style={labelStyle}>Code</div><div style={valueStyle}>{company.code}</div></div>
                <div><div style={labelStyle}>Company Type</div><div style={valueStyle}>{company.company_type || '—'}</div></div>
                <div><div style={labelStyle}>Industry</div><div style={valueStyle}>{company.industry || '—'}</div></div>
                <div><div style={labelStyle}>Business Nature</div><div style={valueStyle}>{company.business_nature || '—'}</div></div>
                <div><div style={labelStyle}>Website</div><div style={valueStyle}>{company.website || '—'}</div></div>
                <div style={{ gridColumn: '1 / -1' }}><div style={labelStyle}>Description</div><div style={valueStyle}>{company.description || '—'}</div></div>
                <div><div style={labelStyle}>Date of Incorporation</div><div style={valueStyle}>{company.date_of_incorporation || '—'}</div></div>
                <div><div style={labelStyle}>Country</div><div style={valueStyle}>{company.country || '—'}</div></div>
                <div><div style={labelStyle}>Default Currency</div><div style={valueStyle}>{company.currency || '—'}</div></div>
                <div><div style={labelStyle}>Default Language</div><div style={valueStyle}>{company.default_language || '—'}</div></div>
                <div><div style={labelStyle}>Time Zone</div><div style={valueStyle}>{company.timezone || '—'}</div></div>
              </div>
            </div>
          )}

          {tab === 'Address' && (
            <div style={sectionStyle} data-tour="org-info-address-panel">
              <h2 style={{ fontSize: 12, fontWeight: 700, color: TEXT.muted, textTransform: 'uppercase', marginBottom: 12 }}>Addresses</h2>
              {addresses.length === 0 ? (
                <p style={{ fontSize: 13, color: TEXT.muted }}>No addresses added yet.</p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {addresses.map((a) => (
                    <div key={a.id} style={cardRowStyle}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, flexWrap: 'wrap' }}>
                        <span style={{ fontSize: 13.5, fontWeight: 600, color: TEXT.heading }}>{a.address_type || 'Address'}</span>
                        {a.is_primary && <span style={{ fontSize: 10.5, fontWeight: 700, padding: '2px 8px', borderRadius: 9999, background: 'rgba(16,185,129,0.12)', color: '#047857' }}>PRIMARY</span>}
                        {!a.is_active && <span style={{ fontSize: 10.5, fontWeight: 700, padding: '2px 8px', borderRadius: 9999, background: 'rgba(220,38,38,0.1)', color: '#b91c1c' }}>INACTIVE</span>}
                      </div>
                      <p style={{ fontSize: 12.5, color: TEXT.secondary, margin: 0 }}>
                        {[a.address_line1, a.address_line2, a.landmark, a.city, a.district, a.state, a.country, a.pincode].filter(Boolean).join(', ')}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {tab === 'Legal & Registration' && (
            <div style={sectionStyle} data-tour="org-info-legal-panel">
              <h2 style={{ fontSize: 12, fontWeight: 700, color: TEXT.muted, textTransform: 'uppercase', marginBottom: 12 }}>Legal & Registration</h2>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
                <div><div style={labelStyle}>Legal Entity Type</div><div style={valueStyle}>{company.legal_entity_type || '—'}</div></div>
                <div><div style={labelStyle}>Legal Status</div><div style={valueStyle}>{company.legal_status || '—'}</div></div>
                <div><div style={labelStyle}>CIN</div><div style={valueStyle}>{company.cin || '—'}</div></div>
                <div><div style={labelStyle}>PAN</div><div style={valueStyle}>{company.pan || '—'}</div></div>
                <div><div style={labelStyle}>TAN</div><div style={valueStyle}>{company.tan || '—'}</div></div>
                <div><div style={labelStyle}>GSTIN</div><div style={valueStyle}>{company.gstin || '—'}</div></div>
                <div><div style={labelStyle}>Udyam Registration No.</div><div style={valueStyle}>{company.udyam_registration_no || '—'}</div></div>
                <div><div style={labelStyle}>IEC</div><div style={valueStyle}>{company.iec || '—'}</div></div>
                <div><div style={labelStyle}>MSME Registration No.</div><div style={valueStyle}>{company.msme_registration_no || '—'}</div></div>
                <div><div style={labelStyle}>PF Registration No.</div><div style={valueStyle}>{company.pf_registration_no || '—'}</div></div>
                <div><div style={labelStyle}>ESIC Registration No.</div><div style={valueStyle}>{company.esic_registration_no || '—'}</div></div>
                <div><div style={labelStyle}>Other Registration Type</div><div style={valueStyle}>{company.other_registration_type || '—'}</div></div>
                <div><div style={labelStyle}>Registration Number</div><div style={valueStyle}>{company.other_registration_number || '—'}</div></div>
                <div><div style={labelStyle}>Registration Date</div><div style={valueStyle}>{company.other_registration_date || '—'}</div></div>
                <div><div style={labelStyle}>Issuing Authority</div><div style={valueStyle}>{company.issuing_authority || '—'}</div></div>
                <div><div style={labelStyle}>Expiry Date</div><div style={valueStyle}>{company.expiry_date || '—'}</div></div>
                <div><div style={labelStyle}>Authorized Capital</div><div style={valueStyle}>{company.authorized_capital != null ? company.authorized_capital.toLocaleString() : '—'}</div></div>
                <div><div style={labelStyle}>Paid-up Capital</div><div style={valueStyle}>{company.paid_up_capital != null ? company.paid_up_capital.toLocaleString() : '—'}</div></div>
                <div><div style={labelStyle}>Legal Representative</div><div style={valueStyle}>{company.legal_representative || '—'}</div></div>
              </div>
            </div>
          )}

          {tab === 'Tax Configuration' && (
            <div style={sectionStyle} data-tour="org-info-tax-panel">
              <h2 style={{ fontSize: 12, fontWeight: 700, color: TEXT.muted, textTransform: 'uppercase', marginBottom: 12 }}>Tax Configuration</h2>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
                <div><div style={labelStyle}>GST Registration Type</div><div style={valueStyle}>{company.gst_registration_type || '—'}</div></div>
                <div><div style={labelStyle}>TDS Applicable</div><div style={valueStyle}>{company.tds_applicable ? 'Yes' : 'No'}</div></div>
                <div><div style={labelStyle}>TCS Applicable</div><div style={valueStyle}>{company.tcs_applicable ? 'Yes' : 'No'}</div></div>
                <div><div style={labelStyle}>Default Tax Region</div><div style={valueStyle}>{company.default_tax_region || '—'}</div></div>
                <div><div style={labelStyle}>Tax Deductibility</div><div style={valueStyle}>{company.tax_deductibility || '—'}</div></div>
                <div><div style={labelStyle}>Tax Registration Status</div><div style={valueStyle}>{company.tax_registration_status || '—'}</div></div>
                <div><div style={labelStyle}>Tax Effective Date</div><div style={valueStyle}>{company.tax_effective_date || '—'}</div></div>
              </div>
            </div>
          )}

          {tab === 'Contacts' && (
            <div style={sectionStyle} data-tour="org-info-contacts-panel">
              <h2 style={{ fontSize: 12, fontWeight: 700, color: TEXT.muted, textTransform: 'uppercase', marginBottom: 12 }}>Contacts</h2>
              {contacts.length === 0 ? (
                <p style={{ fontSize: 13, color: TEXT.muted }}>No contacts added yet.</p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {contacts.map((c) => (
                    <div key={c.id} style={cardRowStyle}>
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
                  ))}
                </div>
              )}
            </div>
          )}

          {tab === 'Financial Year' && (
            <div style={sectionStyle} data-tour="org-info-fy-panel">
              <h2 style={{ fontSize: 12, fontWeight: 700, color: TEXT.muted, textTransform: 'uppercase', marginBottom: 12 }}>Financial Years</h2>
              {financialYears.length === 0 ? (
                <p style={{ fontSize: 13, color: TEXT.muted }}>No financial years added yet.</p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {financialYears.map((fy) => (
                    <div key={fy.id} style={cardRowStyle}>
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
                  ))}
                </div>
              )}
            </div>
          )}

          {tab === 'Branding' && (
            <div style={sectionStyle} data-tour="org-info-branding-panel">
              <h2 style={{ fontSize: 12, fontWeight: 700, color: TEXT.muted, textTransform: 'uppercase', marginBottom: 12 }}>Branding</h2>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
                <div><div style={labelStyle}>Company Logo</div><div style={valueStyle}>{company.logo_url || '—'}</div></div>
                <div>
                  <div style={labelStyle}>Primary Brand Color</div>
                  <div style={{ ...valueStyle, display: 'flex', alignItems: 'center', gap: 8 }}>
                    {company.primary_brand_color && <span style={{ width: 16, height: 16, borderRadius: 4, background: company.primary_brand_color, border: `1px solid ${BORDER.normal}` }} />}
                    {company.primary_brand_color || '—'}
                  </div>
                </div>
                <div>
                  <div style={labelStyle}>Secondary Brand Color</div>
                  <div style={{ ...valueStyle, display: 'flex', alignItems: 'center', gap: 8 }}>
                    {company.secondary_brand_color && <span style={{ width: 16, height: 16, borderRadius: 4, background: company.secondary_brand_color, border: `1px solid ${BORDER.normal}` }} />}
                    {company.secondary_brand_color || '—'}
                  </div>
                </div>
                <div>
                  <div style={labelStyle}>Accent Color</div>
                  <div style={{ ...valueStyle, display: 'flex', alignItems: 'center', gap: 8 }}>
                    {company.accent_color && <span style={{ width: 16, height: 16, borderRadius: 4, background: company.accent_color, border: `1px solid ${BORDER.normal}` }} />}
                    {company.accent_color || '—'}
                  </div>
                </div>
                <div style={{ gridColumn: '1 / -1' }}><div style={labelStyle}>Company Header</div><div style={{ ...valueStyle, whiteSpace: 'pre-wrap' }}>{company.company_header || '—'}</div></div>
                <div style={{ gridColumn: '1 / -1' }}><div style={labelStyle}>Company Footer</div><div style={{ ...valueStyle, whiteSpace: 'pre-wrap' }}>{company.company_footer || '—'}</div></div>
                <div><div style={labelStyle}>Watermark</div><div style={valueStyle}>{company.watermark || '—'}</div></div>
                <div style={{ gridColumn: '1 / -1' }}><div style={labelStyle}>Email Signature</div><div style={{ ...valueStyle, whiteSpace: 'pre-wrap' }}>{company.email_signature || '—'}</div></div>
              </div>
            </div>
          )}

          {tab === 'Documents' && (
            <div style={sectionStyle} data-tour="org-info-documents-panel">
              <h2 style={{ fontSize: 12, fontWeight: 700, color: TEXT.muted, textTransform: 'uppercase', marginBottom: 12 }}>Company Documents</h2>
              {documents.length === 0 ? (
                <p style={{ fontSize: 13, color: TEXT.muted }}>No documents uploaded yet.</p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
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
                        {d.sharepoint_url && <a href={d.sharepoint_url} target="_blank" rel="noreferrer" style={linkBtnStyle}>Open</a>}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {tab === 'Defaults & Controls' && (
            <div style={sectionStyle} data-tour="org-info-defaults-panel">
              <h2 style={{ fontSize: 12, fontWeight: 700, color: TEXT.muted, textTransform: 'uppercase', marginBottom: 12 }}>Company Defaults & Controls</h2>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
                <div><div style={labelStyle}>Default Tax</div><div style={valueStyle}>{company.default_tax || '—'}</div></div>
                <div><div style={labelStyle}>Default Plant</div><div style={valueStyle}>{company.default_plant_id ? `#${company.default_plant_id}` : '—'}</div></div>
                <div><div style={labelStyle}>Default Warehouse</div><div style={valueStyle}>{company.default_warehouse_id ? `#${company.default_warehouse_id}` : '—'}</div></div>
                <div><div style={labelStyle}>Default Cost Center</div><div style={valueStyle}>{company.default_cost_center || '—'}</div></div>
                <div><div style={labelStyle}>Default Profit Center</div><div style={valueStyle}>{company.default_profit_center || '—'}</div></div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
