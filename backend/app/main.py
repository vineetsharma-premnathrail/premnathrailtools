from pathlib import Path
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.trustedhost import TrustedHostMiddleware
from fastapi.staticfiles import StaticFiles
from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.cron import CronTrigger

from app.core.config import settings
from app.tasks.followup_reminders import send_activity_followup_reminders
from app.tasks.po_overdue_reminders import send_po_overdue_reminders
from app.tasks.rfq_reminders import send_rfq_reminders
from app.tasks.hr_reminders import send_hr_reminders
from app.tasks.pm_reminders import send_pm_reminders
from app.tasks.design_reminders import send_design_reminders
from app.tasks.quality_reminders import send_quality_reminders
from app.tasks.gauge_calibration_reminders import send_gauge_reminders
from app.tasks.store_jobwork_reminders import send_jobwork_reminders
from app.tasks.maintenance_pm_scheduler import run_maintenance_pm_scheduler
from app.tasks.erp_sla_reminders import run_erp_sla_reminders
from app.tasks.maintenance_amc_reminders import send_maintenance_amc_reminders
from app.tasks.sales_scheduler import run_sales_scheduler
from app.tasks.bank_guarantee_reminders import send_bank_guarantee_reminders
from app.tasks.erp_contract_scheduler import run_erp_contract_scheduler
from app.modules.main.models.user import User
from app.modules.main.models.audit_log import AuditLog
from app.modules.main.models.managed_document import ManagedDocument, ManagedDocumentEvent
from app.modules.main.models.notification import Notification
from app.modules.main.models.user_session import UserSession
from app.modules.main.models.idempotency_record import IdempotencyRecord  # noqa: F401
from app.modules.main.models.user_document import UserDocument
from app.modules.main.models.module import Module
from app.modules.main.models.role import Role  # noqa: F401
from app.modules.main.models.grc import (  # noqa: F401
    AccessValidity, AccessReview, AccessReviewLine, SodMitigation, PermissionDenial, JobRun, SystemErrorLog,
)
from app.modules.organization.models.company import Company
from app.modules.organization.models.company_address import CompanyAddress
from app.modules.organization.models.company_contact import CompanyContact
from app.modules.organization.models.company_financial_year import CompanyFinancialYear
from app.modules.organization.models.company_document import CompanyDocument
from app.modules.organization.models.branch import Branch
from app.modules.organization.models.branch_address import BranchAddress
from app.modules.organization.models.branch_user_assignment import BranchUserAssignment
from app.modules.organization.models.branch_document import BranchDocument
from app.modules.organization.models.cost_center import CostCenter
from app.modules.organization.models.profit_center import ProfitCenter
from app.modules.production.models.cost_estimate import ProductionCostEstimate, ProductionCostEstimateLine, StoreItemStandardPrice
from app.modules.organization.models.department import Department
from app.modules.erp.models.project import Project
from app.modules.erp.models.project_attachment import ProjectAttachment
from app.modules.erp.models.project_letter import ProjectLetter
from app.modules.erp.models.service_request import ServiceRequest
from app.modules.erp.models.service_material import ServiceMaterial
from app.modules.erp.models.service_request_attachment import ServiceRequestAttachment
from app.modules.erp.models.service_material_attachment import ServiceMaterialAttachment
from app.modules.erp.models.service_contract import ServiceContract, ServiceContractMachine, ServiceContractBilling
from app.modules.p2p.models.p2p_request import P2PRequest
from app.modules.p2p.models.p2p_request_item import P2PRequestItem
from app.modules.p2p.models.p2p_request_attachment import P2PRequestAttachment
from app.modules.p2p.models.p2p_request_approval import P2PRequestApproval
from app.modules.p2p.models.p2p_request_po_approver import P2PRequestPOApprover  # noqa: F401
from app.modules.p2p.models.purchase_order import P2PPurchaseOrder, P2PPurchaseOrderItem
from app.modules.p2p.models.rfq import RFQ
from app.modules.p2p.models.rfq_attachment import RFQAttachment
from app.modules.p2p.models.rfq_invite import RFQVendorInvite
from app.modules.p2p.models.vendor_quotation import VendorQuotation
from app.modules.p2p.models.goods_receipt import P2PGoodsReceipt, P2PGoodsReceiptItem
from app.modules.p2p.models.vendor_return import P2PVendorReturn, P2PVendorReturnItem  # noqa: F401
from app.modules.p2p.models.service_entry import P2PServiceEntry  # noqa: F401
from app.modules.p2p.models.landed_cost import P2PLandedCostAllocation, P2PLandedCostVoucher, P2PPOCharge  # noqa: F401
from app.modules.p2p.models.vendor_quotation import VendorQuotationItem  # noqa: F401
from app.modules.p2p.models.po_amendment import P2PPOAmendment  # noqa: F401
from app.modules.p2p.models.source_list import P2PSourceListEntry  # noqa: F401
from app.modules.store.models.item_plant import StoreItemPlant  # noqa: F401
from app.modules.quality.models.quality_standard import QualityStandard
from app.modules.quality.models.quality_checklist import QualityChecklist, QualityChecklistItem
from app.modules.quality.models.inspection_plan import QualityInspectionPlan, QualityInspectionPlanLine
from app.modules.quality.models.characteristic import QualityCharacteristic
from app.modules.quality.models.sampling import QualitySampleSizeCode, QualityAqlPlan
from app.modules.quality.models.masters import QualityDefectCode, QualityDispositionCode, QualityMasterValue, QualitySetting
from app.modules.quality.models.inspection_lot import QualityInspectionLot, QualityLotResult
from app.modules.quality.models.first_article import QualityFirstArticle
from app.modules.quality.models.inspection_call import QualityInspectionCall
from app.modules.quality.models.lot_attachment import QualityLotPhoto
from app.modules.quality.models.inspection import QualityInspection, QualityInspectionResult, QualityInspectionAttachment
from app.modules.quality.models.ncr import QualityNcr, QualityNcrApproval
from app.modules.quality.models.rejection import QualityRejection
from app.modules.quality.models.capa import QualityCapa, QualityCapaTeamMember, QualityCapaNcr, QualityCapaAction
from app.modules.quality.models.customer_complaint import QualityCustomerComplaint, QualityComplaintPhoto
from app.modules.quality.models.supplier_quality import QualitySupplierScorecard, QualityApprovedVendor, QualityVendorStatusEvent, QualityVendorAudit
from app.modules.quality.models.quality_document import QualityDocument
from app.modules.quality.models.gauge import QualityGauge, QualityGaugeCalibration
from app.modules.maintenance.models.asset import MaintenanceAsset
from app.modules.maintenance.models.request import MaintenanceRequest
from app.modules.maintenance.models.work_order import (
    MaintenanceWorkOrder, MaintenanceWorkOrderTask, MaintenanceWorkOrderSpare, MaintenanceLabourLog,
)
from app.modules.maintenance.models.attachment import MaintenanceAttachment
from app.modules.maintenance.models.asset import MaintenanceAssetSpare
from app.modules.maintenance.models.pm_plan import MaintenancePmPlan, MaintenancePmPlanTask, MaintenancePmPlanSpare
from app.modules.maintenance.models.counters import MaintenanceMeasuringPoint, MaintenanceMeasurementDoc
from app.modules.maintenance.models.permit import MaintenanceWorkPermit
from app.modules.maintenance.models.wo_procurement import MaintenanceWorkOrderPurchaseRequest
from app.modules.erp.models.service_visit import ServiceVisit
from app.modules.sales.models.order import SalesOrder, SalesOrderLine, SalesOrderSchedule, SalesBillingPlanLine, SalesOrderServiceRequest  # noqa: F401
from app.modules.sales.models.amendment import SalesOrderAmendment
from app.modules.sales.models.extension import SalesDeliveryExtension
from app.modules.sales.models.crm_document_link import SalesOrderCrmDocument
from app.modules.sales.models.approval import SalesApproval
from app.modules.sales.models.attachment import SalesAttachment
from app.modules.sales.models.delivery import SalesDeliveryEvent, SalesInvoiceLink
from app.modules.sales.models.proforma import SalesProformaInvoice
from app.modules.production.models.workstation import ProductionWorkstation
from app.modules.production.models.mrp import ProductionMrpRun, ProductionPlannedOrder, ProductionMrpException
from app.modules.production.models.bom import ProductionBom, ProductionBomItem, ProductionBomOperation
from app.modules.production.models.bom import ProductionBomDisciplineMerge
from app.modules.production.models.work_order import (
    ProductionWorkOrder, ProductionWorkOrderMaterial, ProductionWorkOrderOperation, ProductionTimeLog,
    ProductionOrderCostPosting,
)
from app.modules.production.models.rrv_build import (
    ProductionRrvBuild, ProductionRrvBuildStage, ProductionRrvTest, ProductionReworkOrder, ProductionRrvEvent,
)
from app.modules.hydraulic.models.system import HydSystem
from app.modules.hydraulic.models.component import HydComponent
from app.modules.hydraulic.models.circuit import HydCircuit
from app.modules.hydraulic.models.bom import HydBom, HydBomItem
from app.modules.hydraulic.models.calculation import HydCalculation
from app.modules.hydraulic.models.testing import HydTest, HydTestReading
from app.modules.hydraulic.models.maintenance import HydMaintenancePlan, HydServiceRecord, HydServicePart
from app.modules.hydraulic.models.spare_part import HydSparePart
from app.modules.hydraulic.models.document import HydDocument
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
from app.modules.design.models.event import DesignEvent
from app.modules.design.models.change_notice import DesignChangeNoticeBom, DesignEcnAcknowledgement
from app.modules.design.models.setting import DesignSetting, DesignTeamMember
from app.modules.design.models.library import (
    DesignStandard, DesignStandardPart, DesignTemplate, DesignItemApprovedMake, DesignChecklist, DesignChecklistItem,
    DesignReviewResult,
)
from app.modules.design.models.request import DesignRequest, DesignRequirementRevision, DesignTaskDeliverable
from app.modules.design.models.submission import DesignCustomerSubmission, DesignSubmissionLine, DesignSubmissionComment
from app.modules.design.models.bom import DesignBom, DesignBomRevision, DesignBomLine
from app.modules.design.models.change_request import DesignChangeRequest, DesignChangeRequestItem, DesignEcrVote
from app.modules.organization.models.approval import (
    ApprovalWorkflow, ApprovalWorkflowStage, ApprovalRequest, ApprovalRequestStep, ApprovalDelegation, OrganizationSetting,
)
from app.modules.products.models.application import ProductApplication
from app.modules.products.models.product import FinishedProduct, ProductSpecification
from app.modules.products.models.price_condition import ProductPriceCondition
from app.modules.projects.models.project import PmProject
from app.modules.projects.models.element import PmProjectElement  # noqa: F401
from app.modules.projects.models.task import PmProjectTask, PmTaskSubtask, PmTaskUpdate, PmTaskTimeLog, PmMilestoneMessage
from app.modules.projects.models.milestone import PmProjectMilestone
from app.modules.projects.models.document import PmProjectDocument
from app.modules.store.models.location import StoreLocation
from app.modules.store.models.category import StoreItemCategory
from app.modules.store.models.item import StoreItem
from app.modules.store.models.bin import StoreBin
from app.modules.store.models.stock_balance import StoreStockBalance
from app.modules.store.models.stock_transaction import StoreStockTransaction
from app.modules.store.models.material_issue import StoreMaterialIssue, StoreMaterialIssueItem
from app.modules.store.models.material_return import StoreMaterialReturn, StoreMaterialReturnItem
from app.modules.store.models.stock_transfer import StoreStockTransfer, StoreStockTransferItem
from app.modules.store.models.stock_adjustment import StoreStockAdjustment, StoreStockAdjustmentItem
from app.modules.store.models.physical_count import StorePhysicalCount, StorePhysicalCountItem  # noqa: F401
from app.modules.store.models.stock_reservation import StoreStockReservation
from app.modules.store.models.valuation import StoreItemValuation, StoreValuationEvent
from app.modules.store.models.batch import StoreBatch  # noqa: F401
from app.modules.store.models.job_work import StoreJobWorkReceipt, StoreJobWorkReceiptComponent  # noqa: F401
from app.modules.store.models.serial_number import StoreSerialNumber, StoreSerialEvent  # noqa: F401
from app.modules.store.models.bin_move import StoreBinMove  # noqa: F401
from app.modules.crm.models import (
    Organization, OrgContact, Inquiry, InquiryLineItem, Quotation, QuotationLineItem,
    Tender, Activity,
    CrmDocument, CrmStageLog, Product, PaymentTerm, CrmRndRequest, CrmRequirementComment,
    CrmDocumentCategory,
)
from app.modules.accounts.models.gl_account import GLAccount
from app.modules.accounts.models.bank_account import BankAccount
from app.modules.accounts.models.vendor import Vendor
from app.modules.accounts.models.vendor_document import VendorDocument
from app.modules.accounts.models.attachment import FinanceAttachment
from app.modules.accounts.models.vendor_catalog_item import VendorCatalogItem
from app.modules.accounts.models.internal_order import InternalOrder
from app.modules.accounts.models.journal_entry import JournalEntry, JournalEntryLine
from app.modules.accounts.models.gl_balance import GLBalance
from app.modules.accounts.models.vendor_invoice import VendorInvoice
from app.modules.accounts.models.payment_transaction import PaymentTransaction
from app.modules.accounts.models.ar_transaction import ARTransaction
from app.modules.accounts.models.period_close import PeriodClose
from app.modules.accounts.models.bank_reconciliation import BankReconciliation
from app.modules.accounts.models.account_group import AccountGroup
from app.modules.accounts.models.settings import AccountDetermination, NumberSeries, GSTRate
from app.modules.accounts.models.vendor_invoice import VendorInvoiceLine
from app.modules.accounts.models.ar_transaction import ARTransactionLine
from app.modules.accounts.models.party_note import PartyNote, PartyNoteLine
from app.modules.accounts.models.payment_transaction import PaymentLine, PaymentAllocation
from app.modules.accounts.models.settlement_adjustment import SettlementAdjustment
from app.modules.accounts.models.payment_proposal import PaymentProposal, PaymentProposalLine
from app.modules.accounts.models.inventory_valuation import InventoryValuation, InventoryValuationLine
from app.modules.accounts.models.fixed_asset import FixedAsset, DepreciationRun, DepreciationRunLine
from app.modules.accounts.models.bank_statement import BankStatement, BankStatementLine  # noqa: F401
from app.modules.accounts.models.cash_forecast_item import CashForecastItem  # noqa: F401
from app.modules.accounts.models.bank_guarantee import BankGuarantee, BankGuaranteeEvent  # noqa: F401
from app.modules.accounts.models.asset_accounting import AssetRetirement, ITAssetBlock, ITBlockBalance
from app.modules.accounts.models.fx import Currency, ExchangeRate, FxRevaluation
from app.modules.accounts.models.co_planning import CoPlanVersion, CoPlanLine
from app.modules.accounts.models.co_activity import CoActivityRate
from app.modules.accounts.models.co_allocation import CoAllocationCycle, CoAllocationSegment, CoAllocationRun
from app.modules.accounts.models.co_overhead import CoCostingSheetRate, CoOverheadRun, CoOverheadRunLine
from app.modules.accounts.models.collections import AccountsCreditRelease, AccountsCollectionNote, AccountsDunningLetter, AccountsDispute
from app.modules.rnd.models.calculation_history import CalculationHistory
from app.modules.rnd.models.tool_calculations import (
    BrakingCalculation, HydraulicCalculation, LoadDistributionCalculation, QmaxCalculation,
    SplineCalculation, TractiveEffortCalculation, VehiclePerformanceCalculation,
)
from app.modules.rnd.models.project import RndProject
from app.modules.rnd.models.experiment import RndExperiment
from app.modules.rnd.models.prototype import RndPrototype, RndPrototypeBomItem
from app.modules.rnd.models.feasibility import RndFeasibilityStudy
from app.modules.rnd.models.document import RndDocument
from app.modules.rnd.models.requirement_work import RndTeamMember, RndRequirementAccess, RndRequirementTask, RndTaskEvent, RndRequirementProjectLink, RndRequirementShare, RndRequirementDocVisibility
from app.modules.rnd.models.task_approval import RndTaskApproval
from app.modules.rnd.models.technical_offer import RndTechnicalOffer
from app.modules.rnd.models.project_task import RndProjectTask, RndProjectTaskEvent
from app.modules.rnd.models.project_milestone import RndProjectMilestone
from app.modules.rnd.models.requirement_milestone import RndRequirementMilestone
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
from app.modules.hr.models.safety import HrSafetyIncident, HrSafetyIncidentPerson, HrSafetyAction, HrSafetyAttachment
from app.modules.hr.models.overtime import HrOvertime
from app.modules.hr.models.assignment import HrEmployeeAssignment
from app.modules.hr.models.roster import HrShiftPattern, HrShiftRoster
from app.modules.hr.models.punch import HrPunch
from app.modules.hr.models.attendance_period import HrAttendancePeriod
from app.modules.hr.models.statutory_register import HrStatutoryRegister
from app.modules.main.routes import auth as auth_routes
from app.modules.main.routes import app_lock as app_lock_routes
from app.modules.main.routes import users as users_routes
from app.modules.main.routes import roles as roles_routes
from app.modules.main.routes import assignee_rules as assignee_rules_routes
from app.modules.main.routes import grc as grc_routes
from app.modules.main.routes import basis as basis_routes
from app.modules.main.routes import analytics as analytics_routes
from app.modules.main.routes import refs as refs_routes
from app.modules.main.routes import notifications as notifications_routes
from app.modules.main.routes import feedback as feedback_routes
from app.modules.main.routes import modules as modules_routes
from app.modules.main.routes import presence as presence_routes
from app.modules.main.routes import documents as documents_routes
from app.modules.accounts.routes import gl_accounts as accounts_gl_accounts_routes
from app.modules.accounts.routes import bank_accounts as accounts_bank_accounts_routes
from app.modules.accounts.routes import vendors as accounts_vendors_routes
from app.modules.accounts.routes import internal_orders as accounts_internal_orders_routes
from app.modules.accounts.routes import journal_entries as accounts_journal_entries_routes
from app.modules.accounts.routes import vendor_invoices as accounts_vendor_invoices_routes
from app.modules.accounts.routes import payments as accounts_payments_routes
from app.modules.accounts.routes import attachments as accounts_attachments_routes
from app.modules.accounts.routes import ar_transactions as accounts_ar_transactions_routes
from app.modules.accounts.routes import period_close as accounts_period_close_routes
from app.modules.accounts.routes import bank_reconciliations as accounts_bank_reconciliations_routes
from app.modules.accounts.routes import liquidity_forecast as accounts_liquidity_forecast_routes
from app.modules.accounts.routes import reports as accounts_reports_routes
from app.modules.accounts.routes import controlling as accounts_controlling_routes
from app.modules.accounts.routes import co_controlling as accounts_co_controlling_routes
from app.modules.accounts.routes import product_costing as accounts_product_costing_routes
from app.modules.accounts.routes import profit_centers as accounts_profit_centers_routes
from app.modules.accounts.routes import profitability as accounts_profitability_routes
from app.modules.accounts.routes import account_setup as accounts_setup_routes
from app.modules.accounts.routes import party_notes as accounts_party_notes_routes
from app.modules.accounts.routes import gst as accounts_gst_routes
from app.modules.accounts.routes import outstanding as accounts_outstanding_routes
from app.modules.accounts.routes import inventory_accounting as accounts_inventory_routes
from app.modules.accounts.routes import fixed_assets as accounts_fixed_assets_routes
from app.modules.accounts.routes import asset_accounting as accounts_asset_accounting_routes
from app.modules.accounts.routes import fx as accounts_fx_routes
from app.modules.accounts.routes import payment_proposals as accounts_payment_proposals_routes
from app.modules.accounts.routes import settings as accounts_settings_routes
from app.modules.accounts.routes import bank_statements as accounts_bank_statements_routes
from app.modules.accounts.routes import cash_position as accounts_cash_position_routes
from app.modules.accounts.routes import bank_guarantees as accounts_bank_guarantees_routes
from app.modules.erp.routes import projects as erp_projects_routes
from app.modules.erp.routes import project_import as erp_project_import_routes
from app.modules.erp.routes import service_request_import as erp_sr_import_routes
from app.modules.erp.routes import service_requests as erp_sr_routes
from app.modules.erp.routes import service_visits as erp_sr_visits_routes
from app.modules.erp.routes import settings as erp_settings_routes
from app.modules.erp.routes import service_contracts as erp_service_contracts_routes
from app.modules.p2p.routes import pr_transfer as p2p_pr_transfer_routes
from app.modules.p2p.routes import p2p_requests as p2p_requests_routes
from app.modules.p2p.routes import purchase_orders as p2p_purchase_orders_routes
from app.modules.p2p.routes import rfq as p2p_rfq_routes
from app.modules.p2p.routes import goods_receipts as p2p_goods_receipts_routes
from app.modules.p2p.routes import vendor_returns as p2p_vendor_returns_routes
from app.modules.p2p.routes import po_reports as p2p_po_reports_routes
from app.modules.p2p.routes import service_entries as p2p_service_entries_routes
from app.modules.p2p.routes import landed_cost as p2p_landed_cost_routes
from app.modules.p2p.routes import account_assignment as p2p_account_assignment_routes
from app.modules.p2p.routes import pre_po_receipts as p2p_pre_po_receipts_routes
from app.modules.store.routes import pre_po_receipts as store_pre_po_receipts_routes
from app.modules.p2p.routes import mm_quotations as p2p_mm_quotations_routes
from app.modules.p2p.routes import rfq_invites as p2p_rfq_invites_routes
from app.modules.p2p.routes import po_amendments as p2p_po_amendments_routes
from app.modules.p2p.routes import tally_po_import as p2p_tally_po_import_routes
from app.modules.p2p.routes import info_records as p2p_info_records_routes
from app.modules.store.routes import item_plants as store_item_plants_routes
from app.modules.store.routes import in_transit as store_in_transit_routes
from app.modules.accounts.routes import msme as accounts_msme_routes
from app.modules.p2p.routes import mis as p2p_mis_routes
from app.modules.p2p.routes import vendors as p2p_vendors_routes
from app.modules.p2p.routes import settings as p2p_settings_routes
from app.modules.p2p.routes import purpose_rules as p2p_purpose_rules_routes
from app.modules.quality.routes import standards as quality_standards_routes
from app.modules.quality.routes import inspection_plans as quality_inspection_plans_routes
from app.modules.quality.routes import inspections as quality_inspections_routes
from app.modules.quality.routes import ncr as quality_ncr_routes
from app.modules.quality.routes import inspection_lots as quality_inspection_lots_routes
from app.modules.quality.routes import masters as quality_masters_routes
from app.modules.quality.routes import gauges as quality_gauges_routes
from app.modules.quality.routes import settings as quality_settings_routes
from app.modules.quality.routes import capa as quality_capa_routes
from app.modules.quality.routes import complaints as quality_complaints_routes
from app.modules.quality.routes import supplier_quality as quality_supplier_quality_routes
from app.modules.quality.routes import documents as quality_documents_routes
from app.modules.quality.routes import dashboard as quality_dashboard_routes
from app.modules.quality.routes import first_articles as quality_first_articles_routes
from app.modules.quality.routes import inspection_calls as quality_inspection_calls_routes
from app.modules.quality.routes import records as quality_records_routes
from app.modules.quality.routes import analysis as quality_analysis_routes
from app.modules.maintenance.routes import assets as maintenance_assets_routes
from app.modules.maintenance.routes import requests as maintenance_requests_routes
from app.modules.maintenance.routes import work_orders as maintenance_work_orders_routes
from app.modules.maintenance.routes import documents as maintenance_documents_routes
from app.modules.maintenance.routes import dashboard as maintenance_dashboard_routes
from app.modules.maintenance.routes import pm_plans as maintenance_pm_plans_routes
from app.modules.maintenance.routes import spares as maintenance_spares_routes
from app.modules.maintenance.routes import reports as maintenance_reports_routes
from app.modules.maintenance.routes import contracts as maintenance_contracts_routes
from app.modules.maintenance.routes import asset_tags as maintenance_asset_tags_routes
from app.modules.maintenance.routes import settings as maintenance_settings_routes
from app.modules.maintenance.routes import permits as maintenance_permits_routes
from app.modules.maintenance.routes import readings as maintenance_readings_routes
from app.modules.maintenance.routes import wo_procurement as maintenance_wo_procurement_routes
from app.modules.sales.routes import orders as sales_orders_routes
from app.modules.sales.routes import amendments as sales_amendments_routes
from app.modules.sales.routes import schedule as sales_schedule_routes
from app.modules.sales.routes import dashboard as sales_dashboard_routes
from app.modules.sales.routes import lookups as sales_lookups_routes
from app.modules.sales.routes import documents as sales_documents_routes
from app.modules.sales.routes import settings as sales_settings_routes
from app.modules.sales.routes import delivery as sales_delivery_routes
from app.modules.sales.routes import proforma as sales_proforma_routes
from app.modules.accounts.routes import sales_billing as accounts_sales_billing_routes
from app.modules.accounts.routes import receivables as accounts_receivables_routes
from app.modules.production.routes import workstations as production_workstations_routes
from app.modules.production.routes import boms as production_boms_routes
from app.modules.production.routes import work_orders as production_work_orders_routes
from app.modules.production.routes import shop_floor as production_shop_floor_routes
from app.modules.production.routes import planning as production_planning_routes
from app.modules.production.routes import dashboard as production_dashboard_routes
from app.modules.production.routes import reports as production_reports_routes
from app.modules.production.routes import lookups as production_lookups_routes
from app.modules.production.routes import integrations as production_integrations_routes
from app.modules.production.routes import rrv_builds as production_rrv_builds_routes
from app.modules.production.routes import engineering_change as production_ecm_routes
from app.modules.production.routes import engineering_lookups as production_engineering_lookups_routes
from app.modules.production.routes import mrp as production_mrp_routes
from app.modules.hydraulic.routes import systems as hydraulic_systems_routes
from app.modules.hydraulic.routes import components as hydraulic_components_routes
from app.modules.hydraulic.routes import circuits as hydraulic_circuits_routes
from app.modules.hydraulic.routes import boms as hydraulic_boms_routes
from app.modules.hydraulic.routes import calculations as hydraulic_calculations_routes
from app.modules.hydraulic.routes import testing as hydraulic_testing_routes
from app.modules.hydraulic.routes import maintenance as hydraulic_maintenance_routes
from app.modules.hydraulic.routes import service_records as hydraulic_service_records_routes
from app.modules.hydraulic.routes import spare_parts as hydraulic_spare_parts_routes
from app.modules.hydraulic.routes import documents as hydraulic_documents_routes
from app.modules.hydraulic.routes import dashboard as hydraulic_dashboard_routes
from app.modules.hydraulic.routes import lookups as hydraulic_lookups_routes
from app.modules.electrical.routes import jobs as electrical_jobs_routes
from app.modules.electrical.routes import bom as electrical_bom_routes
from app.modules.electrical.routes import panels as electrical_panels_routes
from app.modules.electrical.routes import cables as electrical_cables_routes
from app.modules.electrical.routes import drawings as electrical_drawings_routes
from app.modules.electrical.routes import testing as electrical_testing_routes
from app.modules.electrical.routes import issues as electrical_issues_routes
from app.modules.electrical.routes import documents as electrical_documents_routes
from app.modules.electrical.routes import dashboard as electrical_dashboard_routes
from app.modules.electrical.routes import lookups as electrical_lookups_routes
from app.modules.design.routes import documents as design_documents_routes
from app.modules.design.routes import revisions as design_revisions_routes
from app.modules.design.routes import change_notices as design_change_notices_routes
from app.modules.design.routes import dashboard as design_dashboard_routes
from app.modules.design.routes import reports as design_reports_routes
from app.modules.design.routes import lookups as design_lookups_routes
from app.modules.design.routes import boms as design_boms_routes
from app.modules.design.routes import submissions as design_submissions_routes
from app.modules.design.routes import change_requests as design_change_requests_routes
from app.modules.design.routes import requests as design_requests_routes
from app.modules.design.routes import library as design_library_routes
from app.modules.design.routes import settings as design_settings_routes
from app.modules.design.routes import insights as design_insights_routes
from app.modules.products.routes import applications as products_applications_routes
from app.modules.products.routes import products as products_products_routes
from app.modules.products.routes import price_conditions as products_price_conditions_routes
from app.modules.products import linking as _products_linking  # noqa: F401 — before_flush auto-link to the product master
from app.modules.projects.routes import units as project_units_routes
from app.modules.projects.routes import project as pm_project_routes
from app.modules.projects.routes import milestones as pm_milestones_routes
from app.modules.projects.routes import documents as pm_documents_routes
from app.modules.projects.routes import work as pm_work_routes
from app.modules.projects.routes import project_tasks as pm_project_tasks_routes
from app.modules.store.routes import locations as store_locations_routes
from app.modules.store.routes import categories as store_categories_routes
from app.modules.store.routes import items as store_items_routes
from app.modules.store.routes import item_import as store_item_import_routes
from app.modules.store.routes import uoms as store_uoms_routes
from app.modules.store.routes import item_types as store_item_types_routes
from app.modules.store.routes import doc_types as store_doc_types_routes
from app.modules.store.routes import settings as store_settings_routes
from app.modules.store.routes import item_photo as store_item_photo_routes
from app.modules.store.routes import bins as store_bins_routes
from app.modules.store.routes import stock as store_stock_routes
from app.modules.store.routes import stock_import as store_stock_import_routes
from app.modules.store.routes import material_issues as store_material_issues_routes
from app.modules.store.routes import material_returns as store_material_returns_routes
from app.modules.store.routes import stock_transfers as store_stock_transfers_routes
from app.modules.store.routes import stock_entries as store_stock_entries_routes
from app.modules.store.routes import stock_adjustments as store_stock_adjustments_routes
from app.modules.store.routes import physical_counts as store_physical_counts_routes
from app.modules.store.routes import reorder as store_reorder_routes
from app.modules.store.routes import stock_reservations as store_stock_reservations_routes
from app.modules.store.routes import batches as store_batches_routes
from app.modules.store.routes import job_work as store_job_work_routes
from app.modules.store.routes import serials as store_serials_routes
from app.modules.store.routes import bin_stock as store_bin_stock_routes
import app.modules.store.reports.job_work_challan  # noqa: E402,F401 — registers the managed Word job-work challan
from app.modules.crm.routes import organizations as crm_organizations_routes
from app.modules.crm.routes import inquiries as crm_inquiries_routes
from app.modules.crm.routes import tenders as crm_tenders_routes
from app.modules.crm.routes import activities as crm_activities_routes
from app.modules.crm.routes import documents as crm_documents_routes
from app.modules.crm.routes import workflow as crm_workflow_routes
from app.modules.crm.routes import dashboard as crm_dashboard_routes
from app.modules.crm.routes import products as crm_products_routes
from app.modules.crm.routes import payment_terms as crm_payment_terms_routes
from app.modules.crm.routes import document_categories as crm_document_categories_routes
from app.modules.crm.routes import product_categories as crm_product_categories_routes
from app.modules.crm.routes import bulk_import as crm_bulk_import_routes
from app.modules.crm.routes import rnd_requests as crm_rnd_requests_routes
from app.modules.crm.routes import requirement_discussion as crm_requirement_discussion_routes
from app.modules.crm.routes import settings as crm_settings_routes
from app.modules.crm.routes import exports as crm_exports_routes
from app.modules.crm.routes import quotation_status as crm_quotation_status_routes
from app.modules.crm.routes import opportunity as crm_opportunity_routes
from app.modules.rnd.routes import calculations as rnd_calculations_routes
from app.modules.rnd.routes import history as rnd_history_routes
from app.modules.rnd.routes import projects as rnd_projects_routes
from app.modules.rnd.routes import experiments as rnd_experiments_routes
from app.modules.rnd.routes import prototypes as rnd_prototypes_routes
from app.modules.rnd.routes import dashboard as rnd_dashboard_routes
from app.modules.rnd.routes import documents as rnd_documents_routes
from app.modules.rnd.routes import requirements as rnd_requirements_routes
from app.modules.rnd.routes import requirement_work as rnd_requirement_work_routes
from app.modules.rnd.routes import technical_offers as rnd_technical_offers_routes
from app.modules.rnd.routes import department_requirements as rnd_department_requirements_routes
from app.modules.rnd.routes import project_tasks as rnd_project_tasks_routes
from app.modules.rnd.routes import project_milestones as rnd_project_milestones_routes
from app.modules.rnd.routes import requirement_milestones as rnd_requirement_milestones_routes
from app.core.reporting.router import router as reporting_router
from app.modules.rnd.routes import settings as rnd_settings_routes
from app.modules.organization.routes import company as organization_company_routes
from app.modules.organization.routes import branch as organization_branch_routes
from app.modules.organization.routes import department as organization_department_routes
from app.modules.organization.routes import cost_center as organization_cost_center_routes
from app.modules.organization.routes import audit_log as organization_audit_log_routes
from app.modules.organization.routes import workflows as organization_workflows_routes
from app.modules.organization.routes import approval_mail as organization_approval_mail_routes
from app.modules.organization.routes import delegations as organization_delegations_routes
from app.modules.organization.routes import security as organization_security_routes
from app.modules.organization.services.approval_engine import run_escalations
from app.modules.hr.routes import employees as hr_employees_routes
from app.modules.hr.routes import masters as hr_masters_routes
from app.modules.hr.routes import lifecycle as hr_lifecycle_routes
from app.modules.hr.routes import leave as hr_leave_routes
from app.modules.hr.routes import attendance as hr_attendance_routes
from app.modules.hr.routes import holidays as hr_holidays_routes
from app.modules.hr.routes import assets as hr_assets_routes
from app.modules.hr.routes import visitors as hr_visitors_routes
from app.modules.hr.routes import travel as hr_travel_routes
from app.modules.hr.routes import expenses as hr_expenses_routes
from app.modules.hr.routes import dashboard as hr_dashboard_routes
from app.modules.hr.routes import settings as hr_settings_routes
from app.modules.hr.routes import safety as hr_safety_routes
from app.modules.hr.routes import time_evaluation as hr_time_evaluation_routes
from app.modules.hr.routes import org_assignments as hr_org_assignments_routes
from app.modules.hr.routes import roster as hr_roster_routes
from app.modules.hr.routes import punches as hr_punches_routes
from app.modules.hr.routes import attendance_periods as hr_attendance_periods_routes
from app.modules.hr.routes import registers as hr_registers_routes
from app.modules.hr.routes import expense_posting as hr_expense_posting_routes
from app.middleware.error_handler import setup_error_handlers, LoggingMiddleware
from app.middleware.owasp import OWASPMiddleware
from app.core.audit_context import AuditContextMiddleware
# Registers the Quality/Store/Organization models with the automatic audit
# trail (app/core/audit.py) — import for side effects only.
import app.core.audit_registry  # noqa: F401

