from datetime import date, timedelta

from fastapi import APIRouter, Depends
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core.permissions import require_app_access, require_tab_access
from app.db.session import get_db
from app.modules.hydraulic.models.bom import HydBom
from app.modules.hydraulic.models.circuit import HydCircuit
from app.modules.hydraulic.models.component import HydComponent
from app.modules.hydraulic.models.maintenance import HydMaintenancePlan, HydServiceRecord
from app.modules.hydraulic.models.spare_part import HydSparePart
from app.modules.hydraulic.models.system import HydSystem
from app.modules.hydraulic.models.testing import HydTest
from app.modules.hydraulic.routes.maintenance import to_plan_responses
from app.modules.hydraulic.routes.spare_parts import to_spare_responses
from app.modules.hydraulic.schemas.insights import HydDashboardResponse
from app.modules.hydraulic.service import systems_by_id
from app.modules.main.models.user import User

router = APIRouter(
    prefix="/hydraulic/dashboard", tags=["Hydraulic & Pneumatic"],
    dependencies=[Depends(require_app_access("hydraulic"))],
)


@router.get("", response_model=HydDashboardResponse)
async def get_dashboard(
    db: Session = Depends(get_db),
    _tab: User = Depends(require_tab_access("hydraulic", "dashboard")),
):
    since = date.today() - timedelta(days=30)
    live_sys = HydSystem.is_deleted == False  # noqa: E712
    by_type = dict(db.query(HydSystem.system_type, func.count(HydSystem.id)).filter(live_sys).group_by(HydSystem.system_type).all())
    by_status = dict(db.query(HydSystem.status, func.count(HydSystem.id)).filter(live_sys).group_by(HydSystem.status).all())

    plans = to_plan_responses(db, db.query(HydMaintenancePlan).filter(
        HydMaintenancePlan.is_deleted == False, HydMaintenancePlan.is_active == True,  # noqa: E712
    ).all())
    due = sorted((p for p in plans if p.due_status in ("overdue", "due_soon")),
                 key=lambda p: (p.due_status != "overdue", p.next_due_date or date.max))

    live_svc = HydServiceRecord.is_deleted == False  # noqa: E712
    open_services = db.query(HydServiceRecord).filter(live_svc, HydServiceRecord.status.in_(("open", "in_progress"))).order_by(HydServiceRecord.service_date).all()
    done_30d = db.query(HydServiceRecord).filter(live_svc, HydServiceRecord.status == "completed", HydServiceRecord.completed_on >= since).all()
    parts_cost_30d = sum(p.unit_cost * p.quantity for r in done_30d for p in r.parts)

    live_test = HydTest.is_deleted == False  # noqa: E712
    tests_30d = db.query(HydTest).filter(live_test, HydTest.status == "completed", HydTest.test_date >= since)
    recent_tests = db.query(HydTest).filter(live_test).order_by(HydTest.id.desc()).limit(8).all()

    spares = to_spare_responses(db, db.query(HydSparePart).filter(HydSparePart.is_deleted == False, HydSparePart.status == "active").all())  # noqa: E712
    low = sorted((s for s in spares if s.stock_status in ("low", "out")),
                 key=lambda s: ({"critical": 0, "essential": 1}.get(s.criticality, 2), s.stock_status != "out"))
    svc_systems = systems_by_id(db, {r.system_id for r in open_services})

    return {
        "kpis": {
            "hydraulic_systems": by_type.get("hydraulic", 0),
            "pneumatic_systems": by_type.get("pneumatic", 0),
            "in_service": by_status.get("in_service", 0) + by_status.get("commissioned", 0),
            "under_maintenance": by_status.get("under_maintenance", 0),
            "active_components": db.query(HydComponent).filter(HydComponent.is_deleted == False, HydComponent.status == "active").count(),  # noqa: E712
            "circuits_in_review": db.query(HydCircuit).filter(HydCircuit.is_deleted == False, HydCircuit.status == "under_review").count(),  # noqa: E712
            "draft_boms": db.query(HydBom).filter(HydBom.is_deleted == False, HydBom.status == "draft").count(),  # noqa: E712
            "plans_overdue": sum(1 for p in plans if p.due_status == "overdue"),
            "plans_due_soon": sum(1 for p in plans if p.due_status == "due_soon"),
            "open_service_records": len(open_services),
            "downtime_hours_30d": round(sum(r.downtime_hours or 0 for r in done_30d), 1),
            "service_cost_30d": round(parts_cost_30d + sum((r.labour_cost or 0) + (r.other_cost or 0) for r in done_30d), 2),
            "tests_30d": tests_30d.count(),
            "tests_failed_30d": tests_30d.filter(HydTest.result == "fail").count(),
            "spares_low": len(low),
            "critical_spares_out": sum(1 for s in low if s.criticality == "critical" and s.stock_status == "out"),
        },
        "maintenance_due": [
            {"plan_id": p.id, "plan_number": p.plan_number, "title": p.title, "system_number": p.system_number, "system_name": p.system_name,
             "next_due_date": p.next_due_date, "due_status": p.due_status, "days_to_due": p.days_to_due}
            for p in due[:8]
        ],
        "recent_tests": [
            {"test_id": t.id, "test_number": t.test_number, "title": t.title, "test_type": t.test_type,
             "test_date": t.test_date, "status": t.status, "result": t.result}
            for t in recent_tests
        ],
        "low_spares": [
            {"spare_part_id": s.id, "part_code": s.part_code, "name": s.name, "criticality": s.criticality,
             "available_qty": s.available_qty, "min_stock_qty": s.min_stock_qty, "uom": s.uom, "stock_status": s.stock_status}
            for s in low[:8]
        ],
        "open_services": [
            {"record_id": r.id, "record_number": r.record_number,
             "system_number": svc_systems[r.system_id].system_number if r.system_id in svc_systems else None,
             "system_name": svc_systems[r.system_id].name if r.system_id in svc_systems else None,
             "service_type": r.service_type, "service_date": r.service_date, "status": r.status}
            for r in open_services[:8]
        ],
    }
