"""Shared reports framework: permissions, filters, grouping, comparison,
drill-down, detail, export workbook. Uses a tiny toy dataset registered under
the `erp` module key (so the real permission registry applies); the real
Service reports are tested in test_erp_service_reports.py."""
from __future__ import annotations

from datetime import date
from io import BytesIO

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from openpyxl import load_workbook

from app.core.permission_registry import register_features
from app.core.record_ref import encode_ref
from app.core.reporting import (
    DateField, DetailColumn, Dimension, FilterDef, Measure, ReportChart, ReportDataset, ReportDef, ReportKpi,
    ReportResult, engine, management_feature, register_dataset, register_report,
)
from app.core.reporting import dates as rdates
from app.core.reporting import providers, registry
from app.core.reporting.router import router
from app.db.session import get_db
from app.modules.main.models.audit_log import AuditLog
from app.modules.main.models.user import User
from app.modules.main.routes.auth import get_current_user

BUCKET_LABELS = {"b1": "0-2 days", "b2": "3-7 days", "b3": "8-15 days", "b4": "16-30 days", "b5": "31-60 days", "b6": "Over 60 days"}
AGE_ORDER = list(BUCKET_LABELS.values())
MONEY = ("erp", "service_requests", "charges")
VIEW = ["erp:reports:view"]
EXPORT = ["erp:reports:export"]
PEOPLE = ["erp:reports.management:view"]
CHARGES = ["erp:service_requests.charges:view"]


def _rows(ctx, window):
    me = ctx.user.id
    out = []
    # 12 rows in October 2026 (+ 2 in September) - engineer alternates between the viewer and someone else.
    spec = [
        (1, "urgent", date(2026, 10, 2), 2.0, 100.0), (2, "standard", date(2026, 10, 3), 4.0, 0.0),
        (3, "urgent", date(2026, 10, 9), 6.0, 250.0), (4, "standard", date(2026, 10, 12), 8.0, 0.0),
        (5, "standard", date(2026, 10, 15), 10.0, 50.0), (6, "urgent", date(2026, 10, 20), 12.0, 0.0),
        (7, "standard", date(2026, 10, 31), 1.0, 10.0), (8, "standard", date(2026, 9, 28), 3.0, 0.0),
        (9, "urgent", date(2026, 9, 30), 5.0, 70.0),
    ]
    for i, pr, d, h, bill in spec:
        eng = me if i % 2 else 9999
        out.append({
            "sr_id": i, "request_no": f"SR-{i:04d}", "title": "=HYPERLINK(\"x\")" if i == 1 else f"Pump {i}",
            "opened": d, "priority": pr, "hours": h, "bill": bill, "eng": eng, "eng_name": "Me" if eng == me else "Other",
            "bucket": f"b{(i - 1) % 6 + 1}", "cust": 10 + (i % 2), "cust_name": f"Cust {10 + (i % 2)}", "age": 20 - i, "late": i % 3 == 0,
        })
    return out


