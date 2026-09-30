"""Which models the automatic audit trail (app/core/audit.py) covers, and how
each one is labelled. Imported once from app/main.py. To audit a new model,
add a register_audited() call here; nothing in its routes needs to change."""

from app.core.audit import register_audited

from app.modules.quality.models.ncr import QualityNcr
from app.modules.quality.models.capa import QualityCapa
from app.modules.quality.models.customer_complaint import QualityCustomerComplaint
from app.modules.quality.models.inspection import QualityInspection, QualityInspectionResult, QualityInspectionAttachment
from app.modules.quality.models.inspection_plan import QualityInspectionPlan
from app.modules.quality.models.rejection import QualityRejection
from app.modules.quality.models.quality_standard import QualityStandard
from app.modules.quality.models.quality_checklist import QualityChecklist, QualityChecklistItem
from app.modules.quality.models.supplier_quality import QualitySupplierScorecard
from app.modules.quality.models.quality_document import QualityDocument

from app.modules.maintenance.models.asset import MaintenanceAsset
from app.modules.maintenance.models.request import MaintenanceRequest
from app.modules.maintenance.models.work_order import (
    MaintenanceWorkOrder, MaintenanceWorkOrderTask, MaintenanceWorkOrderSpare, MaintenanceLabourLog,
)
from app.modules.maintenance.models.attachment import MaintenanceAttachment
from app.modules.production.models.workstation import ProductionWorkstation
from app.modules.production.models.bom import ProductionBom, ProductionBomItem, ProductionBomOperation
from app.modules.production.models.work_order import (
    ProductionWorkOrder, ProductionWorkOrderMaterial, ProductionWorkOrderOperation, ProductionTimeLog,
)
from app.modules.production.models.rrv_build import (
    ProductionRrvBuild, ProductionRrvBuildStage, ProductionRrvTest, ProductionReworkOrder, ProductionRrvEvent,
)

from app.modules.electrical.models.job import ElectricalJob, ElectricalJobStage
from app.modules.electrical.models.panel import ElectricalPanel
from app.modules.electrical.models.bom import ElectricalBomItem
from app.modules.electrical.models.cable import ElectricalCable
from app.modules.electrical.models.drawing import ElectricalDrawing, ElectricalDrawingRevision
from app.modules.electrical.models.test_record import ElectricalTest
from app.modules.electrical.models.issue import ElectricalIssue
from app.modules.electrical.models.document import ElectricalDocument

from app.modules.design.models.document import DesignDocument, DesignDocumentRevision, DesignRevisionFile
from app.modules.design.models.change_notice import DesignChangeNotice, DesignChangeNoticeDocument

from app.modules.hydraulic.models.system import HydSystem
from app.modules.hydraulic.models.component import HydComponent
from app.modules.hydraulic.models.circuit import HydCircuit
from app.modules.hydraulic.models.bom import HydBom, HydBomItem
from app.modules.hydraulic.models.calculation import HydCalculation
from app.modules.hydraulic.models.testing import HydTest, HydTestReading
from app.modules.hydraulic.models.maintenance import HydMaintenancePlan, HydServiceRecord, HydServicePart
from app.modules.hydraulic.models.spare_part import HydSparePart
from app.modules.hydraulic.models.document import HydDocument
from app.modules.rnd.models.project import RndProject
from app.modules.rnd.models.experiment import RndExperiment
from app.modules.rnd.models.prototype import RndPrototype, RndPrototypeBomItem
from app.modules.rnd.models.feasibility import RndFeasibilityStudy
from app.modules.rnd.models.document import RndDocument

from app.modules.store.models.item import StoreItem
from app.modules.store.models.category import StoreItemCategory
from app.modules.store.models.location import StoreLocation
from app.modules.store.models.bin import StoreBin
from app.modules.store.models.material_issue import StoreMaterialIssue, StoreMaterialIssueItem
from app.modules.store.models.material_return import StoreMaterialReturn, StoreMaterialReturnItem
from app.modules.store.models.stock_transfer import StoreStockTransfer, StoreStockTransferItem
from app.modules.store.models.stock_adjustment import StoreStockAdjustment, StoreStockAdjustmentItem
from app.modules.store.models.stock_reservation import StoreStockReservation
from app.modules.store.models.stock_transaction import StoreStockTransaction

