"""Generic report endpoints, mounted once at /api/v1 (prefix /reports).

    GET /reports/{module}                              catalogue (what this user may use)
    GET /reports/{module}/{report}                     run: level=summary | detail
    GET /reports/{module}/{report}/options/{filter}    scoped lookup, max 50
    GET /reports/{module}/{report}/export              designed .xlsx

Deny by default: tab View (and Export), the module's money switch and the
`reports.management` switch are checked before any data is read; every
loader starts from the viewer's data scope (see registry.py)."""
from __future__ import annotations

import dataclasses
from datetime import datetime, timezone
from io import BytesIO

from fastapi import APIRouter, Body, Depends, HTTPException, Query, Request
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from app.core.permission_registry import can_perform
from app.core.permissions import ensure_tab_action
from app.core.reporting import dates as rdates
from app.core.reporting import dashboards, engine, xlsx
from app.core.reporting.providers import load_providers
from app.core.reporting.registry import (
    DashboardPage, ReportDataset, ReportDef, VisualSpec, get_dataset, get_report, module_dashboards, module_reports,
)
from app.db.session import get_db
from app.modules.main.models.audit_log import AuditLog
from app.modules.main.models.user import User
from app.modules.main.routes.auth import get_current_user
from app.modules.organization.models.company import Company

router = APIRouter(prefix="/reports", tags=["Reports"])


def _module_or_404(module: str) -> list[ReportDef]:
    load_providers()
    reps = module_reports(module)
    if not reps and not module_dashboards(module):
        raise HTTPException(404, f"There are no reports for module '{module}'. Open Reports from the module's own menu.")
    return reps


def _report_or_404(module: str, key: str) -> ReportDef:
    _module_or_404(module)
    rep = get_report(module, key)
    if rep is None:
        raise HTTPException(404, f"{engine.module_label(module)} has no report called '{key}' - it may have been renamed. "
                                 "Reload the Reports page and pick it again.")
    return rep


# --------------------------------------------------------------------------- catalogue

def _dataset_out(ds: ReportDataset, sees_money: bool, sees_people: bool) -> dict:
    dims = [d for d in ds.dimensions if (sees_money or not d.money) and (sees_people or not d.people)]
    dim_keys = {d.key for d in ds.dimensions if not d.time_bucket}
    time_keys = {d.key for d in ds.dimensions if d.time_bucket}
    filters = []
    for f in engine.all_filters(ds).values():
        if f.key in time_keys:
            continue
        if f.money and not sees_money:
            continue
        has_lookup = f.options is None and (f.options_fn is not None or f.key in dim_keys)
        filters.append({
            "key": f.key, "label": f.label, "type": f.type, "group": f.group, "people": f.people,
            "options": [{"value": v, "label": l} for v, l in f.options] if f.options is not None else None,
            "has_lookup": has_lookup,
        })
    return {
        "key": ds.key, "label": ds.label, "record_noun": ds.record_noun,
        "date_fields": [{"key": x.key, "label": x.label} for x in ds.date_fields],
        "default_date_field": ds.default_date_field,
        "dimensions": [{"key": d.key, "label": d.label, "people": d.people, "time_bucket": d.time_bucket} for d in dims],
        "measures": [{"key": m.key, "label": m.label, "type": m.type, "group": m.group,
                      **({"better": m.better} if m.better else {})}
                     for m in ds.measures if (sees_money or not m.money) and (sees_people or not m.people)],
        "filters": filters,
        "columns": [{"key": c.key, "label": c.label, "type": c.type, "default": c.default, "cut": c.cut,
                     "total": c.total, **({"link": c.link[1], "id_key": c.link[0]} if c.link else {})}
                    for c in ds.columns if sees_money or not c.money],
        "default_sort": list(ds.default_sort),
    }


def _visual_out(v: VisualSpec, ds: ReportDataset, pg: DashboardPage, is_kpi: bool) -> dict:
    mm = {m.key: m for m in ds.measures}
    mkeys = [v.measure] if v.measure else list(v.measures)
    first = mm.get(mkeys[0]) if mkeys else None
    return {
        "id": v.id, "kind": v.kind, "title": v.title, "definition": v.definition, "dataset": v.dataset or pg.dataset,
        "is_kpi": is_kpi, "group_by": v.group_by, "group_by2": v.group_by2, "measure": v.measure,
        "measures": list(v.measures), "columns": list(v.columns), "top_n": v.top_n, "span": v.span,
        "drill": v.drill or v.group_by, "time_window": v.time_window, "date_field": v.date_field,
        "fixed_filters": dashboards.merge_fixed({}, pg.fixed_filters, v.fixed_filters)[0],
        "better": v.better or (first.better if first else None), "value_type": first.type if first else None,
        "measure_label": first.label if first else None,
    }