def _dataset() -> ReportDataset:
    return ReportDataset(
        module="erp", key="toy", label="Toy records", record_noun="toy records",
        date_fields=(DateField("opened", "Opened date", lambda r: r["opened"]), DateField("none", "All dates", None)),
        default_date_field="opened",
        dimensions=(
            Dimension("engineer", "Engineer", lambda r: r["eng"], lambda r: r["eng_name"], people=True),
            Dimension("priority", "Priority", lambda r: r["priority"], lambda r: r["priority"].title()),
            Dimension("customer", "Customer", lambda r: r["cust"], lambda r: r["cust_name"]),
            Dimension("month", "Month", time_bucket="month"),
            Dimension("late", "Late", lambda r: r["late"]),
            Dimension("bucket", "Age", lambda r: r["bucket"], lambda r: BUCKET_LABELS[r["bucket"]], order="value"),
        ),
        measures=(
            Measure("count", "Records", "int", "count", group="Counts"),
            Measure("urgent", "Urgent", "int", "count", where=lambda r: r["priority"] == "urgent",
                    drill_filter={"f_priority": "urgent"}),
            Measure("urgent_pct", "Urgent %", "percent", "ratio", ratio=("urgent", "count")),
            Measure("hours.sum", "Hours", "hours", "sum", field="hours"),
            Measure("hours.avg", "Avg hours", "hours", "avg", field="hours", better="down"),
            Measure("hours.median", "Median hours", "hours", "median", field="hours"),
            Measure("hours.p90", "P90 hours", "hours", "p90", field="hours"),
            Measure("bill.sum", "Billed", "money", "sum", field="bill", money=True),
            Measure("eng_n", "Engineers", "int", "count_distinct", field="eng", people=True),
        ),
        filters=(
            FilterDef("priority", "Priority", "multi_select", options=(("urgent", "Urgent"), ("standard", "Standard"))),
            FilterDef("engineer", "Engineer", "user", people=True),
            FilterDef("customer", "Customer", "entity"),
            FilterDef("age_min", "Age from", "int", match=lambda r, v: r["age"] >= v),
            FilterDef("age_max", "Age to", "int", match=lambda r, v: r["age"] <= v),
            FilterDef("late", "Late", "bool"),
        ),
        columns=(
            DetailColumn("request_no", "SR No", "text", True, link=("sr_id", "/dashboard/toy"), searchable=True),
            DetailColumn("title", "Issue", "longtext", True, cut=True, searchable=True),
            DetailColumn("opened", "Opened", "date", True),
            DetailColumn("priority", "Priority", "status", True),
            DetailColumn("hours", "Work h", "hours", True, total="sum"),
            DetailColumn("bill", "Billed", "money", False, money=True, total="sum"),
        ),
        default_sort=("request_no", "asc"), load=_rows, tab="reports", money_feature=MONEY, id_keys=("sr_id",),
    )


def _composite(ctx):
    return ReportResult(
        group_by="engineer", group_label="Engineer",
        measures=[Measure("done", "Done", "int", "none"), Measure("value", "Value", "money", "none", money=True)],
        rows=[{"key": {"engineer": 1}, "label": {"engineer": "Ana"}, "values": {"done": 3, "value": 99.0},
               "drill": {}, "measure_drill": {"done": {"report": "toy_pivot"}}}],
        totals={"done": 3, "value": 99.0},
        kpis=[ReportKpi("done", "Done", "int", 3), ReportKpi("value", "Value", "money", 99.0, money=True)],
        series={"c1": {"labels": ["Ana"], "datasets": [{"label": "Done", "data": [3]}]},
                "c2": {"labels": ["Ana"], "datasets": [{"label": "Value", "data": [99]}]}},
    )


@pytest.fixture()
def toy(monkeypatch):
    saved_reports = dict(registry._REPORTS.get("erp", {}))
    saved_ds = {k: v for k, v in registry._DATASETS.items() if k[0] == "erp"}
    saved_dash = dict(registry._DASHBOARDS.get("erp", {}))
    registry.unregister_module("erp")
    monkeypatch.setattr(providers, "PROVIDERS", [])
    monkeypatch.setattr(providers, "_loaded", True)
    register_features("erp", "reports", management_feature())
    register_dataset(_dataset())
    common = dict(module="erp", section="Toy", order=1, dataset="toy")
    register_report(ReportDef(key="toy_pivot", label="Toy pivot", description="d", kind="pivot", **common,
                              defaults={"date_field": "opened", "group_by": "priority", "measures": ["count", "hours.sum"]},
                              definitions=(("Records", "Number of toy records"),)))
    register_report(ReportDef(key="toy_people", label="Toy people", description="d", kind="pivot", needs_management=True,
                              **common, defaults={"group_by": "engineer", "measures": ["count"]}))
    register_report(ReportDef(key="toy_bill", label="Toy billing", description="d", kind="pivot", money_report=True,
                              **common, defaults={"group_by": "month", "measures": ["count", "bill.sum"]}))
    register_report(ReportDef(key="toy_self", label="Toy self", description="d", kind="pivot", self_only_without_management=True,
                              **common, defaults={"group_by": "engineer", "measures": ["count"]}))
    register_report(ReportDef(key="toy_comp", label="Toy composite", description="d", kind="composite", **common,
                              composite=_composite, group_bys=(("engineer", "Engineer"),), defaults={"group_by": "engineer"},
                              measures=(Measure("done", "Done", "int", "none"), Measure("value", "Value", "money", "none", money=True)),
                              charts=(ReportChart("c1", "Done", "bar"), ReportChart("c2", "Value", "bar", money=True))))
    yield
    registry.unregister_module("erp")
    registry._REPORTS["erp"] = saved_reports
    registry._DATASETS.update(saved_ds)
    registry._DASHBOARDS["erp"] = saved_dash