from app.modules.organization.models.company import Company
from app.modules.organization.models.company_address import CompanyAddress
from app.modules.organization.models.company_contact import CompanyContact
from app.modules.organization.models.company_financial_year import CompanyFinancialYear
from app.modules.organization.models.company_document import CompanyDocument
from app.modules.organization.models.branch import Branch
from app.modules.organization.models.branch_address import BranchAddress
from app.modules.organization.models.branch_user_assignment import BranchUserAssignment
from app.modules.organization.models.branch_document import BranchDocument
from app.modules.organization.models.department import Department
from app.modules.organization.models.cost_center import CostCenter

from app.modules.hr.models.masters import HrGrade, HrDesignation, HrShift
from app.modules.hr.models.holiday import HrHoliday
from app.modules.hr.models.employee_profile import HrEmployeeProfile
from app.modules.hr.models.lifecycle import HrLifecycleEvent, HrChecklistTemplate, HrChecklistItem
from app.modules.hr.models.leave import HrLeaveType, HrLeaveBalance, HrLeaveRequest
from app.modules.hr.models.attendance import HrAttendance, HrAttendanceRegularization
from app.modules.hr.models.asset import HrAsset, HrAssetAssignment
from app.modules.hr.models.visitor import HrVisitor
from app.modules.hr.models.travel import HrTravelRequest
from app.modules.hr.models.expense import HrExpenseClaim, HrExpenseClaimItem

# ---------------------------------------------------------------------------
# Quality
# ---------------------------------------------------------------------------
register_audited(QualityNcr, entity_type="quality_ncr", module_key="quality", label="NCR", ref=lambda o: o.ncr_number)
register_audited(QualityCapa, entity_type="quality_capa", module_key="quality", label="CAPA", ref=lambda o: o.capa_number)
register_audited(QualityCustomerComplaint, entity_type="quality_complaint", module_key="quality", label="Customer complaint", ref=lambda o: o.complaint_number)
register_audited(QualityInspection, entity_type="quality_inspection", module_key="quality", label="Inspection", ref=lambda o: o.inspection_number)
register_audited(
    QualityInspectionResult, entity_type="quality_inspection_result", module_key="quality", label="Inspection result",
    ref=lambda o: f"'{o.parameter}'", parent_attr="inspection_id", parent_entity_type="quality_inspection", child_action="result",
)
register_audited(
    QualityInspectionAttachment, entity_type="quality_inspection_attachment", module_key="quality", label="Inspection attachment",
    ref=lambda o: f"'{o.filename}'", parent_attr="inspection_id", parent_entity_type="quality_inspection", child_action="attachment",
)
register_audited(QualityInspectionPlan, entity_type="quality_inspection_plan", module_key="quality", label="Inspection plan", ref=lambda o: o.plan_number)
register_audited(QualityRejection, entity_type="quality_rejection", module_key="quality", label="Rejection", ref=lambda o: o.rejection_number)
register_audited(QualityStandard, entity_type="quality_standard", module_key="quality", label="Quality standard", ref=lambda o: o.standard_code)
register_audited(QualityChecklist, entity_type="quality_checklist", module_key="quality", label="Quality checklist", ref=lambda o: f"'{o.name}'")
register_audited(
    QualityChecklistItem, entity_type="quality_checklist_item", module_key="quality", label="Checklist item",
    ref=lambda o: f"'{o.parameter}'", parent_attr="checklist_id", parent_entity_type="quality_checklist", child_action="item",
)
register_audited(
    QualitySupplierScorecard, entity_type="quality_supplier_scorecard", module_key="quality", label="Supplier scorecard",
    ref=lambda o: f"{o.vendor_name} ({o.period})",
)
register_audited(QualityDocument, entity_type="quality_document", module_key="quality", label="Quality document", ref=lambda o: f"'{o.title}' ({o.file_name})")

