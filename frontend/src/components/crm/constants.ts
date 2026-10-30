import { PRIORITY_OPTIONS, normalizePriority } from '@/lib/priority'

export const RAILWAY_ZONES = [
  'Northern Railway', 'Southern Railway', 'Eastern Railway', 'Western Railway', 'Central Railway',
  'South Eastern Railway', 'North Eastern Railway', 'Northeast Frontier Railway', 'South Central Railway',
  'East Central Railway', 'East Coast Railway', 'West Central Railway', 'North Central Railway',
  'North Western Railway', 'South Western Railway', 'Metro Railway Kolkata', 'Not Applicable', 'Other',
]

/** Contact person designations; "Other" opens a free-text box. */
export const CONTACT_DESIGNATIONS = [
  'Owner / Proprietor', 'Founder / Co-Founder', 'Chairman', 'Managing Director (MD)', 'Chief Executive Officer (CEO)',
  'Director', 'General Manager (GM)', 'Deputy General Manager (DGM)', 'Assistant General Manager (AGM)', 'Plant Head',
  'Factory Manager', 'Operations Manager', 'Production Manager', 'Purchase Head', 'Purchase Manager',
  'Procurement Executive', 'Project Manager', 'Design Head', 'Design Engineer', 'R&D Manager',
  'Technical Manager', 'Maintenance Manager', 'Quality Manager', 'Quality Engineer', 'Electrical Engineer',
  'Mechanical Engineer', 'Service Manager', 'Sales Manager', 'Business Development Manager', 'Finance Manager',
  'Accounts Manager', 'HR Manager', 'Store Manager', 'Supervisor', 'Executive',
  'Assistant', 'Consultant', 'Other',
]

/** Contact person departments; "Other" opens a free-text box. */
export const CONTACT_DEPARTMENTS = [
  'Sales', 'Marketing', 'Business Development', 'Purchase / Procurement', 'Design & Engineering',
  'Research & Development (R&D)', 'Production / Manufacturing', 'Project Management', 'Operations',
  'Quality Assurance / Quality Control', 'Service & Commissioning', 'Maintenance', 'Accounts & Finance',
  'Administration', 'Human Resources (HR)', 'Technical Support', 'Customer Service',
  'Supply Chain & Logistics', 'Export & Import', 'Other',
]

export const ACTIVITY_TYPES = ['Call', 'Email', 'Meet at Client/Site Office', 'Meet at Own Office']

export const FOLLOW_UP_STATUSES = ['Open', 'Closed', 'Hold']

export const RELATED_MODULES = [
  { value: '', label: '— None —' },
  { value: 'inquiry', label: 'Inquiry' },
  { value: 'tender', label: 'Tender' },
  { value: 'organization', label: 'Customer Organization' },
]

// Customer organization types depend on the scope chosen on the form.
export const ORG_TYPES_DOMESTIC = ['PSU', 'Govt Department', 'Railway', 'Private', 'Joint Venture', 'Other']
export const ORG_TYPES_INTERNATIONAL = ['Government Department', 'Railway', 'Private Company', 'Joint Venture', 'Public Enterprise', 'Other']
/** Union of both lists, for filters and anything that is not scope-aware. */
export const ORG_TYPES = Array.from(new Set([...ORG_TYPES_DOMESTIC, ...ORG_TYPES_INTERNATIONAL]))
export const orgTypesFor = (scope?: string | null) =>
  scope === 'international' ? ORG_TYPES_INTERNATIONAL : scope === 'domestic' ? ORG_TYPES_DOMESTIC : ORG_TYPES

// Stored values stay as the short codes above (existing records use them); this
// only controls what's shown in the dropdown option text.
export const ORG_TYPE_LABELS: Record<string, string> = {
  PSU: 'Public Sector Undertaking (PSU)',
}

// Railway zone / division only apply to railway-side organizations — they are
// hidden on the form and on the detail view for every other org type.
export const orgTypeHasRailwayFields = (orgType?: string | null) =>
  orgType === 'Railway' || orgType === 'Govt Department' || orgType === 'Government Department'

