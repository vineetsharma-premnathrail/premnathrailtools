# Permission matrix as declared in code (2026-11-03)

## organization — Organization

| tab key | label | group | actions | features (kind) |
|---|---|---|---|---|
| info | Company Info |  | view, edit | statutory (section: Legal, registration & tax), partners (section: Partners), financial_years (section: Financial years), documents (subtab: Company documents) |
| branches | Branches |  | view, create, edit, delete | user_assignments (subtab: Plant › Users), documents (subtab: Plant › Documents) |
| department | Department |  | view, create, edit, delete |  |
| users | Users |  | view, create, edit | assignments (subtab: User › Assignments), documents (subtab: User › Documents), login_history (subtab: User › Login history), activity (subtab: User › Activity & permission history) |
| roles | Role & Permissions |  | view, create, edit, delete | members (subtab: Role users / user roles), extra_permissions (section: Extra permissions of a user), data_access (subtab: Data access (scope)), notifications (subtab: Notifications) |
| workflows | Approval Workflows |  | view, edit | simulate (action: Preview & check a workflow), reset (action: Reset to default), history (subtab: Change history) |
| delegations | Delegations |  | view, create, edit, delete |  |
| security | Security & Sessions |  | view, edit |  |
| audit_logs | Audit Logs |  | view |  |
| access_reviews | Access Reviews |  | view, edit |  |
| grc | Access Risk (SoD) |  | view, edit |  |
| monitor | System Monitor (jobs, errors, denied access) |  | view, edit |  |
| cockpit | Management Cockpit |  | view |  |

## erp — Service & Commissioning

| tab key | label | group | actions | features (kind) |
|---|---|---|---|---|
| dashboard | Dashboard |  | view |  |
| service_requests | Service Requests |  | view, create, edit, delete, export, print, import | rca (subtab: Diagnostics & RCA), materials (subtab: Materials / spares), purchase_requisition (action: Raise PR from SR), spare_issue (action: Issue / return spares from Store), visits (subtab: Service visits), invoice (action: Warranty & service invoice), attachments (subtab: Attachments), audit_trail (subtab: Audit trail), charges (sensitive: Charges, costs & billing amounts) |
| service_contracts | Service Contracts (AMC / CMC) |  | view, create, edit, delete, submit, approve, reject, cancel, export, print | billing_plan (section: Billing plan & period invoices), renew (action: Renew contract), service_requests (section: Service requests on the contract) |
| reports | Reports |  | view, export, print | management (sensitive: People & performance) |
| recycle_bin | Recycle Bin |  | view, edit |  |
| settings | Settings |  | view, edit |  |

## crm — CRM

| tab key | label | group | actions | features (kind) |
|---|---|---|---|---|
| dashboard | Dashboard |  | view |  |
| organizations | Customer Organizations |  | view, create, edit, delete, export, import | contacts (subtab: Contacts), linked_records (subtab: Inquiries & Tenders of the customer organization), audit_trail (subtab: Audit trail) |
| inquiries_tenders | Inquiries & Tenders |  | view, create, edit, delete, approve, reject, export, print | quotations (subtab: Quotations), documents (subtab: Documents), technical_offer (action: Technical Offers (BD upload)), followups (subtab: Follow-ups), timeline (subtab: Timeline), tender_dates (subtab: Tender dates), send_tor (action: Send Technical Requirement (TOR) to R&D), stage (action: Move pipeline stage), bd_owner (section: BD owner), sales_engineer (section: Sales engineer), customer_contact (section: Customer Organization & contact person), prices (sensitive: Prices & margins) |
| products | Products |  | view, create, edit, delete | specifications (section: Technical specifications), prices (sensitive: Prices & sales values), pricing (section: Pricing) |
| reports | Reports |  | view, export, print | management (sensitive: People & performance) |
| settings | Settings |  | view, edit |  |

## p2p — Procurement