# ---------------------------------------------------------------------------
# Store
# ---------------------------------------------------------------------------
register_audited(StoreItem, entity_type="store_item", module_key="store", label="Item", ref=lambda o: o.item_code)
register_audited(StoreItemCategory, entity_type="store_item_category", module_key="store", label="Item category", ref=lambda o: o.code)
register_audited(StoreLocation, entity_type="store_location", module_key="store", label="Warehouse", ref=lambda o: o.code)
register_audited(StoreBin, entity_type="store_bin", module_key="store", label="Bin", ref=lambda o: o.code)

register_audited(StoreMaterialIssue, entity_type="store_material_issue", module_key="store", label="Material issue", ref=lambda o: o.issue_number)
register_audited(
    StoreMaterialIssueItem, entity_type="store_material_issue_item", module_key="store", label="Issue line",
    ref=lambda o: f"item #{o.item_id} × {o.quantity}", parent_attr="issue_id", parent_entity_type="store_material_issue", child_action="line",
)
register_audited(StoreMaterialReturn, entity_type="store_material_return", module_key="store", label="Material return", ref=lambda o: o.return_number)
register_audited(
    StoreMaterialReturnItem, entity_type="store_material_return_item", module_key="store", label="Return line",
    ref=lambda o: f"item #{o.item_id} × {o.quantity} ({o.condition})", parent_attr="return_id", parent_entity_type="store_material_return", child_action="line",
)
register_audited(StoreStockTransfer, entity_type="store_stock_transfer", module_key="store", label="Stock transfer", ref=lambda o: o.transfer_number)
register_audited(
    StoreStockTransferItem, entity_type="store_stock_transfer_item", module_key="store", label="Transfer line",
    ref=lambda o: f"item #{o.item_id} × {o.quantity}", parent_attr="transfer_id", parent_entity_type="store_stock_transfer", child_action="line",
)
register_audited(StoreStockAdjustment, entity_type="store_stock_adjustment", module_key="store", label="Stock adjustment", ref=lambda o: o.adjustment_number)
register_audited(
    StoreStockAdjustmentItem, entity_type="store_stock_adjustment_item", module_key="store", label="Adjustment line",
    ref=lambda o: f"item #{o.item_id}: {o.existing_quantity} → {o.actual_quantity}",
    parent_attr="adjustment_id", parent_entity_type="store_stock_adjustment", child_action="line",
)
register_audited(StoreStockReservation, entity_type="store_stock_reservation", module_key="store", label="Stock reservation", ref=lambda o: o.reservation_number)

# Ledger postings made by a Store document above are already captured by that
# document's own header and line rows. Everything else (manual entries, GRN
# stock-in from P2P, direct PR receipts) is audited here, one row per posting.
# "work_order" postings are captured by the Production work order's own
# material lines (issued/returned qty) and header (quantity_completed).
_DOCUMENT_REFERENCE_TYPES = {"material_issue", "material_return", "stock_transfer", "stock_adjustment", "work_order"}
register_audited(
    StoreStockTransaction, entity_type="store_stock_transaction", module_key="store", label="Stock ledger entry",
    ref=lambda o: f"{o.transaction_type} item #{o.item_id} × {o.quantity} ({o.reference_type or 'manual'} {o.reference_number or ''})".replace(" )", ")"),
    skip=lambda o: o.reference_type in _DOCUMENT_REFERENCE_TYPES,
)

