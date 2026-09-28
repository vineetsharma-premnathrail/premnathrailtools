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
from app.modules.store.models.item import StoreItem
from app.modules.store.models.bin import StoreBin
from app.modules.store.models.stock_balance import StoreStockBalance
from app.modules.store.models.stock_transaction import StoreStockTransaction
from app.modules.store.models.material_issue import StoreMaterialIssue, StoreMaterialIssueItem
from app.modules.store.models.material_return import StoreMaterialReturn, StoreMaterialReturnItem
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
from app.modules.main.routes import auth as auth_routes
from app.modules.main.routes import users as users_routes
from app.modules.main.routes import notifications as notifications_routes
from app.modules.main.routes import feedback as feedback_routes
from app.modules.main.routes import modules as modules_routes
from app.modules.main.routes import presence as presence_routes
from app.modules.accounts.routes import gl_accounts as accounts_gl_accounts_routes
from app.modules.accounts.routes import bank_accounts as accounts_bank_accounts_routes
from app.modules.accounts.routes import vendors as accounts_vendors_routes
from app.modules.accounts.routes import internal_orders as accounts_internal_orders_routes
from app.modules.accounts.routes import journal_entries as accounts_journal_entries_routes
from app.modules.accounts.routes import vendor_invoices as accounts_vendor_invoices_routes
from app.modules.accounts.routes import payments as accounts_payments_routes
from app.modules.accounts.routes import ar_transactions as accounts_ar_transactions_routes
from app.modules.accounts.routes import period_close as accounts_period_close_routes
from app.modules.accounts.routes import bank_reconciliations as accounts_bank_reconciliations_routes
from app.modules.accounts.routes import liquidity_forecast as accounts_liquidity_forecast_routes
from app.modules.accounts.routes import reports as accounts_reports_routes
from app.modules.erp.routes import projects as erp_projects_routes
from app.modules.erp.routes import service_requests as erp_sr_routes
from app.modules.p2p.routes import p2p_requests as p2p_requests_routes
from app.modules.p2p.routes import purchase_orders as p2p_purchase_orders_routes
from app.modules.p2p.routes import rfq as p2p_rfq_routes
from app.modules.p2p.routes import goods_receipts as p2p_goods_receipts_routes
from app.modules.p2p.routes import mis as p2p_mis_routes
from app.modules.quality.routes import standards as quality_standards_routes
from app.modules.quality.routes import checklists as quality_checklists_routes
from app.modules.quality.routes import inspection_plans as quality_inspection_plans_routes
from app.modules.quality.routes import inspections as quality_inspections_routes
from app.modules.quality.routes import ncr as quality_ncr_routes
from app.modules.quality.routes import rejections as quality_rejections_routes
from app.modules.quality.routes import capa as quality_capa_routes
from app.modules.quality.routes import complaints as quality_complaints_routes
from app.modules.quality.routes import supplier_quality as quality_supplier_quality_routes
from app.modules.quality.routes import documents as quality_documents_routes
from app.modules.quality.routes import dashboard as quality_dashboard_routes
from app.modules.projects.routes import project as pm_project_routes
from app.modules.projects.routes import phases as pm_phases_routes
from app.modules.projects.routes import tasks as pm_tasks_routes
from app.modules.projects.routes import milestones as pm_milestones_routes
from app.modules.projects.routes import resources as pm_resources_routes
from app.modules.projects.routes import budget as pm_budget_routes
from app.modules.projects.routes import deliverables as pm_deliverables_routes
from app.modules.projects.routes import documents as pm_documents_routes
from app.modules.projects.routes import issues as pm_issues_routes
from app.modules.projects.routes import risks as pm_risks_routes
from app.modules.projects.routes import change_requests as pm_change_requests_routes
from app.modules.projects.routes import approvals as pm_approvals_routes
from app.modules.store.routes import locations as store_locations_routes
from app.modules.store.routes import categories as store_categories_routes
from app.modules.store.routes import items as store_items_routes
from app.modules.store.routes import bins as store_bins_routes
from app.modules.store.routes import stock as store_stock_routes
from app.modules.store.routes import material_issues as store_material_issues_routes
from app.modules.store.routes import material_returns as store_material_returns_routes
from app.modules.store.routes import stock_transfers as store_stock_transfers_routes
from app.modules.store.routes import stock_adjustments as store_stock_adjustments_routes
from app.modules.store.routes import stock_reservations as store_stock_reservations_routes
from app.modules.crm.routes import organizations as crm_organizations_routes
from app.modules.crm.routes import inquiries as crm_inquiries_routes
from app.modules.crm.routes import tenders as crm_tenders_routes
from app.modules.crm.routes import activities as crm_activities_routes
from app.modules.crm.routes import documents as crm_documents_routes
from app.modules.crm.routes import workflow as crm_workflow_routes
from app.modules.crm.routes import dashboard as crm_dashboard_routes
from app.modules.crm.routes import products as crm_products_routes
from app.modules.crm.routes import payment_terms as crm_payment_terms_routes
from app.modules.crm.routes import product_categories as crm_product_categories_routes
from app.modules.crm.routes import bulk_import as crm_bulk_import_routes
from app.modules.rnd.routes import calculations as rnd_calculations_routes
from app.modules.rnd.routes import history as rnd_history_routes
from app.modules.organization.routes import company as organization_company_routes
from app.modules.organization.routes import branch as organization_branch_routes
from app.modules.organization.routes import department as organization_department_routes
from app.modules.organization.routes import cost_center as organization_cost_center_routes
from app.modules.organization.routes import audit_log as organization_audit_log_routes
from app.middleware.error_handler import setup_error_handlers, LoggingMiddleware
from app.middleware.owasp import OWASPMiddleware
from app.core.audit_context import AuditContextMiddleware

