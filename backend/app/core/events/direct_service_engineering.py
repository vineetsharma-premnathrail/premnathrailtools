"""Direct notifications of Service & Commissioning (erp), Quality, Electrical,
Hydraulic, Design and Maintenance.

"Direct" means the code itself names who gets the notice (the assignee, the
requester, the approver, the Design head …) through
utils/notifications.notify_user / broadcast_notification. A role does not add
people to these; the role's Notifications tab (and a user's personal
override) only picks the channels those people receive each one on. With no
setting anywhere the defaults below apply: approvals, reminders and work
handed to one person go to the bell and Teams, results and information to the
bell only (see register_direct in core/notification_events.py).

Types ending in _created / _updated / _deleted are never sent and are not
listed. Reminders sent by the scheduled jobs live in direct_scheduled.py."""
from app.core.notification_events import register_direct

_BELL = ("bell",)
_BELL_TEAMS = ("bell", "teams")

# ── Service & Commissioning (erp) ────────────────────────────────────────────
register_direct(
    "erp", "sr_assigned", "A service request was assigned to you", "The assigned engineer",
    "a service request is assigned (or re-assigned) to you", default_channels=_BELL_TEAMS, kind="assignment",
)
register_direct(
    "erp", "sr_closed", "Service request closed", "The person who closed it",
    "a service request is closed", default_channels=_BELL, kind="info",
)
register_direct(
    "erp", "sr_spare_issued", "Spare issued for your service request", "The assigned engineer",
    "Store issues a spare against a service request assigned to you", default_channels=_BELL, kind="info",
)
register_direct(
    "erp", "project_approved", "Machine approved",
    "The person who registered the machine",
    "a machine registration is approved, so service requests can be raised on it",
    default_channels=_BELL, kind="info",
)
register_direct(
    "erp", "project_rejected", "Machine rejected",
    "The person who registered the machine",
    "a machine registration is rejected; correcting and saving it sends it back for approval",
    default_channels=_BELL, kind="info",
)
register_direct(
    "erp", "erp_import_result", "Machine or service request import finished",
    "The person who ran the import",
    "a machine or service request import finishes, with the counts created, skipped and failed",
    default_channels=_BELL, kind="info",
)
register_direct(
    "erp", "sr_close_approved", "Service request closure approved",
    "The person who raised the service request",
    "the approver approves closing the service request",
    default_channels=_BELL, kind="info",
)
register_direct(
    "erp", "sr_close_rejected", "Service request closure sent back",
    "The person who raised the service request",
    "the approver sends the service request back to In Progress instead of closing it",
    default_channels=_BELL, kind="info",
)
register_direct(
    "erp", "pr_raised", "Purchase requisition raised for a service request",
    "Everyone with Purchase access",
    "spares for a service request are sent to Purchase as a new purchase requisition",
    default_channels=_BELL, kind="info",
)
register_direct(
    "erp", "pr_received", "Purchase requisition fully received",
    "Everyone with Purchase access",
    "every item of a service request's purchase requisition has been received",
    default_channels=_BELL, kind="info",
)

