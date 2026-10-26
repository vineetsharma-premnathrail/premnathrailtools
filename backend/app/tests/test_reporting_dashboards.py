"""Dashboard pages of the shared reports framework: batch endpoint,
cross-filter overrides, permissions, once-per-request loading, export."""
from __future__ import annotations

import dataclasses
from io import BytesIO

import pytest
from openpyxl import load_workbook

from app.core.reporting import (
    DashboardDef, DashboardPage, VisualSpec, engine, register_dashboard, register_dataset,
)
from app.modules.main.models.audit_log import AuditLog
from test_reporting_framework import (  # noqa: F401  (fixtures are imported by name)
    AGE_ORDER, CHARGES, EXPORT, PEOPLE, VIEW, _dataset, _viewer, api, make_user, toy,
)

URL = "/api/v1/reports/erp"
OCT = {"date_from": "2026-10-01", "date_to": "2026-10-31"}
CALLS: list[int] = []


def _counting_load(ctx, window):
    from test_reporting_framework import _rows
    CALLS.append(1)
    return _rows(ctx, window)


@pytest.fixture()
def dash(toy):  # noqa: F811
    CALLS.clear()
    register_dataset(dataclasses.replace(_dataset(), load=_counting_load))
    kp = (VisualSpec("k_count", "kpi", "Records", "Number of toy records", measure="count"),
          VisualSpec("k_urgent", "kpi", "Urgent", "Urgent records", measure="urgent", better="down"))
    vis = (
        VisualSpec("v_pri", "donut", "By priority", "Records per priority", group_by="priority", measure="count"),
        VisualSpec("v_month", "column", "By month", "Records per month", group_by="month", measure="count",
                   time_window="last_6_months"),
        VisualSpec("v_cust", "hbar", "Top customer", "Hours per customer", group_by="customer", measure="hours.sum", top_n=1),
        VisualSpec("v_stack", "stacked_bar", "Customer by priority", group_by="customer", group_by2="priority", measure="count"),
        VisualSpec("v_tbl", "table", "Priority table", group_by="priority", measures=("count", "hours.sum")),
        VisualSpec("v_rec", "table", "Longest jobs", columns=("request_no", "title", "hours"), sort=("hours", "desc"), top_n=3),
        VisualSpec("v_bill", "column", "Billed by month", group_by="month", measure="bill.sum"),
        VisualSpec("v_eng", "hbar", "By engineer", group_by="engineer", measure="count"),
    )
    pages = (
        DashboardPage("overview", "Overview", "What this shows", slicers=("priority", "customer", "engineer"),
                      kpis=kp, visuals=vis, dataset="toy"),
        DashboardPage("billing", "Billing", money_page=True, kpis=(VisualSpec("b_sum", "kpi", "Billed", measure="bill.sum"),),
                      dataset="toy"),
        DashboardPage("team", "Team", people_page=True, kpis=(VisualSpec("t_n", "kpi", "People", measure="count"),), dataset="toy"),
        DashboardPage("own", "Mine", self_only_without_management=True,
                      visuals=(VisualSpec("o_eng", "hbar", "By engineer", group_by="engineer", measure="count"),), dataset="toy"),
        DashboardPage("fixed", "Fixed", fixed_filters={"priority": "urgent"}, dataset="toy",
                      kpis=(VisualSpec("f_all", "kpi", "Urgent records", measure="count"),
                            VisualSpec("f_c11", "kpi", "Urgent for customer 11", measure="count", fixed_filters={"customer": "11"})),
                      ),
        DashboardPage("ages", "Ages", dataset="toy",
                      visuals=(VisualSpec("f_age", "column", "Age", group_by="bucket", measure="count"),
                               VisualSpec("f_age_label", "column", "Age by label", group_by="bucket", measure="count", sort="label"),
                               VisualSpec("f_age_desc", "column", "Age by value", group_by="bucket", measure="count", sort="value_desc"))),
        DashboardPage("snap", "Snapshot", date_mode="snapshot", kpis=(VisualSpec("s_count", "kpi", "All", measure="count"),),
                      dataset="toy"),
    )
    register_dashboard(DashboardDef("erp", "service", "Dashboards", 1, pages))


