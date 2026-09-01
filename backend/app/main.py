from pathlib import Path
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.trustedhost import TrustedHostMiddleware
from fastapi.staticfiles import StaticFiles
from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.cron import CronTrigger

from app.core.config import settings
from app.tasks.followup_reminders import send_activity_followup_reminders
from app.modules.main.models.user import User
from app.modules.main.models.audit_log import AuditLog
from app.modules.main.models.notification import Notification
from app.modules.main.models.api_key import APIKey
from app.modules.main.models.module import Module
from app.modules.organization.models.company import Company
from app.modules.organization.models.branch import Branch
from app.modules.organization.models.department import Department
from app.modules.manufacturing.models.material import Material as MfgMaterial
from app.modules.manufacturing.models.bom import BOM, BOMItem
from app.modules.manufacturing.models.work_order import WorkOrder as MfgWorkOrder
from app.modules.manufacturing.models.stock_entry import StockEntry as MfgStockEntry
from app.modules.erp.models.project import Project
from app.modules.erp.models.project_attachment import ProjectAttachment
from app.modules.erp.models.service_request import ServiceRequest
from app.modules.erp.models.service_material import ServiceMaterial
from app.modules.erp.models.service_request_attachment import ServiceRequestAttachment
from app.modules.erp.models.service_material_attachment import ServiceMaterialAttachment
from app.modules.purchase.models.purchase_requisition import PurchaseRequisition
from app.modules.purchase.models.purchase_requisition_item import PurchaseRequisitionItem
from app.modules.p2p.models.p2p_request import P2PRequest
from app.modules.p2p.models.p2p_request_item import P2PRequestItem
from app.modules.p2p.models.p2p_request_attachment import P2PRequestAttachment
from app.modules.p2p.models.purchase_order import P2PPurchaseOrder, P2PPurchaseOrderItem
from app.modules.p2p.models.rfq import RFQ
from app.modules.p2p.models.rfq_attachment import RFQAttachment
from app.modules.p2p.models.vendor_quotation import VendorQuotation
from app.modules.vendor.models.vendor import Vendor
from app.modules.store.models.location import StoreLocation
from app.modules.store.models.stock_item import StockItem
from app.modules.store.models.stock_balance import StockBalance
from app.modules.store.models.stock_transaction import StockTransaction
from app.modules.design.models.engineering_document import EngineeringDocument
from app.modules.electrical.models.work_order import ElectricalWorkOrder
from app.modules.crm.models import (
    Organization, OrgContact, Inquiry, InquiryTask, InquiryApproval, Quotation, QuotationLineItem,
    Tender, TenderTask, TenderCompetitor, PurchaseOrder, Activity,
    CrmDocument, CrmDiscussion, CrmStageLog, Product, PaymentTerm,
)
from app.modules.rnd.models.calculation_history import CalculationHistory
from app.modules.rnd.models.tool_calculations import (
    BrakingCalculation, HydraulicCalculation, LoadDistributionCalculation, QmaxCalculation,
    SplineCalculation, TractiveEffortCalculation, VehiclePerformanceCalculation,
)
from app.modules.main.routes import auth as auth_routes
from app.modules.main.routes import users as users_routes
from app.modules.main.routes import notifications as notifications_routes
from app.modules.main.routes import feedback as feedback_routes
from app.modules.main.routes import api_keys as api_keys_routes
from app.modules.main.routes import modules as modules_routes
from app.modules.hr.routes import hr as hr_routes
from app.modules.design.routes import engineering_documents as design_documents_routes
from app.modules.electrical.routes import work_orders as electrical_work_orders_routes
from app.modules.main.routes import presence as presence_routes
from app.modules.erp.routes import projects as erp_projects_routes
from app.modules.erp.routes import service_requests as erp_sr_routes
from app.modules.purchase.routes import purchase_requisitions as purchase_requisitions_routes
from app.modules.p2p.routes import p2p_requests as p2p_requests_routes
from app.modules.p2p.routes import purchase_orders as p2p_purchase_orders_routes
from app.modules.p2p.routes import rfq as p2p_rfq_routes
from app.modules.vendor.routes import vendors as vendors_routes
from app.modules.store.routes import locations as store_locations_routes
from app.modules.store.routes import stock_items as store_stock_items_routes
from app.modules.store.routes import stock_transactions as store_stock_transactions_routes
from app.modules.crm.routes import organizations as crm_organizations_routes
from app.modules.crm.routes import inquiries as crm_inquiries_routes
from app.modules.crm.routes import tenders as crm_tenders_routes
from app.modules.crm.routes import activities as crm_activities_routes
from app.modules.crm.routes import documents as crm_documents_routes
from app.modules.crm.routes import workflow as crm_workflow_routes
from app.modules.crm.routes import dashboard as crm_dashboard_routes
from app.modules.crm.routes import products as crm_products_routes
from app.modules.crm.routes import payment_terms as crm_payment_terms_routes
from app.modules.rnd.routes import calculations as rnd_calculations_routes
from app.modules.rnd.routes import history as rnd_history_routes
from app.modules.organization.routes import company as organization_company_routes
from app.modules.organization.routes import branch as organization_branch_routes
from app.modules.organization.routes import department as organization_department_routes
from app.modules.manufacturing.routes import materials as manufacturing_materials_routes
from app.modules.manufacturing.routes import boms as manufacturing_boms_routes
from app.modules.manufacturing.routes import work_orders as manufacturing_work_orders_routes
from app.modules.manufacturing.routes import stock_entries as manufacturing_stock_entries_routes
from app.modules.manufacturing.routes import dashboard as manufacturing_dashboard_routes
from app.middleware.error_handler import setup_error_handlers, LoggingMiddleware
from app.middleware.owasp import OWASPMiddleware

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
app.include_router(purchase_requisitions_routes.router, prefix="/api/v1")
app.include_router(p2p_requests_routes.router, prefix="/api/v1")
app.include_router(p2p_purchase_orders_routes.router, prefix="/api/v1")
app.include_router(p2p_rfq_routes.router, prefix="/api/v1")
app.include_router(vendors_routes.router, prefix="/api/v1")
app.include_router(store_locations_routes.router, prefix="/api/v1")
app.include_router(store_stock_items_routes.router, prefix="/api/v1")
app.include_router(store_stock_transactions_routes.router, prefix="/api/v1")
app.include_router(crm_organizations_routes.router, prefix="/api/v1")
app.include_router(crm_inquiries_routes.router, prefix="/api/v1")
app.include_router(crm_tenders_routes.router, prefix="/api/v1")
app.include_router(crm_activities_routes.router, prefix="/api/v1")
app.include_router(crm_documents_routes.router, prefix="/api/v1")
app.include_router(crm_workflow_routes.router, prefix="/api/v1")
app.include_router(crm_dashboard_routes.router, prefix="/api/v1")
app.include_router(crm_products_routes.router, prefix="/api/v1")
app.include_router(crm_payment_terms_routes.router, prefix="/api/v1")
app.include_router(notifications_routes.router, prefix="/api/v1")
app.include_router(feedback_routes.router, prefix="/api/v1")
app.include_router(api_keys_routes.router, prefix="/api/v1")
app.include_router(modules_routes.router, prefix="/api/v1")
app.include_router(hr_routes.router, prefix="/api/v1")
app.include_router(design_documents_routes.router, prefix="/api/v1")
app.include_router(electrical_work_orders_routes.router, prefix="/api/v1")
app.include_router(presence_routes.router, prefix="/api/v1")
app.include_router(rnd_calculations_routes.router, prefix="/api/v1/rnd")
app.include_router(rnd_history_routes.router, prefix="/api/v1/rnd")
app.include_router(organization_company_routes.router, prefix="/api/v1")
app.include_router(organization_branch_routes.router, prefix="/api/v1")
app.include_router(organization_department_routes.router, prefix="/api/v1")
app.include_router(manufacturing_materials_routes.router, prefix="/api/v1")
app.include_router(manufacturing_boms_routes.router, prefix="/api/v1")
app.include_router(manufacturing_work_orders_routes.router, prefix="/api/v1")
app.include_router(manufacturing_stock_entries_routes.router, prefix="/api/v1")
app.include_router(manufacturing_dashboard_routes.router, prefix="/api/v1")


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
    scheduler.start()


@app.on_event("shutdown")
async def shutdown():
    """Run on application shutdown."""
    scheduler.shutdown(wait=False)
    print(f"[STOP] {settings.app_name} stopped")