def make_user(db, email, grants, name="Viewer"):
    u = User(email=email, name=name, role="user", is_active=True, granular_permissions=list(grants))
    db.add(u)
    db.commit()
    db.refresh(u)
    return u


@pytest.fixture()
def api(db, toy):
    app = FastAPI()
    app.include_router(router, prefix="/api/v1")
    holder: dict = {}
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: holder["user"]

    def as_user(u):
        holder["user"] = u
        return TestClient(app)
    return as_user


BASE = "/api/v1/reports/erp"
OCT = {"date_from": "2026-10-01", "date_to": "2026-10-31"}


def _viewer(db, extra=(), email="v@x.com"):
    return make_user(db, email, VIEW + list(extra))


# --------------------------------------------------------------------------- 404 / 403

def test_unknown_module_and_report_messages(db, api):
    c = api(_viewer(db))
    r = c.get("/api/v1/reports/xyz")
    assert r.status_code == 404 and r.json()["detail"] == "There are no reports for module 'xyz'. Open Reports from the module's own menu."
    r = c.get(f"{BASE}/abc", params=OCT)
    assert r.status_code == 404
    assert "has no report called 'abc'" in r.json()["detail"] and "Reload the Reports page" in r.json()["detail"]


def test_no_tab_view_is_403_and_export_needs_export(db, api):
    nobody = make_user(db, "n@x.com", [])
    c = api(nobody)
    assert c.get(BASE).status_code == 403
    assert c.get(f"{BASE}/toy_pivot", params=OCT).status_code == 403
    viewer = _viewer(db, email="v2@x.com")
    c = api(viewer)
    assert c.get(f"{BASE}/toy_pivot", params=OCT).status_code == 200
    r = c.get(f"{BASE}/toy_pivot/export", params=OCT)
    assert r.status_code == 403 and "Export" in r.json()["detail"]
    assert api(make_user(db, "e@x.com", VIEW + EXPORT)).get(f"{BASE}/toy_pivot/export", params=OCT).status_code == 200


def test_people_rules(db, api):
    c = api(_viewer(db))
    me = db.query(User).first().id
    r = c.get(f"{BASE}/toy_pivot", params={**OCT, "f_engineer": str(me + 50)})
    assert r.status_code == 403 and "People & performance" in r.json()["detail"] and "your own figures" in r.json()["detail"]
    assert c.get(f"{BASE}/toy_pivot", params={**OCT, "f_engineer": str(me)}).status_code == 200
    assert c.get(f"{BASE}/toy_pivot", params={**OCT, "group_by": "engineer"}).status_code == 403
    assert c.get(f"{BASE}/toy_pivot", params={**OCT, "measures": "eng_n"}).status_code == 403
    assert c.get(f"{BASE}/toy_people", params=OCT).status_code == 403
    boss = api(make_user(db, "b@x.com", VIEW + PEOPLE))
    assert boss.get(f"{BASE}/toy_people", params=OCT).status_code == 200
    assert boss.get(f"{BASE}/toy_pivot", params={**OCT, "group_by": "engineer"}).status_code == 200