// India gets the State / UT list (GST place of supply); any other country is typed
// in under 'Other'. Older records with e.g. 'USA' open as Other + that name.
const WORLD_COUNTRIES = [
  'Afghanistan', 'Albania', 'Algeria', 'Andorra', 'Angola', 'Antigua and Barbuda', 'Argentina', 'Armenia', 'Australia', 'Austria',
  'Azerbaijan', 'Bahamas', 'Bahrain', 'Bangladesh', 'Barbados', 'Belarus', 'Belgium', 'Belize', 'Benin', 'Bhutan', 'Bolivia',
  'Bosnia and Herzegovina', 'Botswana', 'Brazil', 'Brunei', 'Bulgaria', 'Burkina Faso', 'Burundi', 'Cabo Verde', 'Cambodia',
  'Cameroon', 'Canada', 'Central African Republic', 'Chad', 'Chile', 'China', 'Colombia', 'Comoros', 'Congo (Republic)',
  'Costa Rica', "Cote d'Ivoire", 'Croatia', 'Cuba', 'Cyprus', 'Czech Republic', 'Democratic Republic of the Congo', 'Denmark',
  'Djibouti', 'Dominica', 'Dominican Republic', 'Ecuador', 'Egypt', 'El Salvador', 'Equatorial Guinea', 'Eritrea', 'Estonia',
  'Eswatini', 'Ethiopia', 'Fiji', 'Finland', 'France', 'Gabon', 'Gambia', 'Georgia', 'Germany', 'Ghana', 'Greece', 'Grenada',
  'Guatemala', 'Guinea', 'Guinea-Bissau', 'Guyana', 'Haiti', 'Honduras', 'Hungary', 'Iceland', 'Indonesia', 'Iran', 'Iraq',
  'Ireland', 'Israel', 'Italy', 'Jamaica', 'Japan', 'Jordan', 'Kazakhstan', 'Kenya', 'Kiribati', 'Kosovo', 'Kuwait', 'Kyrgyzstan',
  'Laos', 'Latvia', 'Lebanon', 'Lesotho', 'Liberia', 'Libya', 'Liechtenstein', 'Lithuania', 'Luxembourg', 'Madagascar', 'Malawi',
  'Malaysia', 'Maldives', 'Mali', 'Malta', 'Marshall Islands', 'Mauritania', 'Mauritius', 'Mexico', 'Micronesia', 'Moldova',
  'Monaco', 'Mongolia', 'Montenegro', 'Morocco', 'Mozambique', 'Myanmar', 'Namibia', 'Nauru', 'Nepal', 'Netherlands',
  'New Zealand', 'Nicaragua', 'Niger', 'Nigeria', 'North Korea', 'North Macedonia', 'Norway', 'Oman', 'Pakistan', 'Palau',
  'Palestine', 'Panama', 'Papua New Guinea', 'Paraguay', 'Peru', 'Philippines', 'Poland', 'Portugal', 'Qatar', 'Romania', 'Russia',
  'Rwanda', 'Saint Kitts and Nevis', 'Saint Lucia', 'Saint Vincent and the Grenadines', 'Samoa', 'San Marino',
  'Sao Tome and Principe', 'Saudi Arabia', 'Senegal', 'Serbia', 'Seychelles', 'Sierra Leone', 'Singapore', 'Slovakia', 'Slovenia',
  'Solomon Islands', 'Somalia', 'South Africa', 'South Korea', 'South Sudan', 'Spain', 'Sri Lanka', 'Sudan', 'Suriname', 'Sweden',
  'Switzerland', 'Syria', 'Taiwan', 'Tajikistan', 'Tanzania', 'Thailand', 'Timor-Leste', 'Togo', 'Tonga', 'Trinidad and Tobago',
  'Tunisia', 'Turkey', 'Turkmenistan', 'Tuvalu', 'Uganda', 'Ukraine', 'United Arab Emirates', 'United Kingdom', 'United States',
  'Uruguay', 'Uzbekistan', 'Vanuatu', 'Vatican City', 'Venezuela', 'Vietnam', 'Yemen', 'Zambia', 'Zimbabwe',
]
// India first, every other country A-Z, 'Other' last. A saved country that is not in this list
// still opens as Other + its text (see OrganizationForm).
export const COUNTRIES = ['India', ...WORLD_COUNTRIES.slice().sort((a, b) => a.localeCompare(b)), 'Other']

