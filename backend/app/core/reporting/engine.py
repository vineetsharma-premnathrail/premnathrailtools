"""The generic report engine: validation, filtering, grouping, measures,
comparison, drill-down objects, detail paging and the removal of figures the
viewer may not see. Pure Python over rows a dataset loader returns (already
scoped), so SQLite tests and Postgres behave the same."""
from __future__ import annotations

import statistics
from dataclasses import dataclass, field
from datetime import date, datetime, timezone
from typing import Any, Mapping

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.core.data_scope import SCOPE_LABELS, user_scope
from app.core.permission_registry import MODULES, can_feature
from app.core.permissions import _feature_label, _module_label, _tab_label, ensure_tab_action
from app.core.reporting import dates as rdates
from app.core.reporting.registry import (
    NONE_TOKEN, DetailColumn, Dimension, FilterDef, Measure, ReportCtx, ReportDataset, ReportDef,
    ReportResult, get_dataset, token,
)

MAX_GROUPS = 1000
MAX_CHILDREN = 200
MAX_MEASURES = 8
JSON_PAGE_MAX = 500
EXPORT_CAP = 50_000
RESERVED = {
    "level", "date_field", "preset", "date_from", "date_to", "compare", "q", "group_by", "group_by2",
    "measures", "columns", "sort", "dir", "page", "page_size", "include", "sheets", "all_columns",
}


def _422(msg: str) -> HTTPException:
    return HTTPException(status_code=422, detail=msg)


def _fmt_list(items) -> str:
    return ", ".join(items)


# --------------------------------------------------------------------------- permissions

def people_denied(module: str, tab: str) -> HTTPException:
    return HTTPException(403, (
        f"Per-person figures (team performance, grouping or filtering by another person) need "
        f"{_module_label(module)} › {_tab_label(module, tab)} › {_feature_label(module, tab, 'management')}. "
        "You can still see your own figures. Ask an admin to tick it on your role in Organization › Role & Permissions."))


def money_denied(ds: ReportDataset, what: str) -> HTTPException:
    m, t, f = ds.money_feature or ("", "", "")
    return HTTPException(403, (
        f"{what} need {_module_label(m)} › {_tab_label(m, t)} › {_feature_label(m, t, f)}. "
        "Remove the money measures/columns or ask an admin to add it to your role in Organization › Role & Permissions."))


@dataclass
class Prepared:
    module: str
    rep: ReportDef
    ds: ReportDataset
    ctx: ReportCtx
    level: str
    filters_raw: dict[str, str]  # as requested (not locked), for the filters-applied strip
    locked: dict[str, str]
    page: int = 1
    page_size: int = 100
    columns: list[str] = field(default_factory=list)
    sort: tuple[str, str] | None = None
    preset_label: str = ""
    compare_kind: str | None = None
    include: list[str] = field(default_factory=list)
    sheets: list[str] = field(default_factory=list)
    all_columns: bool = False


def access_flags(user, module: str, tab: str, ds: ReportDataset | None) -> tuple[bool, bool]:
    sees_money = bool(ds and ds.money_feature and can_feature(user, *ds.money_feature, "view"))
    sees_people = can_feature(user, module, tab, "management", "view")
    return sees_money, sees_people


def module_label(module: str) -> str:
    return (MODULES.get(module) or {}).get("label") or _module_label(module)


# --------------------------------------------------------------------------- filters

def all_filters(ds: ReportDataset) -> dict[str, FilterDef]:
    """Declared filters plus one generic multi-select per plain dimension."""
    out = {f.key: f for f in ds.filters}
    for d in ds.dimensions:
        if d.key not in out:  # time-bucket dims filter by bucket start date (chart clicks on a time axis)
            out[d.key] = FilterDef(key=d.key, label=d.label, type="multi_select", people=d.people, money=d.money)
    return out


def _parse_one(f: FilterDef, raw: str) -> Any:
    raw = raw.strip()
    if f.type in ("multi_select", "select"):
        vals = [x.strip() for x in raw.split(",") if x.strip()]
        if f.options is not None:
            valid = {v for v, _ in f.options} | {NONE_TOKEN}
            for x in vals:
                if x not in valid:
                    raise _422(f"{f.label} '{x}' is not valid. Use one of: {_fmt_list(l for _, l in f.options)}.")
        return vals
    if f.type in ("user", "entity"):
        out: list = []
        for x in (p.strip() for p in raw.split(",") if p.strip()):
            if x == NONE_TOKEN:
                out.append(x)
                continue
            try:
                out.append(int(x))
            except ValueError:
                raise _422(f"{f.label} filter must be a {f.label.lower()} picked from the list (got '{x}'). "
                           "Clear the filter and pick it again.") from None
        return out
    if f.type == "int":
        try:
            return int(raw)
        except ValueError:
            raise _422(f"{f.label} must be a whole number (got '{raw}'). Type digits only or clear the filter.") from None
    if f.type == "bool":
        if raw.lower() in ("1", "true", "yes", "on"):
            return True
        if raw.lower() in ("0", "false", "no", "off"):
            return False
        raise _422(f"{f.label} must be Yes or No (got '{raw}'). Clear the filter and pick it again.")
    return raw