# ---------------------------------------------------------------------------
# Organization
# ---------------------------------------------------------------------------
register_audited(Company, entity_type="company", module_key="organization", label="Company info", ref=lambda o: o.name)
register_audited(
    CompanyAddress, entity_type="company_address", module_key="organization", label="Company address",
    ref=lambda o: o.address_type, parent_attr="company_id", parent_entity_type="company", child_action="address",
)
register_audited(
    CompanyContact, entity_type="company_contact", module_key="organization", label="Company contact",
    ref=lambda o: o.contact_person, parent_attr="company_id", parent_entity_type="company", child_action="contact",
)
register_audited(
    CompanyFinancialYear, entity_type="company_financial_year", module_key="organization", label="Financial year",
    ref=lambda o: o.name, parent_attr="company_id", parent_entity_type="company", child_action="financial_year",
)
register_audited(
    CompanyDocument, entity_type="company_document", module_key="organization", label="Company document",
    ref=lambda o: f"'{o.document_name}'", parent_attr="company_id", parent_entity_type="company", child_action="document",
)
register_audited(Branch, entity_type="branch", module_key="organization", label="Plant", ref=lambda o: f"{o.code} ({o.name})")
register_audited(
    BranchAddress, entity_type="branch_address", module_key="organization", label="Plant address",
    ref=lambda o: o.address_type, parent_attr="branch_id", parent_entity_type="branch", child_action="address",
)
register_audited(
    BranchUserAssignment, entity_type="branch_user_assignment", module_key="organization", label="Plant user assignment",
    ref=lambda o: f"for user #{o.user_id}", parent_attr="branch_id", parent_entity_type="branch", child_action="user_assignment",
)
register_audited(
    BranchDocument, entity_type="branch_document", module_key="organization", label="Plant document",
    ref=lambda o: f"'{o.document_name}'", parent_attr="branch_id", parent_entity_type="branch", child_action="document",
)
register_audited(Department, entity_type="department", module_key="organization", label="Department", ref=lambda o: f"'{o.name}'")
register_audited(CostCenter, entity_type="cost_center", module_key="organization", label="Cost centre", ref=lambda o: o.code)

# ---------------------------------------------------------------------------
# HR & Administration
# ---------------------------------------------------------------------------
register_audited(HrGrade, entity_type="hr_grade", module_key="hr", label="Grade", ref=lambda o: o.code)
register_audited(HrDesignation, entity_type="hr_designation", module_key="hr", label="Designation", ref=lambda o: f"'{o.name}'")
register_audited(HrShift, entity_type="hr_shift", module_key="hr", label="Shift", ref=lambda o: o.code)
register_audited(HrHoliday, entity_type="hr_holiday", module_key="hr", label="Holiday", ref=lambda o: f"'{o.name}' ({o.holiday_date})")
register_audited(HrLeaveType, entity_type="hr_leave_type", module_key="hr", label="Leave type", ref=lambda o: o.code)
register_audited(
    HrEmployeeProfile, entity_type="hr_employee_profile", module_key="hr", label="Employee profile",
    ref=lambda o: o.employee_code or f"for user #{o.user_id}",
)
register_audited(HrLifecycleEvent, entity_type="hr_lifecycle_event", module_key="hr", label="Lifecycle event", ref=lambda o: o.event_no)
register_audited(
    HrChecklistItem, entity_type="hr_checklist_item", module_key="hr", label="Checklist item",
    ref=lambda o: f"'{o.title}'", parent_attr="event_id", parent_entity_type="hr_lifecycle_event", child_action="checklist_item",
)
register_audited(HrChecklistTemplate, entity_type="hr_checklist_template", module_key="hr", label="Checklist template", ref=lambda o: f"{o.event_type}: '{o.title}'")
register_audited(
    HrLeaveBalance, entity_type="hr_leave_balance", module_key="hr", label="Leave balance",
    ref=lambda o: f"user #{o.user_id} leave type #{o.leave_type_id} {o.year}",
)
register_audited(HrLeaveRequest, entity_type="hr_leave_request", module_key="hr", label="Leave request", ref=lambda o: o.request_no)
register_audited(HrAttendance, entity_type="hr_attendance", module_key="hr", label="Attendance", ref=lambda o: f"user #{o.user_id} on {o.attendance_date}")
register_audited(HrAttendanceRegularization, entity_type="hr_attendance_regularization", module_key="hr", label="Attendance regularization", ref=lambda o: o.request_no)
register_audited(HrAsset, entity_type="hr_asset", module_key="hr", label="Asset", ref=lambda o: o.asset_code)
register_audited(
    HrAssetAssignment, entity_type="hr_asset_assignment", module_key="hr", label="Asset assignment",
    ref=lambda o: f"to user #{o.user_id} on {o.issued_on}", parent_attr="asset_id", parent_entity_type="hr_asset", child_action="assignment",
)
register_audited(HrVisitor, entity_type="hr_visitor", module_key="hr", label="Visitor", ref=lambda o: o.visit_no)
register_audited(HrTravelRequest, entity_type="hr_travel_request", module_key="hr", label="Travel request", ref=lambda o: o.request_no)
register_audited(HrExpenseClaim, entity_type="hr_expense_claim", module_key="hr", label="Expense claim", ref=lambda o: o.claim_no)
register_audited(
    HrExpenseClaimItem, entity_type="hr_expense_claim_item", module_key="hr", label="Expense line",
    ref=lambda o: f"{o.category} {o.amount} on {o.expense_date}", parent_attr="claim_id", parent_entity_type="hr_expense_claim", child_action="line",
)