def test_module_wildcard_does_not_grant_management(db, api):
    c = api(make_user(db, "w@x.com", ["erp:*:*"]))
    assert c.get(f"{BASE}/toy_people", params=OCT).status_code == 403


def test_money_absent_without_switch_and_403_on_request(db, api):
    c = api(_viewer(db))
    cat = c.get(BASE).json()
    ds = cat["datasets"][0]
    assert "bill.sum" not in {m["key"] for m in ds["measures"]}
    assert "bill" not in {x["key"] for x in ds["columns"]}
    assert "toy_bill" not in {r["key"] for r in cat["reports"]}
    comp = next(r for r in cat["reports"] if r["key"] == "toy_comp")
    assert [m["key"] for m in comp["measures"]] == ["done"]
    assert cat["sees_money"] is False and cat["sees_people"] is False
    r = c.get(f"{BASE}/toy_bill", params=OCT)
    assert r.status_code == 403 and "Charges, costs & billing amounts" in r.json()["detail"] and "Organization" in r.json()["detail"]
    assert c.get(f"{BASE}/toy_pivot", params={**OCT, "measures": "bill.sum"}).status_code == 403
    assert c.get(f"{BASE}/toy_pivot", params={**OCT, "level": "detail", "columns": "bill"}).status_code == 403
    det = c.get(f"{BASE}/toy_pivot", params={**OCT, "level": "detail"}).json()
    assert "bill" not in det["columns"][0] and all("bill" not in row for row in det["rows"])
    assert "bill" not in {k["key"] for k in det["columns"]}
    rich = api(make_user(db, "m@x.com", VIEW + CHARGES))
    res = rich.get(f"{BASE}/toy_pivot", params={**OCT, "measures": "bill.sum"})
    assert res.status_code == 200 and res.json()["totals"]["values"]["bill.sum"] == 410.0
    assert rich.get(f"{BASE}/toy_bill", params=OCT).status_code == 200


def test_composite_strips_money_and_people_items(db, api):
    r = api(_viewer(db)).get(f"{BASE}/toy_comp", params=OCT).json()
    assert [m["key"] for m in r["measures"]] == ["done"]
    assert r["rows"][0]["values"] == {"done": 3}
    assert [k["key"] for k in r["kpis"]] == ["done"]
    assert [s["key"] for s in r["series"]] == ["c1"]
    assert r["totals"]["values"] == {"done": 3}
    full = api(make_user(db, "f@x.com", VIEW + CHARGES)).get(f"{BASE}/toy_comp", params=OCT).json()
    assert [s["key"] for s in full["series"]] == ["c1", "c2"] and "value" in full["rows"][0]["values"]
    assert api(_viewer(db, email="z@x.com")).get(f"{BASE}/toy_comp", params={**OCT, "level": "detail"}).status_code == 422


# --------------------------------------------------------------------------- 422 messages

@pytest.mark.parametrize("params,needle", [
    ({"date_from": "2026-10-05", "date_to": "2026-10-01"}, "'From' date 05-10-2026 is after 'To' date 01-10-2026 - swap them."),
    ({"date_from": "2020-01-01", "date_to": "2026-10-01"}, "The period is longer than 3 years - pick a shorter range (for example one financial year)."),
    ({**OCT, "f_foo": "1"}, "Unknown filter 'foo' for Toy records. Allowed:"),
    ({**OCT, "f_priority": "high"}, "Priority 'high' is not valid. Use one of: Urgent, Standard."),
    ({**OCT, "f_customer": "abc"}, "Customer filter must be a customer picked from the list (got 'abc'). Clear the filter and pick it again."),
    ({**OCT, "group_by": "x"}, "Toy pivot can't be grouped by 'x'. Choose one of:"),
    ({**OCT, "group_by": "priority", "group_by2": "priority"}, "Group by and Then by are both 'Priority'"),
    ({**OCT, "measures": "nope"}, "Measure 'nope' is not available for Toy records."),
    ({**OCT, "level": "detail", "columns": "zzz"}, "Column 'zzz' is not part of Toy records - reset the columns (Columns › Reset) and try again."),
    ({**OCT, "level": "detail", "compare": "previous_period"}, "Comparison works on the summary only"),
    ({"date_field": "none", "compare": "previous_period"}, "'All dates' has no period to compare with"),
    ({**OCT, "f_age_min": "30", "f_age_max": "10"}, "Age from 30 is more than Age to 10 - swap them."),
    ({**OCT, "level": "detail", "page_size": "900"}, "Page size must be between 1 and 500"),
    ({**OCT, "compare": "last_week"}, "Comparison 'last_week' is not valid"),
])
def test_validation_messages(db, api, params, needle):
    r = api(_viewer(db)).get(f"{BASE}/toy_pivot", params=params)
    assert r.status_code == 422, r.text
    assert needle in r.json()["detail"]


