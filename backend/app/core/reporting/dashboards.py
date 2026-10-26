"""Dashboard pages: one batch evaluation per request.

Every visual of a page is a small query over a dataset (see registry.VisualSpec).
The request loads each dataset ONCE (rows are cached for the request), then
every KPI card and chart is computed in Python from those rows, with the same
permission pipeline, data scope (the loaders), filter validation, money / people
stripping and error messages as the run endpoint.

Request body (POST) / query (export):
    date_field?, preset?, date_from?, date_to?, compare?,
    filters: {"f_<key>": "a,b"}            page filters (slicers + chart selections)
    visuals: [{"id": "...", "filters": {...}}]   optional; `filters`, when present, is the
             COMPLETE filter set for that visual (it replaces the page filters), so the
             client can leave out the selection a chart itself drives.
A filter key a visual's dataset does not have is ignored for that visual."""
from __future__ import annotations

from dataclasses import dataclass, field, replace
from datetime import date, datetime, timedelta, timezone
from typing import Any, Mapping

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.core.permissions import ensure_tab_action
from app.core.reporting import dates as rdates
from app.core.reporting import engine
from app.core.reporting.registry import (
    NONE_TOKEN, DashboardDef, DashboardPage, ReportCtx, ReportDataset, VisualSpec,
    get_dataset, token,
)

MAX_POINTS = 200
MAX_TABLE = 100
MAX_AXIS = 400
DEFAULT_TOP = 50
DEFAULT_TABLE = 10


def _bug(msg: str) -> HTTPException:
    return HTTPException(500, msg)


@dataclass
class DashCtx:
    db: Session
    user: Any
    module: str
    dash: DashboardDef
    page: DashboardPage
    today: date
    snapshot: bool
    req_field: str | None
    d_from: date | None
    d_to: date | None
    preset_label: str
    compare: dict | None
    raw_filters: dict[str, str]  # key (without f_) -> "a,b"
    requested: list[str] | None  # visual ids, None = all
    overrides: dict[str, dict[str, str]] = field(default_factory=dict)
    rows: dict[str, list[dict]] = field(default_factory=dict)
    _flags: dict[str, tuple[bool, bool]] = field(default_factory=dict)
    _filters: dict[tuple, dict] = field(default_factory=dict)

    def flags(self, ds: ReportDataset) -> tuple[bool, bool]:
        if ds.key not in self._flags:
            self._flags[ds.key] = engine.access_flags(self.user, self.module, self.dash.tab, ds)
        return self._flags[ds.key]

    @property
    def self_only(self) -> bool:
        ds = self.dataset(self.page.dataset)
        return bool(self.page.self_only_without_management and not self.flags(ds)[1])

    def dataset(self, key: str) -> ReportDataset:
        ds = get_dataset(self.module, key)
        if ds is None:
            raise _bug(f"The dashboard page '{self.page.label}' uses the data set '{key}', which is not registered. "
                       "Fix the dashboard definition.")
        return ds


# --------------------------------------------------------------------------- eligibility

def visual_block(spec: VisualSpec, ds: ReportDataset, money: bool, people: bool, self_only: bool) -> str | None:
    """'money' / 'people' when the viewer may not see this visual, else None."""
    mm = {m.key: m for m in ds.measures}
    dm = {d.key: d for d in ds.dimensions}
    cm = {c.key: c for c in ds.columns}
    ms = [mm.get(k) for k in ([spec.measure] if spec.measure else []) + list(spec.measures)]
    dims = [dm.get(k) for k in (spec.group_by, spec.group_by2) if k]
    cols = [cm.get(k) for k in spec.columns]
    is_money = spec.money or any(x and x.money for x in [*ms, *dims, *cols])
    is_people = spec.people or any(x and x.people for x in [*ms, *dims])
    if is_money and not money:
        return "money"
    if is_people and not people and not self_only:
        return "people"
    return None


