# Manager registry batch (collected from builder reports)

## Done
- permission_registry.py: crm ("products","Products",CRUD) tab.
- main.py + alembic/env.py: import RndRequirement, RndRequirementRevision.

## S7
- api.ts: remove projectsApi.salesOrdersAwaitingProject, createFromSalesOrder (~1575-1579).
- types: PmProject += source_kind?: 'inquiry'|'tender'|null, source_id?: number|null;
  ProjectUnitsResponse += project_level?: { departments?: Partial<Record<ProjectUnitDepartment, ProjectUnitCell|null>> } | null.
- ProjectWorkspace.tsx:53 Units tab shown only when project.sales_order_id → show for all (can('projects','overview','view')).
- Open: PM New Project form still asks typed "Sales order (SO) number" (plain text) — report to owner.
- DONE: ProjectWorkspace.tsx Units tab for all projects.
- test:ui errors: UnitsTab.tsx:69 table without RowCount; CreateProjectChooser.tsx:28 custom button box → fix in integration.
- Run: pytest app/tests/test_pm_project_create_rules.py test_project_budget_link.py test_pm_project_with_machine.py.

## S4
- api.ts: remove salesApi block (~4877-4957). KEEP accountsApi.salesBillingOrders/salesBillingOrder/createInvoiceFromSalesOrder.
- types: keep SalesBillingDue, SalesBillingDueRow, SalesBillableOrder; remove other Sales* types after S5 deletes SalesOrderHandoff + grep.
- Sidebar ~91-97: delete Sales entry; no Products entry.
- useAuth.ts:68: drop 'sales' and 'products' from useRequireApp union.
- Backend must keep accounts:sales_invoices.bill_from_so feature + sales_billing route (S2 told).
- Backend: customer advance without sales_order_id but with reason must be accepted (check accounts payments route).
- Backend: store issue_forms.py rule "unless:sales_order" on erp_project_id → required (check git status; store is another session's).
- Bell types: rnd_requirement_accepted / rnd_requirement_returned / rnd_review_reminder (sent to S3, S5).
- .next cache stale: ask owner before clearing.

## S6
- types/index.ts → 'standard'|'urgent' (or Priority): PmPriority ~4900, ProductionPriority ~6631, ElectricalPriority ~7747, RndTaskPriority ~1103, RndProjectPriority ~5438; inline: P2PRequest.priority ~1562, PmDeptSubtask ~5230, DesignChangeNotice ~8259, DesignRequest ~8846, ProductionRrvBuild ~9536. Leave CollectionWorklistRow.
- PROTECTED (other session) hunks → tell owner / apply after their commit: p2p/routes/pre_po_receipts.py:102 "medium"→"standard"; frontend p2p/[id]/page.tsx:109,110,544 two-value labels.
- projectsShared.ts:25-28 tour priority list (S7 owned, S7 finished) → Manager fix.
- test_cov_projects_lifecycle / test_pm_project_create_rules use high/critical → fix in integration.
- Relayed: S8 (order_project_links, mrp), S5 (TenderDetailPanel, TasksBoard), S2 (inquiries priority_label).
- Run later: pytest test_priority_api, maintenance, design, production*, erp_service_requests, notifications, p2p_*, crm_* .

## S5 (full snippet text is in S5 hand-back; key points)
- api.ts rndApi: listRequirements, getRequirement, acceptRequirement, returnRequirement, listTechnicalOffers, uploadTechnicalOffer, downloadTechnicalOfferFile, uploadWorkDocuments(category), setDocumentCategory, listRndTasks, rndTaskAnalytics, createRndTask; progress payloads += progress_percent. Types from '@/types/rndIntake' (new file by S5).
- api.ts crmApi: getRndRequirement, listTechnicalOffers, technicalOfferFile, uploadBdTechnicalOffer, deleteBdTechnicalOffer.
- types: RndTaskPriority/RndProjectPriority = Priority; RndProjectOrigin = 'existing_projects'|'new_project'; RndTask += progress_percent?, progress_from_checklist?, requirement_changed?; RndProjectHistoryEntry.kind → string.
- NotificationBell.tsx lines 56-58: design/electrical/hydraulic_rnd_requirement links point to deleted pages → redirect to R&D requirement or drop.
- crmSettings.ts tour still describes Discussion rule → fix.
- Contract sent to S3 for alignment.

## S8
- CONTRACT MISMATCH: GET /projects/{id}/units returns has_units + whole_project{label, machine_*, lifecycle_stage*, departments}; S7 UnitsTab reads project_level.departments → fix UnitsTab to whole_project.
- types: ProjectUnitLookupItem += project_level, machine_id, machine_serial; ProjectWholeRow; ProjectUnitsResponse += has_units, whole_project (instead of S7's project_level).
- production/routes/work_orders.py (S6 edited, ours): ~331 inherit build.order_project_id; ~679 secure_issue_qty(project_id=wo.order_project_id).
- production/schemas/rrv_build.py: ProductionRrvBuildCreate.priority default "normal" → "standard".
- main.py: remove sales routers, sales_billing? (KEEP sales_billing per override), sales_scheduler, requirement_discussion, department_requirements; mount sales/retired_routes.py.
- material_issues.py hunk sent to S2.