# ---------------------------------------------------------------------------
# R&D
# ---------------------------------------------------------------------------
register_audited(RndProject, entity_type="rnd_project", module_key="rnd", label="R&D project", ref=lambda o: o.project_number)
register_audited(RndExperiment, entity_type="rnd_experiment", module_key="rnd", label="Experiment", ref=lambda o: o.experiment_number)
register_audited(RndPrototype, entity_type="rnd_prototype", module_key="rnd", label="Prototype", ref=lambda o: f"{o.prototype_number} ({o.version})")
register_audited(
    RndPrototypeBomItem, entity_type="rnd_prototype_bom_item", module_key="rnd", label="Prototype BOM line",
    ref=lambda o: f"'{o.item_name}' x {o.quantity}", parent_attr="prototype_id", parent_entity_type="rnd_prototype", child_action="bom_line",
)
register_audited(RndFeasibilityStudy, entity_type="rnd_feasibility_study", module_key="rnd", label="Feasibility study", ref=lambda o: f"for project #{o.project_id}")
register_audited(RndDocument, entity_type="rnd_document", module_key="rnd", label="R&D document", ref=lambda o: f"'{o.title}' ({o.file_name})")

# ---------------------------------------------------------------------------
# Production
# ---------------------------------------------------------------------------
register_audited(ProductionWorkstation, entity_type="production_workstation", module_key="production", label="Workstation", ref=lambda o: o.code)
register_audited(ProductionBom, entity_type="production_bom", module_key="production", label="BOM", ref=lambda o: f"{o.bom_number} v{o.version}")
register_audited(
    ProductionBomItem, entity_type="production_bom_item", module_key="production", label="BOM component",
    ref=lambda o: f"item #{o.component_item_id} × {o.quantity}", parent_attr="bom_id", parent_entity_type="production_bom", child_action="component",
)
register_audited(
    ProductionBomOperation, entity_type="production_bom_operation", module_key="production", label="Routing operation",
    ref=lambda o: f"{o.sequence} {o.operation_name}", parent_attr="bom_id", parent_entity_type="production_bom", child_action="operation",
)
register_audited(ProductionWorkOrder, entity_type="production_work_order", module_key="production", label="Work order", ref=lambda o: o.wo_number)
register_audited(
    ProductionWorkOrderMaterial, entity_type="production_work_order_material", module_key="production", label="Work order material",
    ref=lambda o: f"item #{o.item_id}", parent_attr="work_order_id", parent_entity_type="production_work_order", child_action="material",
)
register_audited(
    ProductionWorkOrderOperation, entity_type="production_work_order_operation", module_key="production", label="Work order operation",
    ref=lambda o: f"{o.sequence} {o.operation_name}", parent_attr="work_order_id", parent_entity_type="production_work_order", child_action="operation",
)
register_audited(
    ProductionTimeLog, entity_type="production_time_log", module_key="production", label="Time log",
    ref=lambda o: f"{o.hours}h on {o.log_date}", parent_attr="work_order_id", parent_entity_type="production_work_order", child_action="time_log",
)

register_audited(ProductionRrvBuild, entity_type="production_rrv_build", module_key="production", label="RRV build", ref=lambda o: f"{o.build_number} ({o.rrv_model})")
register_audited(
    ProductionRrvBuildStage, entity_type="production_rrv_build_stage", module_key="production", label="RRV stage",
    ref=lambda o: o.stage_key, parent_attr="build_id", parent_entity_type="production_rrv_build", child_action="stage",
)
register_audited(
    ProductionRrvTest, entity_type="production_rrv_test", module_key="production", label="Vehicle test",
    ref=lambda o: f"{o.test_type} {o.result}", parent_attr="build_id", parent_entity_type="production_rrv_build", child_action="test",
)
register_audited(ProductionReworkOrder, entity_type="production_rework_order", module_key="production", label="Rework order", ref=lambda o: o.rework_number)