# Schema is managed by Alembic now (see backend/alembic/) — run
# `alembic upgrade head` after pulling new migrations or on first setup.
# create_all() is no longer called here since it can't apply ALTER TABLE
# changes to existing tables, only CREATE TABLE for brand-new ones.

# Every HR route (self-service included) needs the HR & Administration app.
from app.modules.hr.services.access import require_hr_module
from fastapi import Depends as _Depends

app = FastAPI(
    title=settings.app_name,
    description="Premnathrail Portal - CRM, ERP, and R&D tools API",
    version="1.0.0",
    # The API map (every route + record-ID shape) is not published in production.
    docs_url=None if settings.environment == "production" else "/docs",
    redoc_url=None if settings.environment == "production" else "/redoc",
    openapi_url=None if settings.environment == "production" else "/openapi.json",
)

# ============ MIDDLEWARE ============

# Signed record references next to every id in JSON for the portal frontend,
# so page URLs carry tamper-proof links, not editable ids (core/record_ref.py).
from app.middleware.record_refs import RecordRefMiddleware  # noqa: E402
app.add_middleware(RecordRefMiddleware)

# SM12 optimistic locking: X-Lock-Version on saves of locked documents.
from app.core.optimistic_lock import OptimisticLockMiddleware, register_locked_models, setup_lock_handlers  # noqa: E402
app.add_middleware(OptimisticLockMiddleware)
register_locked_models()