export const INDIA_STATES = [
  'Andaman and Nicobar Islands', 'Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chandigarh',
  'Chhattisgarh', 'Dadra and Nagar Haveli and Daman and Diu', 'Delhi', 'Goa', 'Gujarat', 'Haryana',
  'Himachal Pradesh', 'Jammu and Kashmir', 'Jharkhand', 'Karnataka', 'Kerala', 'Ladakh',
  'Lakshadweep', 'Madhya Pradesh', 'Maharashtra', 'Manipur', 'Meghalaya', 'Mizoram', 'Nagaland',
  'Odisha', 'Puducherry', 'Punjab', 'Rajasthan', 'Sikkim', 'Tamil Nadu', 'Telangana', 'Tripura',
  'Uttar Pradesh', 'Uttarakhand', 'West Bengal',
]

export const LEAD_SOURCES = [
  'Website', 'WhatsApp', 'Referral', 'Phone Call', 'Email', 'Walk-in', 'LinkedIn', 'Exhibition/Event', 'Other',
]

// Older records may still carry a retired source (e.g. 'Google Ads', 'Justdial') —
// keep it selectable so opening such a record doesn't silently blank it.
export const leadSourceOptions = (current?: string | null) =>
  current && !LEAD_SOURCES.includes(current) ? [...LEAD_SOURCES, current] : LEAD_SOURCES

export const PRODUCT_CATEGORIES = ['Road Rail Vehicle', 'Rail Vehicle', 'Hydraulic System', 'Braking System', 'Spare Parts', 'Other']

// Priority is exactly Standard / Urgent app-wide (lib/priority.ts). Older rows
// (High / Medium / Low) are shown and edited as their two-value equivalent.
export const PRIORITIES: string[] = PRIORITY_OPTIONS.map((o) => o.value)

export const PRIORITY_MEANINGS: Record<string, string> = {
  standard: 'Normal requirement',
  urgent: 'Important requirement, quick action needed',
}

export const priorityOptions = (_current?: string | null) => PRIORITIES

export const priorityLabel = (p: string) => {
  const v = normalizePriority(p)
  return `${PRIORITY_LABELS_TEXT[v]} — ${PRIORITY_MEANINGS[v]}`
}
const PRIORITY_LABELS_TEXT: Record<string, string> = Object.fromEntries(PRIORITY_OPTIONS.map((o) => [o.value, o.label]))

export const INQUIRY_STATUSES = [
  'Lead',
  'Requirement Received',
  'R&D / Technical Review',
  'Qualified Inquiry',
  'Quotation Sent',
  'Order Received',
  'Closed - Ordered',
  'Closed - Not Ordered',
]

// Older inquiries may still carry a retired status (e.g. 'Negotiation') — keep it
// selectable so opening such a record doesn't silently show/save a different one.
// `saved` = the status already saved on the inquiry: status only moves forward from it,
// and a closed inquiry keeps its status (owner, 2026-10-28; the server checks the same).
export const inquiryStatusOptions = (current?: string | null, saved?: string | null) => {
  const all = current && !INQUIRY_STATUSES.includes(current) ? [...INQUIRY_STATUSES, current] : INQUIRY_STATUSES
  if (!saved || !INQUIRY_STATUSES.includes(saved)) return all
  if (saved.startsWith('Closed')) return [saved]
  return INQUIRY_STATUSES.slice(INQUIRY_STATUSES.indexOf(saved))
}

export const INQUIRY_STATUS_COLORS: Record<string, { bg: string; text: string }> = {
  Lead: { bg: 'rgba(100,116,139,0.12)', text: '#475569' },
  'Requirement Received': { bg: 'rgba(37,99,235,0.1)', text: '#1d4ed8' },
  'R&D / Technical Review': { bg: 'rgba(14,165,233,0.12)', text: '#0369a1' },
  'Qualified Inquiry': { bg: 'rgba(234,179,8,0.14)', text: '#a16207' },
  'Quotation Sent': { bg: 'rgba(139,92,246,0.12)', text: '#7c3aed' },
  'Order Received': { bg: 'rgba(16,185,129,0.12)', text: '#047857' },
  'Under Production': { bg: 'rgba(245,158,11,0.14)', text: '#b45309' },
  'Closed - Ordered': { bg: 'rgba(34,197,94,0.12)', text: '#16a34a' },
  'Closed - Not Ordered': { bg: 'rgba(220,38,38,0.1)', text: '#b91c1c' },
}