# Schema is managed by Alembic now (see backend/alembic/) — run
# `alembic upgrade head` after pulling new migrations or on first setup.
# create_all() is no longer called here since it can't apply ALTER TABLE
# changes to existing tables, only CREATE TABLE for brand-new ones.

app = FastAPI(
    title=settings.app_name,
    description="Premnathrail Portal - CRM, ERP, and R&D tools API",
    version="1.0.0",
)

# ============ MIDDLEWARE ============

# CORS Configuration - Allow frontend to communicate
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_origins_list,
    allow_credentials=True,            # Allow cookies/auth headers
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "X-Requested-With"],
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

# Static assets (e.g. the logo embedded in outgoing emails — see
# app/utils/email.py). Public by design: OWASPMiddleware's PUBLIC_PREFIXES
# already exempts "/static/" from the auth pre-check.
app.mount("/static", StaticFiles(directory=Path(__file__).parent / "static"), name="static")

# ============ ROUTES ============

# API v1 routes
app.include_router(auth_routes.router, prefix="/api/v1")
app.include_router(users_routes.router, prefix="/api/v1")
app.include_router(erp_projects_routes.router, prefix="/api/v1")
app.include_router(erp_sr_routes.router, prefix="/api/v1")
app.include_router(p2p_requests_routes.router, prefix="/api/v1")
app.include_router(p2p_purchase_orders_routes.router, prefix="/api/v1")
app.include_router(p2p_rfq_routes.router, prefix="/api/v1")
app.include_router(p2p_goods_receipts_routes.router, prefix="/api/v1")
app.include_router(p2p_mis_routes.router, prefix="/api/v1")
app.include_router(quality_standards_routes.router, prefix="/api/v1")
app.include_router(quality_checklists_routes.router, prefix="/api/v1")
app.include_router(quality_inspection_plans_routes.router, prefix="/api/v1")
app.include_router(quality_inspections_routes.router, prefix="/api/v1")
app.include_router(quality_ncr_routes.router, prefix="/api/v1")
app.include_router(quality_rejections_routes.router, prefix="/api/v1")
app.include_router(quality_capa_routes.router, prefix="/api/v1")
app.include_router(quality_complaints_routes.router, prefix="/api/v1")
app.include_router(quality_supplier_quality_routes.router, prefix="/api/v1")
app.include_router(quality_documents_routes.router, prefix="/api/v1")
app.include_router(quality_dashboard_routes.router, prefix="/api/v1")
app.include_router(pm_project_routes.router, prefix="/api/v1")
app.include_router(pm_phases_routes.router, prefix="/api/v1")
app.include_router(pm_tasks_routes.router, prefix="/api/v1")
app.include_router(pm_milestones_routes.router, prefix="/api/v1")
app.include_router(pm_resources_routes.router, prefix="/api/v1")
app.include_router(pm_budget_routes.router, prefix="/api/v1")
app.include_router(pm_deliverables_routes.router, prefix="/api/v1")
app.include_router(pm_documents_routes.router, prefix="/api/v1")
app.include_router(pm_issues_routes.router, prefix="/api/v1")
app.include_router(pm_risks_routes.router, prefix="/api/v1")
app.include_router(pm_change_requests_routes.router, prefix="/api/v1")
app.include_router(pm_approvals_routes.router, prefix="/api/v1")
app.include_router(store_locations_routes.router, prefix="/api/v1")
app.include_router(store_categories_routes.router, prefix="/api/v1")
app.include_router(store_items_routes.router, prefix="/api/v1")
app.include_router(store_bins_routes.router, prefix="/api/v1")
app.include_router(store_stock_routes.router, prefix="/api/v1")
app.include_router(store_material_issues_routes.router, prefix="/api/v1")
app.include_router(store_material_returns_routes.router, prefix="/api/v1")
app.include_router(store_stock_transfers_routes.router, prefix="/api/v1")
app.include_router(store_stock_adjustments_routes.router, prefix="/api/v1")
app.include_router(store_stock_reservations_routes.router, prefix="/api/v1")
app.include_router(crm_organizations_routes.router, prefix="/api/v1")
app.include_router(crm_inquiries_routes.router, prefix="/api/v1")
app.include_router(crm_tenders_routes.router, prefix="/api/v1")
app.include_router(crm_activities_routes.router, prefix="/api/v1")
app.include_router(crm_documents_routes.router, prefix="/api/v1")
app.include_router(crm_workflow_routes.router, prefix="/api/v1")
app.include_router(crm_dashboard_routes.router, prefix="/api/v1")
app.include_router(crm_products_routes.router, prefix="/api/v1")
app.include_router(crm_payment_terms_routes.router, prefix="/api/v1")
app.include_router(crm_product_categories_routes.router, prefix="/api/v1")
app.include_router(crm_bulk_import_routes.router, prefix="/api/v1")
app.include_router(notifications_routes.router, prefix="/api/v1")
app.include_router(feedback_routes.router, prefix="/api/v1")
app.include_router(modules_routes.router, prefix="/api/v1")
app.include_router(presence_routes.router, prefix="/api/v1")
app.include_router(accounts_gl_accounts_routes.router, prefix="/api/v1")
app.include_router(accounts_bank_accounts_routes.router, prefix="/api/v1")
app.include_router(accounts_vendors_routes.router, prefix="/api/v1")
app.include_router(accounts_internal_orders_routes.router, prefix="/api/v1")
app.include_router(accounts_journal_entries_routes.router, prefix="/api/v1")
app.include_router(accounts_vendor_invoices_routes.router, prefix="/api/v1")
app.include_router(accounts_payments_routes.router, prefix="/api/v1")
app.include_router(accounts_ar_transactions_routes.router, prefix="/api/v1")
app.include_router(accounts_period_close_routes.router, prefix="/api/v1")
app.include_router(accounts_bank_reconciliations_routes.router, prefix="/api/v1")
app.include_router(accounts_liquidity_forecast_routes.router, prefix="/api/v1")
app.include_router(accounts_reports_routes.router, prefix="/api/v1")
app.include_router(rnd_calculations_routes.router, prefix="/api/v1/rnd")
app.include_router(rnd_history_routes.router, prefix="/api/v1/rnd")
app.include_router(organization_company_routes.router, prefix="/api/v1")
app.include_router(organization_branch_routes.router, prefix="/api/v1")
app.include_router(organization_department_routes.router, prefix="/api/v1")
app.include_router(organization_cost_center_routes.router, prefix="/api/v1")
app.include_router(organization_audit_log_routes.router, prefix="/api/v1")


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
    scheduler.start()


@app.on_event("shutdown")
async def shutdown():
    """Run on application shutdown."""
    scheduler.shutdown(wait=False)
    print(f"[STOP] {settings.app_name} stopped")