# Idempotency-Key: a save retried after a network failure is replayed, never saved twice.
from app.middleware.idempotency import IdempotencyMiddleware  # noqa: E402
app.add_middleware(IdempotencyMiddleware)

# CSRF: block cookie-authenticated unsafe requests from non-portal origins (C-07).
from app.middleware.csrf import CSRFOriginMiddleware  # noqa: E402
app.add_middleware(CSRFOriginMiddleware)

# CORS Configuration - Allow frontend to communicate
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_origins_list,
    allow_credentials=True,            # Allow cookies/auth headers
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "X-Requested-With", "X-Record-Refs", "X-Lock-Version", "X-User-Active", "Idempotency-Key"],
    expose_headers=["X-Reports-Skipped", "Content-Disposition"],  # Excel export: which reports of a pack were left out
)

# Security: Trusted hosts
app.add_middleware(
    TrustedHostMiddleware,
    allowed_hosts=settings.allowed_hosts_list,
)

# Logging middleware
app.add_middleware(LoggingMiddleware)

# Request-scoped IP/user-agent/session context for AuditLog auto-population
# (see app/core/audit_context.py and AuditLog's before_insert listener)
app.add_middleware(AuditContextMiddleware)

# OWASP Top 10 protections: injection detection, rate limiting + IP bans, SSRF
# blocking, security response headers, body-size/method/content-type checks.
app.add_middleware(OWASPMiddleware)