def page_block(page: DashboardPage, ds: ReportDataset, money: bool, people: bool) -> str | None:
    if page.money_page and not money:
        return "money"
    if page.people_page and not people:
        return "people"
    return None


def specs_of(page: DashboardPage) -> list[VisualSpec]:
    return [*page.kpis, *page.visuals]


def visible_specs(dc: DashCtx) -> list[VisualSpec]:
    out = []
    for v in specs_of(dc.page):
        ds = dc.dataset(v.dataset or dc.page.dataset)
        money, people = dc.flags(ds)
        if visual_block(v, ds, money, people, dc.self_only) is None:
            out.append(v)
    return out


# --------------------------------------------------------------------------- request parsing

def find_page(module: str, dashboards: list[DashboardDef], page_key: str) -> tuple[DashboardDef, DashboardPage]:
    for d in dashboards:
        for p in d.pages:
            if p.key == page_key:
                return d, p
    names = ", ".join(p.label for d in dashboards for p in d.pages)
    raise HTTPException(404, f"{engine.module_label(module)} has no dashboard page '{page_key}' - it may have been renamed. "
                             f"Reload the Reports page and pick it again (pages: {names}).")


def parse_filters(raw: Mapping[str, Any] | None) -> dict[str, str]:
    out: dict[str, str] = {}
    for k, v in (raw or {}).items():
        if not str(k).startswith("f_"):
            raise HTTPException(422, f"Filter '{k}' must be sent as 'f_<name>' (for example f_priority). Reload the page and try again.")
        if v is None or (isinstance(v, str) and not v.strip()) or v == []:
            continue
        out[str(k)[2:]] = ",".join(str(x) for x in v) if isinstance(v, (list, tuple)) else str(v)
    return out


def build(db: Session, user, module: str, dash: DashboardDef, page: DashboardPage, body: Mapping[str, Any], *,
          export: bool = False) -> DashCtx:
    ensure_tab_action(user, module, dash.tab, "view")
    if export:
        ensure_tab_action(user, module, dash.tab, "export")
    pds = get_dataset(module, page.dataset)
    if pds is None:
        raise _bug(f"The dashboard page '{page.label}' has no data set. Fix the dashboard definition.")
    money, people = engine.access_flags(user, module, dash.tab, pds)
    blocked = page_block(page, pds, money, people)
    if blocked == "money":
        raise engine.money_denied(pds, f"The {page.label} page's figures")
    if blocked == "people":
        raise engine.people_denied(module, dash.tab)
    today = rdates.today_ist()
    snapshot = page.date_mode == "snapshot"
    req_field = body.get("date_field") or None
    if req_field and req_field not in {x.key for x in pds.date_fields}:
        raise HTTPException(422, f"Date field '{req_field}' is not valid for {pds.label}. Use one of: "
                                 f"{', '.join(x.label for x in pds.date_fields)}.")
    compare_kind = body.get("compare") or None
    d_from = d_to = None
    label = "As of today" if snapshot else "All dates"
    cmp_info = None
    if not snapshot:
        def _d(v):
            try:
                return date.fromisoformat(v) if v else None
            except ValueError:
                raise HTTPException(422, "Dates must be written YYYY-MM-DD (for example 2026-10-01). Pick the date again.") from None
        d_from, d_to, label = rdates.resolve(body.get("preset") or None, _d(body.get("date_from")), _d(body.get("date_to")), today)
        if compare_kind:
            cf, ct = rdates.compare_range(compare_kind, d_from, d_to)
            cmp_info = {"kind": compare_kind, "from": cf, "to": ct}
    elif compare_kind:
        raise HTTPException(422, f"{page.label} shows the position as of today, so there is no period to compare with. "
                                 "Turn the comparison off for this page.")
    raw_filters = parse_filters(body.get("filters"))
    visuals_req = body.get("visuals")
    requested: list[str] | None = None
    overrides: dict[str, dict[str, str]] = {}
    ids = {v.id for v in specs_of(page)}
    if visuals_req:
        requested = []
        for item in visuals_req:
            vid = item.get("id") if isinstance(item, Mapping) else None
            if vid not in ids:
                raise HTTPException(422, f"Visual '{vid}' is not on the {page.label} page - reload the Reports page and try again.")
            requested.append(vid)
            if isinstance(item, Mapping) and item.get("filters") is not None:
                overrides[vid] = parse_filters(item["filters"])
    dc = DashCtx(db=db, user=user, module=module, dash=dash, page=page, today=today, snapshot=snapshot,
                 req_field=req_field, d_from=d_from, d_to=d_to, preset_label=label, compare=cmp_info,
                 raw_filters=raw_filters, requested=requested, overrides=overrides)
    # unknown filter keys (in no data set of this page) are an error, not silently ignored
    known: set[str] = set()
    for v in specs_of(page):
        known |= set(engine.all_filters(dc.dataset(v.dataset or page.dataset)))
    known |= set(engine.all_filters(pds))
    for src in [raw_filters, *overrides.values()]:
        for k in src:
            if k not in known:
                raise HTTPException(422, f"Unknown filter '{k}' for {page.label}. Allowed: {', '.join(sorted(known))} - "
                                         "reload the page if it was just updated.")
    # explicitly requested but hidden visuals are refused with the real reason
    for vid in requested or []:
        v = next(x for x in specs_of(page) if x.id == vid)
        ds = dc.dataset(v.dataset or page.dataset)
        m, p = dc.flags(ds)
        b = visual_block(v, ds, m, p, dc.self_only)
        if b == "money":
            raise engine.money_denied(ds, f"'{v.title}'")
        if b == "people":
            raise engine.people_denied(module, dash.tab)
    return dc