def post(c, page="overview", **body):
    body.setdefault("preset", None)
    return c.post(f"{URL}/dashboard/{page}", json={**OCT, **body})


def ok(c, page="overview", **body):
    r = post(c, page, **body)
    assert r.status_code == 200, r.text
    return r.json()


def test_catalogue_dashboards_follow_rights(db, api, dash):
    cat = api(_viewer(db)).get(URL).json()
    pages = {p["key"]: p for p in cat["dashboards"][0]["pages"]}
    assert set(pages) == {"overview", "own", "snap", "fixed", "ages"}  # no money page, no people page
    ov = pages["overview"]
    ids = {v["id"] for v in ov["visuals"]}
    assert "v_bill" not in ids and "v_eng" not in ids and "v_pri" in ids and "v_rec" in ids
    assert [k["id"] for k in ov["kpis"]] == ["k_count", "k_urgent"] and ov["kpis"][1]["better"] == "down"
    assert [s["key"] for s in ov["slicers"]] == ["priority", "customer", "engineer"]
    assert next(s for s in ov["slicers"] if s["key"] == "priority")["options"][0]["value"] == "urgent"
    assert next(s for s in ov["slicers"] if s["key"] == "customer")["has_lookup"] is True
    assert pages["own"]["self_only"] is True and [v["id"] for v in pages["own"]["visuals"]] == ["o_eng"]
    assert pages["snap"]["date_mode"] == "snapshot" and ov["visuals"][0]["drill"] == "priority"
    full = api(make_user(db, "f@x.com", VIEW + CHARGES + PEOPLE)).get(URL).json()
    fp = {p["key"]: p for p in full["dashboards"][0]["pages"]}
    assert set(fp) == {"overview", "billing", "team", "own", "snap", "fixed", "ages"}
    assert {"v_bill", "v_eng"} <= {v["id"] for v in fp["overview"]["visuals"]}
    assert fp["own"]["self_only"] is False
    assert api(make_user(db, "n@x.com", [])).get(URL).status_code == 403


def test_batch_results_kpis_and_shapes(db, api, dash):
    j = ok(api(_viewer(db)))
    assert j["kpis"]["k_count"]["value"] == 7 and j["kpis"]["k_urgent"]["value"] == 3
    assert j["kpis"]["k_urgent"]["drill"]["filters"] == {"f_priority": "urgent"}
    pri = j["results"]["v_pri"]
    assert pri["labels"] == ["Standard", "Urgent"] and pri["values"] == [4, 3] and pri["tokens"] == ["standard", "urgent"]
    assert pri["drill"] == {"dimension": "priority", "tokens": ["standard", "urgent"]} and pri["row_count"] == 7
    assert pri["datasets"][0]["data"] == [4, 3] and pri["totals"]["count"] == 7
    cust = j["results"]["v_cust"]
    assert len(cust["labels"]) == 1 and cust["truncated"] is True  # top_n = 1
    stack = j["results"]["v_stack"]
    assert {d["label"] for d in stack["datasets"]} == {"Standard", "Urgent"}
    assert sum(sum(d["data"]) for d in stack["datasets"]) == 7
    tbl = j["results"]["v_tbl"]
    assert tbl["rows"][0]["values"] == {"count": 4, "hours.sum": 23.0}
    rec = j["results"]["v_rec"]
    assert [r["hours"] for r in rec["rows"]] == [12.0, 10.0, 8.0] and rec["row_count"] == 7 and rec["rows"][0]["sr_id"] == 6
    assert "bill" not in rec["columns"][0] and "v_bill" not in j["results"] and "v_eng" not in j["results"]
    assert j["period"]["from"] == "2026-10-01" and j["filters_applied"] == [] and j["page"] == "overview"


