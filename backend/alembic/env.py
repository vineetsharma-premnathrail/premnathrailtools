import sys
from pathlib import Path
from logging.config import fileConfig

from sqlalchemy import engine_from_config
from sqlalchemy import pool

from alembic import context

# Make `app.*` importable when Alembic is invoked from backend/.
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.core.config import settings
from app.db.base import Base

# Import every model so Base.metadata is fully populated for autogenerate —
# mirrors the import list in app/main.py.
from app.modules.main.models.user import User
from app.modules.main.models.audit_log import AuditLog
from app.modules.main.models.managed_document import ManagedDocument, ManagedDocumentEvent
from app.modules.main.models.notification import Notification
from app.modules.main.models.user_session import UserSession
from app.modules.main.models.user_document import UserDocument
from app.modules.main.models.module import Module
from app.modules.main.models.role import Role  # noqa: F401
from app.modules.main.models.grc import (  # noqa: F401
    AccessValidity, AccessReview, AccessReviewLine, SodMitigation, PermissionDenial, JobRun, SystemErrorLog,
)
from app.modules.main.models.module_setting import ModuleSetting
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
from app.modules.p2p.models.p2p_request_approval import P2PRequestApproval  # noqa: F401
from app.modules.p2p.models.p2p_request_po_approver import P2PRequestPOApprover  # noqa: F401
from app.modules.p2p.models.purchase_order import P2PPurchaseOrder, P2PPurchaseOrderItem
from app.modules.p2p.models.rfq import RFQ
from app.modules.p2p.models.rfq_attachment import RFQAttachment
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
from app.modules.sales.models.order import SalesOrder, SalesOrderLine, SalesOrderSchedule, SalesBillingPlanLine
from app.modules.sales.models.amendment import SalesOrderAmendment
from app.modules.sales.models.extension import SalesDeliveryExtension
from app.modules.sales.models.approval import SalesApproval
from app.modules.sales.models.attachment import SalesAttachment
from app.modules.sales.models.delivery import SalesDeliveryEvent, SalesInvoiceLink
from app.modules.sales.models.proforma import SalesProformaInvoice
from app.modules.sales.models.order_project import OrderProject, OrderProjectElement
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
from app.modules.projects.models.task import PmProjectTask, PmTaskSubtask, PmTaskUpdate, PmTaskTimeLog, PmMilestoneMessage
from app.modules.projects.models.milestone import PmProjectMilestone
from app.modules.projects.models.document import PmProjectDocument
from app.modules.store.models.location import StoreLocation
from app.modules.store.models.category import StoreItemCategory
from app.modules.store.models.item import StoreItem, StoreUom, StoreItemType
from app.modules.store.models.bin import StoreBin
from app.modules.store.models.stock_balance import StoreStockBalance
from app.modules.store.models.stock_transaction import StoreStockTransaction
from app.modules.store.models.stock_entry import StoreStockEntry, StoreStockEntryAttachment
from app.modules.store.models.material_issue import StoreMaterialIssue, StoreMaterialIssueItem
from app.modules.store.models.material_return import StoreMaterialReturn, StoreMaterialReturnItem, StoreMaterialReturnApproval
from app.modules.store.models.doc_type import StoreDocType
from app.modules.store.models.setting import StoreSetting
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

# this is the Alembic Config object, which provides
# access to the values within the .ini file in use.
config = context.config

# Use the same DATABASE_URL the app itself reads from .env, instead of a
# hardcoded value in alembic.ini.
config.set_main_option("sqlalchemy.url", settings.database_url)

# Interpret the config file for Python logging.
# This line sets up loggers basically.
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

target_metadata = Base.metadata


def run_migrations_offline() -> None:
    """Run migrations in 'offline' mode.

    This configures the context with just a URL
    and not an Engine, though an Engine is acceptable
    here as well.  By skipping the Engine creation
    we don't even need a DBAPI to be available.

    Calls to context.execute() here emit the given string to the
    script output.

    """
    url = config.get_main_option("sqlalchemy.url")
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )

    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    """Run migrations in 'online' mode.

    In this scenario we need to create an Engine
    and associate a connection with the context.

    """
    connectable = engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )

    with connectable.connect() as connection:
        context.configure(
            connection=connection, target_metadata=target_metadata
        )

        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
