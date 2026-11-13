"""CRM features (module › tab › feature). See permission_registry.FEATURES.

`inherit` names the tab action that guarded each feature action before
features existed, so roles that were never customised keep exactly the
access they had.

Tenders have no tab of their own — they share Inquiries & Tenders — so every
Inquiries & Tenders feature below applies to an inquiry AND to a tender
(Quotations exist only on inquiries)."""
from app.core.assignee_rules import register_pickers
from app.core.permission_registry import _feature, register_features
from app.core.reporting.features import management_feature

register_features(
    "crm", "organizations",
    _feature("contacts", "Contacts", "subtab", {
        "view": "view", "create": "edit", "edit": "edit", "delete": "edit",
    }, "The Contacts sub-tab of a customer organization: see its contact persons, add, edit and remove them. "
       "Contacts stay pickable on inquiry / tender / follow-up forms for anyone working those."),
    _feature("linked_records", "Inquiries and Tenders tabs", "subtab", {
        "view": "view",
    }, "The Inquiries and Tenders sub-tabs on a customer organization (the records themselves still need CRM › Inquiries & Tenders › View)."),
    _feature("audit_trail", "Audit trail", "subtab", {
        "view": "view",
    }, "The Audit Trail sub-tab of a customer organization: who created and changed it, and when."),
)

# The Inquiries & Tenders row's own Approve / Reject / Print guard no screen of their own: they are
# what Quotations (approve / reject / print) and Follow-ups (print) inherit until a role is customised.
register_features(
    "crm", "inquiries_tenders",
    _feature("quotations", "Quotations", "subtab", {
        "view": "view", "create": "edit", "edit": "edit", "delete": "delete",
        "submit": "edit", "approve": "approve", "reject": "reject", "print": "print",
    }, "The Quotations sub-tab of an inquiry: see, create / revise (and send / record the customer's answer), "
       "submit for approval, approve / return / reject, delete and print quotations. Until customised, Approve / Reject / "
       "Print follow the Inquiries & Tenders row's Approve / Reject / Print (those row ticks only feed this and Follow-ups)."),
    _feature("documents", "Documents", "subtab", {
        "view": "view", "create": "edit", "delete": "delete",
    }, "The Documents sub-tab of an inquiry / tender: open the Client and Internal documents, upload files, delete your own uploads."),
    _feature("technical_offer", "Technical Offers", "subtab", {
        "view": "view", "create": "edit", "delete": "edit",
    }, "The Technical Offers sub-tab of an inquiry / tender: see the offers, upload BD's own Word / PDF offer (create) and delete one "
       "no quotation uses yet. "
       "It is quotable at once, marked 'Uploaded by BD, not reviewed by R&D'."),
    _feature("followups", "Follow-ups", "subtab", {
        "view": "view", "create": "edit", "edit": "edit", "delete": "delete", "print": "print",
    }, "The Follow Ups sub-tab of an inquiry / tender: see, log, edit and delete follow-ups, and export Meeting MoMs."),
    _feature("timeline", "Timeline", "subtab", {
        "view": "view",
    }, "The Timeline sub-tab of an inquiry / tender: created / deleted events, stage moves and every info change in one history."),
    _feature("tender_dates", "Dates", "subtab", {
        "view": "view",
    }, "The Dates sub-tab of a tender: publish, pre-bid, submission, opening and award dates."),
    _feature("send_tor", "Send Technical Requirement (TOR) to R&D", "action", {
        "view": "view", "create": "edit",
    }, "The \"Send Technical Requirement to R&D\" button on an inquiry / tender — emails R&D the requirement; R&D then accepts it or returns it to BD with a reason."),
    _feature("stage", "Move pipeline stage", "action", {
        "view": "view", "edit": "edit",
    }, "Move an inquiry / tender to another pipeline stage (moving back needs a reason, kept on the timeline)."),
    _feature("bd_owner", "BD owner", "picker", {
        "view": "view", "edit": "edit",
    }, "Only carries the \"Set BD owner to\" assign-to rule of an inquiry's BD Owner field (who this role may make the owner). "
       "Without a rule a user owns what they log."),
    _feature("sales_engineer", "Sales engineer", "picker", {
        "view": "view", "edit": "edit",
    }, "Only carries the \"Set sales engineer to\" assign-to rule of an inquiry's Sales Engineer field (who this role may pick)."),
    _feature("customer_contact", "Customer Organization & contact person", "section", {
        "view": "view",
    }, "The Customer Organization / Contact Person card on an inquiry / tender's Info tab (GST number, address, contact's mobile and email)."),
    _feature("prices", "Prices & margins", "sensitive", {
        "view": "view",
    }, "Quotation prices, discounts and totals, an inquiry's Expected Value and a tender's Tender / Contract Value — on screen, in "
       "exports and in revision history. Whoever can create, edit or approve quotations still sees quotation prices (they price / "
       "release them); without this switch quotation PDF / Word can't be opened. The CRM Dashboard's pipeline values are not covered."),
)