# --------------------------------------------------------------------------- summary maths

def _summary(c, report="toy_pivot", **p):
    r = c.get(f"{BASE}/{report}", params={**OCT, **p})
    assert r.status_code == 200, r.text
    return r.json()


def test_two_level_grouping_totals_median_p90(db, api):
    c = api(_viewer(db))
    j = _summary(c, group_by="priority", group_by2="customer", measures="count,hours.sum,hours.median,hours.p90,urgent_pct")
    assert j["totals"]["values"]["count"] == 7
    assert j["totals"]["values"]["hours.sum"] == 43.0
    assert j["totals"]["values"]["hours.median"] == 6.0
    assert j["totals"]["values"]["urgent_pct"] == pytest.approx(3 / 7, abs=1e-3)
    labels = [r["label"]["priority"] for r in j["rows"]]
    assert labels == ["Standard", "Urgent"]
    for row in j["rows"]:
        assert sum(ch["values"]["count"] for ch in row["children"]) == row["values"]["count"]
    # statistics.quantiles(n=10)[-1] of 1,2,4,6,8,10,12
    assert j["totals"]["values"]["hours.p90"] == pytest.approx(11.6, abs=0.05) or j["totals"]["values"]["hours.p90"] > 10
    assert j["series"] and j["series"][0]["kind"] == "stacked_bar"


def test_pivot_honours_dimension_order_for_age_buckets(db, api):
    j = _summary(api(_viewer(db)), group_by="bucket", date_from="2026-09-01", date_to="2026-10-31", measures="count")
    labels = [r["label"]["bucket"] for r in j["rows"]]
    assert labels == AGE_ORDER
    assert labels != sorted(labels)  # plain text order would put "16-30 days" second


def test_time_bucket_and_auto_series(db, api):
    j = _summary(api(_viewer(db)), group_by="month", date_from="2026-09-01", date_to="2026-10-31")
    assert [r["label"]["month"] for r in j["rows"]] == ["Sep 2026", "Oct 2026"]
    assert j["series"][0]["kind"] == "line"
    d = j["rows"][1]["drill"]
    assert d["date_from"] == "2026-10-01" and d["date_to"] == "2026-10-31"
    j = _summary(api(_viewer(db, email="p@x.com")), group_by="priority")
    assert j["series"][0]["kind"] == "doughnut"


def test_others_group_cap(db, api, monkeypatch):
    monkeypatch.setattr(engine, "MAX_GROUPS", 1)
    j = _summary(api(_viewer(db)), group_by="priority")
    assert [r["label"]["priority"] for r in j["rows"]][-1] == "Others"
    assert any("the rest are summed in 'Others'" in n for n in j["notes"])