@router.get("/{module}")
def catalogue(module: str, user: User = Depends(get_current_user)):
    reps = _module_or_404(module)
    viewable = [r for r in reps if can_perform(user, module, r.tab, "view")]
    dash_viewable = [d for d in module_dashboards(module) if can_perform(user, module, d.tab, "view")]
    if not viewable and not dash_viewable:
        ensure_tab_action(user, module, (reps[0].tab if reps else module_dashboards(module)[0].tab), "view")  # standard 403
    datasets: dict[str, dict] = {}
    reports_out = []
    any_money = any_people = False
    for r in viewable:
        ds = get_dataset(module, r.dataset)
        if ds is None:
            continue
        money, people = engine.access_flags(user, module, r.tab, ds)
        any_money, any_people = any_money or money, any_people or people
        if (r.money_report and not money) or (r.needs_management and not people):
            continue
        if ds.key not in datasets:
            datasets[ds.key] = _dataset_out(ds, money, people)
        d = dict(r.defaults or {})
        dim_ok = {x["key"] for x in datasets[ds.key]["dimensions"]}
        mkeys = {m["key"] for m in datasets[ds.key]["measures"]} if r.kind == "pivot" else {m.key for m in r.measures if (money or not m.money) and (people or not m.people)}
        if r.kind == "pivot":
            for g in ("group_by", "group_by2"):
                if d.get(g) and d[g] not in dim_ok:
                    d[g] = None
        else:
            blocked = set(r.people_group_bys) if not people and not r.self_only_without_management else set()
            for g in ("group_by", "group_by2"):
                if d.get(g) in blocked:
                    d[g] = None
        d["measures"] = [k for k in (d.get("measures") or []) if k in mkeys]
        groups = [{"key": x["key"], "label": x["label"]} for x in datasets[ds.key]["dimensions"]] if r.kind == "pivot" else \
                 [{"key": k, "label": l} for k, l in r.group_bys if people or k not in r.people_group_bys or r.self_only_without_management]
        reports_out.append({
            "key": r.key, "label": r.label, "description": r.description, "section": r.section, "order": r.order,
            "kind": r.kind, "dataset": r.dataset, "defaults": d, "locked_filters": dict(r.locked_filters),
            "self_only": bool(r.self_only_without_management and not people), "date_basis": r.date_basis,
            "group_bys": groups,
            "measures": [{"key": m.key, "label": m.label, "type": m.type, "group": m.group,
                          **({"better": m.better} if m.better else {})}
                         for m in r.measures if (money or not m.money) and (people or not m.people or r.self_only_without_management)],
            "definitions": [list(x) for x in r.definitions],
        })
    dashboards_out = []
    for dd in dash_viewable:
        pages = []
        for pg in dd.pages:
            pds = get_dataset(module, pg.dataset)
            if pds is None:
                continue
            money, people = engine.access_flags(user, module, dd.tab, pds)
            any_money, any_people = any_money or money, any_people or people
            if dashboards.page_block(pg, pds, money, people):
                continue
            if pds.key not in datasets:
                datasets[pds.key] = _dataset_out(pds, money, people)
            self_only = bool(pg.self_only_without_management and not people)
            vis = []
            for v in dashboards.specs_of(pg):
                vds = get_dataset(module, v.dataset or pg.dataset)
                if vds is None:
                    continue
                vm, vp = engine.access_flags(user, module, dd.tab, vds)
                if vds.key not in datasets:
                    datasets[vds.key] = _dataset_out(vds, vm, vp)
                if dashboards.visual_block(v, vds, vm, vp, self_only):
                    continue
                vis.append(_visual_out(v, vds, pg, v in pg.kpis))
            fdefs = engine.all_filters(pds)
            dim_keys = {x.key for x in pds.dimensions if not x.time_bucket}
            slicers = []
            for key in pg.slicers:
                f = fdefs.get(key)
                if f is None or (f.money and not money):
                    continue
                slicers.append({
                    "key": f.key, "label": f.label, "type": f.type, "people": f.people,
                    "options": [{"value": a, "label": b} for a, b in f.options] if f.options is not None else None,
                    "has_lookup": f.options is None and (f.options_fn is not None or f.key in dim_keys)})
            pages.append({
                "key": pg.key, "label": pg.label, "hint": pg.hint, "date_mode": pg.date_mode, "dataset": pg.dataset,
                "date_field": pg.date_field or pds.default_date_field, "self_only": self_only, "slicers": slicers,
                "fixed_filters": dict(pg.fixed_filters),
                "kpis": [x for x in vis if x["is_kpi"]], "visuals": [x for x in vis if not x["is_kpi"]]})
        if pages:
            dashboards_out.append({"key": dd.key, "label": dd.label, "order": dd.order, "pages": pages})
    if not reports_out and not dashboards_out:
        raise HTTPException(403, f"None of the {engine.module_label(module)} reports are open to your role. "
                                 "Ask an admin to add them in Organization › Role & Permissions.")
    tab = viewable[0].tab if viewable else dash_viewable[0].tab
    return {
        "module": module, "module_label": engine.module_label(module),
        "can_export": can_perform(user, module, tab, "export"),
        "sees_money": any_money, "sees_people": any_people,
        "presets": [{"key": k, "label": l} for k, l in rdates.PRESETS],
        "compare_options": [{"key": k, "label": l} for k, l in rdates.COMPARE_OPTIONS],
        "datasets": list(datasets.values()), "reports": reports_out, "dashboards": dashboards_out,
    }