def _matches(row: dict, f: FilterDef, ds: ReportDataset, val: Any, dv=None) -> bool:
    if f.match is not None:
        return bool(f.match(row, val))
    dim = next(d for d in ds.dimensions if d.key == f.key)
    if dim.time_bucket:
        d = dv(row) if dv else None
        rv = token(rdates.bucket(d, dim.time_bucket).isoformat() if d else None)
    else:
        rv = token(dim.value(row))
    if isinstance(val, list):
        return rv in {token(x) for x in val}
    return rv == token(val)


def validate_filters(prep_user, ds: ReportDataset, module: str, tab: str, raw: Mapping[str, str],
                     sees_money: bool, sees_people: bool, report_label: str) -> dict[str, Any]:
    fdefs = all_filters(ds)
    out: dict[str, Any] = {}
    for key, rawv in raw.items():
        f = fdefs.get(key)
        if f is None:
            raise _422(f"Unknown filter '{key}' for {ds.label}. Allowed: {_fmt_list(sorted(fdefs))} - "
                       "reload the page if it was just updated.")
        if f.money and not sees_money:
            raise money_denied(ds, f"The {f.label} filter and other billing figures")
        val = _parse_one(f, rawv)
        tdim = next((d for d in ds.dimensions if d.key == key and d.time_bucket), None)
        if tdim is not None:
            for x in val:
                try:
                    date.fromisoformat(x) if x != NONE_TOKEN else None
                except ValueError:
                    raise _422(f"{f.label} filter must be a {f.label.lower()} picked from the chart (got '{x}'). "
                               "Clear the selection and pick it again.") from None
        if f.people and not sees_people:
            vals = val if isinstance(val, list) else [val]
            if any(str(v) != str(prep_user.id) for v in vals):
                raise people_denied(module, tab)
        out[key] = val
    for key, f in fdefs.items():  # paired ranges: x_min / x_max
        if key.endswith("_min") and key[:-4] + "_max" in out and key in out:
            hi = fdefs[key[:-4] + "_max"]
            if out[key] > out[hi.key]:
                raise _422(f"{f.label} {out[key]} is more than {hi.label} {out[hi.key]} - swap them.")
    return out


# --------------------------------------------------------------------------- row selection

def date_value_fn(ds: ReportDataset, date_field: str):
    df = next(d for d in ds.date_fields if d.key == date_field)
    return df.value


def select_rows(ds: ReportDataset, rows: list[dict], date_field: str, d_from: date | None, d_to: date | None,
                filters: Mapping[str, Any], q: str | None) -> list[dict]:
    fdefs = all_filters(ds)
    dv = date_value_fn(ds, date_field)
    search_cols = [c.key for c in ds.columns if c.searchable]
    needle = (q or "").strip().lower()
    out = []
    for r in rows:
        if dv is not None and d_from is not None and d_to is not None:
            v = dv(r)
            if v is None or v < d_from or v > d_to:
                continue
        if any(not _matches(r, fdefs[k], ds, v, dv) for k, v in filters.items()):
            continue
        if needle and not any(needle in str(r.get(k) if r.get(k) is not None else "").lower() for k in search_cols):
            continue
        out.append(r)
    return out


# --------------------------------------------------------------------------- measures

def _num(v: float) -> float | int:
    if isinstance(v, int):
        return v
    return round(v, 4)


def compute_measure(m: Measure, mmap: Mapping[str, Measure], rows: list[dict], _depth: int = 0) -> Any:
    if m.agg == "ratio":
        if not m.ratio or _depth > 3:
            return None
        num = compute_measure(mmap[m.ratio[0]], mmap, rows, _depth + 1)
        den = compute_measure(mmap[m.ratio[1]], mmap, rows, _depth + 1)
        return _num(num / den) if den else None
    sub = [r for r in rows if m.where is None or m.where(r)]
    if m.agg == "count":
        return len(sub) if m.field is None else sum(1 for r in sub if r.get(m.field) is not None)
    vals = [r.get(m.field) for r in sub if m.field and r.get(m.field) is not None]
    if m.agg == "count_distinct":
        return len({v for v in vals})
    if m.agg == "sum":
        return _num(sum(vals)) if vals else 0
    if not vals:
        return None
    if m.agg == "avg":
        return _num(sum(vals) / len(vals))
    if m.agg == "median":
        return _num(statistics.median(vals))
    if m.agg == "max":
        return _num(max(vals))
    if m.agg == "p90":
        return _num(statistics.quantiles(vals, n=10)[-1]) if len(vals) >= 2 else _num(vals[0])
    return None


def compute_all(keys: list[str], mmap: Mapping[str, Measure], rows: list[dict]) -> dict[str, Any]:
    return {k: compute_measure(mmap[k], mmap, rows) for k in keys}


