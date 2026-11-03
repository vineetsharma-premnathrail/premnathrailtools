"""Design features (module › tab › feature). See permission_registry.FEATURES.

`inherit` names the tab action that guarded each feature action before
features existed, so roles that were never customised keep exactly the
access they had. Most Design record actions were gated only by the Design
app plus record-level rules (Design team / head, named checker / approver,
owner, change-board member, ECN acknowledger), so they inherit from the
tab's "view"; those record-level rules still apply on top of every feature.
Submit inherits the tab's "submit", check / release its "approve" (the
central approval engine required it: these features are the engine's
feature_key for drawing and BOM release) and discarding a revision its "delete"
(the checks the routes made before). Library deletes keep "delete".

The gate applies only to users holding the tab's View (see
modules/design/features.py), so board voters, ECN acknowledgers and named
signatories reaching a record without the tab keep working as before."""
from app.core.assignee_rules import register_pickers
from app.core.permission_registry import MODULES, _feature, register_features
from app.core.visibility import register_visibility
from app.modules.design.models.change_request import DESIGN_ECR_SOURCES, DESIGN_ECR_URGENCIES
from app.modules.design.models.document import DESIGN_DISCIPLINES, DESIGN_DOCUMENT_TYPES


def _reg(tab: str, *features: tuple) -> None:
    """register_features for a Design tab; every hint says the gate only
    applies to roles holding that tab (modules/design/features.py: without
    the tab's View only the record-level rules apply — keep current access)."""
    label = MODULES["design"]["subtabs"].get(tab, tab)
    register_features("design", tab, *(
        (key, flabel, kind, inherit, f"{hint} Applies to roles that hold the {label} tab; without that tab only the record-level rules apply.")
        for key, flabel, kind, inherit, hint in features
    ))

_REC = "Record-level rules still apply (Design team / head, owner, named checker or approver)."

_reg(
    "documents",
    _feature("check_release", "Check, approve & release", "action", {
        "view": "view", "submit": "submit", "approve": "approve", "cancel": "view",
    }, "Submit a drawing revision for check, pass / return it as checker, approve / release it as approver, and recall it to draft. Check / release follows the tab's Approve by default (the approval engine checks it). " + _REC),
    _feature("revisions", "Revisions", "action", {
        "view": "view", "create": "view", "edit": "view", "delete": "delete",
    }, "Start a new revision of a released drawing, edit the draft revision's summary and signatories, and discard a draft revision."),
    _feature("files", "Revision files", "section", {
        "view": "view", "create": "view", "delete": "view",
    }, "The Files block of a revision: see / download the controlled PDF and CAD files, upload and remove files on a draft."),
    _feature("obsolete", "Obsolete & reactivate", "action", {
        "view": "view", "cancel": "view",
    }, "Mark a released drawing obsolete (owner or admin) and reactivate it (admin)."),
    _feature("where_used", "Where used", "section", {"view": "view"},
             "The Where used block: the BOMs and projects that use this drawing."),
    _feature("timeline", "Timeline & comments", "section", {"view": "view", "create": "view"},
             "The record's timeline (audit history) and posting comments on it."),
    _feature("owner", "Owner", "picker", {"view": "view"},
             "Only carries the role's 'Assign to' rule for the Owner picker of a drawing (new drawing, hand-over). Record-level rules still apply (owner, Design head)."),
)

