import type { Inquiry, Organization, OrganizationDetail, OrgContact, Tender } from '@/types'

/**
 * Made-up CRM records for the Role editor's "Preview & choose" (lib/visibility.ts): the lists and the
 * record pages draw these instead of loading anything, so a role editor sees every column and block.
 * Never sent to the server.
 */

export const sampleContact = {
  id: -5, org_id: -1, name: 'Sample contact', designation: 'Purchase Manager', department: 'Purchase / Procurement',
  mobile: '+91 98765 00000', email: 'contact@sample.example', additional_mobiles: [], additional_emails: [],
} as unknown as OrgContact

const orgBase = {
  org_scope: 'domestic', country: 'India', created_at: '2026-11-02T09:30:00', created_by_name: 'Sample user',
  additional_phones: [], additional_emails: [],
}

export const sampleOrganizations = [
  { ...orgBase, id: -1, org_code: 'C-0001', name: 'Sample Railway Workshop', org_type: 'Railway', railway_zone: 'Northern Railway',
    division_workshop: 'Sample Division', address: '12 Sample Road', city: 'New Delhi', state: 'Delhi', pin_code: '110001',
    gst_number: '07AAAAA0000A1Z5', pan: 'AAAAA0000A', gst_state_code: '07', official_phone: '+91 11 2345 6789',
    official_email: 'office@sample.example', website: 'https://sample.example' },
  { ...orgBase, id: -2, org_code: 'C-0002', name: 'Sample Private Company', org_type: 'Private', city: 'Pune', state: 'Maharashtra' },
  { ...orgBase, id: -3, org_code: 'C-0003', name: 'Sample Overseas Operator', org_type: 'Private Company', org_scope: 'international',
    country: 'Germany', city: 'Munich', state: 'Bavaria', tax_vat_id: 'DE123456789', company_registration_no: 'HRB 12345' },
] as unknown as Organization[]

/** The first organization with a contact and counts, for the Customer Organization page preview. */
export const sampleOrganizationDetail = {
  ...sampleOrganizations[0], contacts: [sampleContact], inquiry_count: 2, tender_count: 1,
} as unknown as OrganizationDetail

const recordBase = { org_id: -1, org_contact_id: -5, bd_owner: 'Sample BD owner', created_by_name: 'Sample user', lead_source: 'Referral' }

export const sampleInquiries = [
  { ...recordBase, id: -11, universal_id: 'INQ-20261102-0001', inquiry_date: '2026-11-02', created_at: '2026-11-02T09:30:00',
    status: 'Lead', current_stage: 'Requirement Received', priority: 'standard', product: 'Road Rail Vehicle for OHE maintenance',
    product_spec: 'Self-propelled, 1676 mm BG, hydraulic braking', project_details: 'Sample project background for the preview.',
    current_status_note: 'Waiting for the customer to confirm the site visit.', additional_items: [] },
  { ...recordBase, id: -12, universal_id: 'INQ-20261102-0002', inquiry_date: '2026-11-01', created_at: '2026-11-01T11:00:00',
    status: 'Quotation Sent', current_stage: 'Quotation Sent', priority: 'urgent', product: 'Hydraulic braking system spares', additional_items: [] },
  { ...recordBase, id: -13, org_id: -2, universal_id: 'INQ-20261031-0003', inquiry_date: '2026-10-31', created_at: '2026-10-31T15:20:00',
    status: 'Qualified Inquiry', current_stage: 'Requirement Qualified', priority: 'standard', product: 'Rail welding plant transporter', additional_items: [] },
] as unknown as Inquiry[]

export const sampleTenders = [
  { ...recordBase, id: -21, universal_id: 'TND-20261102-0001', tender_date: '2026-11-02', created_at: '2026-11-02T10:00:00',
    tender_number: 'NR/2026/RRV/01', tender_name: 'Supply of 2 road rail vehicles', tender_authority: 'Northern Railway',
    tender_portal: 'IREPS', tender_type: 'Open', tender_category: 'Road Rail Vehicle', tender_value: 45000000, currency: 'INR',
    status: 'Tender Published', current_stage: 'Tender Published', priority: 'standard', railway_zone: 'Northern Railway', division: 'Delhi',
    tender_details: 'Supply of 2 RRVs with 2 years AMC; eligibility: 3 similar supplies in the last 5 years.',
    current_status_note: 'Pre-bid meeting on 10 Nov.', publish_date: '2026-11-01', doc_download_date: '2026-11-02',
    submission_date: '2026-11-20', closing_at: '2026-11-20T15:00:00' },
  { ...recordBase, id: -22, org_id: -2, universal_id: 'TND-20261101-0002', tender_date: '2026-11-01', created_at: '2026-11-01T12:00:00',
    tender_number: 'PC/26/07', tender_name: 'Annual rate contract — brake spares', tender_category: 'Spare Parts', currency: 'INR',
    status: 'Tender Participation', current_stage: 'Participate Decision', priority: 'urgent', publish_date: '2026-10-28', closing_at: '2026-11-15T11:00:00' },
  { ...recordBase, id: -23, org_id: -3, universal_id: 'TND-20261030-0003', tender_date: '2026-10-30', created_at: '2026-10-30T09:00:00',
    tender_category: 'Rail Vehicle', currency: 'EUR', status: 'Waiting for Future Tender', current_stage: 'Tender Published', priority: 'standard' },
] as unknown as Tender[]