def delta_pct(cur: Any, prev: Any) -> float | None:
    if cur is None or prev in (None, 0):
        return None
    return round((cur - prev) / abs(prev) * 100, 1)


# --------------------------------------------------------------------------- grouping

@dataclass
class _Group:
    key: Any
    label: str
    rows: list[dict]
    bucket: tuple[date, str] | None = None


def group_rows(rows: list[dict], dim: Dimension, dv) -> list[_Group]:
    groups: dict[Any, _Group] = {}
    for r in rows:
        if dim.time_bucket:
            d = dv(r) if dv else None
            if d is None:
                k, label, b = None, "No date", None
            else:
                start = rdates.bucket(d, dim.time_bucket)
                k, label, b = start, rdates.bucket_label(start, dim.time_bucket), (start, dim.time_bucket)
        else:
            k = dim.value(r) if dim.value else None
            if dim.label_of:
                label = dim.label_of(r)
            else:
                label = dim.blank_label if k is None else str(k)
            b = None
        g = groups.get(k)
        if g is None:
            groups[k] = _Group(k, label or dim.blank_label, [r], b)
        else:
            g.rows.append(r)
    return list(groups.values())


def _sort_groups(gs: list[_Group], dim: Dimension, first_measure: Measure, mmap) -> list[_Group]:
    if dim.time_bucket or dim.order == "value":
        def vk(g: _Group):
            k = g.key
            num = isinstance(k, (int, float, date))
            return (k is None, "" if num else str(k), k if num else 0)
        try:
            return sorted(gs, key=vk)
        except TypeError:
            return sorted(gs, key=lambda g: str(g.key))
    if dim.order == "measure":
        return sorted(gs, key=lambda g: -(compute_measure(first_measure, mmap, g.rows) or 0))
    return sorted(gs, key=lambda g: (g.key is None, g.label.lower()))


def _json_key(k: Any) -> Any:
    if k is None or isinstance(k, (str, int, float, bool)):
        return k
    return k.isoformat() if isinstance(k, date) else str(k)


def _group_drill(g: _Group, dim: Dimension, base: dict, d_from: date | None, d_to: date | None) -> dict:
    d = dict(base)
    if dim.time_bucket:
        if g.bucket is not None:
            s, kind = g.bucket
            e = rdates.bucket_end(s, kind)
            d["date_from"] = max(s, d_from).isoformat() if d_from else s.isoformat()
            d["date_to"] = min(e, d_to).isoformat() if d_to else e.isoformat()
    else:
        d[f"f_{dim.key}"] = token(g.key)
    return d


# --------------------------------------------------------------------------- summary

def _base_drill(ctx: ReportCtx) -> dict:
    d: dict = {"date_field": ctx.date_field}
    if ctx.d_from and ctx.d_to:
        d["date_from"], d["date_to"] = ctx.d_from.isoformat(), ctx.d_to.isoformat()
    return d


def _cell_drills(keys: list[str], mmap: Mapping[str, Measure], row_drill: dict) -> dict:
    """measure key -> the COMPLETE drill for that cell (row drill AND the
    measure's own filter; a filter on the same field is intersected). None
    when the two contradict (nothing is behind the number). Measures without
    a drill_filter are absent: use the row drill."""
    out: dict[str, dict | None] = {}
    for k in keys:
        extra = mmap[k].drill_filter
        if not extra:
            continue
        merged = dict(row_drill)
        for fk, fv in extra.items():
            if fk in merged and fk.startswith("f_"):
                a = {x for x in str(merged[fk]).split(",") if x}
                b = {x for x in str(fv).split(",") if x}
                common = sorted(a & b)
                if not common:
                    merged = None
                    break
                merged[fk] = ",".join(common)
            else:
                merged[fk] = fv
        out[k] = merged
    return out