| tab key | label | group | actions | features (kind) |
|---|---|---|---|---|
| purchase_requisitions | Purchase Requisitions |  | view, create, edit, delete, submit, approve, reject, cancel, export, print | my_requisitions (subtab: My Requisitions tab), all_requisitions (subtab: All Requisitions tab), approvals (subtab: Approvals tab), purchase_order (section: Purchase order block), fulfilment (action: Stock check & issue from stock), buyer (action: Assign buyer), my_lines (subtab: My Lines tab), all_lines (action: All buyers' lines (purchase head)), attachments (section: Attachments), close (action: Close / short-close), history (section: Audit history), prices (sensitive: Prices & PO values) |
| vendors | Vendors |  | view, create, edit, delete, export, import | documents (subtab: Vendor documents), catalog (subtab: Vendor catalog), info_records (subtab: Item rates & approved vendors), prices (sensitive: Prices & rates) |
| rfq | R.F.Q |  | view, create, edit, delete, approve, reject, export, print | vendor_quotes (subtab: Vendor quotations), evaluation (action: Technical & commercial evaluation), comparison (subtab: Quotation comparison), award (action: Award / split award), prices (sensitive: Prices & rates) |
| purchase_orders | Purchase Orders |  | view, create, edit, delete, submit, approve, reject, cancel, export, print | amendments (subtab: Amendments & versions), delivery_costs (section: Delivery costs), service_entries (section: Service entries), po_document (action: PO document), link_item (action: Link PO line to Item Master), history (section: PO history), prices (sensitive: Prices & rates) |
| mis | M.I.S Report |  | view, export, print |  |
| purchase_desk | Purchase Desk (buyer — handles RFQs, POs and vendors for every PR) |  | view |  |
| settings | Settings |  | view, edit |  |

## rnd — R&D

| tab key | label | group | actions | features (kind) |
|---|---|---|---|---|
| dashboard | Dashboard |  | view |  |
| project_work | Ongoing Projects |  | view, edit |  |
| requirements | Requirements |  | view, create, edit | customer (section: Customer & contact), crm_info (section: From CRM (commercial)), product_requirement (section: Product requirement), projects (section: Linked projects), crm_request (section: CRM request & response), tasks (subtab: Tasks), history (subtab: Timeline), review (action: Review (accept / return to BD)), technical_offers (subtab: Technical Offers), offer_team (action: Technical Offer team (every requirement)), documents (subtab: Documents) |
| tasks | R&D Tasks |  | view, create | analytics (action: All R&D tasks & analytics) |
| projects | Prototype / Research |  | view, create, edit, delete, approve | tasks (section: Project tasks), team (section: Project lead & team) |
| experiments | Experiments & Tests |  | view, create, edit, delete | conducted_by (section: Conducted by) |
| prototypes | Prototypes |  | view, create, edit, delete, approve | release_production (action: Release to Production), costs (sensitive: BOM costs) |
| documents | Documents |  | view, create, edit, delete |  |
| all | Engineering Tools (landing) | Engineering Tools | view |  |
| braking | Braking | Engineering Tools | view, create, print |  |
| hydraulic | Hydraulic | Engineering Tools | view, create, print |  |
| qmax | Qmax | Engineering Tools | view, create, print |  |
| load_distribution | Load Distribution | Engineering Tools | view, create, print |  |
| tractive_effort | Tractive Effort | Engineering Tools | view, create, print |  |
| vehicle_performance | Vehicle Performance | Engineering Tools | view, create, print |  |
| spline | Spline | Engineering Tools | view, create, print |  |
| history | Calculation History | Engineering Tools | view, delete, export |  |

## design — Design

| tab key | label | group | actions | features (kind) |
|---|---|---|---|---|
| dashboard | Dashboard |  | view |  |
| ongoing_projects | Ongoing Projects |  | view, edit |  |
| project_work | Requests |  | view, create, edit, delete, approve, reject, export, print | technical_requirement (section: Technical requirement), request_progress (action: Accept & progress requests), deliverables (section: Deliverables), timeline (section: Timeline & comments) |
| tasks | My Work |  | view, edit |  |
| documents | Drawings |  | view, create, edit, delete, submit, approve, cancel, export, print | check_release (action: Check, approve & release), revisions (action: Revisions), files (section: Revision files), obsolete (action: Obsolete & reactivate), where_used (section: Where used), timeline (section: Timeline & comments), owner (action: Owner) |
| boms | BOMs |  | view, create, edit, delete, submit, approve, cancel, export, print | check_release (action: Check & release), revisions (action: Revisions & lines), explosion (section: Explosion & export), obsolete (action: Obsolete & reactivate), where_used (section: Where used), timeline (section: Timeline & comments), owner (action: Owner) |
| reviews | Reviews & Approvals |  | view, approve, reject | customer_submissions (subtab: Customer submissions), customer_response (action: Record customer response), comment_actions (section: Customer comment actions) |
| change_notices | Changes (ECR / ECN) |  | view, create, edit, delete, submit, approve, reject, cancel, export, print | ecr_impact (action: ECR impact check), ecr_vote (action: Change board vote), ecr_decision (action: Decide ECRs), ecr_to_ecn (action: Create ECN from ECR), ecn_effectivity (action: ECN effectivity & disposition), ecn_release (action: Release ECN), ecn_acknowledge (action: Acknowledge ECN), cost_impact (sensitive: Cost impact of changes) |
| library | Library |  | view, create, edit, delete | standards (subtab: Standards), standard_parts (subtab: Standard parts), approved_makes (subtab: Approved makes), templates (subtab: Templates), checklists (subtab: Review checklists) |
| reports | Reports |  | view, export, print |  |
| settings | Settings |  | view, edit |  |

## electrical — Electrical

| tab key | label | group | actions | features (kind) |
|---|---|---|---|---|
| dashboard | Dashboard |  | view |  |
| project_work | Ongoing Projects |  | view, edit |  |
| jobs | RRV Electrical Jobs |  | view, create, edit, delete, submit, approve, cancel, print | lead_engineer (action: Lead engineer), stages (subtab: Stages), requirement (section: Electrical requirement), bom (subtab: BOM), panels (subtab: Panels), cables (subtab: Cables), drawings (subtab: Drawings), tests (subtab: Tests), issues (subtab: Troubleshooting), handover (subtab: QC & Handover), documents (subtab: Documents), job_status (action: Hold, resume, cancel & close), costs (sensitive: BOM costs) |
| drawings | Drawings |  | view, create, edit, delete, approve |  |
| purchase | Purchase Requirements |  | view, create, edit, delete |  |
| testing | Testing |  | view, create, edit, delete, print |  |
| troubleshooting | Troubleshooting |  | view, create, edit, delete |  |

## hydraulic — Hydraulic & Pneumatic

| tab key | label | group | actions | features (kind) |
|---|---|---|---|---|
| dashboard | Dashboard |  | view |  |
| project_work | Ongoing Projects |  | view, edit |  |
| systems | Systems |  | view, create, edit, delete | documents (subtab: Documents), owner (action: System owner) |
| components | Component Master |  | view, create, edit, delete, export, import | documents (subtab: Documents) |
| circuits | Circuits & Diagrams |  | view, create, edit, delete, approve | documents (subtab: Documents), revisions (section: Revision history), submit_review (action: Submit for review) |
| bom | BOM |  | view, create, edit, delete, submit, approve, cancel, export | revise (action: Raise new revision), costs (sensitive: Prices & costs) |
| calculations | Calculations |  | view, create, edit, delete |  |
| testing | Testing & Inspection |  | view, create, edit, delete, submit, approve, cancel, print | documents (subtab: Documents), retest (action: Raise re-test), tester (action: Tester) |

## maintenance — Maintenance

| tab key | label | group | actions | features (kind) |
|---|---|---|---|---|
| dashboard | Dashboard |  | view |  |
| project_work | Ongoing Projects |  | view, edit |  |
| requests | Requests |  | view, create, edit | triage (action: Acknowledge / reject requests) |
| work_orders | Work Orders |  | view, create, edit, approve, reject, export, print | assign (action: Assign technician), checklist (section: Checklist), spares (section: Spares), labour (section: Labour), permits (section: Work permits (PTW / LOTO)), purchase (section: Outside purchase (PR)), documents (section: Service reports & photos), close_out (action: Verify, close, reopen & cancel), costs (sensitive: Maintenance costs) |
| assets | Assets / AMC & Warranty |  | view, create, edit, delete, export, import | history (section: Maintenance history), readings (section: Meter readings & measuring points), spare_parts (section: Spare parts list), documents (section: Documents) |
| schedule | PM Schedule |  | view, create, edit, delete | default_assignee (section: Default technician) |
| spares | Spares |  | view, create, edit, delete, export |  |
| reports | Maintenance Reports |  | view, export, print |  |
| settings | Settings |  | view, edit |  |

## production — Production

| tab key | label | group | actions | features (kind) |
|---|---|---|---|---|
| dashboard | Dashboard |  | view |  |
| project_work | Ongoing Projects |  | view, edit |  |
| rrv_builds | RRV Builds |  | view, create, edit, delete, approve, reject, export, print | build_manager (section: Build manager), stages (section: Stage plan), work_orders (subtab: Work orders & consumption), tests (subtab: Tests), rework (subtab: Rework), handover (subtab: Handover), timeline (subtab: Timeline), costs (sensitive: Consumption values) |
| work_orders | Work Orders |  | view, create, edit, delete, approve, reject, export, print | materials (subtab: Materials), operations (subtab: Operations), output (subtab: Output & stock), time_logs (subtab: Time logs), sub_orders (section: Sub-assembly orders), release (action: Release to shop floor), lifecycle (action: Complete, close & cancel), job_card (action: Job card), supervisor (section: Supervisor), costs (sensitive: Work-order costing) |
| shop_floor | Shop Floor |  | view, create, edit, delete | run_operations (action: Run operations), job_work (action: Link job-work challan) |
| planning | Planning |  | view, create, edit | mrp_run (action: Run MRP), planned_orders (action: Planned orders), convert_wo (action: Convert to work order), convert_pr (action: Convert to purchase requisition) |
| bom | BOM & Routing |  | view, create, edit, delete, approve, export, print | routing (section: Routing), design_link (section: Design BOM link), discipline_merge (action: Electrical & hydraulic merge), explosion (section: Multi-level explosion), lifecycle (action: Activate, obsolete & new versions), costs (sensitive: BOM costs) |
| workstations | Workstations |  | view, create, edit, delete |  |
| reports | Production Reports |  | view, export, print | costs (sensitive: Cost & WIP reports) |

## store — Store

| tab key | label | group | actions | features (kind) |
|---|---|---|---|---|
| items | Items |  | view, create, edit, delete, export, import | plant_data (section: Plant data (MRP per plant)), vendor_suggestions (section: Who can supply this item), stock_values (sensitive: Stock value & rates) |
| stock | Stock |  | view, export, print | as_of (section: Stock on a date) |
| bins | Bins (rack / shelf / bin) |  | view, create, edit, delete |  |
| movements | Movements |  | view, export, print |  |
| issues | Issues |  | view, create, edit, delete, export, print | job_work (subtab: Job work (subcontracting)), job_work_receipts (action: Receive processed items (job work receipt)) |
| reservations | Reservations |  | view, create, edit, delete |  |
| adjustments | Adjustments |  | view, create, edit, delete, approve, reject, export, print | approver (action: Name the approving Store Manager), cycle_count (action: Physical / cycle count), quarantine_clear (action: Clear blocked stock), batch_status (action: Block / release a batch) |
| returns | Returns |  | view, create, edit, delete, approve, reject, export, print |  |
| transfers | Transfers |  | view, create, edit, delete, approve, reject, export, print | dispatch (action: Dispatch a transfer), receive (action: Receive a transfer), bin_moves (action: Bin-to-bin moves (put-away)) |
| grn | GRN & Quality check |  | view, create, edit, delete, approve, reject, export, print | inspection (action: Quality inspection decision), return_to_vendor (action: Return to vendor), reverse (action: Reverse a GRN), mill_tc (action: Upload mill test certificates) |
| project_work | Ongoing Projects |  | view, edit |  |
| settings | General settings | Settings | view, edit |  |
| item_types | Item Types | Settings | view, create, edit, delete |  |
| uoms | Units of Measure | Settings | view, create, edit, delete |  |
| categories | Categories | Settings | view, create, edit, delete |  |
| warehouses | Stores (locations) | Settings | view, create, edit, delete |  |
| entry_types | Stock Entry Types | Settings | view, create, edit, delete |  |
| issue_types | Issue Types | Settings | view, create, edit, delete |  |
| issue_rules | Issue Rules | Settings | view, create, edit, delete |  |

## quality — Quality

| tab key | label | group | actions | features (kind) |
|---|---|---|---|---|
| dashboard | Dashboard |  | view |  |
| project_work | Ongoing Projects |  | view, edit |  |
| my_inspections | My Inspections |  | view, edit |  |
| inspection_lots | Inspection Lots |  | view, create, edit, delete, approve, print | results (action: Inspection results), usage_decision (action: Usage decision), assign (action: Assign inspector), photos (section: Photos) |
| ncr | Non-Conformance (NCR) |  | view, create, edit, delete, approve, reject, export, print | disposition (action: Disposition), action_verify (action: Action & verification), closure (action: Close & cancel), costs (sensitive: Cost of non-quality) |
| inspection_plans | Inspection Plans |  | view, create, edit, delete, submit, approve, cancel |  |
| masters | Masters (Characteristics, Defects, Dispositions, Sampling) |  | view, create, edit | calibration (action: Gauge calibration) |
| in_process_inspection | In-process (Operation Gate) Inspections |  | view, create, edit, delete, approve |  |
| final_inspection | RRV Final Inspections |  | view, create, edit, delete, approve, print |  |
| first_article | First Article Inspection (FAI) |  | view, create, edit, approve, print | decision (action: First-article decision) |
| inspection_calls | Customer / Third-party Inspection Calls |  | view, create, edit, approve, print |  |
| standards | Standards |  | view, create, edit, delete |  |
| capa | Corrective & Preventive Actions |  | view, create, edit, approve | owner (section: CAPA owner), team (section: D1 — Team), actions (section: D5 / D7 — Actions), effectiveness (action: D8 — Effectiveness & closure) |
| complaints | Customer Complaints |  | view, create, edit, approve | owner (section: Complaint owner), costs (sensitive: Cost of the complaint) |
| supplier_quality | Supplier Quality |  | view, create, edit, approve | audits (section: Vendor audits) |
| documents | Quality Documents |  | view, create, edit, delete |  |
| reports | Quality Reports |  | view, export, print |  |
| settings | Quality Settings |  | view, edit |  |

## projects — Project Management

| tab key | label | group | actions | features (kind) |
|---|---|---|---|---|
| dashboard | Dashboard |  | view |  |
| all_projects | All Projects |  | view, create, edit, delete, export, print, import | technical_specs (subtab: Technical specs & operator), client_contacts (section: Client & site contacts), warranty (section: Warranty & AMC), service_history (subtab: Maintenance history), production (subtab: Production work orders), documents (subtab: Uploaded documents), letters (action: Delivery letters & certificates), audit_trail (subtab: Audit trail), store_issues (subtab: Store Issues), purchases (subtab: Purchases), task_history (subtab: Tasks) |
| department_board | Department Board |  | view |  |
| department_work | Department Work |  | view, edit |  |
| my_tasks | My Tasks |  | view, edit |  |
| overview | Overview | Project workspace | view, edit | milestones (subtab: Milestones), milestone_status (action: Achieve, reopen & cancel milestones), tasks (action: Tasks in a milestone), task_checklist (subtab: Task › Checklist), task_files (subtab: Task › Files), task_comments (subtab: Task › Comments), task_log (subtab: Task › Activity Log) |
| milestones | WBS | Project workspace | view, create, edit, delete |  |
| documents | Documents | Project workspace | view, create, edit, delete |  |
| project_history | History | Project workspace | view | store_issues (subtab: Store Issues), purchases (subtab: Purchases), task_history (subtab: Tasks) |

## accounts — Finance & Accounting

| tab key | label | group | actions | features (kind) |
|---|---|---|---|---|
| company_fy | Company & FY | Masters | view, edit |  |
| account_groups | Account Groups | Masters | view, create, edit, delete |  |
| ledgers | Ledgers | Masters | view, create, edit, delete, export, import |  |
| ledger_settings | Ledger Settings | Masters | view, edit |  |
| gst_rates | GST Rates | Masters | view, create, edit, delete |  |
| bank_cash_accounts | Bank & Cash Accounts | Masters | view, create, edit, delete |  |
| vendors | Vendors | Masters | view, create, edit, delete, export, import | bank_details (section: Vendor bank details) |
| internal_orders | Internal Orders | Masters | view, create, edit, delete |  |
| opening_balances | Opening Balances | Masters | view, edit, import |  |
| settings | Finance Settings | Masters | view, edit |  |
| currencies | Currencies & FX | Masters | view, create, edit, approve, export | exchange_rates (action: Exchange rates), revaluation (subtab: FX revaluation) |
| journal_vouchers | Journal Vouchers | Journals | view, create, edit, delete, submit, approve, reject, cancel, export, print | reversal (action: Reverse posted journals), change_history (section: Change history), proof (section: Supporting documents) |
| day_book | Day Book | Journals | view, export, print |  |
| ledger_statement | Ledger Statement | Journals | view, export, print |  |
| period_close | Period Close | Journals | view, edit, approve |  |
| purchase_invoices | Purchase Invoices | Purchase | view, create, edit, delete, submit, approve, reject, cancel, export, print | variance_approval (action: Approve 3-way-match variance), settlements (section: Payments against the invoice), proof (section: Supporting documents) |
| debit_notes | Debit Notes | Purchase | view, create, edit, delete, submit, approve, reject, cancel, export, print | proof (section: Supporting documents) |
| sales_invoices | Sales Invoices | Sales | view, create, edit, delete, submit, approve, reject, cancel, export, print | bill_from_so (action: Bill from sales order), e_invoice (action: E-invoice details), settlements (section: Receipts against the invoice), proof (section: Supporting documents) |
| credit_notes | Credit Notes | Sales | view, create, edit, delete, submit, approve, reject, cancel, export, print | proof (section: Supporting documents) |
| payments | Payments & Receipts | Payments | view, create, edit, delete, approve, reject, export, print | allocation (action: Allocate payments to bills), write_offs (action: Write-offs & short payments), cancellation (action: Cancel payment vouchers), payment_block (action: Block invoices for payment), proof (section: Supporting documents) |
| payment_runs | Payment Runs (proposals) | Payments | view, create, edit, delete, submit, approve, reject, cancel, export, print | execution (action: Execute payment runs), bank_file (action: Download bank payment file) |
| bank_book | Bank / Cash Book | Bank & Cash | view, export, print |  |
| reconciliation | Reconciliation (BRS) | Bank & Cash | view, create, edit, delete, export | bank_statements (section: Bank statement import), book_statement_lines (action: Book from statement), completion (action: Complete reconciliation) |
| liquidity | Liquidity Forecast | Bank & Cash | view, create, edit, delete, export, print |  |
| guarantees | Bank Guarantees, LC & EMD | Bank & Cash | view, create, edit, delete, submit, approve, reject, cancel, export, print | lifecycle (action: Issue, extend & release), bank_postings (action: Margin money & commission), invocation (action: Record invocation), instrument_copy (section: Instrument copy) |
| gst | GST Registers & Returns | GST | view, edit, export, print | gstr1 (subtab: GSTR-1), gstr3b (subtab: GSTR-3B), itc_setoff (subtab: ITC set-off) |
| outstanding | Receivables & Payables | Outstanding | view, export, print | receivables (subtab: Receivables (customers)), payables (subtab: Payables (vendors)), msme_dues (subtab: MSME dues) |
| collections | Collections & Dunning | Outstanding | view, create, edit, export, print | dunning (action: Dunning & reminder letters) |
| disputes | Disputes | Outstanding | view, create, edit, export | resolution (action: Resolve disputes) |
| credit_management | Credit Management | Outstanding | view, approve, export |  |
| inventory | Stock Value & Closing Stock | Inventory | view, edit, export, print | purchase_sales_impact (subtab: Purchase / sales impact), closing_stock (subtab: Closing stock) |
| fixed_assets | Asset Register | Assets | view, create, edit, delete, export | capitalisation (subtab: Capitalisation), retirements (subtab: Retirements), asset_reconciliation (subtab: Asset reconciliation) |
| depreciation | Depreciation | Assets | view, approve, export | reversal (action: Reverse depreciation runs) |
| tax_depreciation | Tax Depreciation & Deferred Tax | Assets | view, edit, export |  |
| financial_reports | Financial Reports | Reports | view, export, print |  |
| year_end_close | Year-end Close | Reports | view, approve |  |
| product_costing | Product Costing (cost estimates) | Controlling | view, create, edit, delete, approve, export, print | order_variance (subtab: Order variance), price_history (section: Standard price history) |
| profit_centers | Profit Centres | Controlling | view, create, edit, delete | pl_report (subtab: Profit centre P&L), assignment (action: Assign & re-derive) |
| profitability | Profitability | Controlling | view, export, print | line_items (section: Line-item drill-down) |
| co_planning | Cost Centre Planning | Controlling | view, create, edit, delete, approve, export, import | plan_vs_actual (subtab: Plan vs actual) |
| activity_rates | Activity Types & Rates | Controlling | view, create, edit, delete |  |
| allocations | Assessment & Distribution | Controlling | view, create, edit, delete, approve | reversal (action: Reverse allocation runs) |
| overhead | Overhead (Costing Sheet) | Controlling | view, create, edit, delete, approve | reversal (action: Reverse overhead runs) |

## hr — HR & Administration

| tab key | label | group | actions | features (kind) |
|---|---|---|---|---|
| dashboard | Dashboard |  | view |  |
| me | My HR (self-service) |  | view, create, edit |  |
| approvals | Approvals |  | view, approve, reject |  |
| employees | Employees |  | view, create, edit, delete | personal (section: Personal details & contact), statutory_ids (sensitive: Statutory IDs (PAN, Aadhaar, UAN, ESIC)), hr_notes (section: HR remarks), assignment (subtab: Assignment history), documents (subtab: Documents), lifecycle (subtab: Lifecycle sub-tab), leave (subtab: Leave sub-tab), attendance (subtab: Attendance sub-tab), assets (subtab: Assets sub-tab) |
| org_chart | Org Chart |  | view |  |
| lifecycle | Lifecycle |  | view, create, edit, delete, approve | checklist (action: Manage checklist items) |
| leave | Leave |  | view, create, edit, delete, approve, reject, export | balance_admin (action: Allot & adjust leave balances) |
| attendance | Attendance |  | view, create, edit, delete, export, import | roster (subtab: Shift roster), punches (subtab: Biometric punches), periods (subtab: Payroll periods) |
| holidays | Holidays |  | view, create, edit, delete |  |
| assets | Assets |  | view, create, edit, delete |  |
| visitors | Visitors |  | view, create, edit, delete | gate_desk (action: Gate check-in / check-out) |
| travel | Travel & Claims |  | view, create, edit, delete, approve, reject | complete_trip (action: Mark trip completed), claim_payment (action: Record claim payment) |
| safety | Safety (EHS incidents) |  | view, create, edit, delete, approve, export, print | investigation (section: Investigation), capa (action: CAPA actions), statutory (section: Statutory reporting (Form 18)) |
| reports | Statutory registers & reports |  | view, export, print |  |
| masters | Masters |  | view, create, edit, delete |  |
| settings | Settings |  | view, edit |  |

