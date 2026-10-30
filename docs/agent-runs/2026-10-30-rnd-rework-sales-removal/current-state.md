# Current state map (2026-10-30, read-only scan)

Paths: `rnd/` = backend/app/modules/rnd/.

## Requirements (BD -> R&D)
- No R&D requirement table. Requirement = CRM Inquiry/Tender `(source, record_id)`; visible in R&D once `technical_offer_sent_at` set (rnd/models/requirement_work.py:1-7).
- BD send: POST /crm/inquiries/{id}/technical-offer-request (crm/routes/inquiries.py:465-558), tenders.py:405. Builds TOR Word->PDF, CrmDocument doc_category "Technical Offer Request", email to R&D, sets technical_offer_number (TOR-<suffix>, crm/services/technical_offer.py:37-47), calls record_movement + create_rnd_request.
- CrmRndRequest (crm/models/rnd_request.py, table crm_rnd_requests): one row per send; status open -> responded / superseded on re-send.
- R&D respond: POST /rnd/requirements/requests/{id}/respond (rnd/routes/requirements.py:265-320) -> crm/services/requirement_movement.mark_responded (247-300). No accept/reject exists.
- Revisions: AuditLog snapshot per send (requirement_movement.py:30-129, list_movements diffs); spec edits AuditLog "inquiry_spec"/"tender_spec" (inquiries.py:147, tenders.py:73; GET spec-revisions inquiries.py:579). R&D side only shows an "edited after send" banner.
- Notification on submit: notify_user to R&D heads (rnd_request_assigned), event rnd.tor_received (rnd/services/events.py:30-42, core/events/rnd.py), email with PDF.
- Detail page frontend/src/app/dashboard/rnd/requirements/[source]/[id]/page.tsx tabs (line 29): Requirement, Milestones, Technical Offers, Documents, Discussion, History, Access.
  - Milestones tab = RequirementDepartmentsTab (share with design/electrical/hydraulic, RndRequirementShare, rnd/routes/department_requirements.py) + RndMilestonePlan (components/rnd/RndMilestonePlan.tsx; rnd/models/requirement_milestone.py, rnd/routes/requirement_milestones.py).
  - Documents: components/rnd/RequirementDocumentsTab.tsx; upload rnd/routes/requirement_work.py:492-535; doc_category auto "rnd_document"/"<dept>_document"; CrmDocument related_sub_module REQ_DOC; RndRequirementDocVisibility. CRM categories: crm/routes/document_categories.py.
  - Discussion: components/crm/RequirementDiscussionTab.tsx side="rnd"; crm/routes/requirement_discussion.py; CrmRequirementComment.
  - History: RndProjectHistory, GET /rnd/requirement-work/{source}/{id}/history (requirement_milestones.py:409).
  - Access: components/rnd/RequirementAccessTab.tsx; requirement_work.py:251,280; RndRequirementAccess.

## Technical Offer
- TOR (BD->R&D request) = CRM side, described above.
- R&D Technical Offer: RndTechnicalOffer (rnd/models/technical_offer.py), statuses draft/submitted/released/superseded, number TO-<universal_id>[-Rn] (rnd/services/technical_offers.py:56-63), fields title/scope/technical_details/deviations/exclusions, Word generated (build_docx). Routes rnd/routes/technical_offers.py (create/patch/delete/release/submit/return/revise...). Create gated by feature offer_team + RndTeamMember.can_create_technical_offer.
- BD quotation use: crm_quotations.technical_offer_id FK; GET /crm/inquiries/{id}/technical-offers lists released (crm/routes/workflow.py:188, _quotable_offer :178, used :298 :415; quotation docx stacks TO on top :658-670). Frontend components/crm/InquiryDetailPanel.tsx:507-560, 966-983. UI: components/rnd/RequirementTechnicalOffersTab.tsx.

## Projects / milestones / priority
- R&D project create: rnd/projects/page.tsx:101-108 -> rnd/projects/new/page.tsx; POST /rnd/projects (rnd/routes/projects.py); number RND-YYYY-NNNN. Detail tabs Overview, Members, Milestones, Documents, History (projects/[id]/page.tsx:63, 548). Project milestones rnd/models/project_milestone.py, rnd/routes/project_milestones.py.
- Origin (Prototype/Research): RND_PROJECT_ORIGINS rnd/models/project.py:17-30 (customer_requirement, product_improvement, new_development, process_research), column rnd_projects.origin; frontend components/rnd/ProjectOriginFields.tsx:39-46, projects/page.tsx:26-30, types RndProjectOrigin. Validation rnd/services/project_origin.py.
- Priority values: R&D project low/medium/high/critical (rnd/models/project.py:10); R&D tasks low/medium/high/urgent (rnd/services/task_fields.py:17); CRM free string High/Medium/Low (components/crm/constants.ts:107-120); PM low..critical (projects/models/project.py:17, task.py:13); Design low..urgent; Maintenance/Production/Electrical low/normal/high/urgent; P2P low/medium/high; Service standard/urgent.

## Tasks
- My Tasks page rnd/tasks/page.tsx: read-only merge of PM tasks, project tasks (GET /rnd/project-tasks/mine), requirement tasks (GET /rnd/requirement-work/tasks/mine). No create button.
- Created inside milestone plan / components/rnd/TasksBoard.tsx. Requirement tasks POST /rnd/requirement-work/{source}/{id}/tasks (requirement_work.py:735); project tasks POST /rnd/projects/{id}/tasks (project_tasks.py:277).
- RndRequirementTask fields: source, record_id, parent_task_id, title, remarks, assigned_to_id, created_by_id, due dates, status open/submitted/closed/cancelled, priority, work_status, checklist JSON, department, milestone_id. RndProjectTask same with project_id, no department. No task type, no numeric progress %.

## Nav / permissions
- RndNav components/rnd/RndNav.tsx:13-24: Dashboard, Requirements, My Tasks, Prototype/Research, Engineering Tools, Settings gear.
- Registry backend/app/core/permission_registry.py:109-129 (rnd), Sales at 254-268. Features backend/app/core/features/rnd.py (requirements sub-tabs tasks, milestones, history, technical_offers, documents, discussion, access; departments section; offer_team).
- Sales module frontend: frontend/src/app/dashboard/sales/ (amendments, orders, quotations, reports, settings); backend/app/modules/sales/.
- R&D calculator pages are untouchable.