def summarise(prep: Prepared, rows_cur: list[dict], rows_prev: list[dict] | None, today_note: list[str]) -> dict:
    ctx, ds = prep.ctx, prep.ds
    mmap = {m.key: m for m in ds.measures}
    dmap = {d.key: d for d in ds.dimensions}
    keys = ctx.measures
    dv = date_value_fn(ds, ctx.date_field)
    base = _base_drill(ctx)
    first = mmap[keys[0]]
    has_cmp = rows_prev is not None

    def make_row(g_cur: _Group, dim: Dimension, prev_rows: list[dict], parent_drill: dict, children: list[dict] | None):
        vals = compute_all(keys, mmap, g_cur.rows)
        row = {
            "key": {dim.key: _json_key(g_cur.key)},
            "label": {dim.key: g_cur.label}, "values": vals,
            "drill": _group_drill(g_cur, dim, parent_drill, ctx.d_from, ctx.d_to),
        }
        row["measure_drill"] = _cell_drills(keys, mmap, row["drill"])
        if has_cmp:
            pv = compute_all(keys, mmap, prev_rows)
            row["compare"] = pv
            row["delta_pct"] = {k: delta_pct(vals[k], pv[k]) for k in keys}
        if children is not None:
            row["children"] = children
        return row

    out_rows: list[dict] = []
    dim1 = dmap.get(ctx.group_by) if ctx.group_by else None
    dim2 = dmap.get(ctx.group_by2) if ctx.group_by2 else None
    notes = list(today_note)
    if dim1:
        prev_by_key: dict[Any, list[dict]] = {}
        if has_cmp:
            for g in group_rows(rows_prev, dim1, dv):
                prev_by_key[g.key] = g.rows
        groups = _sort_groups(group_rows(rows_cur, dim1, dv), dim1, first, mmap)
        total_groups = len(groups)
        shown, rest = groups[:MAX_GROUPS], groups[MAX_GROUPS:]
        for g in shown:
            children = None
            if dim2:
                prev2: dict[Any, list[dict]] = {}
                if has_cmp:
                    for g2 in group_rows(prev_by_key.get(g.key, []), dim2, dv):
                        prev2[g2.key] = g2.rows
                subs = _sort_groups(group_rows(g.rows, dim2, dv), dim2, first, mmap)
                gd = _group_drill(g, dim1, base, ctx.d_from, ctx.d_to)
                children = [make_row(s, dim2, prev2.get(s.key, []), gd, None) for s in subs[:MAX_CHILDREN]]
                if len(subs) > MAX_CHILDREN:
                    others = [r for s in subs[MAX_CHILDREN:] for r in s.rows]
                    children.append(_others_row(keys, mmap, others, dim2))
            out_rows.append(make_row(g, dim1, prev_by_key.get(g.key, []), base, children))
        if rest:
            out_rows.append(_others_row(keys, mmap, [r for g in rest for r in g.rows], dim1))
            notes.append(f"Showing the largest {MAX_GROUPS:,} groups of {total_groups:,} - the rest are summed in 'Others'. "
                         "Add a filter to see them.")
    totals_vals = compute_all(keys, mmap, rows_cur)
    totals = {"values": totals_vals, "compare": {}, "delta_pct": {}}
    kpis = []
    prev_vals = compute_all(keys, mmap, rows_prev) if has_cmp else {}
    if has_cmp:
        totals["compare"] = prev_vals
        totals["delta_pct"] = {k: delta_pct(totals_vals[k], prev_vals[k]) for k in keys}
    for k in keys:
        m = mmap[k]
        kd = dict(base)
        kd.update(m.drill_filter or {})
        kp = {"key": k, "label": m.label, "type": m.type, "value": totals_vals[k], "drill": kd}
        if m.better:
            kp["better"] = m.better
        if has_cmp:
            kp["compare"], kp["delta_pct"] = prev_vals[k], delta_pct(totals_vals[k], prev_vals[k])
        kpis.append(kp)
    series = _auto_series(ctx, out_rows, dim1, dim2, first, mmap, dmap) if dim1 else []
    return {"rows": out_rows, "totals": totals, "kpis": kpis, "series": series,
            "group_count": len([r for r in out_rows if r["label"].get(dim1.key if dim1 else "", "") != "Others"]) if dim1 else 0,
            "notes": notes, "measures": [{"key": k, "label": mmap[k].label, "type": mmap[k].type,
                                          **({"better": mmap[k].better} if mmap[k].better else {})} for k in keys]}


def _others_row(keys, mmap, rows, dim: Dimension) -> dict:
    return {"key": {dim.key: None}, "label": {dim.key: "Others"}, "values": compute_all(keys, mmap, rows),
            "drill": {}, "measure_drill": {k: None for k in keys if mmap[k].drill_filter}}


def _auto_series(ctx, rows, dim1, dim2, first: Measure, mmap, dmap) -> list[dict]:
    mkey = first.key
    lab = lambda r: r["label"][dim1.key]  # noqa: E731
    val = lambda r: r["values"][mkey] or 0  # noqa: E731
    title = f"{first.label} by {dim1.label}"
    plain = [r for r in rows if lab(r) != "Others"]
    if not plain:
        return []
    if dim1.time_bucket:
        kind = "line"
        labels, data = [lab(r) for r in plain], [val(r) for r in plain]
        return [{"key": "main", "label": title, "kind": kind, "labels": labels, "datasets": [{"label": first.label, "data": data}]}]
    if dim2:
        top = sorted(plain, key=lambda r: -val(r))[:8]
        totals: dict[str, float] = {}
        for r in top:
            for c in r.get("children", []):
                totals[c["label"][dim2.key]] = totals.get(c["label"][dim2.key], 0) + (c["values"][mkey] or 0)
        cats = [k for k, _ in sorted(totals.items(), key=lambda kv: -kv[1])[:6]]
        datasets = []
        for cat in cats:
            data = []
            for r in top:
                cv = next((c["values"][mkey] for c in r.get("children", []) if c["label"][dim2.key] == cat), 0)
                data.append(cv or 0)
            datasets.append({"label": cat, "data": data})
        return [{"key": "main", "label": f"{title}, then {dim2.label}", "kind": "stacked_bar",
                 "labels": [lab(r) for r in top], "datasets": datasets}]
    if len(plain) <= 8:
        kind = "doughnut" if mkey == "count" else "bar"
        sel = plain
    else:
        kind, sel = "hbar", sorted(plain, key=lambda r: -val(r))[:15]
    return [{"key": "main", "label": title, "kind": kind, "labels": [lab(r) for r in sel],
             "datasets": [{"label": first.label, "data": [val(r) for r in sel]}]}]