# ── Quality ──────────────────────────────────────────────────────────────────
# CAPA
register_direct(
    "quality", "quality_capa_raised", "CAPA raised",
    "Quality head(s) and the CAPA owner",
    "a corrective or preventive action (CAPA) is raised, manually or from an NCR, complaint or vendor rating",
    default_channels=_BELL, kind="info",
)
register_direct(
    "quality", "quality_capa_assigned", "CAPA assigned to you",
    "The person made the CAPA owner",
    "someone is made the owner of a CAPA",
    default_channels=_BELL_TEAMS, kind="assignment",
)
register_direct(
    "quality", "quality_capa_team", "Added to a CAPA team",
    "Each person added to the CAPA's 8D team",
    "someone is added to the 8D team of a CAPA",
    default_channels=_BELL_TEAMS, kind="assignment",
)
register_direct(
    "quality", "quality_capa_action_assigned", "CAPA action assigned",
    "The person who owns the action",
    "an action with a due date is added to a CAPA and given to someone",
    default_channels=_BELL_TEAMS, kind="assignment",
)
register_direct(
    "quality", "quality_capa_actions_done", "CAPA actions completed",
    "Quality head(s) and the CAPA owner",
    "every action on a CAPA is done and the effectiveness check is scheduled",
    default_channels=_BELL, kind="info",
)
register_direct(
    "quality", "quality_capa_closed", "CAPA closed",
    "Quality head(s), the CAPA owner and the CAPA team",
    "a CAPA is verified effective and closed",
    default_channels=_BELL, kind="info",
)
register_direct(
    "quality", "quality_capa_reopened", "CAPA not effective, reopened",
    "Quality head(s), the CAPA owner and the CAPA team",
    "the effectiveness check finds a CAPA not effective and it is reopened",
    default_channels=_BELL, kind="info",
)
# Complaints, first article, inspection calls
register_direct(
    "quality", "quality_complaint_received", "Customer complaint received",
    "Quality head(s)",
    "a customer complaint is logged",
    default_channels=_BELL, kind="info",
)
register_direct(
    "quality", "quality_fai_decided", "First article decided",
    "Quality engineers",
    "a first article inspection is approved or rejected",
    default_channels=_BELL, kind="info",
)
register_direct(
    "quality", "quality_inspection_call", "Inspection call raised or scheduled",
    "Quality engineers",
    "a third-party or customer inspection call is raised or given a date",
    default_channels=_BELL, kind="info",
)
# Inspection lots
register_direct(
    "quality", "quality_lot_assigned", "Inspection lot waiting for you",
    "The assigned inspector; else every inspector who can edit inspection lots; else everyone with Quality access",
    "an inspection lot is created or assigned and waits for results",
    default_channels=_BELL_TEAMS, kind="assignment",
)
register_direct(
    "quality", "quality_plan_needed", "Inspection plan needed",
    "Quality engineers",
    "a lot cannot be inspected because no approved inspection plan exists for its item and inspection type",
    default_channels=_BELL_TEAMS, kind="assignment",
)
# NCR
register_direct(
    "quality", "quality_ncr_critical", "Critical NCR raised",
    "Quality engineers, Quality head(s) and the Partners",
    "a critical non-conformance (NCR) is raised and needs attention now",
    default_channels=_BELL_TEAMS, kind="assignment",
)
register_direct(
    "quality", "quality_ncr_raised", "NCR raised",
    "Quality engineers",
    "a non-critical non-conformance (NCR) is raised",
    default_channels=_BELL, kind="info",
)
register_direct(
    "quality", "quality_ncr_disposition_rejected", "NCR disposition rejected",
    "The person who proposed the disposition",
    "an approver rejects the proposed disposition of an NCR, so a new one must be proposed",
    default_channels=_BELL, kind="info",
)
register_direct(
    "quality", "quality_ncr_disposition_approved", "NCR disposition approved",
    "The person who proposed the disposition",
    "every required approver has signed off the disposition of an NCR",
    default_channels=_BELL, kind="info",
)
# Supplier quality
register_direct(
    "quality", "quality_vendor_status", "Vendor approval decision",
    "Quality head(s), Purchase contacts and the person who asked for the change",
    "a vendor's approved-vendor status change (approve, block or unblock) is approved or rejected",
    default_channels=_BELL, kind="info",
)
register_direct(
    "quality", "quality_vendor_rating_low", "Vendor rating below limit",
    "Quality head(s) and Purchase contacts",
    "a vendor's rating falls below the watch or blocked limit",
    default_channels=_BELL, kind="info",
)
register_direct(
    "quality", "quality_vendor_audit_assigned", "Vendor audit assigned",
    "The auditor",
    "a vendor audit is planned and given to an auditor",
    default_channels=_BELL_TEAMS, kind="assignment",
)

# ── Electrical ───────────────────────────────────────────────────────────────
register_direct(
    "electrical", "electrical_job_assigned", "Electrical job assigned",
    "The lead engineer of the job",
    "an electrical job is created with, or changed to, a new lead engineer",
    default_channels=_BELL_TEAMS, kind="assignment",
)
register_direct(
    "electrical", "electrical_stage_assigned", "Electrical stage assigned",
    "The person who owns the stage",
    "a stage of an electrical job is given a new owner",
    default_channels=_BELL_TEAMS, kind="assignment",
)
register_direct(
    "electrical", "electrical_issue_assigned", "Electrical issue assigned",
    "The person the issue is assigned to",
    "an issue on an electrical job is assigned or re-assigned",
    default_channels=_BELL_TEAMS, kind="assignment",
)
register_direct(
    "electrical", "electrical_issue_resolved", "Electrical issue resolved",
    "The person who reported the issue",
    "an issue on an electrical job is resolved",
    default_channels=_BELL, kind="info",
)
register_direct(
    "electrical", "electrical_drawing_submitted", "Electrical drawing awaiting approval",
    "The lead engineer of the job (when not already asked as an approver)",
    "a drawing revision is submitted for approval",
    default_channels=_BELL_TEAMS, kind="approval",
)
register_direct(
    "electrical", "electrical_drawing_approved", "Electrical drawing approved",
    "The person who prepared the drawing revision",
    "a drawing revision is approved and becomes the drawing in force",
    default_channels=_BELL, kind="info",
)
register_direct(
    "electrical", "electrical_drawing_rejected", "Electrical drawing rejected",
    "The person who prepared the drawing revision",
    "a drawing revision is rejected and a corrected revision must be raised",
    default_channels=_BELL, kind="info",
)
register_direct(
    "electrical", "electrical_inspection_requested", "Electrical QC inspection requested",
    "Everyone with Quality access",
    "an electrical job asks for its final electrical inspection",
    default_channels=_BELL, kind="info",
)
register_direct(
    "electrical", "electrical_job_handed_over", "Electrical job handed over",
    "The lead engineer of the job",
    "the handover stage of an electrical job is completed",
    default_channels=_BELL, kind="info",
)