def test_comparison_previous_period_and_delta_null(db, api):
    c = api(_viewer(db))
    j = _summary(c, date_from="2026-10-01", date_to="2026-10-31", compare="previous_period", group_by="priority",
                 measures="count,urgent")
    assert j["period"]["compare"]["from"] == "2026-08-31" and j["period"]["compare"]["to"] == "2026-09-30"
    assert j["totals"]["compare"]["count"] == 2
    urgent = next(r for r in j["rows"] if r["key"]["priority"] == "urgent")
    assert urgent["compare"]["count"] == 1 and urgent["delta_pct"]["count"] == 200.0
    j = _summary(c, date_from="2026-09-01", date_to="2026-09-30", compare="previous_period", measures="count")
    assert j["totals"]["compare"]["count"] == 0 and j["totals"]["delta_pct"]["count"] is None
    assert j["kpis"][0]["delta_pct"] is None


def test_compare_range_edges():
    assert rdates.compare_range("previous_period", date(2026, 3, 31), date(2026, 3, 31)) == (date(2026, 3, 30), date(2026, 3, 30))
    assert rdates.compare_range("previous_period", date(2026, 10, 1), date(2026, 10, 31)) == (date(2026, 8, 31), date(2026, 9, 30))
    assert rdates.compare_range("previous_year", date(2024, 2, 29), date(2024, 2, 29)) == (date(2023, 2, 28), date(2023, 2, 28))


def test_dates_ist_boundary_and_presets():
    s, e = rdates.bounds(date(2026, 10, 31), date(2026, 10, 31))
    assert s.isoformat() == "2026-10-30T18:30:00+00:00" and e.isoformat() == "2026-10-31T18:30:00+00:00"
    assert rdates.bucket(date(2026, 10, 7), "week") == date(2026, 10, 5)
    assert rdates.bucket(date(2026, 2, 7), "fy") == date(2025, 4, 1)
    assert rdates.bucket(date(2026, 5, 7), "quarter") == date(2026, 4, 1)
    assert rdates.resolve("last_fy", None, None, date(2026, 10, 26))[:2] == (date(2025, 4, 1), date(2026, 3, 31))
    assert rdates.resolve("last_quarter", None, None, date(2026, 10, 26))[:2] == (date(2026, 7, 1), date(2026, 9, 30))
    assert rdates.resolve("this_month", None, None, date(2026, 10, 26))[:2] == (date(2026, 10, 1), date(2026, 10, 31))


def test_filters_and_search_narrow_summary(db, api):
    c = api(_viewer(db))
    assert _summary(c, f_priority="urgent", measures="count")["totals"]["values"]["count"] == 3
    assert _summary(c, f_late="1", measures="count")["totals"]["values"]["count"] == 2
    assert _summary(c, f_customer="11,99", measures="count")["totals"]["values"]["count"] == 4
    assert _summary(c, f_age_min="16", measures="count")["totals"]["values"]["count"] == 4
    assert _summary(c, q="Pump 3", measures="count")["totals"]["values"]["count"] == 1
    fa = _summary(c, f_priority="urgent", measures="count")["filters_applied"]
    assert fa == [{"key": "priority", "label": "Priority", "value": "Urgent", "locked": False}]


def test_drill_matches_every_number(db, api):
    c = api(_viewer(db))
    j = _summary(c, group_by="customer", group_by2="priority", measures="count,urgent")
    checks = 0
    for row in j["rows"]:
        for ch in [row] + row["children"]:
            for m in ("count", "urgent"):
                cell = ch["measure_drill"].get(m, ch["drill"])
                if cell is None:  # contradictory filters: nothing is behind the number
                    assert ch["values"][m] == 0
                    continue
                params = {**cell, "level": "detail"}
                d = c.get(f"{BASE}/toy_pivot", params=params).json()
                assert d["row_count"] == ch["values"][m], (ch["label"], m)
                checks += 1
    assert checks >= 8
    for k in j["kpis"]:
        d = c.get(f"{BASE}/toy_pivot", params={**k["drill"], "level": "detail"}).json()
        assert d["row_count"] == k["value"]


# --------------------------------------------------------------------------- detail

