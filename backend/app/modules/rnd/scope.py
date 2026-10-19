"""R&D records on the central data scope (core/data_scope.py).

Registered: R&D projects, experiments, prototypes, project documents and
the engineering-tool calculation history. "Assigned" = the project lead and
team members (team_member_ids is a JSON list, resolved in Python — the
table is small); experiments / prototypes / documents inherit their
project's team. R&D › Requirements are CRM inquiry/tender records (CRM's own
scope applies) and the engineering tools are calculators, so neither is
registered here.

R&D has no approval chain to move onto the approval engine: the
feasibility Go/No-Go and "release prototype to Production" are single
actions gated by rnd:projects:approve / rnd:prototypes:approve, with no
submit → pending → decide state."""
from __future__ import annotations

from sqlalchemy import false
from sqlalchemy.orm import object_session

from app.core.data_scope import apply_scope, ensure_in_scope, register_scoped  # noqa: F401  (re-exported for routes)
from app.modules.rnd.models.calculation_history import CalculationHistory
from app.modules.rnd.models.document import RndDocument
from app.modules.rnd.models.experiment import RndExperiment
from app.modules.rnd.models.project import RndProject
from app.modules.rnd.models.prototype import RndPrototype


def team_project_ids(user) -> list[int]:
    """Projects the user leads or is a team member of."""
    session = object_session(user)
    if session is None:
        return []
    rows = session.query(RndProject.id, RndProject.lead_id, RndProject.lead_ids, RndProject.team_member_ids).filter(
        RndProject.is_deleted == False  # noqa: E712
    ).all()
    return [
        pid for pid, lead, leads, members in rows
        if lead == user.id or user.id in (leads or []) or user.id in (members or [])
    ]


def _project_team(user):
    ids = team_project_ids(user)
    return RndProject.id.in_(ids) if ids else false()


def _child_of_team(model):
    def expr(user):
        ids = team_project_ids(user)
        return model.project_id.in_(ids) if ids else false()
    return expr


register_scoped(RndProject, "rnd", label="R&D project", owner=("created_by_id",), assigned=("lead_id", _project_team))
register_scoped(
    RndExperiment, "rnd", label="experiment", owner=("created_by_id",),
    assigned=("conducted_by_id", _child_of_team(RndExperiment)),
)
register_scoped(RndPrototype, "rnd", label="prototype", owner=("created_by_id",), assigned=(_child_of_team(RndPrototype),))
register_scoped(RndDocument, "rnd", label="R&D document", owner=("uploaded_by_id",), assigned=(_child_of_team(RndDocument),))
register_scoped(CalculationHistory, "rnd", label="saved calculation", owner=("user_id",))