_reg(
    "boms",
    _feature("check_release", "Check & release", "action", {
        "view": "view", "submit": "submit", "approve": "approve", "cancel": "view",
    }, "Submit a BOM revision for check, pass / return it as checker, release / return it as approver, and recall it to draft. Check / release follows the tab's Approve by default (the approval engine checks it). " + _REC),
    _feature("revisions", "Revisions & lines", "action", {
        "view": "view", "create": "view", "edit": "view", "delete": "delete",
    }, "Start a new BOM revision, edit the draft revision and its lines, and discard a draft revision."),
    _feature("explosion", "Explosion & export", "section", {"view": "view", "export": "view"},
             "The multi-level explosion of a BOM and its CSV export (the hand-over sheet for Store / Purchase)."),
    _feature("obsolete", "Obsolete & reactivate", "action", {
        "view": "view", "cancel": "view",
    }, "Mark a released BOM obsolete (owner or admin) and reactivate it (admin)."),
    _feature("where_used", "Where used", "section", {"view": "view"},
             "The Where used block: parent BOMs and projects that use this BOM's product."),
    _feature("timeline", "Timeline & comments", "section", {"view": "view", "create": "view"},
             "The record's timeline (audit history) and posting comments on it."),
    _feature("owner", "Owner", "picker", {"view": "view"},
             "Only carries the role's 'Assign to' rule for the Owner picker of a BOM (new BOM, hand-over). Record-level rules still apply (owner, Design head)."),
)

_reg(
    "change_notices",
    _feature("ecr_impact", "ECR impact check", "action", {"view": "view", "edit": "view"},
             "Record / update the impact of a change request (stock, open orders, delivery) and name its change board. Design team only."),
    _feature("ecr_vote", "Change board vote", "action", {"view": "view", "submit": "view"},
             "See the change board of an ECR and vote Approve / Reject / Defer (only people on that ECR's board can vote)."),
    _feature("ecr_decision", "Decide ECRs", "action", {"view": "view", "approve": "view", "reject": "view"},
             "Approve an ECR or reject / defer it after the board voted, and reopen a deferred ECR. Design head only."),
    _feature("ecr_to_ecn", "Create ECN from ECR", "action", {"view": "view", "create": "view"},
             "Turn an approved ECR into its change notice (ECN) with effectivity and disposition. Design head only."),
    _feature("ecn_effectivity", "ECN effectivity & disposition", "action", {"view": "view", "edit": "view"},
             "Change an ECN's effectivity and stock / WIP disposition until it is released (head, raiser or approver)."),
    _feature("ecn_release", "Release ECN", "action", {"view": "view", "approve": "view"},
             "Release (implement) an approved ECN once its revisions are released — this asks departments to acknowledge."),
    _feature("ecn_acknowledge", "Acknowledge ECN", "action", {"view": "view", "submit": "view"},
             "Acknowledge a released ECN for a department (only people named in Design › Settings or holders of that department's app)."),
    _feature("cost_impact", "Cost impact of changes", "sensitive", {"view": "view"},
             "See the cost impact figure of change requests. Without it the figure is hidden and an impact check keeps the existing figure."),
)

_reg(
    "reviews",
    _feature("customer_submissions", "Customer submissions", "section", {
        "view": "view", "create": "view", "edit": "view", "submit": "view", "cancel": "view",
    }, "Customer drawing submissions: see them, prepare / edit / delete a draft, send it to the customer and cancel it. Design team only; delete also needs Drawings › Delete."),
    _feature("customer_response", "Record customer response", "action", {"view": "view", "edit": "view"},
             "Record the customer's response to a submission (approved / with comments / rejected) and attach the customer's letter."),
    _feature("comment_actions", "Customer comment actions", "section", {"view": "view", "create": "view", "edit": "view"},
             "The customer comment actions of a submission: add an action and close it (assignee or head)."),
)

_reg(
    "project_work",
    _feature("technical_requirement", "Technical requirement", "section", {"view": "view", "edit": "view", "approve": "view"},
             "The technical requirement of a design request and its revisions: revise it (requester or head) and confirm a revision was reviewed (lead designer or head)."),
    _feature("request_progress", "Accept & progress requests", "action", {"view": "view", "approve": "view", "edit": "view", "cancel": "view"},
             "Accept a request, start / hold / resume / complete / reopen it, change who it waits on, and cancel it. Design head (lead designer may complete)."),
    _feature("deliverables", "Deliverables", "section", {"view": "view"},
             "The drawings and BOMs produced for a request and their release status."),
    _feature("timeline", "Timeline & comments", "section", {"view": "view", "create": "view"},
             "The request's timeline (audit history) and posting comments on it."),
)