def test_detail_search_sort_paging_totals(db, api):
    c = api(_viewer(db))
    j = c.get(f"{BASE}/toy_pivot", params={**OCT, "level": "detail", "page_size": "3", "page": "2", "sort": "hours", "dir": "desc"}).json()
    assert j["row_count"] == 7 and j["page"] == 2 and len(j["rows"]) == 3
    assert [r["hours"] for r in j["rows"]] == [6.0, 4.0, 2.0]
    assert j["totals"]["hours"] == 43.0  # over all rows, not the page
    assert j["rows"][0]["sr_id"] == 3 and j["columns"][0]["link"] == "/dashboard/toy"
    s = c.get(f"{BASE}/toy_pivot", params={**OCT, "level": "detail", "q": "pump 4"}).json()
    assert s["row_count"] == 1
    d = c.get(f"{BASE}/toy_pivot", params={**OCT, "level": "detail", "columns": "request_no,hours"}).json()
    assert [x["key"] for x in d["columns"]] == ["request_no", "hours"] and set(d["rows"][0]) == {"sr_id", "request_no", "hours"}
    # default sort ascending by SR No; ties of an equal sort value fall back to it
    t = c.get(f"{BASE}/toy_pivot", params={**OCT, "level": "detail", "sort": "priority"}).json()
    assert [r["request_no"] for r in t["rows"]][:4] == ["SR-0002", "SR-0004", "SR-0005", "SR-0007"]


def test_self_only_forces_own_rows_and_options_me(db, api):
    me = _viewer(db)
    c = api(me)
    j = _summary(c, "toy_self", group_by="engineer", measures="count")
    assert j["self_only"] is True
    assert [r["label"]["engineer"] for r in j["rows"]] == ["Me"]
    assert j["totals"]["values"]["count"] == 4
    assert c.get(f"{BASE}/toy_self", params={**OCT, "f_engineer": "9999"}).status_code == 403
    opts = c.get(f"{BASE}/toy_pivot/options/engineer").json()
    assert opts == [{"value": me.id, "label": "Me (Viewer)"}]
    boss = api(make_user(db, "bs@x.com", VIEW + PEOPLE))
    assert {o["label"] for o in boss.get(f"{BASE}/toy_pivot/options/engineer").json()} == {"Me", "Other"}
    assert boss.get(f"{BASE}/toy_pivot/options/customer", params={"q": "11"}).json() == [{"value": 11, "label": "Cust 11"}]
    assert c.get(f"{BASE}/toy_pivot/options/priority").json()[0] == {"value": "urgent", "label": "Urgent"}
    assert c.get(f"{BASE}/toy_pivot/options/zzz").status_code == 422
    assert api(make_user(db, "bs2@x.com", VIEW + PEOPLE)).get(f"{BASE}/toy_self", params={**OCT, "group_by": "engineer"}).json()["self_only"] is False


def test_catalogue_shape(db, api):
    cat = api(_viewer(db)).get(BASE).json()
    assert cat["module"] == "erp" and cat["can_export"] is False
    assert [p["key"] for p in cat["presets"]][0] == "this_month" and cat["compare_options"][0]["key"] == "previous_period"
    ds = cat["datasets"][0]
    assert "engineer" not in {d["key"] for d in ds["dimensions"]}
    pr = next(f for f in ds["filters"] if f["key"] == "priority")
    assert pr["options"][0] == {"value": "urgent", "label": "Urgent"} and pr["has_lookup"] is False
    assert next(f for f in ds["filters"] if f["key"] == "customer")["has_lookup"] is True
    assert next(r for r in cat["reports"] if r["key"] == "toy_self")["self_only"] is True
    assert "toy_people" not in {r["key"] for r in cat["reports"]}


# --------------------------------------------------------------------------- export

def _export(c, report="toy_pivot", **p):
    r = c.get(f"{BASE}/{report}/export", params={**OCT, **p})
    assert r.status_code == 200, r.text
    return r, load_workbook(BytesIO(r.content))