def merge_fixed(raw: Mapping[str, str], *fixed: Mapping[str, str]) -> tuple[dict[str, str], bool]:
    """Viewer filters AND fixed filters (same key = intersection). Second value is True
    when the two contradict, i.e. nothing can match."""
    out = dict(raw)
    for fx in fixed:
        for k, v in fx.items():
            if k in out:
                a = {x for x in str(out[k]).split(",") if x}
                b = {x for x in str(v).split(",") if x}
                common = sorted(a & b)
                if not common:
                    return out, True
                out[k] = ",".join(common)
            else:
                out[k] = v
    return out, False


def filters_for(dc: DashCtx, ds: ReportDataset, raw: Mapping[str, str]) -> dict[str, Any]:
    key = (ds.key, tuple(sorted(raw.items())))
    if key in dc._filters:
        return dc._filters[key]
    fdefs = engine.all_filters(ds)
    money, people = dc.flags(ds)
    sub = {k: v for k, v in raw.items() if k in fdefs}
    out = engine.validate_filters(dc.user, ds, dc.module, dc.dash.tab, sub, money, people, dc.page.label)
    if dc.self_only and dc.page.self_filter in fdefs:
        out[dc.page.self_filter] = [dc.user.id]
    dc._filters[key] = out
    return out


# --------------------------------------------------------------------------- dates

def _next_bucket(start: date, kind: str) -> date:
    if kind == "day":
        return start + timedelta(days=1)
    if kind == "week":
        return start + timedelta(days=7)
    if kind == "month":
        return date(start.year + (start.month == 12), start.month % 12 + 1, 1)
    if kind == "quarter":
        m = start.month + 3
        return date(start.year + (m > 12), (m - 1) % 12 + 1, 1)
    return date(start.year + 1, 4, 1)