_LIB = {"view": "view", "create": "view", "edit": "view", "delete": "delete"}
_reg(
    "library",
    _feature("standards", "Standards", "subtab", _LIB,
             "The Standards list: add, edit, attach files to and remove standards (Design head)."),
    _feature("standard_parts", "Standard parts", "subtab", _LIB,
             "The Standard parts list: add, edit and remove standard parts (Design team)."),
    _feature("approved_makes", "Approved makes", "subtab", _LIB,
             "The Approved makes list: approve, change and delete makes (team; delete by head)."),
    _feature("templates", "Templates", "subtab", _LIB,
             "The Templates list: publish and remove drawing / document templates (Design head)."),
    _feature("checklists", "Review checklists", "subtab", _LIB,
             "The review checklists: create, edit and delete checklists used when checking drawings and BOMs (Design head)."),
)

# "Assign to" rules per role (core/assignee_rules.py).
register_pickers("design", "documents",
                 ("owner", "Set owner to", "Who this role may name as a drawing's owner when creating it, or hand a drawing over to."),
                 ("check_release", "Name checker", "Who this role may name as a drawing revision's checker — on a new drawing, a new / draft revision or at submission."))
register_pickers("design", "boms",
                 ("owner", "Set owner to", "Who this role may name as a BOM's owner when creating it, or hand a BOM over to."),
                 ("check_release", "Name checker", "Who this role may name as a BOM revision's checker — on a new BOM, a new / draft revision or at submission."))
register_pickers("design", "project_work",
                 ("request_progress", "Assign lead designer", "Who this role may make lead designer of a design request, when raising or editing it."))
register_pickers("design", "reviews",
                 ("comment_actions", "Assign comment actions to", "Who this role may give a customer comment action to on a customer submission."))


# UI visibility per role (core/visibility.py): what a member of a role sees on
# the Drawings and Changes (ECR) screens. The dropdown values are the coded
# ones from modules/design/models (never retyped); a value a role does not
# allow is also refused by the server (routes/documents.py, routes/change_requests.py).
# Sections holding a required field are locked (always shown). Number / status
# columns are never offered; the ECR cost figure stays behind "Cost impact of changes".
def _words(value: str) -> str:
    """'ga_drawing' -> 'GA Drawing', 'bom' -> 'BOM', 'part_drawing' -> 'Part Drawing'."""
    short = {"ga": "GA", "bom": "BOM", "ncr": "NCR", "capa": "CAPA", "rnd": "R&D", "bd": "BD"}
    return " ".join(short.get(w, w.capitalize()) for w in value.split("_"))