def test_cross_filter_and_per_visual_override(db, api, dash):
    c = api(_viewer(db))
    j = ok(c, filters={"f_priority": "urgent"},
           visuals=[{"id": "k_count"}, {"id": "v_pri", "filters": {}}, {"id": "v_cust"}])
    assert j["kpis"]["k_count"]["value"] == 3
    assert j["results"]["v_pri"]["labels"] == ["Standard", "Urgent"]  # ignores its own selection
    assert j["results"]["v_cust"]["row_count"] == 3
    assert "v_tbl" not in j["results"]  # only the requested visuals are computed
    assert j["filters_applied"][0]["value"] == "Urgent"
    # AND across fields, OR within a field
    j = ok(c, filters={"f_priority": "urgent,standard", "f_customer": "11"}, visuals=[{"id": "k_count"}])
    assert j["kpis"]["k_count"]["value"] == 4


def test_time_window_axis_and_time_click_filter(db, api, dash):
    c = api(_viewer(db))
    j = ok(c, visuals=[{"id": "v_month"}])["results"]["v_month"]
    assert j["labels"] == ["May 2026", "Jun 2026", "Jul 2026", "Aug 2026", "Sep 2026", "Oct 2026"]
    assert j["values"] == [0, 0, 0, 0, 2, 7] and j["time_axis"] is True
    assert j["tokens"][4] == "2026-09-01"
    j2 = ok(c, date_from="2026-09-01", date_to="2026-10-31", filters={"f_month": "2026-09-01"}, visuals=[{"id": "k_count"}])
    assert j2["kpis"]["k_count"]["value"] == 2
    assert post(c, filters={"f_month": "nope"}).status_code == 422


def test_every_chart_token_drills_to_its_number(db, api, dash):
    c = api(_viewer(db))
    pri = ok(c, visuals=[{"id": "v_pri"}])["results"]["v_pri"]
    for tok, val in zip(pri["tokens"], pri["values"]):
        k = ok(c, filters={"f_priority": tok}, visuals=[{"id": "k_count"}])["kpis"]["k_count"]["value"]
        assert k == val
        d = c.get("/api/v1/reports/erp/toy_pivot", params={**OCT, "level": "detail", "f_priority": tok}).json()
        assert d["row_count"] == val


def test_compare_and_snapshot(db, api, dash):
    c = api(_viewer(db))
    j = ok(c, compare="previous_period", visuals=[{"id": "k_count"}, {"id": "v_pri"}, {"id": "v_month"}])
    assert j["kpis"]["k_count"]["compare"] == 2 and j["kpis"]["k_count"]["delta_pct"] == 250.0
    assert j["results"]["v_pri"]["compare"] == [1, 1]
    assert "compare" not in j["results"]["v_month"]  # a time axis has no previous-period series
    assert j["period"]["compare"]["from"] == "2026-08-31"
    s = ok(c, "snap")
    assert s["kpis"]["s_count"]["value"] == 9 and s["period"]["mode"] == "snapshot" and s["period"]["from"] is None
    r = post(c, "snap", compare="previous_period")
    assert r.status_code == 422 and "as of today" in r.json()["detail"]


def test_permissions_money_people_pages_and_visuals(db, api, dash):
    c = api(_viewer(db))
    r = post(c, "billing")
    assert r.status_code == 403 and "Charges, costs & billing amounts" in r.json()["detail"]
    r = post(c, "team")
    assert r.status_code == 403 and "People & performance" in r.json()["detail"]
    r = post(c, visuals=[{"id": "v_bill"}])
    assert r.status_code == 403 and "Charges, costs & billing amounts" in r.json()["detail"]
    assert post(c, visuals=[{"id": "v_eng"}]).status_code == 403
    assert post(c, filters={"f_engineer": "9999"}).status_code == 403
    rich = api(make_user(db, "r@x.com", VIEW + CHARGES + PEOPLE))
    j = ok(rich)
    assert "v_bill" in j["results"] and "v_eng" in j["results"] and sum(j["results"]["v_bill"]["values"]) == 410.0
    assert ok(rich, "billing")["kpis"]["b_sum"]["value"] == 410.0
    assert post(rich, "team").status_code == 200
    # a module wildcard grants neither
    assert post(api(make_user(db, "w@x.com", ["erp:*:*"])), "team").status_code == 403