def _window(spec: VisualSpec, end: date) -> tuple[date, date]:
    first = end.replace(day=1)
    if spec.time_window == "last_12_months":
        idx = first.year * 12 + first.month - 1 - 11
        return date(idx // 12, idx % 12 + 1, 1), end
    if spec.time_window == "last_6_months":
        idx = first.year * 12 + first.month - 1 - 5
        return date(idx // 12, idx % 12 + 1, 1), end
    if spec.time_window == "last_8_weeks":
        return end - timedelta(days=end.weekday()) - timedelta(days=49), end
    raise _bug(f"Visual '{spec.id}' has an unknown time window '{spec.time_window}'. Fix the dashboard definition.")


def _effective_field(dc: DashCtx, spec: VisualSpec, ds: ReportDataset) -> str:
    keys = {x.key for x in ds.date_fields}
    f = spec.date_field or dc.req_field or dc.page.date_field or ds.default_date_field
    if f not in keys:
        f = ds.default_date_field
    if dc.snapshot and not spec.date_field:
        return "none"
    if f == "none" and spec.time_window:
        f = ds.default_date_field
    return f


# --------------------------------------------------------------------------- loading (once per dataset)

def _load_all(dc: DashCtx, specs: list[VisualSpec]) -> None:
    by_ds: dict[str, list[VisualSpec]] = {}
    for v in specs:
        by_ds.setdefault(v.dataset or dc.page.dataset, []).append(v)
    by_ds.setdefault(dc.page.dataset, [])
    for dkey, vs in by_ds.items():
        ds = dc.dataset(dkey)
        money, people = dc.flags(ds)
        fields = {_effective_field(dc, v, ds) for v in vs} or {dc.req_field or dc.page.date_field or ds.default_date_field}
        f0 = next(iter(fields)) if len(fields) == 1 else (dc.req_field or dc.page.date_field or ds.default_date_field)
        simple = len(fields) == 1 and not any(v.time_window for v in vs) and f0 != "none" and dc.d_from is not None
        ctx = ReportCtx(
            db=dc.db, user=dc.user, today=dc.today, date_field=f0, d_from=dc.d_from if f0 != "none" else None,
            d_to=dc.d_to if f0 != "none" else None, filters=filters_for(dc, ds, {}), q=None, group_by=None,
            group_by2=None, measures=[], sees_money=money, sees_people=people, self_only=dc.self_only, compare=dc.compare,
        )
        window = engine.widen_window(ctx) if simple else None
        dc.rows[dkey] = ds.load(ctx, window)


# --------------------------------------------------------------------------- visual evaluation

def _ms(spec: VisualSpec, mmap: Mapping[str, Any]) -> list:
    keys = [spec.measure] if spec.measure else list(spec.measures)
    if not keys:
        raise _bug(f"Visual '{spec.id}' has no measure. Fix the dashboard definition.")
    out = []
    for k in keys:
        if k not in mmap:
            raise _bug(f"Visual '{spec.id}' uses the unknown measure '{k}'. Fix the dashboard definition.")
        out.append(mmap[k])
    return out


def _label_of(dim, g) -> str:
    return g.label


def eval_visual(dc: DashCtx, spec: VisualSpec) -> dict:
    ds = dc.dataset(spec.dataset or dc.page.dataset)
    money, people = dc.flags(ds)
    mmap = {m.key: m for m in ds.measures}
    dmap = {d.key: d for d in ds.dimensions}
    raw, contradict = merge_fixed(dc.overrides.get(spec.id, dc.raw_filters), dc.page.fixed_filters, spec.fixed_filters)
    filters = filters_for(dc, ds, raw)
    field_key = _effective_field(dc, spec, ds)
    dv = engine.date_value_fn(ds, field_key)
    rows = dc.rows[spec.dataset or dc.page.dataset]
    d_from, d_to = (dc.d_from, dc.d_to) if field_key != "none" else (None, None)
    if spec.time_window:
        d_from, d_to = _window(spec, dc.d_to or dc.today)
    cur = [] if contradict else engine.select_rows(ds, rows, field_key, d_from, d_to, filters, None)
    prev = None
    if dc.compare and field_key != "none" and not spec.time_window:
        prev = [] if contradict else engine.select_rows(ds, rows, field_key, dc.compare["from"], dc.compare["to"], filters, None)
    ms = [] if (spec.kind == "table" and not spec.group_by) else _ms(spec, mmap)

    if spec.kind == "kpi":
        m = ms[0]
        val = engine.compute_measure(m, mmap, cur)
        out = {"kind": "kpi", "label": spec.title, "type": m.type, "value": val, "row_count": len(cur),
               "definition": spec.definition, "better": spec.better or m.better,
               "drill": {"dimension": None, "filters": dict(m.drill_filter or {})}}
        if prev is not None:
            pv = engine.compute_measure(m, mmap, prev)
            out["compare"], out["delta_pct"] = pv, engine.delta_pct(val, pv)
        return out

    if spec.kind == "table" and not spec.group_by:
        cols = engine.chosen_columns(ds, list(spec.columns), money)
        sort = spec.sort if isinstance(spec.sort, tuple) else None
        pseudo = engine.Prepared(
            module=dc.module, rep=None, ds=ds, level="detail", filters_raw={}, locked={}, columns=[c.key for c in cols],
            sort=sort, ctx=ReportCtx(db=dc.db, user=dc.user, today=dc.today, date_field=field_key, d_from=d_from, d_to=d_to,
                                     filters=filters, q=None, group_by=None, group_by2=None, measures=[],
                                     sees_money=money, sees_people=people, self_only=dc.self_only))
        limit = min(spec.top_n or DEFAULT_TABLE, MAX_TABLE)
        d = engine.detail(pseudo, cur, limit, 1)
        return {"kind": "table", "columns": [{"key": c.key, "label": c.label, "type": c.type, "cut": c.cut,
                                              **({"link": c.link[1], "id_key": c.link[0]} if c.link else {})}
                                             for c in d["columns"]],
                "rows": d["rows"], "row_count": d["row_count"], "shown": len(d["rows"]),
                "drill": {"dimension": None, "tokens": []}}

    if not spec.group_by or spec.group_by not in dmap:
        raise _bug(f"Visual '{spec.id}' groups by '{spec.group_by}', which {ds.label} does not have. Fix the dashboard definition.")
    dim = dmap[spec.group_by]
    time_axis = bool(dim.time_bucket)
    groups = engine.group_rows(cur, dim, dv)
    if time_axis:
        by_key = {g.key: g for g in groups if g.key is not None}
        kind = dim.time_bucket
        if d_from and d_to:
            cur_b, end_b, n = rdates.bucket(d_from, kind), rdates.bucket(d_to, kind), 0
            ordered = []
            while cur_b <= end_b and n < MAX_AXIS:
                g = by_key.get(cur_b)
                ordered.append(g or engine._Group(cur_b, rdates.bucket_label(cur_b, kind), []))
                cur_b, n = _next_bucket(cur_b, kind), n + 1
        else:
            ordered = sorted(by_key.values(), key=lambda g: g.key)
        groups = ordered
        truncated = False
    else:
        first = ms[0]
        # Dimension.order is honoured: "value" sorts by the stored key (age buckets b1..b6),
        # "measure" by the first measure, "label" by text. An explicit value_desc/value_asc wins.
        sort = spec.sort if isinstance(spec.sort, str) else None
        if sort in (None, "label"):
            sort = {"value": "key", "measure": "value_desc"}.get(dim.order, "label" if sort == "label" else "value_desc")
        if sort == "key":
            groups = engine._sort_groups(groups, replace(dim, order="value"), first, mmap)
        elif sort == "label":
            groups.sort(key=lambda g: (g.key is None, g.label.lower()))
        else:
            groups.sort(key=lambda g: (engine.compute_measure(first, mmap, g.rows) or 0), reverse=(sort != "value_asc"))
        limit = min(spec.top_n or (DEFAULT_TABLE if spec.kind == "table" else DEFAULT_TOP), MAX_TABLE if spec.kind == "table" else MAX_POINTS)
        truncated = len(groups) > limit
        groups = groups[:limit]
    labels = [g.label for g in groups]
    drill_dim = spec.drill or spec.group_by
    ddim = dmap.get(drill_dim, dim)

    def tok(g) -> str:
        if ddim is dim:
            return token(g.key.isoformat() if isinstance(g.key, date) else g.key)
        return token(ddim.value(g.rows[0])) if g.rows else NONE_TOKEN
    tokens = [tok(g) for g in groups]
    totals = {m.key: engine.compute_measure(m, mmap, cur) for m in ms}
    out: dict = {"kind": spec.kind, "labels": labels, "tokens": tokens, "time_axis": time_axis,
                 "measure": {"key": ms[0].key, "label": ms[0].label, "type": ms[0].type},
                 "measures": [{"key": m.key, "label": m.label, "type": m.type} for m in ms],
                 "totals": totals, "row_count": len(cur), "truncated": truncated,
                 "drill": {"dimension": drill_dim, "tokens": tokens}}

    if spec.kind == "table":
        out["columns"] = out["measures"]
        out["rows"] = [{"label": g.label, "token": t, "values": {m.key: engine.compute_measure(m, mmap, g.rows) for m in ms}}
                       for g, t in zip(groups, tokens)]
        out["values"] = [r["values"][ms[0].key] for r in out["rows"]]
        return out

    if spec.group_by2 and spec.group_by2 in dmap:
        d2 = dmap[spec.group_by2]
        tot2: dict[Any, tuple[str, float]] = {}
        for g in groups:
            for g2 in engine.group_rows(g.rows, d2, dv):
                lab, acc = tot2.get(g2.key, (g2.label, 0.0))
                tot2[g2.key] = (lab, acc + (engine.compute_measure(ms[0], mmap, g2.rows) or 0))
        top = sorted(tot2.items(), key=lambda kv: -kv[1][1])[:8]
        datasets = []
        for k2, (lab2, _) in top:
            data = []
            for g in groups:
                sub = [r for r in g.rows if (d2.value(r) if d2.value else None) == k2] if not d2.time_bucket else \
                      [r for r in g.rows if (rdates.bucket(dv(r), d2.time_bucket) if dv(r) else None) == k2]
                data.append(engine.compute_measure(ms[0], mmap, sub) or 0)
            datasets.append({"label": lab2, "data": data, "token": token(k2.isoformat() if isinstance(k2, date) else k2)})
        out["datasets"] = datasets
        out["series_dimension"] = spec.group_by2
    else:
        datasets = [{"label": m.label, "data": [engine.compute_measure(m, mmap, g.rows) for g in groups], "measure": m.key}
                    for m in ms]
        out["datasets"] = datasets
    out["values"] = out["datasets"][0]["data"] if out["datasets"] else []
    if prev is not None and not time_axis and not spec.group_by2:
        pg = {g.key: g.rows for g in engine.group_rows(prev, dim, dv)}
        out["compare"] = [engine.compute_measure(ms[0], mmap, pg.get(g.key, [])) for g in groups]
        pt = engine.compute_measure(ms[0], mmap, prev)
        out["totals_compare"] = pt
        out["delta_pct"] = engine.delta_pct(totals[ms[0].key], pt)
    return out


# --------------------------------------------------------------------------- page

def evaluate(dc: DashCtx) -> dict:
    vis = visible_specs(dc)
    if dc.requested is not None:
        want = set(dc.requested)
        vis = [v for v in vis if v.id in want]
    _load_all(dc, vis)
    kpi_ids = {v.id for v in dc.page.kpis}
    results: dict[str, dict] = {}
    kpis: dict[str, dict] = {}
    for v in vis:
        (kpis if v.id in kpi_ids else results)[v.id] = eval_visual(dc, v)
    pds = dc.dataset(dc.page.dataset)
    money, people = dc.flags(pds)
    pfield = dc.req_field or dc.page.date_field or pds.default_date_field
    pctx = ReportCtx(db=dc.db, user=dc.user, today=dc.today, date_field="none" if dc.snapshot else pfield, d_from=dc.d_from,
                     d_to=dc.d_to, filters=filters_for(dc, pds, merge_fixed(dc.raw_filters, dc.page.fixed_filters)[0]), q=None, group_by=None, group_by2=None,
                     measures=[], sees_money=money, sees_people=people, self_only=dc.self_only, compare=dc.compare)
    pseudo = engine.Prepared(module=dc.module, rep=None, ds=pds, ctx=pctx, level="summary", filters_raw={},
                              locked=dict(dc.page.fixed_filters))
    dlabel = next((x.label for x in pds.date_fields if x.key == pctx.date_field), "All dates")
    period = {"date_field": pctx.date_field, "date_field_label": dlabel, "mode": dc.page.date_mode,
              "from": dc.d_from.isoformat() if dc.d_from else None, "to": dc.d_to.isoformat() if dc.d_to else None,
              "label": dc.preset_label, "compare": None}
    if dc.compare:
        period["compare"] = {"kind": dc.compare["kind"], "from": dc.compare["from"].isoformat(), "to": dc.compare["to"].isoformat()}
    notes = []
    if dc.self_only:
        notes.append("Showing only your own figures - team figures need "
                     f"{engine.module_label(dc.module)} › Reports › People & performance.")
    return {
        "page": dc.page.key, "label": dc.page.label, "hint": dc.page.hint, "dataset": dc.page.dataset, "self_only": dc.self_only,
        "period": period, "filters_applied": engine.filters_applied(pseudo, dc.rows.get(dc.page.dataset, [])),
        "scope_label": engine.scope_label(dc.user, dc.module), "results": results, "kpis": kpis, "notes": notes,
        "generated_at": datetime.now(timezone.utc).astimezone(rdates.IST).isoformat(timespec="seconds"),
    }


def records(dc: DashCtx, cap: int) -> dict | None:
    """All rows of the page dataset under the page filters and period (the
    Records sheet), default columns, capped like every export."""
    ds = dc.dataset(dc.page.dataset)
    money, people = dc.flags(ds)
    if dc.page.dataset not in dc.rows:
        _load_all(dc, [])
    field_key = "none" if dc.snapshot else (dc.req_field or dc.page.date_field or ds.default_date_field)
    d_from, d_to = (dc.d_from, dc.d_to) if field_key != "none" else (None, None)
    raw, contradict = merge_fixed(dc.raw_filters, dc.page.fixed_filters)
    filters = filters_for(dc, ds, raw)
    cur = [] if contradict else engine.select_rows(ds, dc.rows[dc.page.dataset], field_key, d_from, d_to, filters, None)
    if len(cur) > cap:
        raise HTTPException(422, f"This export would have {len(cur):,} records (limit {cap:,}). "
                                 "Narrow the period or add a filter, then export again.")
    pseudo = engine.Prepared(
        module=dc.module, rep=None, ds=ds, level="detail", filters_raw={}, locked={},
        ctx=ReportCtx(db=dc.db, user=dc.user, today=dc.today, date_field=field_key, d_from=d_from, d_to=d_to, filters=filters,
                      q=None, group_by=None, group_by2=None, measures=[], sees_money=money, sees_people=people,
                      self_only=dc.self_only))
    d = engine.detail(pseudo, cur, None, 1)
    return {"columns": [{"key": c.key, "label": c.label, "type": c.type, "cut": c.cut,
                         **({"link": c.link[1], "id_key": c.link[0]} if c.link else {})} for c in d["columns"]],
            "rows": d["rows"], "row_count": d["row_count"], "totals": d["totals"]}