register_visibility(
    "design", "documents",
    label="Drawings & Documents — form, page & register",
    screens=(("form", "New Document form"), ("detail", "Drawing page"), ("list", "Document Register")),
    sections=(
        # New Document form (dashboard/design/documents/new)
        ("document", "Document", "Title, type, discipline, standard, legacy number and description.", True, "form"),
        ("associations", "Associations", "Project, machine, part, department and design request links.", False, "form"),
        ("customer", "Customer", "Customer and whether the customer must approve the drawing.", False, "form"),
        ("signoff", "R0 — sign-off", "Owner, checker, approver and the issue note of the first revision.", False, "form"),
        ("files", "Files", "The files staged on the first revision (controlled print, CAD source).", False, "form"),
        # Drawing page (dashboard/design/documents/[id])
        ("detail_summary", "Document summary", "Number, title, status, controlled revision and owner.", True, "detail"),
        ("detail_document", "Document", "Type, discipline, standard, department and legacy number.", False, "detail"),
        ("detail_customer", "Customer", "Customer and customer-approval flag.", False, "detail"),
        ("detail_links", "Linked to", "Project, machine, part, design request and approved change notices.", False, "detail"),
        ("detail_revision", "Revision", "The selected revision: signatories, dates and its files.", True, "detail"),
        ("detail_history", "Revision history", "The table of every revision and its check answers.", False, "detail"),
        ("detail_submissions", "Customer submissions", "Transmittals sent to the customer and their responses.", False, "detail"),
        ("detail_where_used", "Where used",
         "BOM lines that reference this drawing. Access is still set by the Where used feature; this only hides the block on screen.", False, "detail"),
        ("detail_timeline", "Timeline",
         "The document's history and comments. Access is still set by the Timeline & comments feature; this only hides the block on screen.", False, "detail"),
    ),
    options=(
        ("document_type", "Type", {k: _words(k) for k in DESIGN_DOCUMENT_TYPES},
         "The document types a member may create. A value not allowed here is also refused by the server.", "form"),
        ("discipline", "Discipline", {k: _words(k) for k in DESIGN_DISCIPLINES},
         "The disciplines a member may pick when creating or editing a document.", "form"),
    ),
    tables=(
        ("documents", "Document Register", {"type": "Type", "discipline": "Discipline", "customer": "Customer",
                                            "controlled_rev": "Controlled Rev", "wip": "Work in Progress", "owner": "Owner"}, "list"),
        ("detail_revisions", "Revision history on the drawing page",
         {"change_summary": "Change summary", "prepared": "Prepared", "checked": "Checked", "approved": "Approved",
          "released": "Released", "checklist": "Checklist"}, "detail"),
    ),
)

register_visibility(
    "design", "change_notices",
    label="Change requests (ECR) — form, page & list",
    screens=(("form", "Raise ECR form"), ("detail", "Change request page"), ("list", "Change requests list")),
    sections=(
        # Raise Change Request form (dashboard/design/change-requests/new)
        ("request", "Request", "Title, source, urgency, reason and proposed change.", True, "form"),
        ("source_details", "Source details", "The NCR / CAPA link and the source reference.", False, "form"),
        ("associations", "Associations", "Project and machine links.", False, "form"),
        ("affected_items", "Affected drawings & BOMs", "The released drawings and BOMs the change touches.", True, "form"),
        # Change request page (dashboard/design/change-requests/[id])
        ("detail_summary", "Request summary", "Number, title, status, urgency and who raised it.", True, "detail"),
        ("detail_request", "Request", "Reason and proposed change.", True, "detail"),
        ("detail_origin", "Where it came from", "Source, NCR / CAPA and source reference.", False, "detail"),
        ("detail_links", "Linked to", "Project, machine and the change notice raised from it.", False, "detail"),
        ("detail_items", "Affected items & where used", "The affected drawings / BOMs and the BOMs that use them.", True, "detail"),
        ("detail_impact", "Impact", "The impact check (stock, open orders, delivery). The cost figure stays behind the Cost impact feature.", False, "detail"),
        ("detail_board", "Change board",
         "Board members and their votes. Access is still set by the Change board vote feature; this only hides the block on screen.", False, "detail"),
        ("detail_timeline", "Timeline", "The request's history and comments.", False, "detail"),
    ),
    options=(
        ("source", "Source", {k: _words(k) for k in DESIGN_ECR_SOURCES},
         "Where a change request may come from. A value not allowed here is also refused by the server.", "form"),
        ("urgency", "Urgency", {k: _words(k) for k in DESIGN_ECR_URGENCIES},
         "The urgencies a member may raise a change request with.", "form"),
    ),
    tables=(
        ("change_requests", "Change requests list",
         {"source": "Source", "urgency": "Urgency", "items": "Items", "raised_by": "Raised by", "votes": "Votes",
          "days_open": "Days open", "ecn": "ECN"}, "list"),
    ),
)