# "Assign to" rules per role (core/assignee_rules.py).
register_pickers("crm", "inquiries_tenders",
                 ("bd_owner", "Set BD owner to", "Who this role may make the BD owner of an inquiry (create / edit). Making themselves the owner is always allowed."),
                 ("sales_engineer", "Set sales engineer to", "Who this role may pick as an inquiry's Sales Engineer (create / edit)."))

# CRM › Reports: per-BD-owner figures (Sales team page) need People & performance.
register_features("crm", "reports", management_feature())

# CRM › Sales Library: folders flagged Confidential (price lists, standard quotations by default)
# and the documents inside them are hidden from everyone without this feature.
register_features(
    "crm", "sales_library",
    _feature("confidential", "Confidential folders", "section", {
        "view": None,  # explicit grant only: Sales Library Edit must not reveal price lists
    }, "See folders marked Confidential in the Sales Library (Pricing & Quotations by default) and the files inside them — "
       "in the folder tree, search, counts and on product pages. Without it those folders stay hidden."),
)

# ---------------------------------------------------------------------------
# Role-wise UI visibility (core/visibility.py): which form sections show, which
# coded dropdown values are offered and which list columns show, per role.
# Only CODED dropdowns are listed (constants in code); DB-fed pickers (customer
# organization, contact, product) and free lists with an "Other + text" value
# (organization type, railway zone, tender portal) or frontend-only lists (lead
# source, tender type, currency) are not — the server has no list to enforce.
from app.core.priority import PRIORITY_LABELS
from app.core.visibility import register_visibility
from app.modules.crm.models.inquiry import INQ_STATUSES
from app.modules.crm.models.tender import TND_STATUSES
from app.modules.crm.services.org_scope import ORG_SCOPES

register_visibility(
    "crm", "organizations",
    label="Customer Organizations — form, page & list",
    screens=(("form", "Customer Organization form"), ("detail", "Customer Organization page"), ("list", "Customer Organizations list")),
    sections=(
        # New / Edit Customer Organization form (components/crm/OrganizationForm.tsx)
        ("details", "Customer Organization Details",
         "Scope, type and name (required), railway zone / division and the GSTIN / PAN or Tax / VAT ID.", True, "form"),
        ("address", "Address", "Address, country (required for an International organization), state, city, PIN.", True, "form"),
        ("contact_registration", "Contact & Registration", "Official phone, official email and website.", False, "form"),
        ("contact_persons", "Contact Persons",
         "The contact-person cards on the form. Contacts stay on the organization's Contacts sub-tab.", False, "form"),
        # Customer Organization page (components/crm/OrganizationDetailPanel.tsx). Visibility is the on-screen
        # layer: the feature grants (Contacts, Inquiries & Tenders of the organization, Audit trail) still decide
        # who may see the data at all.
        ("detail_header", "Record summary", "Type, code and name with the Edit / Delete buttons.", True, "detail"),
        ("detail_details", "Customer Organization Details", "Scope, type, railway zone / division on the Overview tab.", False, "detail"),
        ("detail_address", "Address", "Address, city / state, PIN and country on the Overview tab.", False, "detail"),
        ("detail_contact_registration", "Contact & Registration",
         "Official phone / email, website and the tax ids on the Overview tab.", False, "detail"),
        ("detail_contacts", "Contacts tab",
         "The contact persons of the organization. Access is still set by the Contacts feature; this only hides the tab on screen.", False, "detail"),
        ("detail_inquiries", "Inquiries tab",
         "The organization's inquiries. Access is still set by the 'Inquiries and Tenders tabs' feature.", False, "detail"),
        ("detail_tenders", "Tenders tab",
         "The organization's tenders. Access is still set by the 'Inquiries and Tenders tabs' feature.", False, "detail"),
        ("detail_audit", "Audit Trail tab",
         "Who created and changed the organization. Access is still set by the Audit trail feature.", False, "detail"),
    ),
    options=(
        ("org_scope", "Organization Scope", {v: v.capitalize() for v in ORG_SCOPES},
         "Domestic / International chosen first on the form. A value not allowed here is also refused by the server.", "form"),
    ),
    tables=(
        ("organizations", "Customer Organizations list", {
            "org_scope": "Scope", "org_type": "Type", "railway_zone": "Railway Zone", "city": "City",
            "created_at": "Created Date", "created_by_name": "Created By",
        }, "list"),
    ),
)