# Error handlers
setup_error_handlers(app)
setup_lock_handlers(app)

# Static assets (e.g. the logo embedded in outgoing emails — see
# app/utils/email.py). Public by design: OWASPMiddleware's PUBLIC_PREFIXES
# already exempts "/static/" from the auth pre-check.
app.mount("/static", StaticFiles(directory=Path(__file__).parent / "static"), name="static")

# ============ ROUTES ============

# API v1 routes
app.include_router(auth_routes.router, prefix="/api/v1")
app.include_router(app_lock_routes.router, prefix="/api/v1")
app.include_router(users_routes.router, prefix="/api/v1")
app.include_router(roles_routes.router, prefix="/api/v1")
app.include_router(assignee_rules_routes.router, prefix="/api/v1")
app.include_router(grc_routes.router, prefix="/api/v1")
app.include_router(basis_routes.router, prefix="/api/v1")
app.include_router(analytics_routes.router, prefix="/api/v1")
app.include_router(refs_routes.router, prefix="/api/v1")
app.include_router(erp_project_import_routes.router, prefix="/api/v1")  # before /erp/projects/{id}
app.include_router(erp_sr_import_routes.router, prefix="/api/v1")  # before /erp/service-requests/{id}
app.include_router(erp_projects_routes.router, prefix="/api/v1")
app.include_router(erp_sr_routes.router, prefix="/api/v1")
app.include_router(erp_sr_visits_routes.router, prefix="/api/v1")
app.include_router(erp_service_contracts_routes.router, prefix="/api/v1")
app.include_router(erp_settings_routes.router, prefix="/api/v1")
app.include_router(p2p_pr_transfer_routes.router, prefix="/api/v1")
app.include_router(p2p_requests_routes.router, prefix="/api/v1")
app.include_router(p2p_purchase_orders_routes.router, prefix="/api/v1")
app.include_router(p2p_rfq_routes.router, prefix="/api/v1")
app.include_router(p2p_goods_receipts_routes.router, prefix="/api/v1")
app.include_router(p2p_vendor_returns_routes.router, prefix="/api/v1")
app.include_router(p2p_po_reports_routes.router, prefix="/api/v1")
app.include_router(p2p_service_entries_routes.router, prefix="/api/v1")
app.include_router(p2p_landed_cost_routes.router, prefix="/api/v1")
app.include_router(p2p_account_assignment_routes.router, prefix="/api/v1")
app.include_router(p2p_pre_po_receipts_routes.router, prefix="/api/v1")
app.include_router(store_pre_po_receipts_routes.router, prefix="/api/v1")
app.include_router(p2p_mm_quotations_routes.router, prefix="/api/v1")
app.include_router(p2p_rfq_invites_routes.router, prefix="/api/v1")
app.include_router(p2p_po_amendments_routes.router, prefix="/api/v1")
app.include_router(p2p_tally_po_import_routes.router, prefix="/api/v1")
app.include_router(p2p_info_records_routes.router, prefix="/api/v1")
app.include_router(store_item_plants_routes.router, prefix="/api/v1")
app.include_router(store_in_transit_routes.router, prefix="/api/v1")
app.include_router(accounts_msme_routes.router, prefix="/api/v1")
app.include_router(p2p_mis_routes.router, prefix="/api/v1")
app.include_router(p2p_vendors_routes.router, prefix="/api/v1")
app.include_router(p2p_settings_routes.router, prefix="/api/v1")
app.include_router(p2p_settings_routes.flow_router, prefix="/api/v1")
app.include_router(p2p_purpose_rules_routes.router, prefix="/api/v1")
app.include_router(quality_standards_routes.router, prefix="/api/v1")
app.include_router(quality_inspection_plans_routes.router, prefix="/api/v1")
app.include_router(quality_inspections_routes.router, prefix="/api/v1")
app.include_router(quality_ncr_routes.router, prefix="/api/v1")
app.include_router(quality_inspection_lots_routes.router, prefix="/api/v1")
app.include_router(quality_masters_routes.router, prefix="/api/v1")
app.include_router(quality_gauges_routes.router, prefix="/api/v1")
app.include_router(quality_settings_routes.router, prefix="/api/v1")
app.include_router(quality_capa_routes.router, prefix="/api/v1")
app.include_router(quality_complaints_routes.router, prefix="/api/v1")
app.include_router(quality_supplier_quality_routes.router, prefix="/api/v1")
app.include_router(quality_documents_routes.router, prefix="/api/v1")
app.include_router(quality_dashboard_routes.router, prefix="/api/v1")
app.include_router(quality_first_articles_routes.router, prefix="/api/v1")
app.include_router(quality_inspection_calls_routes.router, prefix="/api/v1")
app.include_router(quality_records_routes.router, prefix="/api/v1")
app.include_router(quality_analysis_routes.router, prefix="/api/v1")
app.include_router(maintenance_assets_routes.router, prefix="/api/v1")
app.include_router(maintenance_requests_routes.router, prefix="/api/v1")
app.include_router(maintenance_work_orders_routes.router, prefix="/api/v1")
app.include_router(maintenance_documents_routes.router, prefix="/api/v1")
app.include_router(maintenance_dashboard_routes.router, prefix="/api/v1")
app.include_router(maintenance_pm_plans_routes.router, prefix="/api/v1")
app.include_router(maintenance_spares_routes.router, prefix="/api/v1")
app.include_router(maintenance_reports_routes.router, prefix="/api/v1")
app.include_router(maintenance_contracts_routes.router, prefix="/api/v1")
app.include_router(maintenance_asset_tags_routes.router, prefix="/api/v1")
app.include_router(maintenance_settings_routes.router, prefix="/api/v1")
app.include_router(maintenance_permits_routes.router, prefix="/api/v1")
app.include_router(maintenance_readings_routes.router, prefix="/api/v1")
app.include_router(maintenance_wo_procurement_routes.router, prefix="/api/v1")
app.include_router(sales_orders_routes.router, prefix="/api/v1")
app.include_router(sales_amendments_routes.router, prefix="/api/v1")
app.include_router(sales_schedule_routes.router, prefix="/api/v1")
app.include_router(sales_dashboard_routes.router, prefix="/api/v1")
app.include_router(sales_lookups_routes.router, prefix="/api/v1")
app.include_router(sales_documents_routes.router, prefix="/api/v1")
app.include_router(sales_settings_routes.router, prefix="/api/v1")
app.include_router(sales_delivery_routes.router, prefix="/api/v1")
app.include_router(sales_proforma_routes.router, prefix="/api/v1")
app.include_router(accounts_sales_billing_routes.router, prefix="/api/v1")
app.include_router(accounts_receivables_routes.router, prefix="/api/v1")
app.include_router(production_workstations_routes.router, prefix="/api/v1")
app.include_router(production_boms_routes.router, prefix="/api/v1")
app.include_router(production_work_orders_routes.router, prefix="/api/v1")
app.include_router(production_shop_floor_routes.router, prefix="/api/v1")
app.include_router(production_planning_routes.router, prefix="/api/v1")
app.include_router(production_dashboard_routes.router, prefix="/api/v1")
app.include_router(production_reports_routes.router, prefix="/api/v1")
app.include_router(production_lookups_routes.router, prefix="/api/v1")
app.include_router(production_integrations_routes.router, prefix="/api/v1")
app.include_router(production_rrv_builds_routes.router, prefix="/api/v1")
app.include_router(production_ecm_routes.router, prefix="/api/v1")
app.include_router(production_engineering_lookups_routes.router, prefix="/api/v1")
app.include_router(production_mrp_routes.router, prefix="/api/v1")
app.include_router(hydraulic_systems_routes.router, prefix="/api/v1")
app.include_router(hydraulic_components_routes.router, prefix="/api/v1")
app.include_router(hydraulic_circuits_routes.router, prefix="/api/v1")
app.include_router(hydraulic_boms_routes.router, prefix="/api/v1")
app.include_router(hydraulic_calculations_routes.router, prefix="/api/v1")
app.include_router(hydraulic_testing_routes.router, prefix="/api/v1")
app.include_router(hydraulic_maintenance_routes.router, prefix="/api/v1")
app.include_router(hydraulic_service_records_routes.router, prefix="/api/v1")
app.include_router(hydraulic_spare_parts_routes.router, prefix="/api/v1")
app.include_router(hydraulic_documents_routes.router, prefix="/api/v1")
app.include_router(hydraulic_dashboard_routes.router, prefix="/api/v1")
app.include_router(hydraulic_lookups_routes.router, prefix="/api/v1")
app.include_router(electrical_jobs_routes.router, prefix="/api/v1")
app.include_router(electrical_bom_routes.router, prefix="/api/v1")
app.include_router(electrical_panels_routes.router, prefix="/api/v1")
app.include_router(electrical_cables_routes.router, prefix="/api/v1")
app.include_router(electrical_drawings_routes.router, prefix="/api/v1")
app.include_router(electrical_testing_routes.router, prefix="/api/v1")
app.include_router(electrical_issues_routes.router, prefix="/api/v1")
app.include_router(electrical_documents_routes.router, prefix="/api/v1")
app.include_router(electrical_dashboard_routes.router, prefix="/api/v1")
app.include_router(electrical_lookups_routes.router, prefix="/api/v1")
app.include_router(design_documents_routes.router, prefix="/api/v1")
app.include_router(design_revisions_routes.router, prefix="/api/v1")
app.include_router(design_change_notices_routes.router, prefix="/api/v1")
app.include_router(design_dashboard_routes.router, prefix="/api/v1")
app.include_router(design_reports_routes.router, prefix="/api/v1")
app.include_router(design_lookups_routes.router, prefix="/api/v1")
app.include_router(design_boms_routes.router, prefix="/api/v1")
app.include_router(design_boms_routes.where_used_router, prefix="/api/v1")
app.include_router(design_submissions_routes.router, prefix="/api/v1")
app.include_router(design_change_requests_routes.router, prefix="/api/v1")
app.include_router(design_requests_routes.router, prefix="/api/v1")
app.include_router(design_library_routes.router, prefix="/api/v1")
app.include_router(design_settings_routes.router, prefix="/api/v1")
app.include_router(design_insights_routes.router, prefix="/api/v1")
# applications before products: /products/{product_id} would swallow /products/applications.
app.include_router(products_applications_routes.router, prefix="/api/v1")
app.include_router(products_price_conditions_routes.router, prefix="/api/v1")  # before /products/{product_id}
app.include_router(products_products_routes.router, prefix="/api/v1")
app.include_router(project_units_routes.router, prefix="/api/v1")  # before /projects/{id}
app.include_router(pm_project_routes.router, prefix="/api/v1")
app.include_router(pm_milestones_routes.router, prefix="/api/v1")
app.include_router(pm_documents_routes.router, prefix="/api/v1")
app.include_router(pm_project_tasks_routes.router, prefix="/api/v1")
app.include_router(pm_project_tasks_routes.ongoing_router, prefix="/api/v1")
app.include_router(pm_work_routes.router, prefix="/api/v1")
app.include_router(store_locations_routes.router, prefix="/api/v1")
app.include_router(store_categories_routes.router, prefix="/api/v1")
app.include_router(store_item_import_routes.router, prefix="/api/v1")  # before /store/items/{id}
app.include_router(store_items_routes.router, prefix="/api/v1")
app.include_router(store_uoms_routes.router, prefix="/api/v1")
app.include_router(store_item_types_routes.router, prefix="/api/v1")
app.include_router(store_doc_types_routes.router, prefix="/api/v1")
app.include_router(store_settings_routes.router, prefix="/api/v1")
app.include_router(store_item_photo_routes.router, prefix="/api/v1")
app.include_router(store_bins_routes.router, prefix="/api/v1")
app.include_router(store_stock_routes.router, prefix="/api/v1")
app.include_router(store_stock_import_routes.router, prefix="/api/v1")
app.include_router(store_material_issues_routes.router, prefix="/api/v1")
app.include_router(store_material_returns_routes.router, prefix="/api/v1")
app.include_router(store_stock_transfers_routes.router, prefix="/api/v1")
app.include_router(store_stock_entries_routes.router, prefix="/api/v1")
app.include_router(store_stock_adjustments_routes.router, prefix="/api/v1")
app.include_router(store_physical_counts_routes.router, prefix="/api/v1")
app.include_router(store_reorder_routes.router, prefix="/api/v1")
app.include_router(store_stock_reservations_routes.router, prefix="/api/v1")
app.include_router(store_batches_routes.router, prefix="/api/v1")
app.include_router(store_job_work_routes.router, prefix="/api/v1")
app.include_router(store_serials_routes.router, prefix="/api/v1")
app.include_router(store_bin_stock_routes.router, prefix="/api/v1")
app.include_router(crm_organizations_routes.router, prefix="/api/v1")
app.include_router(crm_inquiries_routes.router, prefix="/api/v1")
app.include_router(crm_tenders_routes.router, prefix="/api/v1")
app.include_router(crm_activities_routes.router, prefix="/api/v1")
app.include_router(crm_documents_routes.router, prefix="/api/v1")
app.include_router(crm_workflow_routes.router, prefix="/api/v1")
app.include_router(crm_dashboard_routes.router, prefix="/api/v1")
app.include_router(crm_products_routes.router, prefix="/api/v1")
app.include_router(crm_payment_terms_routes.router, prefix="/api/v1")
app.include_router(crm_document_categories_routes.router, prefix="/api/v1")
app.include_router(crm_product_categories_routes.router, prefix="/api/v1")
app.include_router(crm_bulk_import_routes.router, prefix="/api/v1")
app.include_router(crm_rnd_requests_routes.router, prefix="/api/v1")
app.include_router(crm_requirement_discussion_routes.router, prefix="/api/v1")
app.include_router(crm_settings_routes.router, prefix="/api/v1")
app.include_router(crm_exports_routes.router, prefix="/api/v1")
app.include_router(crm_quotation_status_routes.router, prefix="/api/v1")
app.include_router(crm_opportunity_routes.router, prefix="/api/v1")
app.include_router(notifications_routes.router, prefix="/api/v1")
app.include_router(feedback_routes.router, prefix="/api/v1")
app.include_router(modules_routes.router, prefix="/api/v1")
app.include_router(presence_routes.router, prefix="/api/v1")
app.include_router(documents_routes.router, prefix="/api/v1")
app.include_router(accounts_gl_accounts_routes.router, prefix="/api/v1")
app.include_router(accounts_bank_accounts_routes.router, prefix="/api/v1")
app.include_router(accounts_vendors_routes.router, prefix="/api/v1")
app.include_router(accounts_internal_orders_routes.router, prefix="/api/v1")
app.include_router(accounts_journal_entries_routes.router, prefix="/api/v1")
app.include_router(accounts_vendor_invoices_routes.router, prefix="/api/v1")
app.include_router(accounts_payments_routes.router, prefix="/api/v1")
app.include_router(accounts_attachments_routes.router, prefix="/api/v1")
app.include_router(accounts_ar_transactions_routes.router, prefix="/api/v1")
app.include_router(accounts_period_close_routes.router, prefix="/api/v1")
app.include_router(accounts_bank_reconciliations_routes.router, prefix="/api/v1")
app.include_router(accounts_liquidity_forecast_routes.router, prefix="/api/v1")
app.include_router(accounts_reports_routes.router, prefix="/api/v1")
app.include_router(accounts_controlling_routes.router, prefix="/api/v1")
app.include_router(accounts_co_controlling_routes.router, prefix="/api/v1")
app.include_router(accounts_product_costing_routes.router, prefix="/api/v1")
app.include_router(accounts_profit_centers_routes.router, prefix="/api/v1")
app.include_router(accounts_profitability_routes.router, prefix="/api/v1")
app.include_router(accounts_setup_routes.router, prefix="/api/v1")
app.include_router(accounts_party_notes_routes.router, prefix="/api/v1")
app.include_router(accounts_gst_routes.router, prefix="/api/v1")
app.include_router(accounts_outstanding_routes.router, prefix="/api/v1")
app.include_router(accounts_inventory_routes.router, prefix="/api/v1")
app.include_router(accounts_fixed_assets_routes.router, prefix="/api/v1")
app.include_router(accounts_asset_accounting_routes.router, prefix="/api/v1")
app.include_router(accounts_fx_routes.router, prefix="/api/v1")
app.include_router(accounts_payment_proposals_routes.router, prefix="/api/v1")
app.include_router(accounts_settings_routes.router, prefix="/api/v1")
app.include_router(accounts_bank_statements_routes.router, prefix="/api/v1")
app.include_router(accounts_cash_position_routes.router, prefix="/api/v1")
app.include_router(accounts_bank_guarantees_routes.router, prefix="/api/v1")
app.include_router(rnd_calculations_routes.router, prefix="/api/v1/rnd")
app.include_router(rnd_history_routes.router, prefix="/api/v1/rnd")
app.include_router(rnd_projects_routes.router, prefix="/api/v1/rnd")
app.include_router(rnd_experiments_routes.router, prefix="/api/v1/rnd")
app.include_router(rnd_prototypes_routes.router, prefix="/api/v1/rnd")
app.include_router(rnd_dashboard_routes.router, prefix="/api/v1/rnd")
app.include_router(rnd_documents_routes.router, prefix="/api/v1/rnd")
app.include_router(rnd_requirements_routes.router, prefix="/api/v1/rnd")
app.include_router(rnd_requirement_work_routes.router, prefix="/api/v1/rnd")
app.include_router(rnd_technical_offers_routes.router, prefix="/api/v1/rnd")
app.include_router(rnd_department_requirements_routes.router, prefix="/api/v1/rnd")
app.include_router(rnd_project_tasks_routes.router, prefix="/api/v1/rnd")
app.include_router(rnd_project_milestones_routes.router, prefix="/api/v1/rnd")
app.include_router(rnd_requirement_milestones_routes.router, prefix="/api/v1/rnd")
app.include_router(reporting_router, prefix="/api/v1")
app.include_router(rnd_settings_routes.router, prefix="/api/v1/rnd")
app.include_router(organization_company_routes.router, prefix="/api/v1")
app.include_router(organization_branch_routes.router, prefix="/api/v1")
app.include_router(organization_department_routes.router, prefix="/api/v1")
app.include_router(organization_cost_center_routes.router, prefix="/api/v1")
app.include_router(organization_audit_log_routes.router, prefix="/api/v1")
app.include_router(organization_workflows_routes.router, prefix="/api/v1")
app.include_router(organization_workflows_routes.approvals_router, prefix="/api/v1")
app.include_router(organization_approval_mail_routes.router, prefix="/api/v1")
app.include_router(organization_delegations_routes.router, prefix="/api/v1")
app.include_router(organization_security_routes.router, prefix="/api/v1")
app.include_router(hr_employees_routes.router, prefix="/api/v1", dependencies=[_Depends(require_hr_module)])
app.include_router(hr_masters_routes.router, prefix="/api/v1", dependencies=[_Depends(require_hr_module)])
app.include_router(hr_lifecycle_routes.router, prefix="/api/v1", dependencies=[_Depends(require_hr_module)])
app.include_router(hr_leave_routes.router, prefix="/api/v1", dependencies=[_Depends(require_hr_module)])
app.include_router(hr_attendance_routes.router, prefix="/api/v1", dependencies=[_Depends(require_hr_module)])
app.include_router(hr_holidays_routes.router, prefix="/api/v1", dependencies=[_Depends(require_hr_module)])
app.include_router(hr_assets_routes.router, prefix="/api/v1", dependencies=[_Depends(require_hr_module)])
app.include_router(hr_visitors_routes.router, prefix="/api/v1", dependencies=[_Depends(require_hr_module)])
app.include_router(hr_travel_routes.router, prefix="/api/v1", dependencies=[_Depends(require_hr_module)])
app.include_router(hr_expenses_routes.router, prefix="/api/v1", dependencies=[_Depends(require_hr_module)])
app.include_router(hr_dashboard_routes.router, prefix="/api/v1", dependencies=[_Depends(require_hr_module)])
app.include_router(hr_settings_routes.router, prefix="/api/v1", dependencies=[_Depends(require_hr_module)])
app.include_router(hr_safety_routes.router, prefix="/api/v1", dependencies=[_Depends(require_hr_module)])
app.include_router(hr_time_evaluation_routes.router, prefix="/api/v1", dependencies=[_Depends(require_hr_module)])
app.include_router(hr_org_assignments_routes.router, prefix="/api/v1", dependencies=[_Depends(require_hr_module)])
app.include_router(hr_org_assignments_routes.lifecycle_router, prefix="/api/v1", dependencies=[_Depends(require_hr_module)])
app.include_router(hr_roster_routes.router, prefix="/api/v1", dependencies=[_Depends(require_hr_module)])
app.include_router(hr_punches_routes.router, prefix="/api/v1", dependencies=[_Depends(require_hr_module)])
app.include_router(hr_attendance_periods_routes.router, prefix="/api/v1", dependencies=[_Depends(require_hr_module)])
app.include_router(hr_registers_routes.router, prefix="/api/v1", dependencies=[_Depends(require_hr_module)])
# Finance screen for HR claims (PR05): accounts permissions, no HR app needed.
app.include_router(hr_expense_posting_routes.router, prefix="/api/v1")