# ── Hydraulic ────────────────────────────────────────────────────────────────
register_direct(
    "hydraulic", "hyd_circuit_review", "Hydraulic circuit needs review",
    "The circuit approvers (when the approval workflow has not already asked them)",
    "a circuit revision is submitted for approval",
    default_channels=_BELL_TEAMS, kind="approval",
)
register_direct(
    "hydraulic", "hyd_circuit_approved", "Hydraulic circuit approved",
    "The person who submitted the circuit",
    "a circuit revision is approved",
    default_channels=_BELL, kind="info",
)
register_direct(
    "hydraulic", "hyd_circuit_returned", "Hydraulic circuit returned for changes",
    "The person who submitted the circuit",
    "a circuit revision is sent back with the reviewer's remarks",
    default_channels=_BELL, kind="info",
)

# ── Design ───────────────────────────────────────────────────────────────────
# Design requests
register_direct(
    "design", "design_request_new", "New design request",
    "Design head(s)",
    "a design request is raised (including the one opened when a sales order is confirmed) and needs a lead designer",
    default_channels=_BELL, kind="info",
)
register_direct(
    "design", "design_request_assigned", "Design request assigned",
    "The lead designer",
    "a design request is accepted with, or changed to, a new lead designer",
    default_channels=_BELL_TEAMS, kind="assignment",
)
register_direct(
    "design", "design_requirement_revised", "Design requirement revised",
    "The lead designer and Design head(s)",
    "the technical requirement of a design request is revised",
    default_channels=_BELL, kind="info",
)
register_direct(
    "design", "design_request_status", "Design request status changed",
    "The person who raised the request",
    "the status of a design request changes",
    default_channels=_BELL, kind="info",
)
register_direct(
    "design", "design_request_waiting", "Design waiting for input",
    "The person who raised the request (when Design needs input), or the lead designer (when the input is back)",
    "Design marks a request as waiting on the requester for input, or the request is marked back with Design",
    default_channels=_BELL_TEAMS, kind="assignment",
)
# Drawing and BOM revisions
register_direct(
    "design", "design_approval_requested", "Design approval needed",
    "The approver of the document or BOM revision",
    "the checker passes a document or BOM revision and it waits for approval",
    default_channels=_BELL_TEAMS, kind="approval",
)
register_direct(
    "design", "design_revision_approved", "Revision ready for customer approval",
    "The author, the document owner and Design head(s)",
    "a document revision is approved internally and still needs the customer's approval",
    default_channels=_BELL, kind="info",
)
register_direct(
    "design", "design_revision_returned", "Revision returned to draft",
    "The author (and the checker when the approver returns it)",
    "a checker or approver returns a document or BOM revision to draft with a comment",
    default_channels=_BELL, kind="info",
)
register_direct(
    "design", "design_revision_recalled", "Revision recalled",
    "The checker or approver the revision was waiting on",
    "the author recalls a revision to draft, so no action is needed for now",
    default_channels=_BELL, kind="info",
)
register_direct(
    "design", "design_revision_released", "Revision released",
    "The author, the checker and the document owner",
    "a document or BOM revision is released as the controlled revision",
    default_channels=_BELL, kind="info",
)
register_direct(
    "design", "design_bom_released", "BOM released",
    "Everyone with Store, Purchase or Production access",
    "a BOM revision is released and can be used for material planning, purchasing and production",
    default_channels=_BELL, kind="info",
)
register_direct(
    "design", "design_new_item_request", "New item code needed for a BOM",
    "Everyone with Store access",
    "a BOM revision lists items that do not exist in the Item Master yet",
    default_channels=_BELL, kind="info",
)
# Engineering changes
register_direct(
    "design", "design_ecr_raised", "Engineering change request raised",
    "Design head(s)",
    "an engineering change request (ECR) is raised",
    default_channels=_BELL, kind="info",
)
register_direct(
    "design", "design_ecr_vote", "Change board vote needed",
    "Each member of the change board",
    "the impact of an ECR is checked and the board is asked to vote",
    default_channels=_BELL_TEAMS, kind="approval",
)
register_direct(
    "design", "design_ecr_ready", "Change board has voted",
    "Design head(s)",
    "every change board member has voted and the ECR is ready for a decision",
    default_channels=_BELL_TEAMS, kind="approval",
)
register_direct(
    "design", "design_ecr_decided", "Engineering change request decided",
    "The person who raised the ECR",
    "an ECR is approved, rejected or deferred",
    default_channels=_BELL, kind="info",
)
register_direct(
    "design", "design_ecn_approved", "Engineering change notice approved",
    "The person who raised the ECN and the owners of the affected documents and BOMs",
    "an ECN is approved, or opened from an approved ECR, and the affected revisions must be raised under it",
    default_channels=_BELL, kind="info",
)
register_direct(
    "design", "design_ecn_rejected", "Engineering change notice rejected",
    "The person who raised the ECN",
    "an ECN is rejected",
    default_channels=_BELL, kind="info",
)
register_direct(
    "design", "design_ecn_cancelled", "Engineering change notice cancelled",
    "The approver of the ECN",
    "a submitted ECN is cancelled or withdrawn, so no decision is needed",
    default_channels=_BELL, kind="info",
)
register_direct(
    "design", "design_ecn_implemented", "Engineering change released",
    "The person who raised the ECN, the people named in each department, the project manager, and everyone in a department with no named person",
    "an ECN is implemented; the departments must acknowledge it",
    default_channels=_BELL, kind="info",
)
register_direct(
    "design", "design_ecn_closed", "Engineering change notice closed",
    "The person who raised the ECN",
    "every department has acknowledged an ECN and it is closed",
    default_channels=_BELL, kind="info",
)
# Customer submissions
register_direct(
    "design", "design_customer_approved", "Customer approved a drawing",
    "The approver, the document owner and Design head(s)",
    "the customer approves a submitted document revision",
    default_channels=_BELL, kind="info",
)
register_direct(
    "design", "design_customer_rejected", "Customer rejected a drawing",
    "The author and the document owner",
    "the customer rejects a submitted document revision",
    default_channels=_BELL, kind="info",
)
register_direct(
    "design", "design_customer_comment", "Customer comment to address",
    "The person the comment is assigned to",
    "a customer's comment on a submission is logged as an action and assigned to someone",
    default_channels=_BELL_TEAMS, kind="assignment",
)

