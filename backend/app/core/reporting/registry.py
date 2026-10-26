"""Report framework definitions (design revision 2: datasets + reports).

A module registers, in code (never in the database):
- `ReportDataset`s: one fact row (a plain dict) per record, with dimensions
  (group-by AND filter fields), measures, filters, detail columns, date
  fields and a scoped `load(ctx, window)` function;
- `ReportDef`s: either a `pivot` over a dataset (named defaults the user can
  change freely) or a `composite` (coded figures that mix datasets).

Contract for loaders (`ReportDataset.load`)
- Start from `apply_scope(query, ctx.user, Model)`; never return rows outside
  the viewer's data scope. Join visits etc. only through a scoped parent.
- `window` is `(from, to)` (inclusive dates, already widened to cover the
  comparison period) or None for "all dates". Use it for a cheap SQL
  pre-filter and for look-back needs; the engine re-applies the exact window,
  the filters and the search in Python, so a loader may over-fetch.
- `ctx.filters` holds the validated filters; a loader MAY use them to
  pre-filter in SQL, but must never rely on that for correctness.
- Rows are dicts. Filter tokens: values are compared as strings after
  `token()` (None -> "__none__", bool -> "1"/"0").

Composite contract: `composite(ctx) -> ReportResult` (see `ReportResult`).
Ratios/percent values are FRACTIONS (0.25 = 25 %), formatted by the client.

Aliases kept for the names agreed with backend-agent B: `ReportFilter`
= `FilterDef`, `ReportColumn` = `DetailColumn`.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date
from typing import Any, Callable, Literal

from sqlalchemy.orm import Session

ColType = Literal[
    "text", "longtext", "int", "decimal", "money", "percent", "hours", "days",
    "date", "datetime", "time", "status", "bool",
]
Agg = Literal["count", "count_distinct", "sum", "avg", "median", "max", "p90", "ratio", "none"]
ChartKind = Literal["bar", "stacked_bar", "hbar", "line", "doughnut"]
NONE_TOKEN = "__none__"
TIME_BUCKETS = ("day", "week", "month", "quarter", "fy")


def token(value: Any) -> str:
    """The string a filter / drill uses for a row value."""
    if value is None:
        return NONE_TOKEN
    if isinstance(value, bool):
        return "1" if value else "0"
    return str(value)


@dataclass(frozen=True)
class Dimension:
    key: str
    label: str
    value: Callable[[dict], Any] | None = None  # row -> hashable (None = blank); ignored for time_bucket
    label_of: Callable[[dict], str] | None = None  # row -> label (default: str(value), blank -> "Not set")
    people: bool = False
    money: bool = False
    order: Literal["label", "value", "measure"] = "label"
    time_bucket: str | None = None  # "day|week|month|quarter|fy": buckets the chosen date field
    blank_label: str = "Not set"


@dataclass(frozen=True)
class Measure:
    key: str  # may be dotted, e.g. "response_h.avg"
    label: str
    type: ColType = "int"
    agg: Agg = "count"
    field: str | None = None  # row key aggregated (sum/avg/median/max/p90/count_distinct)
    where: Callable[[dict], bool] | None = None  # row predicate (only matching rows count)
    ratio: tuple[str, str] | None = None  # (numerator measure key, denominator measure key)
    money: bool = False
    people: bool = False
    drill_filter: dict[str, str] | None = None  # extra f_<filter> parameters when the number is clicked
    better: Literal["up", "down"] | None = None  # which direction is good (colours the change)
    group: str = ""  # chooser group: Counts / Time / Effort / Money


@dataclass(frozen=True)
class FilterDef:
    key: str
    label: str
    type: Literal["select", "multi_select", "user", "entity", "text", "int", "bool"] = "multi_select"
    options: tuple[tuple[str, str], ...] | None = None  # static (value, label); enforces valid values
    # lookup for big lists, built from SCOPED data: fn(ctx, q) -> [{"value","label"}] (max 50)
    options_fn: Callable[[Any, str], list[dict]] | None = None
    # predicate fn(row, parsed_value) -> bool. Default: the dimension with the same key,
    # compared by token(). user/entity values are lists of ints (or "__none__"); int is an int; bool a bool.
    match: Callable[[dict, Any], bool] | None = None
    people: bool = False  # another person than the viewer needs the management right
    money: bool = False
    group: str = ""  # popup group: People / Customer & machine / Classification / Cover & billing / Timing


@dataclass(frozen=True)
class DetailColumn:
    key: str
    label: str
    type: ColType = "text"
    default: bool = False
    money: bool = False
    link: tuple[str, str] | None = None  # (row id key, page base path)
    cut: bool = False
    width: int | None = None
    searchable: bool = False
    total: Literal["sum", "none"] = "none"


@dataclass(frozen=True)
class DateField:
    key: str
    label: str
    value: Callable[[dict], date | None] | None = None  # None value = "all dates" (key "none")


@dataclass(frozen=True)
class ReportDataset:
    module: str
    key: str
    label: str
    record_noun: str  # "service requests"
    date_fields: tuple[DateField, ...]
    default_date_field: str
    dimensions: tuple[Dimension, ...]
    measures: tuple[Measure, ...]
    filters: tuple[FilterDef, ...]
    columns: tuple[DetailColumn, ...]
    default_sort: tuple[str, str]  # (column key, "asc"|"desc")
    load: Callable[[Any, tuple[date, date] | None], list[dict]]
    tab: str = "reports"
    money_feature: tuple[str, str, str] | None = None  # (module, tab, feature) -> "view"
    id_keys: tuple[str, ...] = ()  # row keys always carried in detail rows (e.g. sr_id, project_id)


@dataclass(frozen=True)
class ReportChart:
    """Declares a chart a composite report returns in `ReportResult.series`."""
    key: str
    label: str
    kind: ChartKind = "bar"
    money: bool = False
    people: bool = False


@dataclass(frozen=True)
class ReportDef:
    module: str
    key: str
    label: str
    description: str
    section: str
    order: int
    kind: Literal["pivot", "composite"]
    dataset: str
    # date_field, preset, compare, filters, group_by, group_by2, measures, columns, level, sort.
    # Used for first load and for fields the request leaves out (group_by/measures/date_field/level);
    # `filters` is only the client's starting state (the server never re-adds a removed filter).
    defaults: dict[str, Any] = field(default_factory=dict)
    locked_filters: dict[str, str] = field(default_factory=dict)  # always applied, shown, not removable
    money_report: bool = False
    needs_management: bool = False
    self_only_without_management: bool = False
    self_filter: str = "engineer"  # filter forced to the viewer when self-only
    # composite only:
    composite: Callable[[Any], "ReportResult"] | None = None
    measures: tuple[Measure, ...] = ()  # figures the composite returns (chooser + stripping)
    group_bys: tuple[tuple[str, str], ...] = ()  # composite group-by options (key, label)
    people_group_bys: tuple[str, ...] = ()
    charts: tuple[ReportChart, ...] = ()
    definitions: tuple[tuple[str, str], ...] = ()  # (metric, how it is calculated)
    tab: str = "reports"
    date_basis: str = ""  # printed on the page header and Excel (composite)


@dataclass
class ReportCtx:
    db: Session
    user: Any
    today: date  # today in IST
    date_field: str
    d_from: date | None  # None when date_field == "none"
    d_to: date | None
    filters: dict[str, Any]  # validated (see FilterDef.match)
    q: str | None
    group_by: str | None
    group_by2: str | None
    measures: list[str]
    sees_money: bool
    sees_people: bool
    self_only: bool  # viewer may see only their own figures
    compare: dict | None = None  # {"kind","from","to"} when a comparison is on


@dataclass
class ReportKpi:
    """One KPI chip of a composite result."""
    key: str
    label: str
    type: ColType = "int"
    value: Any = None
    compare: Any = None
    delta_pct: float | None = None
    drill: dict = field(default_factory=dict)
    money: bool = False
    people: bool = False
    better: Literal["up", "down"] | None = None


@dataclass
class ReportResult:
    """What a composite returns. Rows have the same shape as pivot summary rows:
    {"key": {dim: v}, "label": {dim: text}, "values": {measure key: v}, "compare": {}, "delta_pct": {},
     "drill": {...}, "measure_drill": {measure key: {"report": "<target>", "f_x": "..."}}, "children": []}.
    `group_by` names the label key; `series` maps a declared chart key to
    {"labels": [...], "datasets": [{"label": str, "data": [...]}]}."""
    rows: list[dict] = field(default_factory=list)
    group_by: str | None = None
    group_label: str = ""
    measures: list[Measure] = field(default_factory=list)
    totals: dict = field(default_factory=dict)  # measure key -> value
    kpis: list[ReportKpi] = field(default_factory=list)
    series: dict[str, dict] = field(default_factory=dict)
    notes: list[str] = field(default_factory=list)


@dataclass(frozen=True)
class VisualSpec:
    """One card on a dashboard page (data, never hard-coded in the client).

    kind: kpi | donut | column | hbar | line | stacked_bar | table
    - group_by: a dimension key of the dataset (time_bucket dims give a time axis);
      group_by2 splits stacked_bar / multi-line series.
    - measure: ONE measure key (kpi, donut, column, hbar, line); measures: several
      (stacked_bar without group_by2, multi-series line, table columns).
    - table: with group_by = a "Top N" table of groups x measures; without group_by
      = a record list of `columns` (dataset column keys) sorted by `sort`.
    - top_n: keep the N largest groups (not for time axes).
    - sort: "value_desc" (default for categories) | "value_asc" | "label"; for a
      record table a (column key, "asc"|"desc") tuple.
    - date_field: overrides the page's date field for this visual.
    - drill: dimension a click filters (default = group_by).
    - time_window: "last_12_months" | "last_6_months" | "last_8_weeks": the axis covers
      that window ending at the period end (or today for snapshots), ignoring the
      period start.
    - span: card width 1..3 columns.
    - money / people: removed (ABSENT) for viewers without the right; a measure
      with money/people also hides the visual.
    - better: up | down for KPI colouring (falls back to the measure's own)."""
    id: str
    kind: Literal["kpi", "donut", "column", "hbar", "line", "stacked_bar", "table"]
    title: str
    definition: str = ""
    dataset: str = ""
    group_by: str | None = None
    group_by2: str | None = None
    measure: str | None = None
    measures: tuple[str, ...] = ()
    columns: tuple[str, ...] = ()
    top_n: int | None = None
    sort: Any = None
    date_field: str | None = None
    span: int = 1
    money: bool = False
    people: bool = False
    better: Literal["up", "down"] | None = None
    drill: str | None = None
    time_window: str | None = None
    # Always-on filters for this card only ({"status": "open,on_hold"}); ANDed with the viewer's filters
    # (same key = intersection). Not removable by per-visual overrides.
    fixed_filters: dict[str, str] = field(default_factory=dict)


@dataclass(frozen=True)
class DashboardPage:
    key: str
    label: str
    hint: str = ""
    date_mode: Literal["range", "snapshot"] = "range"
    slicers: tuple[str, ...] = ()  # filter keys of the page dataset
    kpis: tuple[VisualSpec, ...] = ()
    visuals: tuple[VisualSpec, ...] = ()
    money_page: bool = False  # whole page needs the module's money switch
    people_page: bool = False  # whole page needs the reports.management switch
    # Like ReportDef.self_only_without_management: a viewer without the management switch still gets the
    # page, forced to their own figures (people-flagged visuals stay, filtered to "me"). Without this flag
    # people-flagged visuals are removed for such viewers.
    self_only_without_management: bool = False
    self_filter: str = "engineer"
    dataset: str = ""  # default dataset of the page (also the Records sheet / Detailed data)
    date_field: str | None = None  # default date field of the page
    # Always-on filters for every card of the page; shown locked in `filters_applied`.
    fixed_filters: dict[str, str] = field(default_factory=dict)


@dataclass(frozen=True)
class DashboardDef:
    module: str
    key: str
    label: str
    order: int
    pages: tuple[DashboardPage, ...]
    tab: str = "reports"


# Aliases agreed with backend-agent B.
ReportFilter = FilterDef
ReportColumn = DetailColumn

_DATASETS: dict[tuple[str, str], ReportDataset] = {}
_REPORTS: dict[str, dict[str, ReportDef]] = {}
_DASHBOARDS: dict[str, dict[str, DashboardDef]] = {}


def register_dataset(ds: ReportDataset) -> ReportDataset:
    dims = {d.key: d for d in ds.dimensions}
    for f in ds.filters:
        if f.match is None and (f.key not in dims or dims[f.key].time_bucket):
            raise ValueError(f"Filter {ds.key}.{f.key} needs a match function or a dimension with the same key.")
    if ds.default_date_field not in {d.key for d in ds.date_fields}:
        raise ValueError(f"Dataset {ds.key}: default_date_field '{ds.default_date_field}' is not a date field.")
    if ds.default_sort[0] not in {c.key for c in ds.columns}:
        raise ValueError(f"Dataset {ds.key}: default_sort column '{ds.default_sort[0]}' is not a column.")
    _DATASETS[(ds.module, ds.key)] = ds
    return ds


def get_dataset(module: str, key: str) -> ReportDataset | None:
    return _DATASETS.get((module, key))


def register_report(defn: ReportDef) -> ReportDef:
    if defn.kind == "composite" and defn.composite is None:
        raise ValueError(f"Report {defn.module}/{defn.key} is composite but has no composite function.")
    _REPORTS.setdefault(defn.module, {})[defn.key] = defn
    return defn


def get_report(module: str, key: str) -> ReportDef | None:
    return _REPORTS.get(module, {}).get(key)


def module_reports(module: str) -> list[ReportDef]:
    return sorted(_REPORTS.get(module, {}).values(), key=lambda d: (d.order, d.label))


def register_dashboard(defn: DashboardDef) -> DashboardDef:
    keys = [p.key for p in defn.pages]
    if len(keys) != len(set(keys)):
        raise ValueError(f"Dashboard {defn.module}/{defn.key} has duplicate page keys.")
    for p in defn.pages:
        ids = [v.id for v in (*p.kpis, *p.visuals)]
        if len(ids) != len(set(ids)):
            raise ValueError(f"Dashboard page {p.key} has duplicate visual ids.")
    _DASHBOARDS.setdefault(defn.module, {})[defn.key] = defn
    return defn


def module_dashboards(module: str) -> list[DashboardDef]:
    return sorted(_DASHBOARDS.get(module, {}).values(), key=lambda d: (d.order, d.label))


def unregister_module(module: str) -> None:
    """Test helper: drop everything a module registered."""
    _REPORTS.pop(module, None)
    _DASHBOARDS.pop(module, None)
    for k in [k for k in _DATASETS if k[0] == module]:
        del _DATASETS[k]