export const inquiryStatusColor = (status: string) => INQUIRY_STATUS_COLORS[status] || { bg: 'rgba(0,0,0,0.06)', text: '#57534e' }

export const INQ_STAGES = [
  'Requirement Received',
  'Requirement Qualified',
  'Quotation Sent',
  'Negotiation',
  'Order Received',
  'Closed – Not Ordered',
]

export const TND_STAGES = [
  'Tender Published',
  'Documents Downloaded',
  'Participate Decision',
  'Bid Submitted',
  'Technical Qualified',
  'Financial Opened',
  'Awarded / Lost',
]

export const TENDER_STATUSES = [
  'Waiting for Future Tender',
  'Tender Published',
  'Tender Participation',
  'Tender Submitted',
  'LOA / Order Received',
  'Closed – Ordered',
  'Closed – Not Ordered',
  'Tender Cancelled',
]

export const TENDER_STATUS_COLORS: Record<string, { bg: string; text: string }> = {
  'Waiting for Future Tender': { bg: 'rgba(37,99,235,0.1)', text: '#1d4ed8' },
  'Tender Published': { bg: 'rgba(37,99,235,0.1)', text: '#1d4ed8' },
  'Tender Participation': { bg: 'rgba(234,179,8,0.14)', text: '#a16207' },
  'Tender Submitted': { bg: 'rgba(139,92,246,0.12)', text: '#7c3aed' },
  'LOA / Order Received': { bg: 'rgba(34,197,94,0.12)', text: '#16a34a' },
  'Closed – Ordered': { bg: 'rgba(34,197,94,0.12)', text: '#16a34a' },
  'Closed – Not Ordered': { bg: 'rgba(220,38,38,0.1)', text: '#b91c1c' },
  'Tender Cancelled': { bg: 'rgba(0,0,0,0.06)', text: '#57534e' },
}

export const tenderStatusColor = (status: string) => TENDER_STATUS_COLORS[status] || { bg: 'rgba(0,0,0,0.06)', text: '#57534e' }

export const TENDER_PORTALS = ['GeM', 'IREPS', 'CPP Portal', 'eProcure', 'Direct', 'Other']

export const TENDER_TYPES = ['Open', 'Limited', 'Single', 'Global']

export const CURRENCIES = ['INR', 'USD', 'EUR']

export const CUSTOMER_RESPONSES = ['— Awaiting —', 'Accepted', 'Rejected', 'Negotiating']

export const QUOTE_CONDITIONS = ['Standard T&C', 'Ex-works', 'FOR Destination', 'FOB', 'CIF', 'Other/Custom']