def test_self_only_page(db, api, dash):
    me = _viewer(db)
    c = api(me)
    j = ok(c, "own")
    assert j["self_only"] is True and j["results"]["o_eng"]["labels"] == ["Me"] and j["results"]["o_eng"]["values"] == [4]
    assert any("only your own figures" in n for n in j["notes"])
    boss = ok(api(make_user(db, "b@x.com", VIEW + PEOPLE)), "own")
    assert boss["self_only"] is False and set(boss["results"]["o_eng"]["labels"]) == {"Me", "Other"}


@pytest.mark.parametrize("page,body,status,needle", [
    ("nope", {}, 404, "has no dashboard page 'nope'"),
    ("overview", {"filters": {"f_foo": "1"}}, 422, "Unknown filter 'foo' for Overview. Allowed:"),
    ("overview", {"filters": {"priority": "urgent"}}, 422, "must be sent as 'f_<name>'"),
    ("overview", {"filters": {"f_priority": "high"}}, 422, "Priority 'high' is not valid. Use one of: Urgent, Standard."),
    ("overview", {"visuals": [{"id": "zzz"}]}, 422, "Visual 'zzz' is not on the Overview page"),
    ("overview", {"date_from": "2026-10-05", "date_to": "2026-10-01"}, 422, "'From' date 05-10-2026 is after 'To' date 01-10-2026"),
    ("overview", {"date_from": "bad", "date_to": "2026-10-01"}, 422, "Dates must be written YYYY-MM-DD"),
    ("overview", {"date_field": "zzz"}, 422, "Date field 'zzz' is not valid for Toy records"),
    ("overview", {"filters": {"f_customer": "abc"}}, 422, "Customer filter must be a customer picked from the list"),
])
def test_validation_messages(db, api, dash, page, body, status, needle):
    r = api(_viewer(db)).post(f"{URL}/dashboard/{page}", json={**OCT, **body})
    assert r.status_code == status, r.text
    assert needle in r.json()["detail"]


def test_no_tab_view_is_403(db, api, dash):
    assert api(make_user(db, "n@x.com", [])).post(f"{URL}/dashboard/overview", json=OCT).status_code == 403


def test_each_dataset_is_loaded_once_per_request(db, api, dash):
    c = api(_viewer(db))
    CALLS.clear()
    ok(c, compare="previous_period")
    assert len(CALLS) == 1  # 10 visuals, one load


def test_export_dashboard_workbook(db, api, dash):
    u = make_user(db, "e@x.com", VIEW + EXPORT + CHARGES + PEOPLE)
    c = api(u)
    r = c.get(f"{URL}/dashboard/overview/export", params={**OCT, "f_priority": "urgent,standard", "compare": "previous_period"})
    assert r.status_code == 200
    assert 'filename="Service_Overview_2026-10-01_to_2026-10-31.xlsx"' in r.headers["content-disposition"]
    wb = load_workbook(BytesIO(r.content))
    assert wb.sheetnames[0] == "Summary" and wb.sheetnames[-1] == "Definitions" and "Records" in wb.sheetnames
    assert {"By priority", "By month", "Priority table", "Longest jobs", "Billed by month"} <= set(wb.sheetnames)
    pri = wb["By priority"]
    assert pri.cell(7, 1).value == "Group" and pri.cell(8, 1).value == "Standard" and pri.cell(8, 2).value == 4
    assert len(pri._charts) == 1 and pri.cell(7, 3).value == "Previous period"
    assert pri.freeze_panes == "B8" and pri.page_setup.orientation == "landscape"
    summary = wb["Summary"]
    texts = " ".join(str(cell.value) for row in summary.iter_rows() for cell in row if cell.value is not None)
    assert "Filters: Priority: Urgent, Standard" in texts and "Records" in texts and "Generated" in texts
    rec = wb["Records"]
    assert rec.cell(8, 2).value is not None and rec.auto_filter.ref.startswith("A7:")
    assert wb["Longest jobs"].cell(8, 1).value is not None
    assert wb["Definitions"].cell(8, 1).value == "Records" and wb["Definitions"].cell(8, 2).value == "Number of toy records"
    log = db.query(AuditLog).filter_by(entity_type="report_export").one()
    assert "Overview dashboard" in log.summary and log.subtab_key == "reports" and log.performed_by_id == u.id


