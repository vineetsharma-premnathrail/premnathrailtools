"""New Material Issue: Excel lines are read into the form (not posted)."""
import io

from openpyxl import Workbook

from app.tests.test_store_plant_access import API, setup  # noqa: F401 — fixture


def _xlsx(rows):
    wb = Workbook()
    ws = wb.active
    for r in rows:
        ws.append(r)
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


def test_import_lines_merges_and_reports_bad_rows(client, setup):  # noqa: F811
    data = _xlsx([["item_code", "quantity", "batch_number", "remarks"],
                  ["MT-GEN-0001", 2, "", ""], ["mt-gen-0001", 3, "", ""], ["NOPE-1", 1, "", ""], ["MT-GEN-0001", "x", "", ""]])
    r = client.post(f"{API}/material-issues/import-lines", files={"file": ("lines.xlsx", data)}, headers=setup["admin"])
    assert r.status_code == 200, r.text
    body = r.json()
    assert len(body["lines"]) == 1 and body["lines"][0]["quantity"] == 5
    assert [e["row"] for e in body["errors"]] == [4, 5]
    t = client.get(f"{API}/material-issues/import-lines/template", headers=setup["admin"])
    assert t.status_code == 200 and t.content[:2] == b"PK"
