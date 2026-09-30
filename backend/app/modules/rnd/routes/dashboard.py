from fastapi import APIRouter, Depends
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core.permissions import require_app_access, require_tab_access
from app.db.session import get_db
from app.modules.main.models.user import User
from app.modules.store.models.item import StoreItem
from app.modules.rnd.models.project import RndProject, RND_PROJECT_STAGES
from app.modules.rnd.models.experiment import RndExperiment
from app.modules.rnd.models.prototype import RndPrototype, RndPrototypeBomItem, RND_PROTOTYPE_STATUSES
from app.modules.rnd.service import user_names

router = APIRouter(tags=["RnD Dashboard"], dependencies=[Depends(require_app_access("rnd"))])


@router.get("/dashboard")
async def rnd_dashboard(
    db: Session = Depends(get_db),
    _tab: User = Depends(require_tab_access("rnd", "dashboard")),
):
    live_projects = db.query(RndProject).filter(RndProject.is_deleted == False)  # noqa: E712
    by_stage = dict(
        live_projects.filter(RndProject.status != "cancelled")
        .with_entities(RndProject.stage, func.count(RndProject.id)).group_by(RndProject.stage).all()
    )
    by_status = dict(live_projects.with_entities(RndProject.status, func.count(RndProject.id)).group_by(RndProject.status).all())

    live_exps = db.query(RndExperiment).filter(RndExperiment.is_deleted == False)  # noqa: E712
    by_result = dict(
        live_exps.filter(RndExperiment.status == "completed")
        .with_entities(RndExperiment.result, func.count(RndExperiment.id)).group_by(RndExperiment.result).all()
    )
    exp_open = live_exps.filter(RndExperiment.status.in_(("planned", "in_progress"))).count()

    by_proto_status = dict(
        db.query(RndPrototype.status, func.count(RndPrototype.id))
        .filter(RndPrototype.is_deleted == False).group_by(RndPrototype.status).all()  # noqa: E712
    )

    total_budget = live_projects.filter(RndProject.status != "cancelled").with_entities(
        func.coalesce(func.sum(RndProject.budget_amount), 0)
    ).scalar() or 0
    total_spend = (
        db.query(func.coalesce(func.sum(RndPrototypeBomItem.quantity * func.coalesce(RndPrototypeBomItem.unit_cost, 0)), 0))
        .join(RndPrototype, RndPrototype.id == RndPrototypeBomItem.prototype_id)
        .join(RndProject, RndProject.id == RndPrototype.project_id)
        .filter(RndPrototype.is_deleted == False, RndProject.is_deleted == False, RndProject.status != "cancelled")  # noqa: E712
        .scalar()
    ) or 0

    recent_projects = live_projects.order_by(RndProject.updated_at.desc()).limit(6).all()
    lead_names = user_names(db, [p.lead_id for p in recent_projects])
    recent_experiments = live_exps.order_by(RndExperiment.updated_at.desc()).limit(6).all()
    completed = sum(by_result.values())

    return {
        "projects": {
            "total": sum(by_status.values()),
            "active": by_status.get("active", 0),
            "on_hold": by_status.get("on_hold", 0),
            "cancelled": by_status.get("cancelled", 0),
            "by_stage": {s: by_stage.get(s, 0) for s in RND_PROJECT_STAGES},
        },
        "experiments": {
            "open": exp_open,
            "completed": completed,
            "pass": by_result.get("pass", 0),
            "fail": by_result.get("fail", 0),
            "inconclusive": by_result.get("inconclusive", 0),
            "pass_rate": round(by_result.get("pass", 0) / completed * 100, 1) if completed else None,
        },
        "prototypes": {s: by_proto_status.get(s, 0) for s in RND_PROTOTYPE_STATUSES},
        "budget": {"total_budget": round(float(total_budget), 2), "total_spend": round(float(total_spend), 2)},
        "recent_projects": [
            {
                "id": p.id, "project_number": p.project_number, "title": p.title, "stage": p.stage,
                "status": p.status, "priority": p.priority, "lead_name": lead_names.get(p.lead_id),
                "target_end_date": p.target_end_date,
            } for p in recent_projects
        ],
        "recent_experiments": [
            {
                "id": e.id, "experiment_number": e.experiment_number, "title": e.title,
                "status": e.status, "result": e.result, "experiment_date": e.experiment_date,
            } for e in recent_experiments
        ],
    }


@router.get("/lookups/store-items")
async def lookup_store_items(search: str | None = None, db: Session = Depends(get_db)):
    """Minimal Item Master search for the prototype BOM editor — R&D users
    usually don't hold the 'store' app, so they can't call /store/items."""
    query = db.query(StoreItem)
    if search:
        like = f"%{search}%"
        query = query.filter((StoreItem.item_name.ilike(like)) | (StoreItem.item_code.ilike(like)))
    items = query.order_by(StoreItem.item_name).limit(50).all()
    return [{"id": i.id, "item_code": i.item_code, "item_name": i.item_name, "uom": i.uom} for i in items]