# --------------------------------------------------------------------------- detail

def chosen_columns(ds: ReportDataset, requested: list[str] | None, sees_money: bool, all_cols: bool = False) -> list[DetailColumn]:
    cmap = {c.key: c for c in ds.columns}
    if requested:
        out = []
        for k in requested:
            c = cmap.get(k)
            if c is None:
                raise _422(f"Column '{k}' is not part of {ds.label} - reset the columns (Columns › Reset) and try again.")
            if c.money and not sees_money:
                raise money_denied(ds, "Money columns")
            out.append(c)
        return out
    return [c for c in ds.columns if (all_cols or c.default) and (sees_money or not c.money)] or \
           [c for c in ds.columns if sees_money or not c.money][:1]


def detail(prep: Prepared, rows: list[dict], page_size: int | None, page: int) -> dict:
    ds = prep.ds
    cols = chosen_columns(ds, prep.columns, prep.ctx.sees_money, prep.all_columns)
    cmap = {c.key: c for c in ds.columns}
    sort_key, sort_dir = prep.sort or ds.default_sort
    if sort_key not in cmap:
        raise _422(f"Column '{sort_key}' is not part of {ds.label} - reset the sort and try again.")
    if cmap[sort_key].money and not prep.ctx.sees_money:
        raise money_denied(ds, "Money columns")

    def ordered(rs: list[dict], key: str, direction: str) -> list[dict]:
        have = [r for r in rs if r.get(key) is not None]
        none = [r for r in rs if r.get(key) is None]

        def kf(r):
            v = r.get(key)
            return v.lower() if isinstance(v, str) else v
        try:
            have.sort(key=kf, reverse=(direction == "desc"))
        except TypeError:
            have.sort(key=lambda r: str(r.get(key)), reverse=(direction == "desc"))
        return have + none

    rs = ordered(rows, ds.default_sort[0], ds.default_sort[1])  # tie-break, then requested (stable)
    if sort_key != ds.default_sort[0] or sort_dir != ds.default_sort[1]:
        rs = ordered(rs, sort_key, sort_dir)
    total = len(rs)
    totals = {c.key: _num(sum(r.get(c.key) or 0 for r in rs)) for c in cols if c.total == "sum"}
    if page_size is not None:
        rs = rs[(page - 1) * page_size: page * page_size]
    id_keys = list(ds.id_keys) + [c.link[0] for c in cols if c.link and c.link[0] not in ds.id_keys]
    out = [{**{k: r.get(k) for k in id_keys}, **{c.key: r.get(c.key) for c in cols}} for r in rs]
    return {"columns": cols, "rows": out, "row_count": total, "totals": totals, "sort": [sort_key, sort_dir]}


# --------------------------------------------------------------------------- loading

def widen_window(ctx: ReportCtx) -> tuple[date, date] | None:
    if ctx.d_from is None or ctx.d_to is None:
        return None
    lo, hi = ctx.d_from, ctx.d_to
    if ctx.compare:
        lo, hi = min(lo, ctx.compare["from"]), max(hi, ctx.compare["to"])
    return lo, hi


def load_selected(prep: Prepared) -> tuple[list[dict], list[dict] | None, list[dict]]:
    """(current rows, comparison rows or None, all loaded rows)."""
    ctx, ds = prep.ctx, prep.ds
    loaded = ds.load(ctx, widen_window(ctx))
    cur = select_rows(ds, loaded, ctx.date_field, ctx.d_from, ctx.d_to, ctx.filters, ctx.q)
    prev = None
    if ctx.compare:
        prev = select_rows(ds, loaded, ctx.date_field, ctx.compare["from"], ctx.compare["to"], ctx.filters, ctx.q)
    return cur, prev, loaded


# --------------------------------------------------------------------------- composite