// Dialling code pre-filled in the phone fields for the selected country. The code is plain
// text in the field and stays editable. 'Other' has none (the user types it).
export const COUNTRY_DIAL_CODES: Record<string, string> = {
  India: '+91', Afghanistan: '+93', Albania: '+355', Algeria: '+213', Andorra: '+376', Angola: '+244',
  'Antigua and Barbuda': '+1', Argentina: '+54', Armenia: '+374', Australia: '+61', Austria: '+43', Azerbaijan: '+994',
  Bahamas: '+1', Bahrain: '+973', Bangladesh: '+880', Barbados: '+1', Belarus: '+375', Belgium: '+32', Belize: '+501',
  Benin: '+229', Bhutan: '+975', Bolivia: '+591', 'Bosnia and Herzegovina': '+387', Botswana: '+267', Brazil: '+55',
  Brunei: '+673', Bulgaria: '+359', 'Burkina Faso': '+226', Burundi: '+257', 'Cabo Verde': '+238', Cambodia: '+855',
  Cameroon: '+237', Canada: '+1', 'Central African Republic': '+236', Chad: '+235', Chile: '+56', China: '+86',
  Colombia: '+57', Comoros: '+269', 'Congo (Republic)': '+242', 'Costa Rica': '+506', "Cote d'Ivoire": '+225',
  Croatia: '+385', Cuba: '+53', Cyprus: '+357', 'Czech Republic': '+420', 'Democratic Republic of the Congo': '+243',
  Denmark: '+45', Djibouti: '+253', Dominica: '+1', 'Dominican Republic': '+1', Ecuador: '+593', Egypt: '+20',
  'El Salvador': '+503', 'Equatorial Guinea': '+240', Eritrea: '+291', Estonia: '+372', Eswatini: '+268', Ethiopia: '+251',
  Fiji: '+679', Finland: '+358', France: '+33', Gabon: '+241', Gambia: '+220', Georgia: '+995', Germany: '+49',
  Ghana: '+233', Greece: '+30', Grenada: '+1', Guatemala: '+502', Guinea: '+224', 'Guinea-Bissau': '+245', Guyana: '+592',
  Haiti: '+509', Honduras: '+504', Hungary: '+36', Iceland: '+354', Indonesia: '+62', Iran: '+98', Iraq: '+964',
  Ireland: '+353', Israel: '+972', Italy: '+39', Jamaica: '+1', Japan: '+81', Jordan: '+962', Kazakhstan: '+7',
  Kenya: '+254', Kiribati: '+686', Kosovo: '+383', Kuwait: '+965', Kyrgyzstan: '+996', Laos: '+856', Latvia: '+371',
  Lebanon: '+961', Lesotho: '+266', Liberia: '+231', Libya: '+218', Liechtenstein: '+423', Lithuania: '+370',
  Luxembourg: '+352', Madagascar: '+261', Malawi: '+265', Malaysia: '+60', Maldives: '+960', Mali: '+223', Malta: '+356',
  'Marshall Islands': '+692', Mauritania: '+222', Mauritius: '+230', Mexico: '+52', Micronesia: '+691', Moldova: '+373',
  Monaco: '+377', Mongolia: '+976', Montenegro: '+382', Morocco: '+212', Mozambique: '+258', Myanmar: '+95',
  Namibia: '+264', Nauru: '+674', Nepal: '+977', Netherlands: '+31', 'New Zealand': '+64', Nicaragua: '+505',
  Niger: '+227', Nigeria: '+234', 'North Korea': '+850', 'North Macedonia': '+389', Norway: '+47', Oman: '+968',
  Pakistan: '+92', Palau: '+680', Palestine: '+970', Panama: '+507', 'Papua New Guinea': '+675', Paraguay: '+595',
  Peru: '+51', Philippines: '+63', Poland: '+48', Portugal: '+351', Qatar: '+974', Romania: '+40', Russia: '+7',
  Rwanda: '+250', 'Saint Kitts and Nevis': '+1', 'Saint Lucia': '+1', 'Saint Vincent and the Grenadines': '+1',
  Samoa: '+685', 'San Marino': '+378', 'Sao Tome and Principe': '+239', 'Saudi Arabia': '+966', Senegal: '+221',
  Serbia: '+381', Seychelles: '+248', 'Sierra Leone': '+232', Singapore: '+65', Slovakia: '+421', Slovenia: '+386',
  'Solomon Islands': '+677', Somalia: '+252', 'South Africa': '+27', 'South Korea': '+82', 'South Sudan': '+211',
  Spain: '+34', 'Sri Lanka': '+94', Sudan: '+249', Suriname: '+597', Sweden: '+46', Switzerland: '+41', Syria: '+963',
  Taiwan: '+886', Tajikistan: '+992', Tanzania: '+255', Thailand: '+66', 'Timor-Leste': '+670', Togo: '+228', Tonga: '+676',
  'Trinidad and Tobago': '+1', Tunisia: '+216', Turkey: '+90', Turkmenistan: '+993', Tuvalu: '+688', Uganda: '+256',
  Ukraine: '+380', 'United Arab Emirates': '+971', 'United Kingdom': '+44', 'United States': '+1', Uruguay: '+598',
  Uzbekistan: '+998', Vanuatu: '+678', 'Vatican City': '+39', Venezuela: '+58', Vietnam: '+84', Yemen: '+967',
  Zambia: '+260', Zimbabwe: '+263',
}
export const dialCodeFor = (country?: string | null) => (country && COUNTRY_DIAL_CODES[country]) || ''
const DIAL_DIGITS = new Set(Object.values(COUNTRY_DIAL_CODES).map((c) => c.replace(/\D/g, '')))
/** True when a phone field holds only a dialling code (nothing real typed yet): treated as empty. */
export const isDialCodeOnly = (v: string) => {
  const d = (v || '').replace(/\D/g, '')
  return d !== '' && DIAL_DIGITS.has(d)
}
/** The phone value to validate, compare and save: a code-only field counts as empty. */
export const phoneOrBlank = (v: string) => (isDialCodeOnly(v) ? '' : v)