# --------------------------------------------------------------------------- run / options

def _qp(request: Request) -> dict[str, str]:
    return {k: v for k, v in request.query_params.items()}


def _dash_page(module: str, page: str):
    _module_or_404(module)
    dds = module_dashboards(module)
    if not dds:
        raise HTTPException(404, f"{engine.module_label(module)} has no dashboards yet. "
                                 "Open the Reports page from the module's own menu.")
    return dashboards.find_page(module, dds, page)


@router.post("/{module}/dashboard/{page}")
def run_dashboard(module: str, page: str, body: dict = Body(default_factory=dict), db: Session = Depends(get_db),
                  user: User = Depends(get_current_user)):
    dash, pg = _dash_page(module, page)
    dc = dashboards.build(db, user, module, dash, pg, body)
    return dashboards.evaluate(dc)


@router.get("/{module}/dashboard/{page}/export")
def export_dashboard(module: str, page: str, request: Request, visual: str | None = Query(None),
                     db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    dash, pg = _dash_page(module, page)
    qp = _qp(request)
    body: dict = {k: qp[k] for k in ("date_field", "preset", "date_from", "date_to", "compare") if k in qp}
    body["filters"] = {k: v for k, v in qp.items() if k.startswith("f_")}
    if visual:
        body["visuals"] = [{"id": visual}]
    dc = dashboards.build(db, user, module, dash, pg, body, export=True)
    result = dashboards.evaluate(dc)
    visible = dashboards.visible_specs(dc)
    specs = [{"id": v.id, "kind": v.kind, "title": v.title, "definition": v.definition}
             for v in visible if visual is None or v.id == visual]
    rec = None if visual else dashboards.records(dc, engine.EXPORT_CAP)
    company = db.query(Company).first()
    now = datetime.now(timezone.utc).astimezone(rdates.IST)
    mlabel = engine.module_label(module)
    meta = {"company": company.name if company and company.name else "Premnath Rail Tools", "module_label": mlabel,
            "user_name": user.name or user.email, "generated": now.strftime("%d-%m-%Y %H:%M IST"),
            "scope_label": engine.scope_label(user, module)}
    data = xlsx.build_dashboard_workbook(result, specs, rec, meta)
    period = result["period"]
    if dc.d_from and dc.d_to:
        when = f"{period['date_field_label']} {rdates.fmt(dc.d_from)}-{rdates.fmt(dc.d_to)}"
    else:
        when = "as of today"
    if dc.compare:
        when += " vs previous " + ("year" if dc.compare["kind"] == "previous_year" else "period")
    fl = "; ".join(f"{x['label']}: {x['value']}" for x in result["filters_applied"])
    what = f"{pg.label} dashboard" + (f" > {specs[0]['title']}" if visual and specs else "")
    extra = f"; {rec['row_count']} records" if rec else ""
    summary = f"Exported {mlabel.split(' &')[0]} › {what} ({when}{'; ' + fl if fl else ''}{extra})"
    db.add(AuditLog(entity_type="report_export", entity_id=None, action="exported", summary=summary[:2000],
                    performed_by_id=user.id, module_key=module, subtab_key=dash.tab))
    db.commit()
    fname = xlsx.safe_filename(mlabel, f"{pg.label}{'_' + visual if visual else ''}",
                               dc.d_from.isoformat() if dc.d_from else None, dc.d_to.isoformat() if dc.d_to else None)
    return StreamingResponse(BytesIO(data), headers={"Content-Disposition": f'attachment; filename="{fname}"'},
                             media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")


@router.get("/{module}/{report}")
def run_report(module: str, report: str, request: Request, db: Session = Depends(get_db),
               user: User = Depends(get_current_user)):
    rep = _report_or_404(module, report)
    prep = engine.prepare(db, user, module, rep, _qp(request))
    return engine.run(prep)


@router.get("/{module}/{report}/options/{filter_key}")
def filter_options(module: str, report: str, filter_key: str, q: str = Query(""), db: Session = Depends(get_db),
                   user: User = Depends(get_current_user)):
    rep = _report_or_404(module, report)
    prep = engine.prepare(db, user, module, rep, {})
    fdefs = engine.all_filters(prep.ds)
    f = fdefs.get(filter_key)
    if f is None:
        raise HTTPException(422, f"Unknown filter '{filter_key}' for {prep.ds.label}. Allowed: {', '.join(sorted(fdefs))} - "
                                 "reload the page if it was just updated.")
    return engine.options(prep, f, q)


# --------------------------------------------------------------------------- export

def _export_part(prep: engine.Prepared, sheets: list[str]) -> dict:
    rep = prep.rep
    part: dict = {"label": rep.label, "summary": None, "detail": None, "definitions": list(rep.definitions)}
    if "summary" in sheets:
        part["summary"] = engine.run(dataclasses.replace(prep, level="summary"))
    if "detail" in sheets and rep.kind == "pivot":
        ctx = dataclasses.replace(prep.ctx, compare=None)
        p = dataclasses.replace(prep, level="detail", ctx=ctx)
        res = engine.run(p, export_all=True)
        if res["row_count"] > engine.EXPORT_CAP:
            raise HTTPException(422, f"This export would have {res['row_count']:,} records (limit {engine.EXPORT_CAP:,}). "
                                     "Narrow the period or add a filter, then export again.")
        part["detail"] = res
    return part


def _included_qp(qp: dict[str, str], ds: ReportDataset | None, rep: ReportDef) -> dict[str, str]:
    keep = {"date_from", "date_to", "preset", "compare", "sheets"}
    out = {k: v for k, v in qp.items() if k in keep}
    if ds is not None:
        ok = set(engine.all_filters(ds))
        out.update({k: v for k, v in qp.items() if k.startswith("f_") and k[2:] in ok and k[2:] not in rep.locked_filters})
    return out


@router.get("/{module}/{report}/export")
def export_report(module: str, report: str, request: Request, db: Session = Depends(get_db),
                  user: User = Depends(get_current_user)):
    rep = _report_or_404(module, report)
    qp = _qp(request)
    prep = engine.prepare(db, user, module, rep, qp, export=True)
    parts = [_export_part(prep, prep.sheets)]
    skipped: list[str] = []
    for key in prep.include:
        if key == rep.key:
            continue
        rep2 = _report_or_404(module, key)
        try:
            p2 = engine.prepare(db, user, module, rep2, _included_qp(qp, get_dataset(module, rep2.dataset), rep2), export=True)
        except HTTPException as exc:
            if exc.status_code == 403:
                skipped.append(rep2.label)
                continue
            raise
        parts.append(_export_part(p2, prep.sheets))
    company = (db.query(Company).first() or None)
    now = datetime.now(timezone.utc).astimezone(rdates.IST)
    mlabel = engine.module_label(module)
    main = parts[0]
    ref = main.get("summary") or main.get("detail") or {}
    meta = {
        "company": (company.name if company and company.name else "Premnath Rail Tools"),
        "module_label": mlabel, "user_name": user.name or user.email,
        "generated": now.strftime("%d-%m-%Y %H:%M IST"), "scope_label": engine.scope_label(user, module),
        "sheets": prep.sheets,
    }
    data = xlsx.build_workbook(parts, meta)
    period = ref.get("period") or {}
    records = (main.get("detail") or {}).get("row_count")
    if records is None:
        records = (main.get("summary") or {}).get("record_count", len((main.get("summary") or {}).get("rows", [])))
    ctx = prep.ctx
    when = (f"{period.get('date_field_label', '')} {rdates.fmt(ctx.d_from)}-{rdates.fmt(ctx.d_to)}" if ctx.d_from and ctx.d_to
            else f"{period.get('date_field_label', 'All dates')}")
    if ctx.compare:
        when += " vs previous " + ("year" if ctx.compare["kind"] == "previous_year" else "period")
    fl = "; ".join(f"{x['label']}: {x['value']}" for x in ref.get("filters_applied", []))
    summary = f"Exported {mlabel.split(' &')[0]} › {rep.label} ({when}{'; ' + fl if fl else ''}" \
              f"{'; search ' + repr(ctx.q) if ctx.q else ''}; {records} records)"
    if len(parts) > 1:
        summary += f" with {len(parts) - 1} more report(s)"
    db.add(AuditLog(entity_type="report_export", entity_id=None, action="exported", summary=summary[:2000],
                    performed_by_id=user.id, module_key=module, subtab_key=rep.tab))
    db.commit()
    fname = xlsx.safe_filename(mlabel, rep.label, ctx.d_from.isoformat() if ctx.d_from else None,
                               ctx.d_to.isoformat() if ctx.d_to else None)
    headers = {"Content-Disposition": f'attachment; filename="{fname}"'}
    if skipped:
        headers["X-Reports-Skipped"] = ", ".join(s.encode("ascii", "ignore").decode() for s in skipped)
    return StreamingResponse(BytesIO(data), headers=headers,
                             media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
