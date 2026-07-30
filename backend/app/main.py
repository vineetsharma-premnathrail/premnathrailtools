from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.trustedhost import TrustedHostMiddleware
from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.cron import CronTrigger

from app.core.config import settings
from app.tasks.followup_reminders import send_activity_followup_reminders
from app.modules.main.models.user import User
from app.modules.main.models.audit_log import AuditLog
from app.modules.main.models.notification import Notification
from app.modules.main.models.api_key import APIKey
from app.modules.erp.models.project import Project
from app.modules.erp.models.project_attachment import ProjectAttachment
from app.modules.erp.models.service_request import ServiceRequest
from app.modules.erp.models.service_material import ServiceMaterial
from app.modules.erp.models.service_request_attachment import ServiceRequestAttachment
from app.modules.crm.models import (
    Organization, OrgContact, Inquiry, InquiryTask, InquiryApproval, Quotation,
    Tender, TenderTask, TenderCompetitor, PurchaseOrder, Activity, Note,
    CrmDocument, CrmDiscussion, CrmStageLog,
)
from app.modules.rnd.models.calculation_history import CalculationHistory
from app.modules.rnd.models.tool_calculations import (
    BrakingCalculation, HydraulicCalculation, LoadDistributionCalculation, QmaxCalculation,
    SplineCalculation, TractiveEffortCalculation, VehiclePerformanceCalculation,
)
from app.modules.main.routes import auth as auth_routes
from app.modules.main.routes import users as users_routes
from app.modules.main.routes import notifications as notifications_routes
from app.modules.main.routes import api_keys as api_keys_routes
from app.modules.main.routes import presence as presence_routes
from app.modules.erp.routes import projects as erp_projects_routes
from app.modules.erp.routes import service_requests as erp_sr_routes
from app.modules.crm.routes import organizations as crm_organizations_routes
from app.modules.crm.routes import inquiries as crm_inquiries_routes
from app.modules.crm.routes import tenders as crm_tenders_routes
from app.modules.crm.routes import activities as crm_activities_routes
from app.modules.crm.routes import notes as crm_notes_routes
from app.modules.crm.routes import documents as crm_documents_routes
from app.modules.crm.routes import workflow as crm_workflow_routes
from app.modules.crm.routes import dashboard as crm_dashboard_routes
from app.modules.crm.routes import bulk_import as crm_bulk_import_routes
from app.modules.rnd.routes import calculations as rnd_calculations_routes
from app.modules.rnd.routes import history as rnd_history_routes
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

# ============ ROUTES ============

# API v1 routes
app.include_router(auth_routes.router, prefix="/api/v1")
app.include_router(users_routes.router, prefix="/api/v1")
app.include_router(erp_projects_routes.router, prefix="/api/v1")
app.include_router(erp_sr_routes.router, prefix="/api/v1")
app.include_router(crm_organizations_routes.router, prefix="/api/v1")
app.include_router(crm_inquiries_routes.router, prefix="/api/v1")
app.include_router(crm_tenders_routes.router, prefix="/api/v1")
app.include_router(crm_activities_routes.router, prefix="/api/v1")
app.include_router(crm_notes_routes.router, prefix="/api/v1")
app.include_router(crm_documents_routes.router, prefix="/api/v1")
app.include_router(crm_workflow_routes.router, prefix="/api/v1")
app.include_router(crm_dashboard_routes.router, prefix="/api/v1")
app.include_router(crm_bulk_import_routes.router, prefix="/api/v1")
app.include_router(notifications_routes.router, prefix="/api/v1")
app.include_router(api_keys_routes.router, prefix="/api/v1")
app.include_router(presence_routes.router, prefix="/api/v1")
app.include_router(rnd_calculations_routes.router, prefix="/api/v1/rnd")
app.include_router(rnd_history_routes.router, prefix="/api/v1/rnd")


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
