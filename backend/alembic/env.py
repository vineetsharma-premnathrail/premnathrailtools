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
from app.modules.main.models.notification import Notification
from app.modules.main.models.user_session import UserSession
from app.modules.main.models.user_document import UserDocument
from app.modules.main.models.module import Module
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
from app.modules.organization.models.department import Department
from app.modules.erp.models.project import Project
from app.modules.erp.models.project_attachment import ProjectAttachment
from app.modules.erp.models.service_request import ServiceRequest
from app.modules.erp.models.service_material import ServiceMaterial
from app.modules.erp.models.service_request_attachment import ServiceRequestAttachment
from app.modules.erp.models.service_material_attachment import ServiceMaterialAttachment
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
from app.modules.quality.models.quality_standard import QualityStandard
from app.modules.quality.models.quality_checklist import QualityChecklist, QualityChecklistItem
from app.modules.quality.models.inspection_plan import QualityInspectionPlan
from app.modules.quality.models.inspection import QualityInspection, QualityInspectionResult, QualityInspectionAttachment
from app.modules.quality.models.ncr import QualityNcr
from app.modules.quality.models.rejection import QualityRejection
from app.modules.quality.models.capa import QualityCapa
from app.modules.quality.models.customer_complaint import QualityCustomerComplaint
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
from app.modules.projects.models.project import PmProject
from app.modules.projects.models.phase import PmProjectPhase
from app.modules.projects.models.task import PmProjectTask
from app.modules.projects.models.milestone import PmProjectMilestone
from app.modules.projects.models.resource import PmProjectResource
from app.modules.projects.models.budget import PmBudgetLine, PmCostEntry
from app.modules.projects.models.deliverable import PmDeliverable
from app.modules.projects.models.document import PmProjectDocument
from app.modules.projects.models.issue import PmIssue
from app.modules.projects.models.risk import PmRisk
from app.modules.projects.models.change_request import PmChangeRequest
from app.modules.projects.models.approval import PmApproval
from app.modules.store.models.location import StoreLocation
from app.modules.store.models.category import StoreItemCategory
from app.modules.store.models.item import StoreItem, StoreUom, StoreItemType
from app.modules.store.models.bin import StoreBin
from app.modules.store.models.stock_balance import StoreStockBalance
from app.modules.store.models.stock_transaction import StoreStockTransaction
from app.modules.store.models.material_issue import StoreMaterialIssue, StoreMaterialIssueItem
from app.modules.store.models.material_return import StoreMaterialReturn, StoreMaterialReturnItem, StoreMaterialReturnApproval
from app.modules.store.models.doc_type import StoreDocType
from app.modules.store.models.setting import StoreSetting
from app.modules.store.models.stock_transfer import StoreStockTransfer, StoreStockTransferItem
from app.modules.store.models.stock_adjustment import StoreStockAdjustment, StoreStockAdjustmentItem
from app.modules.store.models.stock_reservation import StoreStockReservation
from app.modules.crm.models import (
    Organization, OrgContact, Inquiry, InquiryLineItem, Quotation, QuotationLineItem,
    Tender, Activity,
    CrmDocument, CrmStageLog, Product, PaymentTerm,
)
from app.modules.accounts.models.gl_account import GLAccount
from app.modules.accounts.models.bank_account import BankAccount
from app.modules.accounts.models.vendor import Vendor
from app.modules.accounts.models.internal_order import InternalOrder
from app.modules.accounts.models.journal_entry import JournalEntry, JournalEntryLine
from app.modules.accounts.models.gl_balance import GLBalance
from app.modules.accounts.models.vendor_invoice import VendorInvoice
from app.modules.accounts.models.payment_transaction import PaymentTransaction
from app.modules.accounts.models.ar_transaction import ARTransaction
from app.modules.accounts.models.period_close import PeriodClose
from app.modules.accounts.models.bank_reconciliation import BankReconciliation
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
