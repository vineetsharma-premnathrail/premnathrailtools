export const RAILWAY_ZONES = [
  'Northern Railway', 'Southern Railway', 'Eastern Railway', 'Western Railway', 'Central Railway',
  'South Eastern Railway', 'North Eastern Railway', 'Northeast Frontier Railway', 'South Central Railway',
  'East Central Railway', 'East Coast Railway', 'West Central Railway', 'North Central Railway',
  'North Western Railway', 'South Western Railway', 'Metro Railway Kolkata', 'Not Applicable', 'Other',
]

export const ACTIVITY_TYPES = ['Call', 'Email', 'Meet at Client/Site Office', 'Meet at Own Office']

export const FOLLOW_UP_STATUSES = ['Open', 'Closed', 'Hold']

export const RELATED_MODULES = [
  { value: '', label: '— None —' },
  { value: 'inquiry', label: 'Inquiry' },
  { value: 'tender', label: 'Tender' },
  { value: 'organization', label: 'Customer Organization' },
]

export const ORG_TYPES = ['PSU', 'Govt Department', 'Railway', 'Private', 'Joint Venture', 'Other']

// Stored values stay as the short codes above (existing records use them); this
// only controls what's shown in the dropdown option text.
export const ORG_TYPE_LABELS: Record<string, string> = {
  PSU: 'Public Sector Undertaking (PSU)',
}

// Railway zone / division only apply to railway-side organizations — they are
// hidden on the form and on the detail view for every other org type.
export const orgTypeHasRailwayFields = (orgType?: string | null) =>
  orgType === 'Railway' || orgType === 'Govt Department'

export const COUNTRIES = ['India', 'USA', 'UK', 'UAE', 'Other']

export const INDIA_STATES = [
  'Andaman and Nicobar Islands', 'Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chandigarh',
  'Chhattisgarh', 'Dadra and Nagar Haveli and Daman and Diu', 'Delhi', 'Goa', 'Gujarat', 'Haryana',
  'Himachal Pradesh', 'Jammu and Kashmir', 'Jharkhand', 'Karnataka', 'Kerala', 'Ladakh',
  'Lakshadweep', 'Madhya Pradesh', 'Maharashtra', 'Manipur', 'Meghalaya', 'Mizoram', 'Nagaland',
  'Odisha', 'Puducherry', 'Punjab', 'Rajasthan', 'Sikkim', 'Tamil Nadu', 'Telangana', 'Tripura',
  'Uttar Pradesh', 'Uttarakhand', 'West Bengal',
]

export const LEAD_SOURCES = [
  'Website', 'Google Ads', 'Facebook / Instagram', 'WhatsApp', 'Referral', 'Phone Call',
  'Email', 'Walk-in', 'LinkedIn', 'Exhibition/Event', 'Justdial', 'Other',
]

export const PRODUCT_CATEGORIES = ['Road Rail Vehicle', 'Rail Vehicle', 'Hydraulic System', 'Braking System', 'Spare Parts', 'Other']

export const PRIORITIES = ['High', 'Medium', 'Low']

export const PRIORITY_MEANINGS: Record<string, string> = {
  High: 'Important requirement, quick action needed',
  Medium: 'Normal requirement',
  Low: 'Can be handled later',
}

// Older records may still carry a retired value (e.g. 'Urgent') — keep it
// selectable so opening such a record doesn't silently change it.
export const priorityOptions = (current?: string | null) =>
  current && !PRIORITIES.includes(current) ? [...PRIORITIES, current] : PRIORITIES

export const priorityLabel = (p: string) => (PRIORITY_MEANINGS[p] ? `${p} — ${PRIORITY_MEANINGS[p]}` : p)

export const INQUIRY_STATUSES = [
  'Requirement Received',
  'R&D / Technical Review',
  'Qualified',
  'Quotation Sent',
  'Order Received',
  'Under Production',
  'Closed - Ordered',
  'Closed - Not Ordered',
]

// Older inquiries may still carry a retired status (e.g. 'Negotiation') — keep it
// selectable so opening such a record doesn't silently show/save a different one.
export const inquiryStatusOptions = (current?: string | null) =>
  current && !INQUIRY_STATUSES.includes(current) ? [...INQUIRY_STATUSES, current] : INQUIRY_STATUSES

export const INQUIRY_STATUS_COLORS: Record<string, { bg: string; text: string }> = {
  'Requirement Received': { bg: 'rgba(37,99,235,0.1)', text: '#1d4ed8' },
  'R&D / Technical Review': { bg: 'rgba(14,165,233,0.12)', text: '#0369a1' },
  Qualified: { bg: 'rgba(234,179,8,0.14)', text: '#a16207' },
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
  'Requirement Received',
  'Tender Published',
  'Tender Participation',
  'Tender Submitted',
  'Technical Evaluation',
  'Commercial Evaluation',
  'Negotiation',
  'LOA / Order Received',
  'Closed – Ordered',
  'Closed – Not Ordered',
  'Tender Cancelled',
]

export const TENDER_STATUS_COLORS: Record<string, { bg: string; text: string }> = {
  'Requirement Received': { bg: 'rgba(37,99,235,0.1)', text: '#1d4ed8' },
  'Tender Published': { bg: 'rgba(37,99,235,0.1)', text: '#1d4ed8' },
  'Tender Participation': { bg: 'rgba(234,179,8,0.14)', text: '#a16207' },
  'Tender Submitted': { bg: 'rgba(139,92,246,0.12)', text: '#7c3aed' },
  'Technical Evaluation': { bg: 'rgba(139,92,246,0.12)', text: '#7c3aed' },
  'Commercial Evaluation': { bg: 'rgba(139,92,246,0.12)', text: '#7c3aed' },
  Negotiation: { bg: 'rgba(245,158,11,0.14)', text: '#b45309' },
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