# ---------------------------------------------------------------------------
# Electrical (RRV electrical jobs)
# ---------------------------------------------------------------------------
register_audited(ElectricalJob, entity_type="electrical_job", module_key="electrical", label="Electrical job", ref=lambda o: o.job_number)
register_audited(
    ElectricalJobStage, entity_type="electrical_job_stage", module_key="electrical", label="Job stage",
    ref=lambda o: o.stage_key, parent_attr="job_id", parent_entity_type="electrical_job", child_action="stage",
)
register_audited(
    ElectricalBomItem, entity_type="electrical_bom_item", module_key="electrical", label="BOM line",
    ref=lambda o: f"line {o.line_no} {o.description}", parent_attr="job_id", parent_entity_type="electrical_job", child_action="bom_line",
)
register_audited(
    ElectricalPanel, entity_type="electrical_panel", module_key="electrical", label="Panel",
    ref=lambda o: o.panel_tag, parent_attr="job_id", parent_entity_type="electrical_job", child_action="panel",
)
register_audited(
    ElectricalCable, entity_type="electrical_cable", module_key="electrical", label="Cable",
    ref=lambda o: o.cable_tag, parent_attr="job_id", parent_entity_type="electrical_job", child_action="cable",
)
register_audited(
    ElectricalDrawing, entity_type="electrical_drawing", module_key="electrical", label="Electrical drawing",
    ref=lambda o: o.drawing_number, parent_attr="job_id", parent_entity_type="electrical_job", child_action="drawing",
)
register_audited(
    ElectricalDrawingRevision, entity_type="electrical_drawing_revision", module_key="electrical", label="Drawing revision",
    ref=lambda o: o.revision_label, parent_attr="drawing_id", parent_entity_type="electrical_drawing", child_action="revision",
)
register_audited(
    ElectricalTest, entity_type="electrical_test", module_key="electrical", label="Electrical test",
    ref=lambda o: f"{o.test_number} {o.result}", parent_attr="job_id", parent_entity_type="electrical_job", child_action="test",
)
register_audited(
    ElectricalIssue, entity_type="electrical_issue", module_key="electrical", label="Electrical issue",
    ref=lambda o: o.issue_number, parent_attr="job_id", parent_entity_type="electrical_job", child_action="issue",
)
register_audited(
    ElectricalDocument, entity_type="electrical_document", module_key="electrical", label="Electrical document",
    ref=lambda o: f"'{o.title}' ({o.file_name})", parent_attr="job_id", parent_entity_type="electrical_job", child_action="document",
)

# ---------------------------------------------------------------------------
# Design (engineering document control — ISO 9001 §7.5 records)
# ---------------------------------------------------------------------------
register_audited(DesignDocument, entity_type="design_document", module_key="design", label="Design document", ref=lambda o: o.doc_number)
register_audited(
    DesignDocumentRevision, entity_type="design_document_revision", module_key="design", label="Document revision",
    ref=lambda o: o.revision_label, parent_attr="document_id", parent_entity_type="design_document", child_action="revision",
)
register_audited(
    DesignRevisionFile, entity_type="design_revision_file", module_key="design", label="Revision file",
    ref=lambda o: f"'{o.file_name}' ({o.file_role})", parent_attr="revision_id", parent_entity_type="design_document_revision", child_action="file",
)
register_audited(DesignChangeNotice, entity_type="design_change_notice", module_key="design", label="Change notice (ECN)", ref=lambda o: o.ecn_number)
register_audited(
    DesignChangeNoticeDocument, entity_type="design_change_notice_document", module_key="design", label="ECN affected document",
    ref=lambda o: f"document #{o.document_id}", parent_attr="ecn_id", parent_entity_type="design_change_notice", child_action="affected_document",
)

