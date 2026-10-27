"""Service Projects (machine register) move from Service to Project Management (2026-10-26).

The tab `erp:projects:*` becomes `projects:service_projects:*` (owner decision:
the machine register lives under Project Management; API stays /erp/projects).

- Stored grants in roles, users' extra grants and approval stage configs are
  renamed (`erp:projects:` and feature ids `erp:projects.<f>:`).
- A Service wildcard (`erp:*:view` / `erp:*:*` ...) used to cover the tab, so it
  gets the matching explicit grant - nobody loses access. A Project Management
  wildcard does NOT cover the new tab (EXPLICIT_ONLY_TABS), so nobody gains it.
- Machines now follow the Project Management data scope. A role that holds
  machine grants and no other Project Management grant gets its Service scope
  copied to Project Management (same for a user's own Service scope override),
  so what they see does not change. A role / user that already works in
  Project Management keeps its Project Management scope for machines too.
- The notification "New machine registered" moved: role subscriptions and user
  overrides `erp.machine_registered` become `projects.machine_registered`.
- The machine approval workflow (`erp.machine`) is listed under Project
  Management. Approval delegations are left as they are.

Every data-scope copy is written to service_projects_move_log so the downgrade
can take it back.

Revision ID: f7c3a9e1d5b2
Revises: e4b8c2d6f1a3
Create Date: 2026-10-26
"""
import json

from alembic import op
import sqlalchemy as sa

revision = "f7c3a9e1d5b2"
down_revision = "e4b8c2d6f1a3"
branch_labels = None
depends_on = None

OLD, NEW = "erp:projects", "projects:service_projects"
ACTIONS = ("view", "create", "edit", "delete", "export", "print", "import")
EVENT_OLD, EVENT_NEW = "erp.machine_registered", "projects.machine_registered"
LOG = "service_projects_move_log"


def _load(v):
    if v is None:
        return None
    return json.loads(v) if isinstance(v, str) else v


def _moved(g: str, forward: bool) -> str | None:
    src, dst = (OLD, NEW) if forward else (NEW, OLD)
    for sep in (":", "."):
        if g.startswith(src + sep):
            return dst + g[len(src):]
    return None


def _rename_list(grants, forward: bool):
    if not isinstance(grants, list):
        return grants, False
    out, changed = [], False
    for g in grants:
        if isinstance(g, str):
            m = _moved(g, forward)
            if m:
                g, changed = m, True
        if g not in out:
            out.append(g)
    if forward:
        for g in list(out):
            if isinstance(g, str) and g.startswith("erp:*:"):
                a = g.split(":")[2]
                for x in ACTIONS:
                    if a in ("*", x) and f"{NEW}:{x}" not in out:
                        out.append(f"{NEW}:{x}")
                        changed = True
    return out, changed


def _rename_cfg(cfg, forward: bool):
    if not isinstance(cfg, dict) or "plus_permission" not in cfg:
        return cfg, False
    plus = cfg["plus_permission"]
    if isinstance(plus, str) and _moved(plus, forward):
        return {**cfg, "plus_permission": _moved(plus, forward)}, True
    if isinstance(plus, list) and any(isinstance(p, str) and _moved(p, forward) for p in plus):
        return {**cfg, "plus_permission": [(_moved(p, forward) or p) if isinstance(p, str) else p for p in plus]}, True
    return cfg, False


def _rename_events(subs, forward: bool):
    src, dst = (EVENT_OLD, EVENT_NEW) if forward else (EVENT_NEW, EVENT_OLD)
    if not isinstance(subs, dict) or src not in subs:
        return subs, False
    out = {k: v for k, v in subs.items() if k != src}
    out.setdefault(dst, subs[src])
    return out, True


def _other_pm(grants) -> bool:
    """Holds a Project Management grant besides Service Projects."""
    return any(isinstance(g, str) and g.startswith("projects:") and not g.startswith(NEW) for g in grants or [])


def _has_machines(grants) -> bool:
    return any(isinstance(g, str) and g.startswith(NEW) for g in grants or [])


def _table(name, *cols):
    return sa.table(name, sa.column("id", sa.Integer), *[sa.column(c, sa.JSON) for c in cols])


