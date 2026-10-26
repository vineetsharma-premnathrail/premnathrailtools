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


def _is_fresh_database(connection) -> bool:
    """True when no migration has ever run here (no / empty alembic_version)."""
    from sqlalchemy import inspect, text

    if "alembic_version" not in inspect(connection).get_table_names():
        return True
    return connection.execute(text("SELECT count(*) FROM alembic_version")).scalar() == 0


def _give_python_defaults_a_server_default() -> None:
    """Fresh install only. Baseline's create_all() makes today's NOT NULL
    columns, but older data steps insert rows without columns added later
    (e.g. roles.data_scopes); those columns' defaults live only in Python.
    Give such columns the same value as a database default before the tables
    are created, so the old inserts work."""
    import datetime as _dt
    import json as _json

    from sqlalchemy import JSON, text
    from sqlalchemy.schema import DefaultClause

    for table in target_metadata.tables.values():
        for col in table.columns:
            if col.nullable or col.server_default is not None or col.default is None or col.primary_key:
                continue
            d = col.default
            if getattr(d, "is_scalar", False):
                value = d.arg
            elif getattr(d, "is_callable", False):
                try:
                    value = d.arg(None)
                except Exception:
                    continue
            else:
                continue
            if isinstance(col.type, JSON) or isinstance(value, (dict, list)):
                literal = "'" + _json.dumps(value).replace("'", "''") + "'"
            elif isinstance(value, bool):
                literal = "true" if value else "false"
            elif isinstance(value, (int, float)):
                literal = str(value)
            elif isinstance(value, str):
                literal = "'" + value.replace("'", "''") + "'"
            elif isinstance(value, (_dt.datetime, _dt.date)):
                literal = "now()" if isinstance(value, _dt.datetime) else "CURRENT_DATE"
            else:
                continue
            col.server_default = DefaultClause(text(literal))
            col.server_default._set_parent(col)


def _make_schema_ops_idempotent() -> None:
    """Fresh install only. The baseline migration runs Base.metadata.create_all()
    against today's models, so on an empty database every later table / column /
    index already exists in its final shape and things later migrations drop
    were never created. Skip those schema ops instead of failing on
    "already exists" / "does not exist"; data steps still run. Never used on a
    database that has migration history, where such an error is real."""
    from alembic.ddl.impl import DefaultImpl
    from sqlalchemy import inspect

    def insp(impl):
        return inspect(impl.connection)

    def has_table(impl, name, schema=None):
        return insp(impl).has_table(name, schema=schema)

    def cols(impl, table, schema=None):
        return {c["name"] for c in insp(impl).get_columns(table, schema=schema)} if has_table(impl, table, schema) else set()

    def index_names(impl, table, schema=None):
        return {i["name"] for i in insp(impl).get_indexes(table, schema=schema)} if has_table(impl, table, schema) else set()

    def constraint_names(impl, table, schema=None):
        if not has_table(impl, table, schema):
            return set()
        i = insp(impl)
        names = {fk["name"] for fk in i.get_foreign_keys(table, schema=schema)}
        names |= {u["name"] for u in i.get_unique_constraints(table, schema=schema)}
        names |= {c["name"] for c in i.get_check_constraints(table, schema=schema)}
        pk = i.get_pk_constraint(table, schema=schema)
        if pk and pk.get("name"):
            names.add(pk["name"])
        return names | index_names(impl, table, schema)

    def table_of(obj):
        return obj.table.name, obj.table.schema

    # op name -> guard(impl, *args, **kw): run the real op only when True.
    guards = {
        "create_table": lambda self, table, **kw: not has_table(self, table.name, table.schema),
        "drop_table": lambda self, table, **kw: has_table(self, table.name, table.schema),
        "add_column": lambda self, table_name, column, *, schema=None, **kw:
            has_table(self, table_name, schema) and column.name not in cols(self, table_name, schema),
        "drop_column": lambda self, table_name, column, *, schema=None, **kw: column.name in cols(self, table_name, schema),
        "alter_column": lambda self, table_name, column_name, *a, schema=None, **kw: column_name in cols(self, table_name, schema),
        "create_index": lambda self, index, **kw:
            has_table(self, *table_of(index)) and index.name not in index_names(self, *table_of(index)),
        "drop_index": lambda self, index, **kw: index.name in index_names(self, *table_of(index)),
        "add_constraint": lambda self, const, **kw:
            const.name is None or const.name not in constraint_names(self, *table_of(const)),
        "drop_constraint": lambda self, const, **kw: const.name in constraint_names(self, *table_of(const)),
    }

    def subclasses(cls):
        out = [cls]
        for sub in cls.__subclasses__():
            out += subclasses(sub)
        return out

    def wrap(real, guard):
        def op_if_needed(self, *a, **kw):
            if guard(self, *a, **kw):
                return real(self, *a, **kw)
        return op_if_needed

    # Wrap each impl class's own method: dialect impls override some
    # (PostgresqlImpl.create_index / alter_column).
    for cls in subclasses(DefaultImpl):
        for name, guard in guards.items():
            if name in cls.__dict__:
                setattr(cls, name, wrap(cls.__dict__[name], guard))


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
        fresh = _is_fresh_database(connection)
        # End the check's implicit transaction, or Alembic would treat it as
        # an outer transaction and never commit the migrations.
        connection.rollback()
        if fresh:
            _make_schema_ops_idempotent()
            _give_python_defaults_a_server_default()
        context.configure(
            connection=connection, target_metadata=target_metadata
        )

        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