def test_export_single_visual_permissions_and_cap(db, api, dash, monkeypatch):
    nox = api(_viewer(db))
    assert nox.get(f"{URL}/dashboard/overview/export", params=OCT).status_code == 403  # no Export right
    c = api(make_user(db, "e2@x.com", VIEW + EXPORT))
    r = c.get(f"{URL}/dashboard/overview/export", params={**OCT, "visual": "v_pri"})
    wb = load_workbook(BytesIO(r.content))
    assert wb.sheetnames == ["Summary", "By priority", "Definitions"]
    assert c.get(f"{URL}/dashboard/overview/export", params={**OCT, "visual": "v_bill"}).status_code == 403
    wb = load_workbook(BytesIO(c.get(f"{URL}/dashboard/overview/export", params=OCT).content))
    assert "Billed by month" not in wb.sheetnames
    monkeypatch.setattr(engine, "EXPORT_CAP", 3)
    r = c.get(f"{URL}/dashboard/overview/export", params=OCT)
    assert r.status_code == 422 and "limit 3" in r.json()["detail"]


def test_register_dashboard_guards():
    with pytest.raises(ValueError):
        register_dashboard(DashboardDef("erp", "bad", "Bad", 1, (
            DashboardPage("p", "P", kpis=(VisualSpec("a", "kpi", "A", measure="count"), VisualSpec("a", "kpi", "B", measure="count")),
                          dataset="toy"),)))


def test_age_buckets_follow_dimension_order_not_text_or_value(db, api, dash):
    c = api(_viewer(db))
    j = ok(c, "ages", date_from="2026-09-01", date_to="2026-10-31", filters={}, visuals=[{"id": "f_age"}, {"id": "f_age_label"}])
    for vid in ("f_age", "f_age_label"):
        assert j["results"][vid]["labels"] == [x for x in AGE_ORDER if x in j["results"][vid]["labels"]]
        assert j["results"][vid]["labels"] != sorted(j["results"][vid]["labels"])
    assert j["results"]["f_age"]["tokens"] == sorted(j["results"]["f_age"]["tokens"])  # b1..b6
    # an explicit value_desc still sorts by the figure
    d = ok(c, "ages", date_from="2026-09-01", date_to="2026-10-31", visuals=[{"id": "f_age_desc"}])["results"]["f_age_desc"]
    assert d["values"] == sorted(d["values"], reverse=True)


def test_fixed_filters_page_and_visual(db, api, dash):
    c = api(_viewer(db))
    j = ok(c, "fixed", visuals=[{"id": "f_all"}, {"id": "f_c11"}])
    assert j["kpis"]["f_all"]["value"] == 3 and j["kpis"]["f_c11"]["value"] == 2
    assert j["filters_applied"] == [{"key": "priority", "label": "Priority", "value": "Urgent", "locked": True}]
    # a viewer filter on the same field is intersected; a contradiction matches nothing
    both = ok(c, "fixed", filters={"f_priority": "urgent,standard"}, visuals=[{"id": "f_all"}])["kpis"]["f_all"]["value"]
    assert both == 3
    none = ok(c, "fixed", filters={"f_priority": "standard"}, visuals=[{"id": "f_all"}])["kpis"]["f_all"]["value"]
    assert none == 0
    # a per-visual override cannot drop a fixed filter
    j = ok(c, "fixed", visuals=[{"id": "f_all", "filters": {}}])
    assert j["kpis"]["f_all"]["value"] == 3
    cat = c.get(URL).json()
    pg = next(p for p in cat["dashboards"][0]["pages"] if p["key"] == "fixed")
    assert pg["fixed_filters"] == {"priority": "urgent"}
    assert next(k for k in pg["kpis"] if k["id"] == "f_c11")["fixed_filters"] == {"priority": "urgent", "customer": "11"}
    r = api(make_user(db, "e@x.com", VIEW + EXPORT)).get(f"{URL}/dashboard/fixed/export", params=OCT)
    wb = load_workbook(BytesIO(r.content))
    assert wb["Records"].auto_filter.ref == "A7:E10"  # only the 3 urgent records
