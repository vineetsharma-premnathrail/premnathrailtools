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
    _feature("linked_records", "Inquiries & Tenders of the customer organization", "subtab", {
        "view": "view",
    }, "The Inquiries and Tenders sub-tabs on a customer organization (the records themselves still need CRM › Inquiries & Tenders › View)."),
    _feature("audit_trail", "Audit trail", "subtab", {
        "view": "view",
    }, "The Audit Trail sub-tab of a customer organization: who created and changed it, and when."),
    _feature("engagements", "Engagements", "subtab", {
        "view": "view", "create": "view", "edit": "view", "delete": "view",
    }, "The Engagements sub-tab of a customer organization: log meetings, calls, visits and discussions with its contacts "
       "and their outcome. Anyone who can see organizations logs them; only the person who logged one (or an admin) edits / deletes it."),
)

register_features(
    "crm", "inquiries_tenders",
    _feature("quotations", "Quotations", "subtab", {
        "view": "view", "create": "edit", "edit": "edit", "delete": "delete",
        "submit": "edit", "approve": "approve", "reject": "reject", "print": "print",
    }, "The Quotations sub-tab of an inquiry: see, create / revise (and send / record the customer's answer), "
       "submit for approval, approve / return / reject, delete and print quotations."),
    _feature("documents", "Documents", "subtab", {
        "view": "view", "create": "edit", "delete": "delete",
    }, "The Documents sub-tab of an inquiry / tender: open the Client and Internal documents, upload files, delete your own uploads."),
    _feature("discussion", "Discussion with R&D", "subtab", {
        "view": "view", "create": "edit",
    }, "The Discussion sub-tab (opens once the Technical Requirement is sent to R&D): read the BD ↔ R&D thread, and post messages."),
    _feature("followups", "Follow-ups", "subtab", {
        "view": "view", "create": "edit", "edit": "edit", "delete": "delete", "print": "print",
    }, "The Follow Ups sub-tab of an inquiry / tender: see, log, edit and delete follow-ups, and export Meeting MoMs."),
    _feature("timeline", "Timeline", "subtab", {
        "view": "view",
    }, "The Timeline sub-tab of an inquiry / tender: created / deleted events, stage moves and every info change in one history."),
    _feature("tender_dates", "Tender dates", "subtab", {
        "view": "view",
    }, "The Dates sub-tab of a tender: publish, pre-bid, submission, opening and award dates."),
    _feature("send_tor", "Send Technical Requirement (TOR) to R&D", "action", {
        "view": "view", "create": "edit",
    }, "The \"Send Technical Requirement to R&D\" button on an inquiry / tender — emails R&D the requirement and opens the R&D discussion."),
    _feature("stage", "Move pipeline stage", "action", {
        "view": "view", "edit": "edit",
    }, "Move an inquiry / tender to its next pipeline stage (stages only move forward; moving back stays an admin correction)."),
    _feature("bd_owner", "BD owner", "section", {
        "view": "view", "edit": "edit",
    }, "The BD Owner field of an inquiry: who owns the opportunity (set on create, changed on edit — today an admin's choice; everyone else owns what they log)."),
    _feature("sales_engineer", "Sales engineer", "section", {
        "view": "view", "edit": "edit",
    }, "The Sales Engineer field in an inquiry's Opportunity section: who supports the BD owner on it."),
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