# ── Maintenance ──────────────────────────────────────────────────────────────
# Requests
register_direct(
    "maintenance", "maintenance_request_raised", "Maintenance request raised",
    "The maintenance team of the asset's branch",
    "a maintenance request or breakdown is raised on an asset",
    default_channels=_BELL, kind="info",
)
register_direct(
    "maintenance", "maintenance_request_acknowledged", "Maintenance request acknowledged",
    "The person who raised the request",
    "maintenance acknowledges the request",
    default_channels=_BELL, kind="info",
)
register_direct(
    "maintenance", "maintenance_request_rejected", "Maintenance request rejected",
    "The person who raised the request",
    "a request is rejected or marked duplicate, with the reason",
    default_channels=_BELL, kind="info",
)
register_direct(
    "maintenance", "maintenance_reading_limit_breach", "Reading outside its limit",
    "The maintenance team of the asset's branch",
    "a meter or condition reading is outside its limits and a request is raised automatically",
    default_channels=_BELL, kind="info",
)
# Work orders
register_direct(
    "maintenance", "maintenance_wo_assigned", "Work order assigned to you",
    "The assigned technician",
    "a work order, including a preventive-maintenance job, is assigned or re-assigned",
    default_channels=_BELL_TEAMS, kind="assignment",
)
register_direct(
    "maintenance", "maintenance_wo_reopened", "Work order reopened",
    "The assigned technician",
    "a completed work order is reopened after verification is rejected or sent back",
    default_channels=_BELL_TEAMS, kind="assignment",
)
register_direct(
    "maintenance", "maintenance_permit_issued", "Work permit issued",
    "The assigned technician",
    "a permit is issued on a work order and must be accepted before the work starts",
    default_channels=_BELL_TEAMS, kind="assignment",
)
register_direct(
    "maintenance", "maintenance_wo_completed", "Work order completed",
    "The person who raised the request (asked to confirm the machine) and the work order's creator",
    "the technician completes a work order",
    default_channels=_BELL, kind="info",
)
register_direct(
    "maintenance", "maintenance_wo_confirmed", "Requester confirmed the machine is OK",
    "The work order's creator and the person who acknowledged the request",
    "the requester confirms the machine is working, so the job can be verified and closed",
    default_channels=_BELL, kind="info",
)
register_direct(
    "maintenance", "maintenance_wo_confirmation_rejected", "Requester says the machine is not OK",
    "The assigned technician and the work order's creator",
    "the requester reports the machine is still not OK and the work order goes back to In Progress",
    default_channels=_BELL, kind="info",
)
# Spares
register_direct(
    "maintenance", "maintenance_spare_below_min", "Critical spare below minimum",
    "Maintenance planners of the branch",
    "a critical spare's total stock drops below its minimum or reorder level (once a day per spare)",
    default_channels=_BELL_TEAMS, kind="reminder",
)