def strip_composite(rep: ReportDef, res: ReportResult, keep: list[str], sees_money: bool, sees_people: bool) -> dict:
    allowed = [m for m in res.measures if m.key in keep and (sees_money or not m.money) and (sees_people or not m.people)]
    ak = {m.key for m in allowed}

    def clean(row: dict) -> dict:
        r = dict(row)
        for fld in ("values", "compare", "delta_pct", "measure_drill"):
            if fld in r and isinstance(r[fld], dict):
                r[fld] = {k: v for k, v in r[fld].items() if k in ak}
        if r.get("children"):
            r["children"] = [clean(c) for c in r["children"]]
        return r

    kpis = [k for k in res.kpis if (sees_money or not k.money) and (sees_people or not k.people)]
    cmap = {c.key: c for c in rep.charts}
    series = []
    for key, s in res.series.items():
        c = cmap.get(key)
        if c is None or (c.money and not sees_money) or (c.people and not sees_people):
            continue
        series.append({"key": key, "label": c.label, "kind": c.kind, "labels": s.get("labels", []), "datasets": s.get("datasets", [])})
    totals = {k: v for k, v in res.totals.items() if k in ak}
    return {
        "group_by": res.group_by, "group_label": res.group_label,
        "measures": [{"key": m.key, "label": m.label, "type": m.type, **({"better": m.better} if m.better else {})} for m in allowed],
        "rows": [clean(r) for r in res.rows],
        "totals": {"values": totals, "compare": {}, "delta_pct": {}},
        "kpis": [{"key": k.key, "label": k.label, "type": k.type, "value": k.value, "compare": k.compare,
                  "delta_pct": k.delta_pct, "drill": k.drill, **({"better": k.better} if k.better else {})} for k in kpis],
        "series": series, "notes": list(res.notes),
    }


# --------------------------------------------------------------------------- orchestration

def _split(v: str | None) -> list[str]:
    return [x.strip() for x in (v or "").split(",") if x.strip()]