register_visibility(
    "crm", "inquiries_tenders",
    label="Inquiries & Tenders — forms, pages & list",
    screens=(("inquiry_form", "Inquiry form"), ("tender_form", "Tender form"), ("inquiry_detail", "Inquiry page"),
             ("tender_detail", "Tender page"), ("list", "Inquiries & Tenders list")),
    sections=(
        # Inquiry form (components/crm/InquiryForm.tsx)
        ("inq_company", "Company Information", "Client company and contact person (required).", True, "inquiry_form"),
        ("inq_basic", "Basic Information", "Inquiry date, lead source, priority and status (required), current status note.", True, "inquiry_form"),
        ("inq_product", "Product Requirement", "Product (required) and the customer requirement text.", True, "inquiry_form"),
        ("inq_project_details", "Project Details", "Free-text project background on the inquiry form.", False, "inquiry_form"),
        # Tender form (components/crm/TenderForm.tsx)
        ("tnd_info", "Tender Information", "Number, name, authority, portal, type, value, currency, status, details.", True, "tender_form"),
        ("tnd_dates", "Key Dates", "Publish date and closing date & time are required once the tender is published.", True, "tender_form"),
        ("tnd_basic", "Basic Information", "Created date and priority (required).", True, "tender_form"),
        ("tnd_customer", "Customer Organization & Contact", "Customer organization (required) and contact person.", True, "tender_form"),
        # Inquiry page (components/crm/InquiryDetailPanel.tsx). The sub-tabs stay behind their feature grants
        # (Quotations, Documents, Follow-ups, Timeline ...); visibility only hides them on screen.
        ("inq_detail_header", "Record summary & actions", "Number, date, status, customer name and the Edit / Delete / Send to R&D buttons.", True, "inquiry_detail"),
        ("inq_detail_rnd", "R&D status card", "Whether the requirement went to R&D and where it stands.", False, "inquiry_detail"),
        ("inq_detail_customer", "Customer", "Client company, GST number, address and contact person on the Info tab. "
         "Access is still set by the 'Customer Organization & contact person' feature.", False, "inquiry_detail"),
        ("inq_detail_lead", "Lead", "Status, priority, expected value / order date and lost reason on the Info tab.", False, "inquiry_detail"),
        ("inq_detail_product", "Product Requirement", "Product, customer requirement, additional products and project details on the Info tab.", False, "inquiry_detail"),
        ("inq_detail_quotations", "Quotations tab", "Access is still set by the Quotations feature; this only hides the tab on screen.", False, "inquiry_detail"),
        ("inq_detail_technical_offers", "Technical Offers tab", "Access is still set by the Technical Offers feature.", False, "inquiry_detail"),
        ("inq_detail_documents", "Documents tab", "Access is still set by the Documents feature.", False, "inquiry_detail"),
        ("inq_detail_followups", "Follow Ups tab", "Access is still set by the Follow-ups feature.", False, "inquiry_detail"),
        ("inq_detail_timeline", "Timeline tab", "Access is still set by the Timeline feature.", False, "inquiry_detail"),
        # Tender page (components/crm/TenderDetailPanel.tsx)
        ("tnd_detail_header", "Record summary & actions", "Number, status, name, the stage bar and the Edit / Delete / Send to R&D buttons.", True, "tender_detail"),
        ("tnd_detail_rnd", "R&D status card", "Whether the requirement went to R&D and where it stands.", False, "tender_detail"),
        ("tnd_detail_info", "Tender Information", "Status, details, authority, portal, type, value and lead source on the Info tab.", False, "tender_detail"),
        ("tnd_detail_customer", "Customer", "Customer organization, zone / division and contact person on the Info tab. "
         "Access is still set by the 'Customer Organization & contact person' feature.", False, "tender_detail"),
        ("tnd_detail_dates", "Dates tab", "Access is still set by the Dates feature; this only hides the tab on screen.", False, "tender_detail"),
        ("tnd_detail_technical_offers", "Technical Offers tab", "Access is still set by the Technical Offers feature.", False, "tender_detail"),
        ("tnd_detail_documents", "Documents tab", "Access is still set by the Documents feature.", False, "tender_detail"),
        ("tnd_detail_followups", "Follow Ups tab", "Access is still set by the Follow-ups feature.", False, "tender_detail"),
        ("tnd_detail_timeline", "Timeline tab", "Access is still set by the Timeline feature.", False, "tender_detail"),
    ),
    options=(
        ("inquiry_priority", "Priority", dict(PRIORITY_LABELS),
         "Standard / Urgent (Customer Requirement Priority) on the inquiry form. A value not allowed here is also refused by the server.", "inquiry_form"),
        ("inquiry_status", "Inquiry Status", {s: s for s in INQ_STATUSES},
         "The Status an inquiry can be given on its form. An older inquiry keeps a status this role no longer offers; "
         "only a CHANGE to a value outside the list is refused.", "inquiry_form"),
        ("tender_priority", "Priority", dict(PRIORITY_LABELS),
         "Standard / Urgent on the tender form. A value not allowed here is also refused by the server.", "tender_form"),
        ("tender_status", "Tender Status", {s: s for s in TND_STATUSES},
         "The Status a tender can be given on its form. Statuses other than 'Waiting for Future Tender' and "
         "'Tender Cancelled' require the tender number, name, publish and closing dates.", "tender_form"),
    ),
    tables=(
        ("inquiries_tenders", "Inquiries & Tenders list", {
            "org_name": "Customer Organization", "product": "Product", "created_at": "Created Date",
            "created_by_name": "Created By",
        }, "list"),
    ),
)