@app.get("/health")
def health_check():
    """Health check endpoint to verify that the application is running."""
    return {
        "status": "ok",
        "app": settings.app_name,
        "version": "1.0.0",
        "environment": settings.environment,
    }


@app.get("/")
def root():
    """Root endpoint - API information."""
    return {
        "name": settings.app_name,
        "version": "1.0.0",
        "docs": "/docs",
        "api": "/api/v1",
    }


# ============ STARTUP/SHUTDOWN EVENTS ============

scheduler = BackgroundScheduler(timezone="Asia/Kolkata")


@app.on_event("startup")
async def startup():
    """Run on application startup."""
    print(f"[OK] {settings.app_name} started")
    print(f"[DOCS] API Docs: http://localhost:8000/docs")

    # Central approval engine: escalate steps past their "escalate after N hours".
    scheduler.add_job(
        run_escalations,
        CronTrigger(minute=5),
        id="approval_escalations",
        replace_existing=True,
    )
    scheduler.add_job(
        send_activity_followup_reminders,
        CronTrigger(hour=8, minute=0),
        id="activity_followup_reminders",
        replace_existing=True,
    )
    scheduler.add_job(
        send_po_overdue_reminders,
        CronTrigger(hour=8, minute=30),
        id="po_overdue_reminders",
        replace_existing=True,
    )
    scheduler.add_job(
        send_rfq_reminders,
        CronTrigger(hour=9, minute=0),
        id="rfq_reminders",
        replace_existing=True,
    )
    # PA40: effective-dated transfers / promotions / org changes (00:30 IST).
    from app.tasks.hr_lifecycle_apply import run_hr_lifecycle_apply
    scheduler.add_job(
        run_hr_lifecycle_apply,
        CronTrigger(hour=0, minute=30),
        id="hr_lifecycle_apply",
        replace_existing=True,
    )
    scheduler.add_job(
        send_hr_reminders,
        CronTrigger(hour=9, minute=0),
        id="hr_reminders",
        replace_existing=True,
    )
    scheduler.add_job(
        send_pm_reminders,
        CronTrigger(hour=9, minute=15),
        id="pm_reminders",
        replace_existing=True,
    )
    scheduler.add_job(
        send_design_reminders,
        CronTrigger(hour=9, minute=30),
        id="design_reminders",
        replace_existing=True,
    )
    scheduler.add_job(
        send_jobwork_reminders,
        CronTrigger(hour=9, minute=50),
        id="store_jobwork_reminders",
        replace_existing=True,
    )
    scheduler.add_job(
        send_quality_reminders,
        CronTrigger(hour=9, minute=45),
        id="quality_reminders",
        replace_existing=True,
    )
    scheduler.add_job(
        send_gauge_reminders,
        CronTrigger(hour=9, minute=40),
        id="gauge_calibration_reminders",
        replace_existing=True,
    )
    scheduler.add_job(
        run_erp_sla_reminders,
        CronTrigger(minute=20),  # hourly — service-request SLA at-risk / breach reminders
        id="erp_sla_reminders",
        replace_existing=True,
    )
    scheduler.add_job(
        run_maintenance_pm_scheduler,
        CronTrigger(hour=6, minute=0),
        id="maintenance_pm_scheduler",
        replace_existing=True,
    )
    scheduler.add_job(
        send_maintenance_amc_reminders,
        CronTrigger(hour=6, minute=15),
        id="maintenance_amc_reminders",
        replace_existing=True,
    )
    scheduler.add_job(
        send_bank_guarantee_reminders,
        CronTrigger(hour=7, minute=0),
        id="accounts_bank_guarantee_reminders",
        replace_existing=True,
    )
    scheduler.add_job(
        run_sales_scheduler,
        CronTrigger(hour=6, minute=30),
        id="sales_scheduler",
        replace_existing=True,
    )
    scheduler.add_job(
        run_erp_contract_scheduler,  # AMC / CMC expiry, renewal reminders, periodic billing
        CronTrigger(hour=6, minute=20),
        id="erp_contract_scheduler",
        replace_existing=True,
    )
    # Finance collections: settle promises to pay, remind collectors of broken
    # promises and today's follow-ups (Teams — reminders only).
    from app.modules.accounts.services.collections import run_collection_reminders_job
    scheduler.add_job(
        run_collection_reminders_job,
        CronTrigger(hour=8, minute=45),
        id="accounts_collection_reminders",
        replace_existing=True,
    )
    # Nightly Entra → users sync so leavers lose access without an admin
    # clicking "Sync Azure Users" (C-10).
    from app.modules.main.services.azure_sync import run_azure_sync_job
    scheduler.add_job(
        run_azure_sync_job,
        CronTrigger(hour=2, minute=0),
        id="azure_user_sync",
        replace_existing=True,
    )
    # SM36/SM37: governance jobs + run history for every job (core/jobs.py).
    from app.core.jobs import instrument_scheduler
    instrument_scheduler(scheduler)
    scheduler.start()


@app.on_event("shutdown")
async def shutdown():
    """Run on application shutdown."""
    scheduler.shutdown(wait=False)
    print(f"[STOP] {settings.app_name} stopped")