def prepare(db: Session, user, module: str, rep: ReportDef, qp: Mapping[str, str], *, export: bool = False) -> Prepared:
    """Validate the request and build the context. Deny by default; the
    order is: tab View (+Export), money / management switches, period,
    filters, grouping, measures, columns."""
    ds = get_dataset(module, rep.dataset)
    if ds is None:
        raise HTTPException(404, f"{module_label(module)} has no data set '{rep.dataset}' for {rep.label}. Reload the Reports page.")
    ensure_tab_action(user, module, rep.tab, "view")
    if export:
        ensure_tab_action(user, module, rep.tab, "export")
    sees_money, sees_people = access_flags(user, module, rep.tab, ds)
    if rep.money_report and not sees_money:
        raise money_denied(ds, "Billing and cost figures")
    if rep.needs_management and not sees_people:
        raise people_denied(module, rep.tab)
    d = rep.defaults or {}
    is_composite = rep.kind == "composite"

    # level
    level = qp.get("level") or d.get("level") or "summary"
    if level not in ("summary", "detail"):
        raise _422(f"Level '{level}' is not valid. Use summary or detail.")
    if level == "detail" and is_composite:
        raise _422(f"{rep.label} is a table of figures. Click a figure to open the records behind it.")

    # date field and period
    date_field = qp.get("date_field") or d.get("date_field") or ds.default_date_field
    dkeys = {x.key: x.label for x in ds.date_fields}
    if date_field not in dkeys:
        raise _422(f"Date field '{date_field}' is not valid for {ds.label}. Use one of: {_fmt_list(dkeys.values())}.")
    compare_kind = qp.get("compare") or None
    if compare_kind and level == "detail":
        raise _422("Comparison works on the summary only - switch to Summary, or turn comparison off for the record list.")
    today = rdates.today_ist()
    d_from = d_to = None
    preset_label = "All dates"
    cmp_info = None
    if dkeys and next(x for x in ds.date_fields if x.key == date_field).value is not None:
        raw_from, raw_to = qp.get("date_from"), qp.get("date_to")
        try:
            pf = date.fromisoformat(raw_from) if raw_from else None
            pt = date.fromisoformat(raw_to) if raw_to else None
        except ValueError:
            raise _422("Dates must be written YYYY-MM-DD (for example 2026-10-01). Pick the date again.") from None
        preset = qp.get("preset") or (None if (pf or pt) else d.get("preset"))
        d_from, d_to, preset_label = rdates.resolve(preset, pf, pt, today)
        if compare_kind:
            cf, ct = rdates.compare_range(compare_kind, d_from, d_to)
            cmp_info = {"kind": compare_kind, "from": cf, "to": ct}
    elif compare_kind:
        raise _422("'All dates' has no period to compare with - pick a date field (for example Reported, Work completed or Closed) "
                   "to compare periods.")

    # filters
    locked = dict(rep.locked_filters)
    raw_f = {k[2:]: v for k, v in qp.items() if k.startswith("f_") and k[2:] not in locked}
    # unknown f_ keys on included reports are dropped by the caller
    filters = validate_filters(user, ds, module, rep.tab, {**raw_f, **locked}, sees_money, sees_people, rep.label)
    self_only = bool(rep.self_only_without_management and not sees_people)
    fdefs = all_filters(ds)
    if self_only and rep.self_filter in fdefs:
        filters[rep.self_filter] = [user.id]

    # grouping
    gb_pairs = dict(rep.group_bys) if is_composite else {x.key: x.label for x in ds.dimensions}
    people_gb = set(rep.people_group_bys) if is_composite else {x.key for x in ds.dimensions if x.people}
    money_gb = set() if is_composite else {x.key for x in ds.dimensions if x.money}

    def pick_group(name: str, dflt_key: str) -> str | None:
        if name in qp:
            v = qp.get(name) or None
            explicit = True
        else:
            v, explicit = d.get(dflt_key), False
        if not v:
            return None
        if v not in gb_pairs:
            if explicit:
                raise _422(f"{rep.label} can't be grouped by '{v}'. Choose one of: {_fmt_list(gb_pairs.values())}.")
            return None
        if v in money_gb and not sees_money:
            if explicit:
                raise money_denied(ds, "Money groupings")
            return None
        if v in people_gb and not sees_people and not self_only:
            if explicit:
                raise people_denied(module, rep.tab)
            return None
        return v

    group_by = pick_group("group_by", "group_by")
    group_by2 = pick_group("group_by2", "group_by2") if group_by else None
    if group_by and group_by2 and group_by == group_by2:
        raise _422(f"Group by and Then by are both '{gb_pairs[group_by]}' - pick a different second grouping or clear it.")
    if is_composite:
        group_by2 = None

    # measures
    avail = {m.key: m for m in (rep.measures if is_composite else ds.measures)}

    def allowed(m: Measure) -> bool:
        return (sees_money or not m.money) and (sees_people or not m.people or self_only)

    if "measures" in qp and qp.get("measures"):
        keys = _split(qp.get("measures"))
        if not 1 <= len(keys) <= MAX_MEASURES:
            raise _422(f"Pick between 1 and {MAX_MEASURES} measures.")
        for k in keys:
            m = avail.get(k)
            if m is None:
                raise _422(f"Measure '{k}' is not available for {rep.label if is_composite else ds.label}. Pick measures from the Measures list.")
            if m.money and not sees_money:
                raise money_denied(ds, "Money measures")
            if m.people and not sees_people and not self_only:
                raise people_denied(module, rep.tab)
    else:
        keys = [k for k in (d.get("measures") or []) if k in avail and allowed(avail[k])]
        if not keys:
            keys = [k for k, m in avail.items() if allowed(m)][: (MAX_MEASURES if is_composite else 1)]
        if not keys:
            raise _422(f"{rep.label} has no figures you may see. Ask an admin for access in Organization › Role & Permissions.")
    # detail options
    page = 1
    page_size = 100
    try:
        page = max(1, int(qp.get("page") or 1))
        page_size = int(qp.get("page_size") or 100)
    except ValueError:
        raise _422("Page and page size must be whole numbers.") from None
    if page_size < 1 or page_size > JSON_PAGE_MAX:
        raise _422(f"Page size must be between 1 and {JSON_PAGE_MAX}. Use the paging buttons for more rows or export to Excel.")
    columns = _split(qp.get("columns")) if "columns" in qp else _split(None)
    if not columns and d.get("columns"):
        columns = [c for c in d["columns"] if c in {x.key for x in ds.columns}]
    direction = (qp.get("dir") or "").lower()
    if direction and direction not in ("asc", "desc"):
        raise _422(f"Sort direction '{direction}' is not valid. Use asc or desc.")
    sort = None
    if qp.get("sort"):
        sort = (qp["sort"], direction or "asc")
    elif d.get("sort"):
        sort = (d["sort"][0], d["sort"][1])
    ctx = ReportCtx(
        db=db, user=user, today=today, date_field=date_field, d_from=d_from, d_to=d_to, filters=filters,
        q=(qp.get("q") or "").strip() or None, group_by=group_by, group_by2=group_by2, measures=keys,
        sees_money=sees_money, sees_people=sees_people, self_only=self_only, compare=cmp_info,
    )
    sheets = [s for s in _split(qp.get("sheets")) if s in ("summary", "detail", "definitions")] or ["summary", "detail", "definitions"]
    return Prepared(
        module=module, rep=rep, ds=ds, ctx=ctx, level=level, filters_raw=raw_f, locked=locked, page=page,
        page_size=page_size, columns=columns, sort=sort, preset_label=preset_label, compare_kind=compare_kind,
        include=_split(qp.get("include")), sheets=sheets, all_columns=(qp.get("all_columns") in ("1", "true")),
    )