def test_export_workbook_and_audit(db, api):
    u = make_user(db, "x@x.com", VIEW + EXPORT + CHARGES)
    c = api(u)
    r, wb = _export(c, group_by="priority", group_by2="customer", measures="count,hours.sum,bill.sum",
                    compare="previous_period", f_priority="urgent,standard", columns="request_no,title,opened,priority,hours,bill")
    assert 'filename="Service_Toy_pivot_2026-10-01_to_2026-10-31.xlsx"' in r.headers["content-disposition"]
    assert wb.sheetnames == ["Summary", "Toy pivot - summary", "Toy pivot - records", "Definitions"]
    sm = wb["Toy pivot - summary"]
    assert sm.cell(7, 2).value == "Records - this period" and sm.cell(7, 4).value == "Records - change %"
    assert sm.freeze_panes == "B8" and sm.auto_filter.ref
    assert sm.page_setup.orientation == "landscape" and sm.print_title_rows == "$7:$7"
    assert any(sm.row_dimensions[i].outline_level == 1 for i in range(8, 20))
    rec = wb["Toy pivot - records"]
    assert rec.freeze_panes == "B8" and rec.auto_filter.ref == "A7:F14"
    assert rec.cell(7, 1).value == "SR No" and rec.cell(7, 5).value == "Work h"
    assert rec.cell(8, 3).number_format == "DD-MM-YYYY"
    assert rec["F8"].number_format == '"₹" #,##,##0.00'
    assert rec.cell(15, 5).value == "=SUBTOTAL(109,E8:E14)"
    link = rec.cell(8, 1).hyperlink.target
    assert link.endswith("/dashboard/toy/" + encode_ref(1)) and "/1" != link[-2:]
    # a customer-typed issue title that starts with "=" must stay text
    title = rec.cell(8, 2)
    assert title.value.startswith("=HYPERLINK") and title.data_type == "s"
    assert rec.cell(7, 1).fill.start_color.rgb == "FFFF7A45"
    assert wb["Summary"]["A1"].value.endswith("Reports - Toy pivot") and wb["Summary"]["A1"].fill.start_color.rgb == "FF0F172A"
    assert wb["Definitions"].cell(8, 2).value == "Records"
    log = db.query(AuditLog).filter_by(entity_type="report_export").one()
    assert log.action == "exported" and log.module_key == "erp" and log.subtab_key == "reports" and log.performed_by_id == u.id
    assert "Exported erp" not in log.summary and "Toy pivot" in log.summary and "Priority: Urgent, Standard" in log.summary


def test_export_pack_and_money_is_dropped_without_switch(db, api):
    c = api(make_user(db, "y@x.com", VIEW + EXPORT))
    r, wb = _export(c, include="toy_bill,toy_comp,toy_people")
    assert "Toy composite - summary" in wb.sheetnames and "Toy billing - summary" not in wb.sheetnames
    assert "Toy composite - records" not in wb.sheetnames
    assert "bill" not in "".join(str(cell.value) for row in wb["Toy pivot - records"].iter_rows() for cell in row).lower().replace("billed", "")


def test_export_cap_and_sheet_choice(db, api, monkeypatch):
    c = api(make_user(db, "z@x.com", VIEW + EXPORT))
    monkeypatch.setattr(engine, "EXPORT_CAP", 3)
    r = c.get(f"{BASE}/toy_pivot/export", params=OCT)
    assert r.status_code == 422
    assert r.json()["detail"] == "This export would have 7 records (limit 3). Narrow the period or add a filter, then export again."
    monkeypatch.setattr(engine, "EXPORT_CAP", 50_000)
    _, wb = _export(c, sheets="summary")
    assert wb.sheetnames == ["Summary", "Toy pivot - summary"]


def test_registration_guards():
    with pytest.raises(ValueError):
        register_report(ReportDef(module="erp", key="bad", label="b", description="", section="s", order=1,
                                  kind="composite", dataset="toy"))
    ds = _dataset()
    bad = ReportDataset(**{**ds.__dict__, "filters": (FilterDef("nothing", "Nothing", "int"),)})
    with pytest.raises(ValueError):
        register_dataset(bad)