# Hydraulic & Pneumatic
register_audited(HydSystem, entity_type="hyd_system", module_key="hydraulic", label="Hydraulic/pneumatic system", ref=lambda o: o.system_number)
register_audited(HydComponent, entity_type="hyd_component", module_key="hydraulic", label="Fluid component", ref=lambda o: o.code)
register_audited(HydCircuit, entity_type="hyd_circuit", module_key="hydraulic", label="Circuit", ref=lambda o: f"{o.circuit_number} Rev {o.revision}")
register_audited(HydBom, entity_type="hyd_bom", module_key="hydraulic", label="Hydraulic BOM", ref=lambda o: f"{o.bom_number} Rev {o.revision}")
register_audited(
    HydBomItem, entity_type="hyd_bom_item", module_key="hydraulic", label="BOM line",
    ref=lambda o: f"{o.tag_number or 'component #' + str(o.component_id)} × {o.quantity}", parent_attr="bom_id", parent_entity_type="hyd_bom", child_action="line",
)
register_audited(HydCalculation, entity_type="hyd_calculation", module_key="hydraulic", label="Calculation", ref=lambda o: o.calc_number)
register_audited(HydTest, entity_type="hyd_test", module_key="hydraulic", label="Test", ref=lambda o: o.test_number)
register_audited(
    HydTestReading, entity_type="hyd_test_reading", module_key="hydraulic", label="Test reading",
    ref=lambda o: o.parameter, parent_attr="test_id", parent_entity_type="hyd_test", child_action="reading",
)
register_audited(HydMaintenancePlan, entity_type="hyd_maintenance_plan", module_key="hydraulic", label="Maintenance plan", ref=lambda o: o.plan_number)
register_audited(HydServiceRecord, entity_type="hyd_service_record", module_key="hydraulic", label="Service record", ref=lambda o: o.record_number)
register_audited(
    HydServicePart, entity_type="hyd_service_part", module_key="hydraulic", label="Service spare",
    ref=lambda o: f"spare #{o.spare_part_id} × {o.quantity}", parent_attr="record_id", parent_entity_type="hyd_service_record", child_action="part",
)
register_audited(HydSparePart, entity_type="hyd_spare_part", module_key="hydraulic", label="Spare part", ref=lambda o: o.part_code)
register_audited(HydDocument, entity_type="hyd_document", module_key="hydraulic", label="Document", ref=lambda o: o.title)

# ---------------------------------------------------------------------------
# Maintenance
# ---------------------------------------------------------------------------
register_audited(MaintenanceAsset, entity_type="maintenance_asset", module_key="maintenance", label="Asset", ref=lambda o: o.asset_code)
register_audited(MaintenanceRequest, entity_type="maintenance_request", module_key="maintenance", label="Maintenance request", ref=lambda o: o.request_number)
register_audited(MaintenanceWorkOrder, entity_type="maintenance_work_order", module_key="maintenance", label="Maintenance work order", ref=lambda o: o.wo_number)
register_audited(
    MaintenanceWorkOrderTask, entity_type="maintenance_wo_task", module_key="maintenance", label="Checklist line",
    ref=lambda o: f"'{o.description[:60]}'", parent_attr="work_order_id", parent_entity_type="maintenance_work_order", child_action="task",
)
register_audited(
    MaintenanceWorkOrderSpare, entity_type="maintenance_wo_spare", module_key="maintenance", label="Spare line",
    ref=lambda o: f"item #{o.store_item_id} (issued {o.qty_issued:g}, returned {o.qty_returned:g})",
    parent_attr="work_order_id", parent_entity_type="maintenance_work_order", child_action="spare",
)
register_audited(
    MaintenanceLabourLog, entity_type="maintenance_labour_log", module_key="maintenance", label="Labour entry",
    ref=lambda o: f"{o.hours:g} h by user #{o.technician_id}", parent_attr="work_order_id", parent_entity_type="maintenance_work_order", child_action="labour",
)
register_audited(MaintenanceAttachment, entity_type="maintenance_attachment", module_key="maintenance", label="Maintenance attachment", ref=lambda o: f"'{o.filename}'")
