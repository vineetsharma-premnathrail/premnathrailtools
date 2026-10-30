# Requirement: R&D rework, Sales module removal, priority = Standard/Urgent

Date: 2026-10-30. Size: L. Alembic head at launch: c3e5a7b9d1f2.
Protected (modified before launch): backend/app/db/session.py, backend/app/middleware/error_handler.py.

## Owner's list (verbatim intent)
1. R&D Requirements
   - R&D accepts requests submitted by BD (Accept, or Return to BD with reason).
   - Auto unique R&D ID for every requirement.
   - Every change BD submits is recorded; R&D generates a Revision ID for each revision.
   - Remove Discussion section, remove Access section, rename History -> Timeline.
   - Categorize all documents. Remove document creation completely.
   - Simple notification to R&D when BD submits.
2. Technical Offer
   - R&D Technical Offer creation -> Technical Offer Upload.
   - BD can create (upload) technical offers independently for use in quotations.
3. Remove
   - Discussion, Milestones (keep Tasks only), Share Department.
   - Sales module completely (code + permissions + sidebar). DB tables are NOT dropped without a separate OK.
   - Project creation moves to Project Management (was from Sales Order).
   - Priority = two options everywhere: Standard / Urgent.
4. R&D Prototype / Research origin
   - Customer Requirement -> remove; Improvement of Existing Product -> "Existing Projects";
     Process Technology Research -> remove; New Product -> "New Project".
5. R&D Tasks: "My Tasks" -> "R&D Tasks". Authorized persons Create Task -> pick type (Requirement / Prototype)
   -> matching form -> assign -> track status + progress.
6. R&D Task analytics: central table with user-wise tasks, task progress %, project-wise tasks, project progress,
   pending / completed / overdue. Filters: project, assigned user, department, requirement/prototype, status,
   priority, date range, completion progress.

## Owner answers (2026-10-30)
- Sales: delete the module.
- Priority: Standard / Urgent, whole app.
- PM "Create Project" first asks New Project or New Prototype. New Project -> existing PM project form;
  New Prototype -> R&D prototype form. R&D users can open projects to create tasks.
- Accept: both Accept and Return to BD.

## Owner answers round 2 (2026-10-30, after BA spec section 3)
- Products and Pricing move INTO CRM (CRM nav tab + crm permission tabs; old sales:products/pricing grants aliased).
- No Units: do NOT build "Add Unit" in PM. Production/QC/Dispatch unit pickers degrade to project level / empty for new projects (record as known gap).
- Remove Finance from project creation for now (no budget/billing link on PM New Project). Sales removal = Stage 1 (UI/routes/permissions gone, models kept for historic data, no new orders). Stage 2 billing = later, separate OK.
- Other BA section-11 defaults accepted by Manager: High/Critical -> Urgent; RDR-YYYY-NNNN + -Rn; Return allowed from Accepted before Respond; Discussion removed both sides; offer upload DOCX (stacked) or PDF (separate attachment); keep TOR email on submit.

## Owner answers round 3
- CRM gets ONE "Products" tab; Pricing lives inside it.
- One project = one project (one machine). Production/QC/Dispatch/Store reservation work at project level when a project has no units.
- Confirmed: budget/billing link removed from PM New Project.

## Manager decisions on architecture section 13 (owner said "yes" to proceed)
1. Drop "CRM locked by live SO" rule; keep the delete guard.
2. Historic SOs with unbilled milestones stay billable via Finance bill-from-SO until closed.
3. Prototypes NOT listed in PM All Projects.
4. Technical Offer number auto: TO-/BTO- + -Rn.
5. BD offer upload on inquiries and tenders.
6. Discussion removed on CRM side too.

## Core flow position
Customer -> BD (CRM) -> R&D -> Design/EHP; Sales Order step removed, project now starts in PM.