def upgrade() -> None:
    bind = op.get_bind()
    tables = set(sa.inspect(bind).get_table_names())
    if LOG not in tables:
        op.create_table(
            LOG,
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("table_name", sa.String(40), nullable=False),
            sa.Column("row_id", sa.Integer(), nullable=False),
        )
    log = sa.table(LOG, sa.column("table_name", sa.String), sa.column("row_id", sa.Integer))

    for name, col, fn in (("roles", "permissions", _rename_list), ("users", "granular_permissions", _rename_list),
                          ("approval_workflow_stages", "rule_config", _rename_cfg),
                          ("roles", "notification_events", _rename_events),
                          ("users", "notification_overrides", _rename_events)):
        if name not in tables or col not in {c["name"] for c in sa.inspect(bind).get_columns(name)}:
            continue
        t = _table(name, col)
        for rid, val in bind.execute(sa.select(t.c.id, t.c[col])).fetchall():
            new, changed = fn(_load(val), True)
            if changed:
                bind.execute(t.update().where(t.c.id == rid).values({col: new}))

    # Data scope: machines now read the "projects" scope.
    role_grants: dict[int, list] = {}
    if "roles" in tables:
        t = _table("roles", "permissions", "data_scopes")
        for rid, perms, scopes in bind.execute(sa.select(t.c.id, t.c.permissions, t.c.data_scopes)).fetchall():
            perms, scopes = _load(perms) or [], _load(scopes) or {}
            role_grants[rid] = perms
            if _has_machines(perms) and not _other_pm(perms) and scopes.get("erp") and not scopes.get("projects"):
                bind.execute(t.update().where(t.c.id == rid).values(data_scopes={**scopes, "projects": scopes["erp"]}))
                bind.execute(log.insert().values(table_name="roles", row_id=rid))
    if "users" in tables and "user_roles" in tables:
        links: dict[int, list[int]] = {}
        for uid, rid in bind.execute(sa.text("SELECT user_id, role_id FROM user_roles")).fetchall():
            links.setdefault(uid, []).append(rid)
        t = _table("users", "granular_permissions", "data_access_scopes")
        for uid, extra, scopes in bind.execute(sa.select(t.c.id, t.c.granular_permissions, t.c.data_access_scopes)).fetchall():
            scopes = _load(scopes) or {}
            if not scopes.get("erp") or scopes.get("projects"):
                continue
            grants = list(_load(extra) or []) + [g for r in links.get(uid, []) for g in role_grants.get(r, [])]
            if _has_machines(grants) and not _other_pm(grants):
                bind.execute(t.update().where(t.c.id == uid).values(data_access_scopes={**scopes, "projects": scopes["erp"]}))
                bind.execute(log.insert().values(table_name="users", row_id=uid))

    if "approval_workflows" in tables:
        bind.execute(sa.text("UPDATE approval_workflows SET module_key = 'projects' WHERE key = 'erp.machine' AND module_key = 'erp'"))


def downgrade() -> None:
    bind = op.get_bind()
    tables = set(sa.inspect(bind).get_table_names())
    if LOG in tables:
        for name, col in (("roles", "data_scopes"), ("users", "data_access_scopes")):
            t = _table(name, col)
            ids = [r[0] for r in bind.execute(sa.text(f"SELECT row_id FROM {LOG} WHERE table_name = :n"), {"n": name}).fetchall()]
            for rid, val in bind.execute(sa.select(t.c.id, t.c[col]).where(t.c.id.in_(ids))).fetchall() if ids else []:
                scopes = {k: v for k, v in (_load(val) or {}).items() if k != "projects"}
                bind.execute(t.update().where(t.c.id == rid).values({col: scopes}))
        op.drop_table(LOG)
    for name, col, fn in (("roles", "permissions", _rename_list), ("users", "granular_permissions", _rename_list),
                          ("approval_workflow_stages", "rule_config", _rename_cfg),
                          ("roles", "notification_events", _rename_events),
                          ("users", "notification_overrides", _rename_events)):
        if name not in tables or col not in {c["name"] for c in sa.inspect(bind).get_columns(name)}:
            continue
        t = _table(name, col)
        for rid, val in bind.execute(sa.select(t.c.id, t.c[col])).fetchall():
            new, changed = fn(_load(val), False)
            if changed:
                bind.execute(t.update().where(t.c.id == rid).values({col: new}))
    if "approval_workflows" in tables:
        bind.execute(sa.text("UPDATE approval_workflows SET module_key = 'erp' WHERE key = 'erp.machine' AND module_key = 'projects'"))