def filters_applied(prep: Prepared, loaded: list[dict]) -> list[dict]:
    ds, ctx = prep.ds, prep.ctx
    fdefs = all_filters(ds)
    dmap = {d.key: d for d in ds.dimensions}
    out = []
    for key, val in ctx.filters.items():
        f = fdefs[key]
        locked = key in prep.locked
        vals = val if isinstance(val, list) else [val]
        labels: dict[str, str] = {}
        if f.options:
            labels = {v: l for v, l in f.options}
        elif key in dmap and dmap[key].time_bucket:
            for x in vals:
                try:
                    labels[str(x)] = rdates.bucket_label(date.fromisoformat(str(x)), dmap[key].time_bucket)
                except ValueError:
                    pass
        elif key in dmap:
            dim = dmap[key]
            for r in loaded:
                t = token(dim.value(r))
                if t not in labels:
                    labels[t] = dim.label_of(r) if dim.label_of else (dim.blank_label if t == NONE_TOKEN else t)
        shown = []
        for v in vals:
            if isinstance(v, bool):
                shown.append("Yes" if v else "No")
            elif str(v) == str(ctx.user.id) and f.people:
                shown.append("Me")
            elif str(v) == NONE_TOKEN:
                shown.append(dmap[key].blank_label if key in dmap else "Not set")
            else:
                shown.append(labels.get(token(v), str(v)))
        out.append({"key": key, "label": f.label, "value": ", ".join(shown), "locked": locked})
    out.sort(key=lambda x: (not x["locked"], x["label"]))
    return out


def scope_label(user, module: str) -> str:
    try:
        return SCOPE_LABELS.get(user_scope(user, module), "Your data scope")
    except Exception:  # label only; never block a report on it
        return "Your data scope"


def period_block(prep: Prepared) -> dict:
    ctx = prep.ctx
    dlabel = next(x.label for x in prep.ds.date_fields if x.key == ctx.date_field)
    blk: dict = {"date_field": ctx.date_field, "date_field_label": dlabel,
                 "from": ctx.d_from.isoformat() if ctx.d_from else None,
                 "to": ctx.d_to.isoformat() if ctx.d_to else None, "label": prep.preset_label, "compare": None}
    if ctx.compare:
        blk["compare"] = {"kind": ctx.compare["kind"], "from": ctx.compare["from"].isoformat(), "to": ctx.compare["to"].isoformat()}
    return blk


def run(prep: Prepared, *, export_all: bool = False) -> dict:
    """Run the prepared report at its level. `export_all` returns every
    detail row (capped by the caller)."""
    ctx, rep, ds = prep.ctx, prep.rep, prep.ds
    base = {"report": rep.key, "label": rep.label, "dataset": ds.key, "self_only": ctx.self_only,
            "period": period_block(prep), "scope_label": scope_label(ctx.user, prep.module),
            "generated_at": datetime.now(timezone.utc).astimezone(rdates.IST).isoformat(timespec="seconds")}
    if rep.kind == "composite":
        res = rep.composite(ctx)
        body = strip_composite(rep, res, ctx.measures, ctx.sees_money, ctx.sees_people)
        loaded: list[dict] = []
        return {"level": "summary", **base, "filters_applied": filters_applied(prep, loaded),
                "group_by": body.pop("group_by"), "group_by2": None, **body, "group_count": len(body["rows"]), "truncated": False}
    cur, prev, loaded = load_selected(prep)
    fa = filters_applied(prep, loaded)
    if prep.level == "detail":
        d = detail(prep, cur, None if export_all else prep.page_size, prep.page)
        cols = d["columns"]
        return {"level": "detail", **base, "filters_applied": fa, "q": ctx.q,
                "columns": [{"key": c.key, "label": c.label, "type": c.type, "cut": c.cut,
                             **({"link": c.link[1], "id_key": c.link[0]} if c.link else {})} for c in cols],
                "rows": d["rows"], "row_count": d["row_count"], "page": prep.page, "page_size": prep.page_size,
                "sort": d["sort"], "totals": d["totals"], "notes": []}
    s = summarise(prep, cur, prev, [])
    return {"level": "summary", **base, "filters_applied": fa, "group_by": ctx.group_by, "group_by2": ctx.group_by2,
            **s, "truncated": False, "record_count": len(cur)}


# --------------------------------------------------------------------------- options

def me_option(user) -> list[dict]:
    return [{"value": user.id, "label": f"Me ({getattr(user, 'name', None) or getattr(user, 'email', '')})"}]


def options(prep: Prepared, f: FilterDef, q: str) -> list[dict]:
    ctx, ds = prep.ctx, prep.ds
    if f.money and not ctx.sees_money:
        raise money_denied(ds, "Money filters")
    if f.people and not ctx.sees_people:
        return me_option(ctx.user)
    needle = (q or "").strip().lower()
    if f.options is not None:
        res = [{"value": v, "label": l} for v, l in f.options]
    elif f.options_fn is not None:
        res = list(f.options_fn(ctx, needle))
    else:
        dim = next((d for d in ds.dimensions if d.key == f.key and not d.time_bucket), None)
        if dim is None:
            return []
        seen: dict[str, dict] = {}
        for r in ds.load(ctx, None):
            v = dim.value(r)
            if v is None or token(v) in seen:
                continue
            seen[token(v)] = {"value": v, "label": dim.label_of(r) if dim.label_of else str(v)}
        res = sorted(seen.values(), key=lambda o: str(o["label"]).lower())
    if needle:
        res = [o for o in res if needle in str(o["label"]).lower()]
    return res[:50]
